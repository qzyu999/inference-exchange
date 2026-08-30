"""Local E2E Test — proves the full system works incrementally.

Levels 0-3: everything runnable on Windows with no special hardware.
Each level builds on the previous, testing increasingly complex scenarios.

Prerequisites:
  - .venv activated
  - pip install -e ".[dev]"
  - At least one model downloaded: python -m inference_exchange download-model

Usage:
  .venv\\Scripts\\python tests/local_e2e_test.py
  .venv\\Scripts\\python tests/local_e2e_test.py --level 2  (run up to level 2 only)

The script starts/stops all processes automatically.
"""

import argparse
import asyncio
import json
import os
import signal
import subprocess
import sys
import time

import httpx

BASE_URL = "http://localhost:8000"
PYTHON = sys.executable
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Track spawned processes for cleanup
_processes: list[subprocess.Popen] = []


def start_process(args: list[str], name: str, wait_for: str | None = None, wait_port: int | None = None) -> subprocess.Popen:
    """Start a subprocess and optionally wait for it to be ready."""
    print(f"  Starting {name}...")
    proc = subprocess.Popen(
        args,
        cwd=PROJECT_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    _processes.append(proc)

    if wait_port:
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                r = httpx.get(f"http://127.0.0.1:{wait_port}/health", timeout=2)
                if r.status_code == 200:
                    print(f"  ✓ {name} ready (port {wait_port})")
                    return proc
            except (httpx.ConnectError, httpx.ReadTimeout):
                pass
            if proc.poll() is not None:
                output = proc.stdout.read() if proc.stdout else ""
                print(f"  ✗ {name} exited early:\n{output[-500:]}")
                raise RuntimeError(f"{name} died during startup")
            time.sleep(0.5)
        raise RuntimeError(f"{name} didn't start within 30s")

    # Just wait a bit
    time.sleep(2)
    if proc.poll() is not None:
        output = proc.stdout.read() if proc.stdout else ""
        print(f"  ✗ {name} exited early:\n{output[-500:]}")
        raise RuntimeError(f"{name} died during startup")
    print(f"  ✓ {name} started (PID {proc.pid})")
    return proc


def stop_all():
    """Stop all spawned processes."""
    for proc in _processes:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
    _processes.clear()


def check(condition: bool, msg: str):
    """Assert with a descriptive message."""
    if condition:
        print(f"    ✓ {msg}")
    else:
        print(f"    ✗ FAIL: {msg}")
        raise AssertionError(msg)


# ---------------------------------------------------------------------------
# LEVEL 0: Basic E2E
# ---------------------------------------------------------------------------

def level_0():
    """Basic coordinator + provider + inference."""
    print("\n" + "=" * 60)
    print("  LEVEL 0: Basic E2E (coordinator + provider + inference)")
    print("=" * 60)

    stop_all()

    # Start coordinator
    start_process(
        [PYTHON, "-m", "inference_exchange.coordinator"],
        "Coordinator",
        wait_port=8000,
    )

    # Start provider
    start_process(
        [PYTHON, "-m", "inference_exchange.provider",
         "--name", "level0-provider", "--price-output", "0.10",
         "--trust", "open", "--tps", "25"],
        "Provider",
    )
    time.sleep(4)  # Wait for provider to register

    # Check health
    r = httpx.get(f"{BASE_URL}/health")
    check(r.status_code == 200, "Health endpoint returns 200")
    health = r.json()
    check(health["providers"] >= 1, f"At least 1 provider connected ({health['providers']})")

    # Send non-streaming request
    print("\n  [Test] Non-streaming inference:")
    r = httpx.post(f"{BASE_URL}/v1/chat/completions", json={
        "model": "default",
        "messages": [{"role": "user", "content": "What is 1+1? One word."}],
        "stream": False,
        "max_tokens": 10,
    }, timeout=30)
    check(r.status_code == 200, f"Status 200 (got {r.status_code})")
    data = r.json()
    check("choices" in data, "Response has choices")
    content = data["choices"][0]["message"]["content"]
    check(len(content) > 0, f"Got response: '{content}'")
    check("usage" in data, "Response has usage stats")
    check(data["usage"]["completion_tokens"] > 0, f"Tokens counted: {data['usage']}")

    # Send streaming request
    print("\n  [Test] Streaming inference:")
    r = httpx.post(f"{BASE_URL}/v1/chat/completions", json={
        "model": "default",
        "messages": [{"role": "user", "content": "Say hello"}],
        "stream": True,
        "max_tokens": 10,
    }, timeout=30)
    check(r.status_code == 200, "Streaming response started")
    tokens = []
    for line in r.text.split("\n"):
        if line.startswith("data: ") and line != "data: [DONE]":
            try:
                chunk = json.loads(line[6:])
                c = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                if c:
                    tokens.append(c)
            except json.JSONDecodeError:
                pass
    check(len(tokens) > 0, f"Got {len(tokens)} streamed tokens: {''.join(tokens)}")

    # Check billing
    print("\n  [Test] Billing:")
    r = httpx.get(f"{BASE_URL}/v1/exchange/balance")
    bal = r.json()
    check(bal["total_spent_usd"] > 0, f"Consumer spent: ${bal['total_spent_usd']:.6f}")
    check(bal["requests_made"] >= 2, f"Requests tracked: {bal['requests_made']}")

    # Check E2E encryption
    print("\n  [Test] E2E Encryption:")
    r = httpx.get(f"{BASE_URL}/v1/exchange/providers")
    providers = r.json()["providers"]
    check(len(providers) >= 1, "Provider listed")
    check(providers[0]["encrypted"], "Provider has encryption enabled")

    # Check traces
    print("\n  [Test] Decision traces:")
    r = httpx.get(f"{BASE_URL}/v1/exchange/traces")
    traces = r.json()["traces"]
    check(len(traces) >= 1, f"Traces recorded: {len(traces)}")
    check("scoring" in traces[0], "Trace includes scoring breakdown")

    print("\n  ✅ LEVEL 0 PASSED")


# ---------------------------------------------------------------------------
# LEVEL 1: Preference Routing (different prices/speeds/trust)
# ---------------------------------------------------------------------------

def level_1():
    """Multiple providers, preference-based routing picks different winners."""
    print("\n" + "=" * 60)
    print("  LEVEL 1: Preference Routing (3 providers, different winners)")
    print("=" * 60)

    stop_all()

    start_process(
        [PYTHON, "-m", "inference_exchange.coordinator"],
        "Coordinator",
        wait_port=8000,
    )

    # Three differentiated providers
    for name, price, trust, tps, hw in [
        ("cheap-node", "0.08", "open", "25", "apple-m1"),
        ("fast-node", "0.30", "contained", "120", "nvidia-rtx4090"),
        ("secure-node", "0.50", "confidential", "60", "amd-epyc-sev"),
    ]:
        start_process(
            [PYTHON, "-m", "inference_exchange.provider",
             "--name", name, "--price-output", price,
             "--trust", trust, "--tps", tps, "--hardware", hw],
            name,
        )
    time.sleep(5)

    r = httpx.get(f"{BASE_URL}/health")
    check(r.json()["providers"] == 3, "All 3 providers connected")

    # Test each preference picks a different winner
    results = {}
    for pref in ["cheapest", "fastest", "most_secure"]:
        r = httpx.post(f"{BASE_URL}/v1/chat/completions", json={
            "model": "default",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
            "max_tokens": 5,
            "ocip_preference": pref,
        }, timeout=30)
        check(r.status_code == 200, f"Preference '{pref}' returned 200")
        results[pref] = None

    # Check traces to see which provider won each
    r = httpx.get(f"{BASE_URL}/v1/exchange/traces")
    traces = r.json()["traces"][:3]
    for t in traces:
        pref = t.get("preference", "unknown")
        provider = t.get("selected_provider", "?")
        results[pref] = provider
        print(f"    {pref:15} → {provider}")

    # Verify different preferences produce different winners
    unique_winners = len(set(v for v in results.values() if v))
    check(unique_winners >= 2, f"At least 2 different winners across preferences ({unique_winners})")

    print("\n  ✅ LEVEL 1 PASSED")


# ---------------------------------------------------------------------------
# LEVEL 2: Two-Process Architecture (OCIP Agent)
# ---------------------------------------------------------------------------

def level_2():
    """OCIP Agent manages a separate inference server process."""
    print("\n" + "=" * 60)
    print("  LEVEL 2: Two-Process Architecture (OCIP Agent + Server)")
    print("=" * 60)

    stop_all()

    start_process(
        [PYTHON, "-m", "inference_exchange.coordinator"],
        "Coordinator",
        wait_port=8000,
    )

    # Start OCIP agent (it starts its own inference server)
    start_process(
        [PYTHON, "ocip_agent/agent.py",
         "--name", "ocip-two-process",
         "--trust", "hardened",
         "--price-output", "0.12"],
        "OCIP Agent",
    )
    time.sleep(8)  # Agent needs to start server + connect

    r = httpx.get(f"{BASE_URL}/health")
    check(r.json()["providers"] >= 1, "OCIP agent registered as provider")

    # Verify the provider shows trust="hardened"
    r = httpx.get(f"{BASE_URL}/v1/exchange/providers")
    providers = r.json()["providers"]
    ocip_provider = next((p for p in providers if "ocip" in p["name"].lower()), None)
    check(ocip_provider is not None, "OCIP provider found in registry")
    check(ocip_provider["trust_level"] == "hardened", f"Trust level is hardened (got: {ocip_provider['trust_level']})")
    check(ocip_provider["encrypted"], "E2E encryption active")

    # Send a request through the two-process pipeline
    print("\n  [Test] Request through two-process architecture:")
    r = httpx.post(f"{BASE_URL}/v1/chat/completions", json={
        "model": "default",
        "messages": [{"role": "user", "content": "What is the meaning of life? One sentence."}],
        "stream": False,
        "max_tokens": 20,
    }, timeout=30)
    check(r.status_code == 200, "Request succeeded")
    content = r.json()["choices"][0]["message"]["content"]
    check(len(content) > 0, f"Got response: '{content[:50]}...'")

    # Check trace shows encryption
    r = httpx.get(f"{BASE_URL}/v1/exchange/traces")
    traces = r.json()["traces"]
    if traces:
        check(traces[0].get("encrypted", False), "Request was E2E encrypted")

    print("\n  ✅ LEVEL 2 PASSED")


# ---------------------------------------------------------------------------
# LEVEL 3: Consumer SDK Integration
# ---------------------------------------------------------------------------

def level_3():
    """OpenAI SDK works as a drop-in replacement."""
    print("\n" + "=" * 60)
    print("  LEVEL 3: Consumer SDK Integration (OpenAI SDK)")
    print("=" * 60)

    # Don't stop — reuse Level 2's setup (if running), or start fresh
    try:
        r = httpx.get(f"{BASE_URL}/health", timeout=2)
        if r.json()["providers"] == 0:
            raise Exception("No providers")
    except Exception:
        stop_all()
        start_process(
            [PYTHON, "-m", "inference_exchange.coordinator"],
            "Coordinator",
            wait_port=8000,
        )
        start_process(
            [PYTHON, "-m", "inference_exchange.provider",
             "--name", "sdk-test-provider", "--price-output", "0.15"],
            "Provider",
        )
        time.sleep(4)

    try:
        from openai import OpenAI
    except ImportError:
        print("  ⚠ OpenAI SDK not installed — skipping Level 3")
        print("  Install with: pip install openai")
        return

    client = OpenAI(base_url=f"{BASE_URL}/v1", api_key="sk-ie-test")

    # Test 1: List models
    print("\n  [Test] OpenAI SDK — list models:")
    models = client.models.list()
    model_ids = [m.id for m in models.data]
    check(len(model_ids) > 0, f"Models listed: {model_ids}")

    # Test 2: Non-streaming completion
    print("\n  [Test] OpenAI SDK — non-streaming:")
    r = client.chat.completions.create(
        model="default",
        messages=[{"role": "user", "content": "Say hello"}],
        max_tokens=10,
    )
    check(r.choices[0].message.content is not None, f"Response: '{r.choices[0].message.content}'")

    # Test 3: Streaming completion
    print("\n  [Test] OpenAI SDK — streaming:")
    stream = client.chat.completions.create(
        model="default",
        messages=[{"role": "user", "content": "Count to 3"}],
        max_tokens=15,
        stream=True,
    )
    tokens = []
    for chunk in stream:
        if chunk.choices[0].delta.content:
            tokens.append(chunk.choices[0].delta.content)
    check(len(tokens) > 0, f"Streamed {len(tokens)} tokens: {''.join(tokens)}")

    # Test 4: Multi-tenant API keys
    print("\n  [Test] Multi-tenant API keys:")
    r1 = httpx.post(f"{BASE_URL}/v1/auth/keys", json={"name": "Alice"})
    r2 = httpx.post(f"{BASE_URL}/v1/auth/keys", json={"name": "Bob"})
    alice_key = r1.json()["api_key"]
    bob_key = r2.json()["api_key"]

    alice = OpenAI(base_url=f"{BASE_URL}/v1", api_key=alice_key)
    bob = OpenAI(base_url=f"{BASE_URL}/v1", api_key=bob_key)

    alice.chat.completions.create(model="default", messages=[{"role": "user", "content": "hi"}], max_tokens=5)
    bob.chat.completions.create(model="default", messages=[{"role": "user", "content": "hi"}], max_tokens=5)

    alice_bal = httpx.get(f"{BASE_URL}/v1/auth/me", headers={"Authorization": f"Bearer {alice_key}"}).json()
    bob_bal = httpx.get(f"{BASE_URL}/v1/auth/me", headers={"Authorization": f"Bearer {bob_key}"}).json()

    check(alice_bal["requests_made"] >= 1, f"Alice: {alice_bal['requests_made']} requests, spent ${alice_bal['total_spent_usd']:.6f}")
    check(bob_bal["requests_made"] >= 1, f"Bob: {bob_bal['requests_made']} requests, spent ${bob_bal['total_spent_usd']:.6f}")
    check(alice_bal["consumer_id"] != bob_bal["consumer_id"], "Alice and Bob have different consumer IDs")

    print("\n  ✅ LEVEL 3 PASSED")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Local E2E Test Suite")
    parser.add_argument("--level", type=int, default=3, help="Run up to this level (0-3)")
    args = parser.parse_args()

    print()
    print("=" * 60)
    print("  INFERENCE EXCHANGE — LOCAL E2E TEST")
    print(f"  Running levels 0 through {args.level}")
    print("=" * 60)

    try:
        if args.level >= 0:
            level_0()
        if args.level >= 1:
            level_1()
        if args.level >= 2:
            level_2()
        if args.level >= 3:
            level_3()

        print()
        print("=" * 60)
        print(f"  🎉 ALL LEVELS (0-{args.level}) PASSED")
        print("=" * 60)
        print()

    except AssertionError as e:
        print(f"\n  ❌ TEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n  ❌ ERROR: {e}")
        sys.exit(1)
    finally:
        stop_all()


if __name__ == "__main__":
    main()
