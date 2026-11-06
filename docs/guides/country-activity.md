# Approximate country activity

Overview can show where completed inference connects providers and API callers.
The globe uses country anchors, not device coordinates.
The same Cloudflare country header applies to browser and SDK requests through the public hostname.
An SDK call from a server describes that server's connection origin.
VPNs and proxies can change the apparent country.
Unknown countries are omitted.
The first version covers `/v1/chat/completions`; the separate confidential-session API is not included.

## What the public globe shows

The globe releases the previous UTC day's grouped country pairs.
Each pair needs at least five completed requests and three distinct consumer accounts.
Counts appear in bands such as `5–9`.
Matched, rejected, and failed requests do not qualify.
A node being online does not qualify.
With a small alpha network, an empty globe is expected.
The Show example control displays an illustration, not real traffic.
Routes do not link to individual traces.
The animation is decorative; it does not indicate active streaming or a direct network connection.
The coordinator still relays the inference traffic.

## Data handling

Collection is disabled by default.
The feature does not retain raw IPs, prompts, precise coordinates, or raw account/request IDs.
It keeps country counters and daily keyed hashes in process memory.
Only the current and previous UTC days are retained.
A cleanup task runs every minute.
A restart clears the counters; a release can then be empty or incomplete.
This first version assumes one coordinator process. Multiple workers do not share these counters.
No historic traces are backfilled.
Suppression reduces exposure but does not guarantee anonymity or resist users who control multiple accounts.
For stronger public anonymity, use larger cohorts and separately reviewed privacy measures.

## Enable collection at a trusted edge

Complete these steps before enabling collection.
Do not trust a country header sent directly by an arbitrary client.

1. Keep the coordinator and local web ingress unreachable from the public internet except through the configured Cloudflare path.
2. Enable Cloudflare IP Geolocation for the public hostname. This supplies `CF-IPCountry`.
3. Generate a random secret with `python3 -c 'import secrets; print(secrets.token_hex(32))'` in a private terminal.
4. In a Cloudflare Request Header Transform Rule, match only the IE API hostname. Set `X-IE-Geo-Secret` to that secret as a static value. Use Set, not Add, so an incoming client marker is overwritten. The rule must cover the API requests and `/ws/provider` upgrade.
5. Set the same value in `IE_GEO_INGRESS_SECRET` in the coordinator service's private environment. Set `IE_COUNTRY_ACTIVITY_ENABLED=1` there too. Do not place the secret in Git, URLs, logs, or screenshots.
6. Restart the coordinator with that environment. Reconnect providers so their new WebSocket handshakes carry the trusted country header.
7. Send authorized test requests through the public hostname. Direct local calls without the marker must remain unlocated. Do not log the complete incoming headers to debug this.
8. Check `/v1/exchange/country-activity` after the next UTC boundary. Sparse routes remain hidden. The enabled flag confirms configuration, not that Cloudflare supplied valid country data.

This PR does not modify Cloudflare rules or service environments.
Never reuse an API key, JWT secret, or provider credential as the geography marker.
Clear the flag and restart the coordinator to disable collection and clear the counters.

References:
- [Cloudflare IP geolocation](https://developers.cloudflare.com/network/ip-geolocation/)
- [Request Header Transform Rules](https://developers.cloudflare.com/rules/transform/request-header-modification/)

## Exclude an API request

An SDK caller can opt out without changing routing:

```python
client = OpenAI(
    api_key=os.environ["IE_API_KEY"],
    base_url="https://alpha.inferenceex.com/v1",
    default_headers={"X-IE-Exclude-Geography": "true"},
)
```

The same header excludes a provider WebSocket handshake if the client supplies it.
A provider without an available custom-header option can ask the operator to exclude its connection at the edge.
Do not interpret this approximate geography as an attestation or use it for access control.
