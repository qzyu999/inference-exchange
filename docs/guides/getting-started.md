# Getting started

This guide shows three ways to run Inference Exchange. Start with the first one.

## 1. One computer

The coordinator, the provider, and the web UI run on one computer. Use this setup for development and tests.

```
Your computer
  Coordinator :8000  <-->  Provider
  Web UI :3000
```

### Install

```bash
git clone https://github.com/qzyu999/inference-exchange
cd inference-exchange
make setup
```

### Start

```bash
# Terminal 1: coordinator and web UI
make dev

# Terminal 2: provider
make dev-provider
```

Open http://localhost:3000. Go to **Chat** and send a message.

In development, the coordinator makes a shared API key when it starts. The web UI uses this key automatically.

### Use the mock provider if you do not have a model

```bash
python -m inference_exchange.provider --mock --trust hardened
```

The mock provider sends canned replies. It does not need a model or llama-cpp.

- `--mock-tps 50` sets the speed in tokens per second.
- `--models a,b` advertises more than one model name.

## 2. Two computers

The coordinator and the web UI run on computer A. The provider runs on computer B, for example a Mac with Apple Silicon. Use this setup to test real inference.

```
Computer A                         Computer B
  Coordinator :8000  <-- WS -->      OCIP agent --> llama-server
  Web UI :3000
```

### Computer A: coordinator

1. Install and start:

   ```bash
   git clone https://github.com/qzyu999/inference-exchange
   cd inference-exchange
   make setup
   make dev
   ```

2. Find the IP address of computer A, for example `192.168.1.100`. The coordinator listens on `0.0.0.0:8000`, so other computers on the LAN can connect.

3. Make a provider token. Do this one time:

   ```bash
   curl -X POST http://localhost:8000/v1/admin/provider-tokens \
     -H "Content-Type: application/json" \
     -d '{"name": "m2-provider"}'
   ```

4. Keep the token. The provider needs it to connect.

### Computer B: provider

```bash
git clone https://github.com/qzyu999/inference-exchange
cd inference-exchange
make setup-py
make setup-model
source .venv/bin/activate
python -m ocip_agent.agent \
  --coordinator ws://192.168.1.100:8000/ws/provider \
  --token "<provider-token>"
```

You can also use the simple provider. It does not encrypt responses to the consumer:

```bash
python -m inference_exchange.provider \
  --name "m2-provider" \
  --price-output 0.15 \
  --coordinator ws://192.168.1.100:8000/ws/provider
```

### Consumer: browser on computer A

Open http://localhost:3000. The web UI sends requests to the coordinator. The coordinator sends them to the provider on computer B.

To get the shared API key in development:

```bash
curl http://localhost:8000/health?include_key=1
```

To make a new API key in development:

```bash
curl -X POST http://localhost:8000/v1/auth/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "my-key"}'
```

## 3. Cloud server

The coordinator runs on a cloud VM. Providers and consumers connect from any location.

```
Consumer --HTTPS--> Cloud VM (Caddy + coordinator) <--WS-- Provider
```

- `deploy/docker-compose.yml` runs Caddy, the coordinator, and Litestream.
  - Caddy gets a TLS certificate, serves the web UI, and sends API traffic to the coordinator.
  - Litestream copies the SQLite database to object storage.
- `infra/` makes the VM with OpenTofu.
- For all steps and the runbook, see `infra/README.md`.

Put the configuration in `deploy/.env`. Copy it from `deploy/.env.example`.

| Variable | Function |
|---|---|
| `IE_ENV=prod` | Production mode. See [Architecture](../architecture.md) for the differences. |
| `IE_JWT_SECRET` | Mandatory in production. With it, sessions stay valid after a restart. |
| `IE_GITHUB_CLIENT_ID`, `IE_GITHUB_CLIENT_SECRET` | GitHub OAuth app. Callback: `https://<domain>/v1/auth/github/callback` |
| `IE_GITHUB_MIN_AGE_DAYS` | Reject GitHub accounts that are younger than this number of days. |
| `IE_ADMIN_EMAILS` | Emails that get the admin role. Use commas between emails. |
| `IE_PASSWORD_AUTH=1` | Turn on email and password sign-in in production. |
| `IE_METRICS_TOKEN` | Bearer token for `/metrics`. Caddy also blocks `/metrics` from the internet. |

Each provider needs a token. Sign in as an admin, then send `POST /v1/admin/provider-tokens`.

## Troubleshooting

### Chat says "No providers available"

1. Look at the trust selector. If it is "Hardened+" and the provider is L0 or L1, the coordinator does not use that provider. For development, select "Any", or start the provider with `--trust hardened`.
2. Open the **Providers** page. Make sure that your provider is on the list.
3. Look at the coordinator log for connection and registration messages.

### The provider cannot connect to the coordinator

1. Make sure that the provider can reach the coordinator: `curl http://<coordinator-ip>:8000/health`
2. Make sure that the firewall lets traffic through on port 8000.
3. If you use a provider token, make sure that it is correct.

### The model download fails

- The default model (Qwen 2.5 0.5B) is approximately 400 MB. It comes from Hugging Face.
- If you are behind a proxy, set `HF_HUB_DOWNLOAD_TIMEOUT` and `HTTPS_PROXY`.
- You can also download the model yourself. Put it in `~/.inference-exchange/models/`.

### Admin endpoints return 403

In development, admin access is open only before the first user signs up. After that, add your email to `IE_ADMIN_EMAILS`, restart the coordinator, and sign in again.

### The web UI is blank or shows errors

- The web UI on port 3000 sends API calls to the coordinator on port 8000. If the coordinator is not running, the browser console shows proxy errors.
- The landing page needs WebGL. On old hardware, the page shows a CSS animation instead.
