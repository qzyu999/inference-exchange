# Isolated GitHub OAuth provider browser staging (#179)

**Status (2026-10-29): the isolated M6 loopback test passed with two real GitHub identities.** This guide remains a reproducible staging procedure, not qualification of an independent provider under #160/#9.

## Verified scope and remaining checks

Operator-reported acceptance using revision `b55e17a` (before this documentation update): real GitHub OAuth, two separate account sessions, owner-private nodes and earnings, self-service L0/Open token issuance, Qwen2.5 0.5B inference on isolated port `10000`, integer microUSD settlement `100 = 90 + 10`, live credential revocation, terminal agent exit `78`, native server cleanup, and rejected reconnect (`4003`). Logout returned `401`; the original M6 inference server on `9999` stayed healthy. Isolated staging services were stopped after testing. These are observed hardware results, not automated CI assertions.

**Still unverified:** independent third-party Mac/network, HTTPS/WSS public ingress, signup-disabled *new-user* browser path, foreign-owner credential DELETE, duplicate/invalid-profile browser path, CSRF failure/recovery, temporary coordinator outage/reconnect, and launchd supervisor behavior. Do not repeat already passed hardware tests just because this guide was updated. Keep `IE_SIGNUP_DISABLED=1` and `IE_PROVIDER_SELF_ENROLL_ENABLED=0` when staging is restarted by default.

## Safety preflight

1. First run the read-only M6 and MBP A status commands from the 2026-10-29 handoff. Check the original launchd provider and coordinator remotely registered provider count. Do not print environment files, tokens, OAuth secrets, full process arguments, or service scripts.
2. Work only in the independent M6 staging checkout and staging database. Confirm `127.0.0.1:8001` and `127.0.0.1:10000` are free. Preserve production M6 `127.0.0.1:9999`, its LaunchAgent, node, provider credential, billing principal, and all historical transactions.
3. Use an independent staging SQLite path, HOME, audit log, JWT secret, OAuth App, and service configuration. Never source `alpha-env.sh` or reuse a production token or database. Do not publish staging ports through a tunnel, Cloudflare, a router, or a public reverse proxy.
4. For production-mode API admission checks use `IE_ENV=prod`, `IE_PASSWORD_AUTH=0` and `IE_PRICE_COLLECTOR=0` in **staging only**. Enable `IE_PROVIDER_SELF_ENROLL_ENABLED=1` only on staging. A fresh real GitHub identity requires `IE_SIGNUP_DISABLED=0` for a bounded and locally restricted test window. Public alpha keeps its existing flags.

## Fixed loopback browser proxy

In the staging checkout's `web/` directory:

```bash
npm ci
npm run dev:provider-staging
```

This is a dedicated Vite dev entrypoint bound to **`127.0.0.1:3001`**, with a fixed port and all three routes `/v1`, `/ws`, and `/health` targeting **`127.0.0.1:8001`**. It cannot silently proxy to the usual dev target `:8000`. Do not use ordinary `npm run dev` or append `--host` for this test.

Set the independent coordinator's `IE_PUBLIC_URL` exactly to:

```text
http://127.0.0.1:3001
```

Create a **separate** GitHub OAuth App. Configure its callback URL (with wildcard matching disabled) exactly to:

```text
http://127.0.0.1:3001/v1/auth/github/callback
```

Set `IE_GITHUB_CLIENT_ID` and `IE_GITHUB_CLIENT_SECRET` only in the private staging environment. The browser and callback must consistently use `127.0.0.1`, not `localhost`.

**Secure-cookie caveat:** `IE_ENV=prod` sets `Secure` on OAuth/session cookies. HTTP loopback cookie exemptions vary. Verify that the **real browser** accepts and sends the cookie. If the cookie is rejected, stop. Obtain approval for a properly trusted, separately configured **HTTPS** staging origin and same-origin proxy. Do not weaken production cookie security or CSRF checks and do not expose staging to the public internet to bypass this limitation. Loopback browser tests alone do not qualify external ingress.

## Happy and failure-path acceptance

1. Confirm `/health` reports **zero staging providers** and `/v1/auth/config` reports GitHub enabled, password auth disabled. Confirm the browser's API requests go to staging only. Do not export HAR files or screenshots that expose secrets.
2. In a clean browser profile visit `http://127.0.0.1:3001/provide`. Test GitHub authorization redirect, matching state and PKCE exchange, session cookie, `/v1/auth/me`, return to `/provide`, reload and logout.
3. Test canceled/absent callback, wrong state, invalid code, signup disabled and replayed session after logout. No failed login creates a provider node. Use a **second actual GitHub identity** in another browser profile for cross-account tests; synthetic fixtures are not real OAuth logins.
4. Confirm only Apple Silicon/macOS + GGUF/Metal L0/Open is offered and it is labeled self-reported. Enroll through `/provide`; the one-time `pt-ie-` credential must never appear again in metadata, logs, screenshots, URLs, browser storage, or GitHub. Test duplicate enrollment, invalid hardware, anonymous and cross-owner access, Origin CSRF, and rate limits.
5. Connect **only a separate foreground test OCIP agent** to `ws://127.0.0.1:8001/ws/provider` using the test credential, local port `10000` and the GGUF read-only. Do not rotate or restart the original M6 agent. Run one real inference request, verify integer microUSD conservation and private provider earnings.
6. Revoke the **test** credential while actively connected. Verify WebSocket disconnect, reconnect denied with `4003`, terminal exit `78`, port `10000` released, and historical staging transactions conserved. Also test a transient coordinator disconnect and successful recovery.
7. Stop only staging foreground processes, disable staging signup/enrollment again, retain sanitized evidence, and re-check production MBP A / M6 health and original stable node/principal/ledger. Update #179 and #160 with the exact test code SHA and limitations.

**Release gate:** A second real GitHub identity on the existing M6 is **not** an independent provider Mac/operator/network. Keep #160/#9 open until an external Apple Silicon provider qualifies. #178 launchd policy, #109 release readiness, #123 Cloudflare Access segmentation and #174 legal/privacy review remain separate. This procedure does not authorize public/global signup, payouts, real-money settlement, attestation, or confidential-inference claims.
