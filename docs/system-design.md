# System Design — Local POC vs Production Deployment

## The Two Architectures

There are two distinct deployment models for the Inference Exchange. The local
POC is where we are now — everything on one machine, used for development and
demos. The production deployment is what runs when real money flows and real
providers serve real consumers over the internet.

The React frontend fits differently in each model.

---

## Local POC (Current State)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Developer Machine (localhost)                  │
│                                                                  │
│   ┌────────────────────┐                                        │
│   │  Vite Dev Server   │  npm run dev                           │
│   │  localhost:3000     │  (React SPA + hot reload)             │
│   │                     │                                        │
│   │  Proxy rules:       │                                        │
│   │  /v1/*  → :8000     │                                        │
│   │  /ws/*  → :8000     │                                        │
│   │  /health → :8000    │                                        │
│   └─────────┬──────────┘                                        │
│             │ proxy                                              │
│             ▼                                                    │
│   ┌────────────────────────────────────────────────────────┐    │
│   │  Coordinator (python -m inference_exchange.coordinator) │    │
│   │  localhost:8000                                         │    │
│   │                                                         │    │
│   │  ┌─────────────┐ ┌──────────────┐ ┌────────────────┐  │    │
│   │  │ REST API    │ │ Provider Hub │ │ SQLite (store) │  │    │
│   │  │ /v1/chat/*  │ │ /ws/provider │ │ exchange.db    │  │    │
│   │  │ /v1/models  │ │              │ │                │  │    │
│   │  │ /v1/exchange│ │ WS manager   │ │ accounts, keys │  │    │
│   │  │ /v1/admin   │ │ routing      │ │ billing ledger │  │    │
│   │  └─────────────┘ └──────┬───────┘ └────────────────┘  │    │
│   │                          │ WebSocket                    │    │
│   └──────────────────────────┼──────────────────────────────┘    │
│                              │                                   │
│   ┌──────────────────────────┼──────────────────────────────┐   │
│   │  Provider (python -m inference_exchange.provider)         │   │
│   │                          │                               │   │
│   │  ┌──────────┐  ┌───────┴────────┐  ┌────────────────┐  │   │
│   │  │ WS Agent │  │ llama-cpp-py   │  │ GGUF model     │  │   │
│   │  │          │──│ (CPU inference) │  │ (~400MB)       │  │   │
│   │  └──────────┘  └────────────────┘  └────────────────┘  │   │
│   └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│   Optional: docker compose up (starts coordinator + 3 providers) │
└──────────────────────────────────────────────────────────────────┘
```

### What's Running

| Process | Port | Role |
|---------|------|------|
| `npm run dev` (Vite) | 3000 | React SPA, proxies API to coordinator |
| `python -m inference_exchange.coordinator` | 8000 | API, routing, billing, WebSocket hub |
| `python -m inference_exchange.provider` | — | WS client, inference, streams tokens |

### How to Start (no Docker)

```bash
# Terminal 1 — coordinator
cd inference-exchange
.venv\Scripts\activate
python -m inference_exchange.coordinator

# Terminal 2 — provider
python -m inference_exchange.provider --name "local" --price-output 0.10

# Terminal 3 — React frontend
cd web
npm run dev
# → open http://localhost:3000
```

### How to Start (Docker, no frontend dev)

```bash
# Coordinator + 3 demo providers, no React
docker compose up

# Old static HTML UI at http://localhost:8000
```

### POC Characteristics

- **No auth** — single default API key, no user accounts
- **SQLite** — single-file DB, coordinator process owns it
- **Same machine** — provider and coordinator talk over localhost
- **No TLS** — everything is plaintext HTTP/WS
- **Vite proxy** — frontend dev server forwards API calls
- **No CDN** — React app served by Vite dev server
- **Docker is optional** — useful for multi-provider demos but not required

### Where Docker Fits in the POC

Docker currently exists for **demo convenience** only: spin up 3 providers with
different price points to see the matching engine work. The React frontend is
NOT in Docker because:

1. Hot reload matters during development
2. Vite dev server provides the proxy (no CORS headaches)
3. Building a static bundle into the coordinator image adds no value locally

The Docker compose file is useful for:
- Quick "look at this" demos
- Testing multi-provider routing
- CI integration tests (if we add them)

---

## Production Deployment

```
                        ┌───────────────────────────┐
  Consumers ────────────│  CDN (CloudFront / R2)    │
  (browsers)    HTTPS   │                           │
                        │  React SPA (static files) │
                        │  index.html, JS, CSS      │
                        └───────────────────────────┘

                        ┌───────────────────────────┐
  Consumers ────────────│  Load Balancer / Gateway   │
  (API calls)   HTTPS   │  (TLS termination)         │
  (SDKs, curl,          │                           │
   Cursor, etc.)        │  api.inference.exchange    │
                        └─────────────┬─────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │  Coordinator (1) │  │  Coordinator (2) │  │  Coordinator (N) │
    │  (container)      │  │  (container)      │  │  (container)      │
    │                   │  │                   │  │                   │
    │  FastAPI + WS     │  │  FastAPI + WS     │  │  FastAPI + WS     │
    └────────┬──────────┘  └────────┬──────────┘  └────────┬──────────┘
             │                      │                      │
             ▼                      ▼                      ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                     PostgreSQL (RDS)                         │
    │  accounts, api_keys, billing_ledger, request_history,       │
    │  provider_profiles, attestation_records                      │
    └─────────────────────────────────────────────────────────────┘
    ┌─────────────────────────────────────────────────────────────┐
    │                     Redis (ElastiCache)                      │
    │  provider_state, active_requests, session_affinity,          │
    │  rate_limit_counters, ws_pubsub                              │
    └─────────────────────────────────────────────────────────────┘

    ═══════════════════════════ Internet ═══════════════════════════

     ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
     │Mac Mini  │   │Linux w/  │   │AMD SEV-  │   │Mac Studio│
     │M4 Pro    │   │RTX 4090  │   │SNP Server│   │M2 Ultra  │
     │          │   │          │   │          │   │          │
     │OCIP Agent│   │OCIP Agent│   │OCIP Agent│   │OCIP Agent│
     │    ↕     │   │    ↕     │   │    ↕     │   │    ↕     │
     │Hardened  │   │Hardened  │   │Hardened  │   │Hardened  │
     │Inference │   │Inference │   │Inference │   │Inference │
     │Server    │   │Server    │   │Server    │   │Server    │
     │          │   │          │   │          │   │          │
     │Trust: L2 │   │Trust: L2 │   │Trust: L3 │   │Trust: L2 │
     └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

### Component Breakdown

| Component | Technology | Scaling |
|-----------|-----------|---------|
| React SPA | Static files on CDN | Infinite (edge-cached) |
| Load Balancer | ALB / Cloudflare / Fly.io proxy | Auto |
| Coordinator | FastAPI containers (ECS / Fly.io / Railway) | Horizontal (N replicas) |
| Database | PostgreSQL (RDS / Neon / Supabase) | Vertical + read replicas |
| Cache/PubSub | Redis (ElastiCache / Upstash) | Cluster mode |
| Providers | Native processes on provider hardware | Organic (people join) |

### Why This Topology

**React SPA on CDN, not in the coordinator container:**

The coordinator serves API endpoints and maintains WebSocket connections. It
should NOT serve static files in production because:

1. **CDN edge caching** — static assets load in <50ms globally, no load on
   coordinator
2. **Independent deploys** — ship frontend changes without restarting the
   coordinator (zero downtime for providers' WebSocket connections)
3. **Horizontal scaling** — coordinator replicas don't each serve identical
   static files; CDN handles it once
4. **Separation of concerns** — coordinator is a compute service, not a web
   server

**PostgreSQL replaces SQLite:**

SQLite can't handle concurrent writes from multiple coordinator replicas. The
billing ledger (real money) needs ACID guarantees across multiple processes.

**Redis for shared ephemeral state:**

Provider connections are ephemeral — a provider connects to ONE coordinator
replica. For any replica to route requests to any provider, the provider
registry must be shared. Redis pub/sub fans out events across replicas.

**Providers are NOT in containers:**

Providers run on consumer hardware (Mac Minis, Linux boxes, gaming PCs). They
need direct GPU access. The OCIP Agent is installed via `pip install ie-provider`
and manages a hardened inference server process. No Docker needed or wanted —
Docker adds latency and complicates GPU passthrough.

---

## Migration Path: POC → Production

### Phase 1: Current (POC)

```
[Vite:3000] ──proxy──▶ [Coordinator:8000] ◀──WS──▶ [Provider]
                              │
                         [SQLite file]
```

- Everything localhost
- React dev server proxies API calls
- SQLite, in-memory state
- Docker optional (demo only)

### Phase 2: Deployed Coordinator (Single Node)

```
[CDN: static SPA] ──HTTPS──▶ [Coordinator VM:8000] ◀──WSS──▶ [Remote Providers]
                                      │
                                 [SQLite file]
                                 [TLS via Caddy/nginx]
```

Changes from Phase 1:
- `vite build` → deploy static bundle to CDN (Cloudflare Pages, Vercel, S3+CF)
- Coordinator on a single VM (Fly.io, Railway, or GCE)
- TLS via reverse proxy (Caddy auto-certs)
- SQLite still OK for single-node (WAL mode, <100 concurrent)
- Providers connect over the internet (WSS)

### Phase 3: Horizontally Scaled

```
[CDN] ──▶ [ALB] ──▶ [Coordinator ×N] ──▶ [PostgreSQL]
                                      ──▶ [Redis]
                     ◀──WSS──▶ [Providers ×M]
```

Changes from Phase 2:
- PostgreSQL replaces SQLite (billing needs distributed ACID)
- Redis for provider registry, session affinity, rate limits
- Multiple coordinator containers behind a load balancer
- WebSocket sticky sessions (ALB with connection affinity)
- Provider WS connections pinned per coordinator instance, Redis pub/sub
  for cross-instance routing

### Phase 4: Full Production

Everything in Phase 3, plus:
- Stripe integration (real deposits, provider payouts)
- User accounts (OAuth, not just API keys)
- Monitoring (Datadog / Prometheus + Grafana)
- Provider attestation verification (hardware-backed)
- Geographic routing (providers matched by region)
- Audit log (every request, billing event, attestation)

---

## Docker Strategy

### What Goes in Docker

| Component | Docker? | Reason |
|-----------|---------|--------|
| Coordinator | Yes | Reproducible deploy, container orchestration |
| React SPA | Build-only | `npm run build` in CI, deploy static files to CDN |
| Provider | No | Needs native GPU, hardware attestation, user's machine |
| PostgreSQL | Managed service | RDS / Neon / Supabase (not self-hosted) |
| Redis | Managed service | ElastiCache / Upstash (not self-hosted) |

### Updated Dockerfile (Coordinator Only)

The current `Dockerfile` is coordinator-only, which is correct. It should NOT
include the React frontend — that's built separately and deployed to a CDN.

The current `Dockerfile.provider` and `docker-compose.yml` are for local demo
only. In production, providers install natively via pip.

### CI Build Pipeline (Future)

```
git push main
  │
  ├── Build React SPA ──▶ deploy to CDN (Cloudflare Pages)
  │   npm run build
  │   Output: web/dist/
  │
  ├── Build Coordinator Container ──▶ push to registry (GHCR)
  │   docker build -f Dockerfile .
  │   Output: ghcr.io/qzyu999/ie-coordinator:latest
  │
  └── Run Tests ──▶ gate deploy
      pytest tests/
```

---

## Frontend Deployment Detail

### Development (now)

```bash
cd web && npm run dev
# Vite serves at :3000, proxies /v1/* to :8000
```

### Staging / Demo (single VM)

Option A — Coordinator serves the built SPA:
```python
# In coordinator main.py, mount the built React app:
app.mount("/", StaticFiles(directory="web/dist", html=True))
```

Option B — Reverse proxy (Caddy) serves SPA + proxies API:
```
# Caddyfile
console.inference.exchange {
    handle /v1/* {
        reverse_proxy localhost:8000
    }
    handle /ws/* {
        reverse_proxy localhost:8000
    }
    handle {
        root * /opt/ie/web/dist
        file_server
        try_files {path} /index.html
    }
}
```

### Production

```
console.inference.exchange → CDN (static SPA)
api.inference.exchange     → ALB → Coordinator containers
```

SPA makes all API calls to `api.inference.exchange` (configured via
`VITE_API_BASE` at build time or runtime config).

---

## Summary: What Changes Between POC and Production

| Concern | POC (now) | Production |
|---------|-----------|------------|
| Frontend serving | Vite dev server (:3000) | CDN (Cloudflare Pages) |
| API proxy | Vite proxy config | CORS headers + separate domain |
| Coordinator | Single process (:8000) | N containers behind ALB |
| Database | SQLite (file) | PostgreSQL (managed) |
| Shared state | In-process dicts | Redis |
| Provider install | `python -m ...` (same machine) | `pip install ie-provider` (remote) |
| Transport | HTTP/WS (plaintext) | HTTPS/WSS (TLS) |
| Auth | Default API key | OAuth + API keys |
| Billing | Simulated credits | Stripe (real money) |
| Monitoring | Log files | Datadog / Prometheus |
| Docker | Optional demo | Coordinator containers |
| React in Docker? | No | No (CDN) |
