"""Exchange simulation — multiple buyers with different preferences competing.

Simulates a real marketplace with:
- Buyers with different budgets and routing preferences
- Concurrent requests creating contention
- Providers filling up, forcing overflow to more expensive providers

Watch the dashboard at http://localhost:8000 while this runs.

Usage:
    .venv\\Scripts\\python tests/simulate_exchange.py
"""

import asyncio
import random
import time

import httpx

BASE_URL = "http://localhost:8000"

# --- Buyer Profiles ---
# Each buyer has a personality: budget, preference, request rate

BUYERS = [
    {
        "name": "Budget Bot",
        "style": "cheapest",
        "max_price": 0.15,
        "interval": 2.0,  # seconds between requests
        "prompts": [
            "What's 2+2?",
            "Name a color.",
            "Say hi.",
            "Count to 3.",
            "What day is it?",
        ],
    },
    {
        "name": "Speed Freak",
        "style": "fastest",
        "max_price": 1.00,  # Doesn't care about price
        "interval": 1.5,
        "prompts": [
            "Quick! One word answer: capital of France?",
            "Fast! Name an animal.",
            "Hurry! What's the opposite of hot?",
            "Quick! Name a fruit.",
            "Speed! What color is the sky?",
        ],
    },
    {
        "name": "Security First",
        "style": "most_secure",
        "max_price": 0.60,
        "interval": 3.0,
        "prompts": [
            "What are my account details? (test: should be private)",
            "Process this sensitive data: hello world",
            "Confidential query: what is 1+1?",
            "Private: name a country.",
            "Secure request: say hello.",
        ],
    },
    {
        "name": "Bulk Worker",
        "style": "cheapest",
        "max_price": 0.30,
        "interval": 1.0,  # Very frequent
        "prompts": [
            "Summarize: hello.",
            "Translate: hi.",
            "Classify: cat.",
            "Extract: the sky is blue.",
            "Generate: one word.",
        ],
    },
    {
        "name": "Casual User",
        "style": "balanced",
        "max_price": 0.50,
        "interval": 4.0,  # Slow, casual
        "prompts": [
            "Tell me a joke in one sentence.",
            "What's a good book to read?",
            "How's the weather?",
            "What should I have for lunch?",
            "Name a random fun fact.",
        ],
    },
]


async def buyer_loop(client: httpx.AsyncClient, buyer: dict, duration: float, results: list):
    """Simulate a single buyer sending requests at their natural rate."""
    name = buyer["name"]
    end_time = time.time() + duration
    request_num = 0

    # Small random offset so buyers don't all start at exactly the same time
    await asyncio.sleep(random.random() * 1.0)

    while time.time() < end_time:
        prompt = random.choice(buyer["prompts"])
        request_num += 1
        start = time.time()

        try:
            resp = await client.post(
                f"{BASE_URL}/v1/chat/completions",
                json={
                    "model": "default",
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "max_tokens": 15,
                },
                timeout=30,
            )
            elapsed = time.time() - start

            if resp.status_code == 200:
                data = resp.json()
                tokens = data.get("usage", {}).get("completion_tokens", 0)
                results.append({
                    "buyer": name,
                    "status": "ok",
                    "tokens": tokens,
                    "latency_ms": int(elapsed * 1000),
                    "time": time.time(),
                })
            else:
                results.append({
                    "buyer": name,
                    "status": f"http_{resp.status_code}",
                    "latency_ms": int(elapsed * 1000),
                    "time": time.time(),
                })
        except Exception as e:
            results.append({
                "buyer": name,
                "status": "error",
                "error": str(e)[:50],
                "time": time.time(),
            })

        # Wait before next request (with jitter)
        jitter = random.uniform(0.5, 1.5)
        await asyncio.sleep(buyer["interval"] * jitter)


async def main():
    duration = 30  # Run for 30 seconds

    print()
    print("=" * 65)
    print("  INFERENCE EXCHANGE — MARKETPLACE SIMULATION")
    print("=" * 65)
    print()
    print(f"  Duration: {duration}s")
    print(f"  Buyers:   {len(BUYERS)}")
    print()

    # Check health
    async with httpx.AsyncClient() as client:
        try:
            health = await client.get(f"{BASE_URL}/health")
            h = health.json()
            print(f"  Coordinator: ✅ Online")
            print(f"  Providers:   {h['providers']}")
        except Exception as e:
            print(f"  ❌ Coordinator down: {e}")
            return

        if h["providers"] == 0:
            print("  ⚠️  No providers. Start some first.")
            return

        # Show buyers
        print()
        print(f"  {'Buyer':<18} {'Strategy':<14} {'Max $/M':<10} {'Rate'}")
        print(f"  {'-'*18} {'-'*14} {'-'*10} {'-'*12}")
        for b in BUYERS:
            print(f"  {b['name']:<18} {b['style']:<14} ${b['max_price']:<9.2f} 1/{b['interval']:.1f}s")

        print()
        print(f"  Starting simulation... watch http://localhost:8000")
        print()

        # Get initial balance
        bal_before = (await client.get(f"{BASE_URL}/v1/exchange/balance")).json()

        # Run all buyers concurrently
        results: list[dict] = []
        tasks = [
            buyer_loop(client, buyer, duration, results)
            for buyer in BUYERS
        ]

        start = time.time()
        await asyncio.gather(*tasks)
        elapsed = time.time() - start

        # Get final state
        bal_after = (await client.get(f"{BASE_URL}/v1/exchange/balance")).json()
        telemetry = (await client.get(f"{BASE_URL}/v1/exchange/telemetry")).json()

        # Analyze results
        successes = [r for r in results if r["status"] == "ok"]
        errors = [r for r in results if r["status"] != "ok"]

        print()
        print("=" * 65)
        print("  RESULTS")
        print("=" * 65)
        print()
        print(f"  Duration:        {elapsed:.1f}s")
        print(f"  Total requests:  {len(results)}")
        print(f"  Successful:      {len(successes)}")
        print(f"  Failed:          {len(errors)}")
        print(f"  Throughput:      {len(results)/elapsed:.1f} req/s")

        if successes:
            latencies = sorted(r["latency_ms"] for r in successes)
            print(f"\n  Latency:")
            print(f"    P50:  {latencies[len(latencies)//2]}ms")
            print(f"    P95:  {latencies[int(len(latencies)*0.95)]}ms")
            print(f"    P99:  {latencies[int(len(latencies)*0.99)]}ms")
            print(f"    Max:  {latencies[-1]}ms")

        # Per-buyer breakdown
        print(f"\n  Per-Buyer Breakdown:")
        print(f"  {'Buyer':<18} {'Reqs':<6} {'OK':<6} {'Fail':<6} {'Avg ms':<8} {'Tokens'}")
        print(f"  {'-'*18} {'-'*6} {'-'*6} {'-'*6} {'-'*8} {'-'*8}")

        for buyer in BUYERS:
            name = buyer["name"]
            buyer_results = [r for r in results if r["buyer"] == name]
            buyer_ok = [r for r in buyer_results if r["status"] == "ok"]
            buyer_fail = [r for r in buyer_results if r["status"] != "ok"]
            avg_lat = sum(r.get("latency_ms", 0) for r in buyer_ok) // max(len(buyer_ok), 1)
            total_tok = sum(r.get("tokens", 0) for r in buyer_ok)
            print(f"  {name:<18} {len(buyer_results):<6} {len(buyer_ok):<6} {len(buyer_fail):<6} {avg_lat:<8} {total_tok}")

        # Economics
        spent = bal_after["total_spent_usd"] - bal_before["total_spent_usd"]
        print(f"\n  Economics:")
        print(f"    Total spent:   ${spent:.6f}")
        print(f"    Balance:       ${bal_after['balance_usd']:.4f}")
        print(f"    Avg cost/req:  ${spent/max(len(successes),1):.6f}")
        print(f"    Volume (all):  ${telemetry['economics']['total_volume_usd']:.6f}")

        if errors:
            error_types = {}
            for e in errors:
                t = e["status"]
                error_types[t] = error_types.get(t, 0) + 1
            print(f"\n  Errors: {error_types}")

        print()


if __name__ == "__main__":
    asyncio.run(main())
