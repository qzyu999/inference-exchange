"""Load test — fires concurrent requests to demonstrate matching engine behavior.

Shows how requests are distributed across providers based on price, speed,
capacity, and consumer preferences.

Usage:
    .venv\\Scripts\\python tests/load_test.py [--requests N] [--concurrency C]
"""

import argparse
import asyncio
import json
import time

import httpx


BASE_URL = "http://localhost:8000"


async def send_request(
    client: httpx.AsyncClient,
    request_id: int,
    preference: str = "balanced",
    max_price: float | None = None,
) -> dict:
    """Send a single inference request and collect metadata."""
    start = time.time()

    body = {
        "model": "default",
        "messages": [{"role": "user", "content": f"Say hello (request {request_id})"}],
        "stream": False,
        "max_tokens": 20,
    }

    try:
        resp = await client.post(f"{BASE_URL}/v1/chat/completions", json=body, timeout=120)
        elapsed = time.time() - start

        if resp.status_code == 200:
            data = resp.json()
            return {
                "id": request_id,
                "status": "success",
                "provider": resp.headers.get("x-ocip-provider", "unknown"),
                "price": resp.headers.get("x-ocip-price-output", "?"),
                "tokens": data.get("usage", {}).get("completion_tokens", 0),
                "latency_ms": int(elapsed * 1000),
            }
        else:
            return {
                "id": request_id,
                "status": "error",
                "error": resp.text[:100],
                "latency_ms": int(elapsed * 1000),
            }
    except Exception as e:
        return {
            "id": request_id,
            "status": "exception",
            "error": str(e)[:100],
            "latency_ms": int((time.time() - start) * 1000),
        }


async def run_load_test(total_requests: int, concurrency: int):
    """Fire concurrent requests and report results."""
    print(f"\n{'='*60}")
    print(f"  INFERENCE EXCHANGE — LOAD TEST")
    print(f"  Requests: {total_requests} | Concurrency: {concurrency}")
    print(f"{'='*60}\n")

    # Check health first
    async with httpx.AsyncClient() as client:
        try:
            health = await client.get(f"{BASE_URL}/health")
            h = health.json()
            print(f"  Coordinator: ✅ Online")
            print(f"  Providers:   {h['providers']} connected")
            print(f"  Models:      {', '.join(h['models'])}")
        except Exception as e:
            print(f"  ❌ Coordinator unreachable: {e}")
            return

        if h["providers"] == 0:
            print("\n  ⚠️  No providers connected. Start some first.")
            return

        # Get provider details
        providers = await client.get(f"{BASE_URL}/v1/exchange/providers")
        provider_list = providers.json()["providers"]
        print(f"\n  Provider Fleet:")
        print(f"  {'Name':<30} {'Price':<10} {'Slots':<8} {'Encrypted'}")
        print(f"  {'-'*30} {'-'*10} {'-'*8} {'-'*10}")
        for p in provider_list:
            enc = "🔐" if p["encrypted"] else "🔓"
            print(f"  {p['name']:<30} ${p['price_output']:<9.2f} {p['max_concurrent']:<8} {enc}")

        # Fire requests
        print(f"\n  Sending {total_requests} requests (concurrency={concurrency})...\n")
        start = time.time()

        semaphore = asyncio.Semaphore(concurrency)

        async def bounded_request(i):
            async with semaphore:
                return await send_request(client, i)

        tasks = [bounded_request(i) for i in range(total_requests)]
        results = await asyncio.gather(*tasks)

        elapsed = time.time() - start

        # Analyze results
        successes = [r for r in results if r["status"] == "success"]
        errors = [r for r in results if r["status"] != "success"]

        print(f"\n  {'='*60}")
        print(f"  RESULTS")
        print(f"  {'='*60}")
        print(f"  Total time:      {elapsed:.2f}s")
        print(f"  Throughput:      {total_requests/elapsed:.1f} req/s")
        print(f"  Success:         {len(successes)}/{total_requests}")
        print(f"  Errors:          {len(errors)}")

        if successes:
            latencies = [r["latency_ms"] for r in successes]
            print(f"\n  Latency:")
            print(f"    Min:           {min(latencies)}ms")
            print(f"    Max:           {max(latencies)}ms")
            print(f"    Avg:           {sum(latencies)//len(latencies)}ms")
            print(f"    P50:           {sorted(latencies)[len(latencies)//2]}ms")

            # Distribution across providers
            provider_counts: dict[str, int] = {}
            for r in successes:
                p = r.get("provider", "unknown")
                provider_counts[p] = provider_counts.get(p, 0) + 1

            print(f"\n  Request Distribution:")
            print(f"  {'Provider':<30} {'Requests':<10} {'Share'}")
            print(f"  {'-'*30} {'-'*10} {'-'*10}")
            for name, count in sorted(provider_counts.items(), key=lambda x: -x[1]):
                share = count / len(successes) * 100
                bar = "█" * int(share / 5)
                print(f"  {name:<30} {count:<10} {share:.0f}% {bar}")

        if errors:
            print(f"\n  Errors:")
            for e in errors[:5]:
                print(f"    [{e['id']}] {e['status']}: {e.get('error', '')[:80]}")

        # Final balance
        balance = await client.get(f"{BASE_URL}/v1/exchange/balance")
        b = balance.json()
        print(f"\n  Account Balance: ${b['balance_usd']:.4f} (spent: ${b['total_spent_usd']:.4f})")
        print()


def main():
    parser = argparse.ArgumentParser(description="Inference Exchange load test")
    parser.add_argument("--requests", type=int, default=20, help="Total requests")
    parser.add_argument("--concurrency", type=int, default=5, help="Max concurrent")
    args = parser.parse_args()

    asyncio.run(run_load_test(args.requests, args.concurrency))


if __name__ == "__main__":
    main()
