# Getting Started

Three ways to run the Inference Exchange, from simplest to production-like.

## Topology 1: Single Machine (everything local)

The simplest setup. Coordinator, provider, and web UI all on one machine. Good for development and testing.

```
┌──────────────────────────────────────────┐
│  Your Machine                            │
│  ┌────────────┐  ┌────────┐  ┌───────┐  │
│  │ Coordinator │  │Provider│  │Web UI │  │
│  │ :8000      │←→│ agent  │  │ :3000 │  │
│  └────────────┘  └────────┘  └───────┘  │
└──────────────────────────────────────────┘
```

### Setup

```bash
git clone https://github.com/qzyu999/inference-exchange
cd inference-exchange
make setup
```

### Run

```bash
# Terminal 1: Coordinator + Web UI
make dev

# Terminal 2: Provider
make dev-provider
```

Open **http://localhost:3000** → Chat → Send a message.

The coordinator auto-creates a default API key on startup (shown in logs). The web UI picks it up automatically.

---

## Topology 2: Two Machines (coordinator + remote provider)

Coordinator and web UI on one machine (e.g. Intel MBP), provider on another (e.g. M2 Mac with GPU). This is the typical dev setup for testing real inference.

```
┌─────────────────────────┐         ┌──────────────────────┐
│  Machine A (Intel MBP)  │         │  Machine B (M2 Mac)  │
│  ┌────────────┐ ┌─────┐ │   WS    │  ┌────────┐ ┌─────┐ │
│  │ Coordinator│ │ Web │ │←───────→│  │ OCIP   │ │llama│ │
│  │ :8000      │ │:3000│ │         │  │ Agent  │ │-svr │ │
│  └────────────┘ └─────┘ │         │  └────────┘ └─────┘ │
└─────────────────────────┘         └──────────────────────┘
```

### Machine A (Coordinator)

```bash
git clone https://github.com/qzyu999/inference-exchange
cd inference-exchange
make setup

# Start coordinator + web UI
make dev
```

Note the coordinator's IP address (e.g. `192.168.1.100`). The coordinator binds to `0.0.0.0:8000` so it's accessible from the LAN.

**Create a provider token** (one time, from Machine A):

```bash
curl -X POST http://localhost:8000/v1/admin/provider-tokens \
  -H "Content-Type: application/json" \
  -d '{"name": "m2-provider"}'
```

Save the returned token — the provider needs it to connect.

### Machine B (Provider)

```bash
git clone https://github.com/qzyu999/inference-exchange
cd inference-exchange
make setup-py
make setup-model

# Point at Machine A's coordinator
source .venv/bin/activate
python -m ocip_agent.agent \
  --coordinator ws://192.168.1.100:8000/ws/provider \
  --token "<provider-token-from-above>"
```

Or using the simple provider (no E2E encryption):

```bash
python -m inference_exchange.provider \
  --name "m2-node" \
  --price-output 0.15 \
  --coordinator ws://192.168.1.100:8000/ws/provider
```

### Consumer (Machine A browser)

Open **http://localhost:3000** — the web UI talks to the local coordinator, which routes to the M2 provider.

The default API key is auto-detected. If you need a key explicitly:

```bash
curl http://localhost:8000/health?include_key=1
# → {"default_api_key": "sk-ie-..."}
```

Or create a new one:

```bash
curl -X POST http://localhost:8000/v1/auth/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "my-key"}'
```

---

## Topology 3: Cloud Coordinator (planned)

Coordinator deployed on a cloud VM, providers and consumers connect from anywhere.

```
                    ┌──────────────────┐
┌─────────┐        │  Cloud VM        │        ┌─────────┐
│Consumer  │──HTTPS→│  Coordinator     │←──WS───│Provider │
│(browser) │        │  :443            │        │(M2 Mac) │
└─────────┘        └──────────────────┘        └─────────┘
```

This topology needs:
- TLS termination (nginx/caddy in front of the coordinator)
- Domain name + certificate
- The web UI built and served by the coordinator (or deployed to a CDN)
- Provider tokens for authenticated admission

Setup guide: coming soon. The Docker Compose in the repo (`docker-compose.yml`) is a starting point for the coordinator deployment.

---

## Troubleshooting

### "No providers available" in chat
- Check the Privacy selector — if set to "L2+" but your provider is unhardened (L0/L1), it gets filtered out. Set to "Any" for dev testing.
- Check the Exchange page — is your provider listed?
- Check coordinator logs for connection/registration messages.

### Provider can't connect to coordinator
- Verify the coordinator IP is reachable: `curl http://<coordinator-ip>:8000/health`
- Check firewall: port 8000 must be open for WebSocket.
- If using a provider token, make sure it's correct.

### Model download fails
- The default model (Qwen 2.5 0.5B) is ~400MB from HuggingFace.
- If behind a proxy, set `HF_HUB_DOWNLOAD_TIMEOUT` and `HTTPS_PROXY` env vars.
- Or manually download and place in `~/.inference-exchange/models/`.

### Web UI shows blank/errors
- The web UI (`:3000`) proxies API calls to the coordinator (`:8000`). If the coordinator isn't running, you'll see proxy errors in the console.
- The Three.js landing page needs WebGL. On older hardware, a CSS fallback shows instead.
