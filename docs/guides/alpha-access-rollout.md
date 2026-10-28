# Alpha ingress: IE identity for users and providers, Cloudflare Access for operators only

This is a **staged runbook**, not an instruction to remove the live Access application immediately.
Tracking issue: [#123](https://github.com/qzyu999/inference-exchange/issues/123).

## Identity boundaries

| Path / persona | Cloudflare Access login? | IE credential / behavior |
| --- | --- | --- |
| `/`, `/docs`, `/v1/models`, market discovery | **No** | Public/read-only |
| `/login`, `/v1/auth/github/*`, `/chat` | **No** | GitHub OAuth -> IE session cookie for account functions |
| `/v1/chat/completions` | **No** | IE API key for SDK or IE session cookie; unauthenticated production requests rejected |
| `/v1/exchange/balance`, `/history`, `/traces`, `/v1/auth/keys` | **No** | IE account authorization, never a shared anonymous identity |
| `/ws/provider` | **No** | IE-issued provider token + capability/admission checks. Current agents send provider token in WebSocket URL; migrate away from URL logging separately |
| `/admin`, `/v1/admin/*` | **Yes (owner only)** | Additional IE admin JWT role checks. No reliance on Cloudflare identity alone |
| `/metrics`, `/openapi.json`, `/redoc` | Not routable | 404 at the loopback proxy |

The static React pages may render when unauthenticated; API authorization must prevent sensitive operations. Do not equate page visibility with access to inference or data.

**Caveat:** The path-specific Access gate is an **edge policy**, not enforced by `deploy/Caddyfile.alpha-local` itself. The FastAPI app independently enforces admin authorization, but if Cloudflare Access is removed or bypassed, the extra layer disappears. Directly exposing the origin IP/ports, creating an alternate unrestricted public hostname that reaches the same paths, or using an unchecked tunnel route can bypass the edge gate. Keep the coordinator/Caddy local, check all tunnel public hostnames, and consider verified Access JWT enforcement at the origin before production.

## Preflight (keep existing blanket Access enabled)

1. On MBP A, save your `~/.inference-exchange/alpha-env.sh` and SQLite backup. Do not paste or commit secrets.
2. Build frontend from the repo root: `cd web && npm ci && npm run build && cd ..`.
3. Ensure `source ~/.inference-exchange/alpha-env.sh` sets `IE_ENV=prod`, `IE_PUBLIC_URL=https://alpha.inferenceex.com`, `IE_JWT_SECRET`, OAuth credentials, and your admin email. Keep the existing authenticated Mac mini provider connected.
4. Start the existing coordinator on port 8000 (from your virtualenv). Caddy and Cloudflare Tunnel remain separate running processes.
5. Configure the tracked **loopback-only** ingress below instead of the old temporary `/tmp/ie-alpha.Caddyfile`:

```bash
cd ~/Desktop/projects/inference-exchange
export IE_ALPHA_WEB_ROOT="$PWD/web/dist"
caddy validate --config deploy/Caddyfile.alpha-local
caddy run --config deploy/Caddyfile.alpha-local
```

Caddy serves `127.0.0.1:8080`; the tunnel's existing `alpha.inferenceex.com` hostname routes to `http://localhost:8080`. No extra exposed port, new coordinator process, second SQLite database, or public Caddy listener is required. Keep `api-dev.inferenceex.com` protected until all alternate paths to admin routes are inventoried.

## Stage Cloudflare Access protection for **admin paths**

While the existing `alpha.inferenceex.com` root Access application is **still enabled**:

1. Under **Zero Trust -> Access controls -> Applications**, create a self-hosted Access app for each protected exact path/pattern. Use owner-email-only **Allow** policies, never `Everyone`:
   - `alpha.inferenceex.com/admin` (browser admin UI)
   - `alpha.inferenceex.com/v1/admin` (exact parent, if requested)
   - `alpha.inferenceex.com/v1/admin/*` (all nested admin API paths)
2. Confirm Cloudflare's specific-path application matching takes precedence over the broader hostname app. Note the wildcard path **does not include the parent**. Do not use a wildcard hostname or a public `Bypass` policy to represent an operator allowlist.
3. In a fresh browser, visit `/admin` and `/v1/admin/controls`. Confirm both require Cloudflare Access for your allowlisted email, then independently require a valid GitHub IE admin session. Try a different browser with no Access cookies; IE JSON 403 by itself does **not** demonstrate Cloudflare protection.
4. Inspect **all** Tunnel public hostname routes and any DNS/origin reachability. An unrestricted `api-dev` or other alternate hostname leading to the same origin can bypass path-specific Access. Either keep those routes Access-protected, remove them, or enforce equivalent access controls.

Avoid putting Access in front of `/v1/auth/github/login`, `/v1/auth/github/callback`, `/v1/chat/completions`, or `/ws/provider` after the cutover. Standard users/providers should not encounter Cloudflare login screens.

## Cutover (manual, reversible; after tests)

1. Once the specific admin-path apps are confirmed working, **remove the original root `alpha.inferenceex.com` Access app** (do not delete any of the admin-path apps). Keep the Cloudflare Tunnel and DNS published hostname unchanged.
2. From a fresh incognito session with **no prior Cloudflare Access cookies**, test `/`, `/login`, `/v1/auth/config`, public market data and GitHub OAuth. Browser users should no longer see a Cloudflare PIN.
3. Run `python3 scripts/check_alpha_access_boundary.py --url https://alpha.inferenceex.com` from a machine without Access cookies. It makes only anonymous requests; no keys/secrets are needed.
4. Verify a new IE API key from an **independent machine** works with OpenAI SDK using only `Authorization: Bearer sk-ie-...`; an unauthenticated SDK must fail. The current Mac mini is registered as `open`/L0, so explicitly request `ocip_min_confidence="open"` with nonsensitive data only.
5. Verify an independent provider reconnects using **only an IE provider token** over `wss://alpha.inferenceex.com/ws/provider`, while invalid/revoked tokens fail. Don't paste provider token or its URL into logs/issues.
6. In your **admin browser**, navigate to `/admin`; Access should still challenge if not authenticated, and `/v1/admin/controls` should return 200 only after IE GitHub admin sign-in. Confirm non-admin IE users get 403 even if somehow allowed through Access.
7. Recheck rate limiting, request size, concurrency, model/context caps, logs and incident controls, particularly when exposing a one-slot hobby provider publicly. No real-money claims, payments or provider payouts.

**Rollback** if any authorization or route test fails: immediately re-enable a root/hostname-wide owner-only Access application at `alpha.inferenceex.com`, verify that an incognito browser is challenged, and optionally pause inference using an already authenticated IE admin session. Do not delete the tunnel/provider credentials or overwrite the live SQLite database.

Cloudflare application path semantics and precedence: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/

## Limits before public recruitment

- This runbook does not install Cloudflare policies for you, and the GitHub PR does **not** change your live Cloudflare account. Manually verify the actual Access apps; issue #123 is not completed by merging docs.
- `/ws/provider` currently supports credential-in-URL. It is an operational logging risk: track migration to a non-URL handshake and ensure logs redact URL query values.
- Some app/API paths are accessible anonymously by design. This runbook is not a replacement for a full endpoint inventory, per-user authorization tests, provider attestation, or security assessment.
- Treat any current Apple Silicon provider's self-claimed trust level as unverified unless independently substantiated.
