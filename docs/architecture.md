# Architecture

This page shows the system as it is now. For the rules that the system must obey, see [Requirements](requirements/README.md).

## Components

```
Consumer (browser or OpenAI SDK)
   |  HTTPS
   v
Caddy  ---- serves the web UI (static files)
   |  reverse proxy: /v1/*, /ws/*, /health, /readiness
   v
Coordinator (FastAPI, one process)
   |-- Auth: GitHub OAuth, sessions, API keys
   |-- Matching: selects a provider for each request
   |-- Queue: holds requests when all providers are busy
   |-- Billing: charges the consumer, credits the provider
   |-- SQLite: users, accounts, keys, transactions
   |
   |  WebSocket (/ws/provider)
   v
Provider agent  -->  Inference engine (llama.cpp, or mock)

Litestream  ---- copies SQLite to object storage
```

## Request flow

1. The consumer sends `POST /v1/chat/completions` with a session cookie or an API key.
2. The coordinator identifies the consumer. In production, it rejects anonymous requests (AUTH-011).
3. The coordinator checks the input, the rate limit, and the balance.
4. Matching selects a provider. It removes each provider that does not meet the trust level, the price ceiling, or the model (ROUTE-001, ROUTE-002). Then it scores the remaining providers.
5. If no provider is free, the request waits in the queue for a maximum of 30 seconds.
6. The coordinator encrypts the messages to the provider key and sends them on the WebSocket.
7. The provider streams tokens back. The coordinator sends them to the consumer as SSE.
8. When the provider sends `inference_done`, the coordinator bills the request (BILL-006).

## Data

| Data | Store | Durable |
|---|---|---|
| Users, accounts, API keys, transactions | SQLite | Yes, with Litestream backup |
| Provider tokens, provider history | SQLite | Yes |
| Connected providers, queue | Memory | No |
| Traces (last 100), reputation, TPS | Memory | No |
| Chat history | Browser local storage | Browser only |

## Trust boundaries

- **Coordinator**: Treat it as untrusted (P4). Today it can see plaintext on the standard path, because it encrypts the messages to the provider itself. The confidential path (`/v1/confidential/infer`) relays ciphertext only.
- **Provider**: It claims a trust level. The coordinator does not verify the claim yet (PROV-004).
- **Browser**: The coordinator serves the web UI. A compromised coordinator can serve bad JavaScript (#68).

## Environments

| Setting | Development | Production (`IE_ENV=prod`) |
|---|---|---|
| Anonymous inference | Permitted (shared account) | Rejected |
| Shared default API key | Available at `/health?include_key=1` | Not available |
| Password sign-in | On | Off, unless `IE_PASSWORD_AUTH=1` |
| Admin access before the first user | Open | Closed |
| `IE_JWT_SECRET` | Optional | Mandatory |

## Code map

| Path | Contents |
|---|---|
| `inference_exchange/coordinator/` | Coordinator service |
| `inference_exchange/provider/` | Simple provider and mock engine |
| `ocip_agent/` | OCIP provider agent (production path) |
| `provider-hardened/` | L2 hardening for Apple Silicon |
| `web/` | React web UI |
| `deploy/` | Docker Compose, Caddy, Litestream |
| `infra/` | OpenTofu module for the VM |
| `tests/` | Test suite |

For the protocol, see the [OCIP specification](https://github.com/qzyu999/ocip). For the security model, see [Threat model](security/threat-model.md) and [Protocol](security/protocol.md).
