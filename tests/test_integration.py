"""Quick integration test — verifies TPS tracking + HF search + billing all work."""
import httpx
import json
import time

BASE = "http://localhost:8000"

print("=== Integration Test ===\n")

# 1. Send 3 requests
print("[1] Sending 3 requests...")
for i in range(3):
    r = httpx.post(f"{BASE}/v1/chat/completions", json={
        "model": "default",
        "messages": [{"role": "user", "content": "say one word"}],
        "stream": False,
        "max_tokens": 5,
    }, timeout=30)
    assert r.status_code == 200, f"Request failed: {r.status_code}"
print("    ✓ All succeeded")

# 2. Check TPS tracking
print("\n[2] TPS Tracking:")
r = httpx.get(f"{BASE}/v1/exchange/tps")
stats = r.json()["tps_stats"]
for s in stats:
    print(f"    {s['provider_id']}/{s['model']}: "
          f"estimated={s['estimated_tps']}, "
          f"observed={s['observed_tps_ema']:.1f}, "
          f"effective={s['effective_tps']:.1f} "
          f"({s['total_requests']} reqs)")
assert len(stats) > 0, "No TPS stats recorded!"
assert stats[0]["total_requests"] >= 3, "Not enough measurements"
print("    ✓ TPS tracking works")

# 3. Check HF model search
print("\n[3] HuggingFace Model Search:")
r = httpx.get(f"{BASE}/v1/exchange/models/search", params={"q": "qwen2.5 gguf"})
models = r.json()["models"]
print(f"    Found {len(models)} models for 'qwen2.5 gguf'")
if models:
    print(f"    Top: {models[0]['repo_id']} ({models[0]['downloads']} downloads)")
assert len(models) > 0, "No models found!"
print("    ✓ HF search works")

# 4. Check billing persisted
print("\n[4] Billing (persisted):")
r = httpx.get(f"{BASE}/v1/exchange/balance")
bal = r.json()
print(f"    Balance: ${bal['balance_usd']:.4f}, Spent: ${bal['total_spent_usd']:.4f}, Requests: {bal['requests_made']}")
assert bal["requests_made"] >= 3
print("    ✓ Billing works")

# 5. Check admin state includes TPS
print("\n[5] Admin State:")
r = httpx.get(f"{BASE}/v1/admin/state")
state = r.json()
print(f"    Components: {len(state['system']['components'])}")
print(f"    Providers: {len(state['providers'])}")
print(f"    Accounts: {len(state['accounts'])}")
print(f"    Traces: {len(state['traces'])}")
print("    ✓ Admin state works")

print("\n=== All integration tests passed ===")
