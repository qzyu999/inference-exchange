"""Quick test: send requests with different preferences and show which provider wins."""
import httpx
import json

BASE = "http://localhost:8000"

prefs = ["cheapest", "fastest", "most_secure", "balanced"]

print("\nTesting preference routing:\n")
print(f"  {'Preference':<14} {'Winner':<30} {'Score':<8} {'Price':<8} {'TPS':<6} {'Trust'}")
print(f"  {'-'*14} {'-'*30} {'-'*8} {'-'*8} {'-'*6} {'-'*14}")

for pref in prefs:
    r = httpx.post(f"{BASE}/v1/chat/completions", json={
        "model": "default",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": False,
        "max_tokens": 3,
        "ocip_preference": pref,
    }, timeout=30)

# Now read traces
traces = httpx.get(f"{BASE}/v1/exchange/traces").json()["traces"][:4]

for t in reversed(traces):
    pref = t.get("preference", "balanced")
    winner = t["selected_provider"]
    scoring = t["scoring"]
    winner_data = next(s for s in scoring if s["selected"])
    print(f"  {pref:<14} {winner:<30} {winner_data['score']:<8.3f} ${winner_data['price']:<7.2f} {winner_data.get('tps',0):<6.0f} {winner_data['trust']}")

print("\n  Full scoring for 'cheapest':")
cheapest_trace = next((t for t in traces if t.get("preference") == "cheapest"), None)
if cheapest_trace:
    for s in cheapest_trace["scoring"]:
        marker = " ◄ WINNER" if s["selected"] else ""
        print(f"    {s['name']:<30} score={s['score']:.4f}  ${s['price']:.2f}  {s.get('tps',0):.0f}tps  {s['trust']}{marker}")

print("\n  Full scoring for 'most_secure':")
secure_trace = next((t for t in traces if t.get("preference") == "most_secure"), None)
if secure_trace:
    for s in secure_trace["scoring"]:
        marker = " ◄ WINNER" if s["selected"] else ""
        print(f"    {s['name']:<30} score={s['score']:.4f}  ${s['price']:.2f}  {s.get('tps',0):.0f}tps  {s['trust']}{marker}")
