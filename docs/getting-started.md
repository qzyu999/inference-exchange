# Getting Started — Inference Exchange Alpha

Run private AI inference where the coordinator never sees your prompts.

## What you need

- **Machine A** (coordinator + consumer): any machine with Python 3.11+
- **Machine B** (provider): Apple Silicon Mac (M1/M2/M3/M4) with a GGUF model
- Both machines on the same network

You can also run everything on a single Apple Silicon Mac for local testing.

## 1. Setup (both machines)

```bash
git clone https://github.com/qzyu999/inference-exchange
cd inference-exchange
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
```

On Apple Silicon, `llama-cpp-python` auto-detects Metal. If you have SSL issues downloading models:

```bash
pip install certifi
export SSL_CERT_FILE=$(python -c "import certifi; print(certifi.where())")
```

## 2. Get a model (Machine B — provider)

If you have Ollama installed, you can use an existing model:

```bash
# Find your Ollama models
ls ~/.ollama/models/blobs/

# Use a model directly (no download needed)
# The sha256-... path works — the agent reads GGUF metadata from it
```

Or download a small model (~400MB) for testing:

```bash
python -m inference_exchange download-model
```

## 3. Start the coordinator (Machine A)

```bash
python -m inference_exchange.coordinator
```

You should see:
```
Starting Inference Exchange coordinator on 0.0.0.0:8000
Store initialized: ~/.inference-exchange/exchange.db
Attestation challenge loop started
```

## 4. Start the provider (Machine B)

```bash
python -m ocip_agent.agent \
  --coordinator ws://<MACHINE_A_IP>:8000/ws/provider \
  --name "my-provider" \
  --model /path/to/your/model.gguf \
  --price-output 0.15 \
  --trust hardened
```

Replace `<MACHINE_A_IP>` with Machine A's LAN IP (e.g., `192.168.0.152`).

You should see:
```
🔐 Encryption key: aCDh8nK5E+PdLiVO...
Model: Meta Llama 3.1 8B Instruct (llama, Q4_0)
Inference server PID: 71252
Connected to coordinator
Registered: my-provider (model=Meta Llama 3.1 8B Instruct, slots=2)
```

If you get `4003 Provider token required`, either delete `~/.inference-exchange/exchange.db` on Machine A and restart the coordinator, or create a token:

```bash
# On Machine A:
curl -X POST http://localhost:8000/v1/admin/provider-tokens \
  -H "Content-Type: application/json" -d '{"name":"my-provider"}'

# Use the returned token on Machine B:
--token pt-ie-PASTE_TOKEN_HERE
```

## 5. Verify the provider connected

```bash
# On Machine A:
curl http://localhost:8000/v1/exchange/providers | python -m json.tool
```

You should see your provider with `"encrypted": true` and `"status": "online"`.

## 6. Send a request

### Non-confidential (coordinator encrypts for you)

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"default","messages":[{"role":"user","content":"Say hello"}],"stream":false}' \
  --max-time 60
```

### Confidential (consumer encrypts locally — coordinator never sees plaintext)

```python
from inference_exchange.confidential_sdk import ExchangeClient
from inference_exchange.shared.crypto import encrypt_json, KeyPair
import httpx, json

# Discover the provider's encryption key
ex = ExchangeClient()
providers = ex.list_providers()["providers"]
provider = providers[0]
pubkey = provider["encryption_public_key"]

# Encrypt locally
consumer_kp = KeyPair()
payload = {
    "messages": [{"role": "user", "content": "Say hello"}],
    "consumer_public_key": consumer_kp.public_key_b64,
}
encrypted = encrypt_json(payload, pubkey)

# Send through the confidential relay (coordinator sees only ciphertext)
resp = httpx.post("http://localhost:8000/v1/confidential/infer", json={
    "session_id": "test-session",
    "encrypted_envelope": encrypted.to_dict(),
    "model": "default",
    "stream": False,
    "estimated_input_tokens": 10,
    "sequence_number": 0,
}, timeout=60)

print(f"Status: {resp.status_code}")
print(json.dumps(resp.json(), indent=2))
```

## 7. Check the dashboard

Open `http://<MACHINE_A_IP>:8000` in a browser for the exchange dashboard.

## What's happening

1. Your prompt is encrypted on your machine using the provider's X25519 public key
2. The coordinator receives only ciphertext — it routes by metadata (model, session_id)
3. The provider decrypts with its private key, runs inference via llama.cpp + Metal
4. Response tokens are encrypted back to your key
5. The coordinator relays opaque blobs — it never sees prompt or response content

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `SSL: CERTIFICATE_VERIFY_FAILED` | `export SSL_CERT_FILE=$(python -c "import certifi; print(certifi.where())")` |
| `4003 Provider token required` | Delete `~/.inference-exchange/exchange.db` and restart coordinator, or create a token |
| `No model found` | Pass `--model /path/to/file.gguf` explicitly |
| Provider keeps reconnecting | Check the coordinator IP is correct and both machines are on the same network |
| `503 No provider available` | Wait for the provider to finish connecting (check provider logs for "Registered") |

## Next steps

- Read the [known limitations](known-limitations.md) before relying on any security claims
- Read the [threat model](security/threat-model.md) for what L2 protects and what it doesn't
- To pentest the L2 boundary, see the [pentest guide](security/pentest-guide.md)
- To report a vulnerability, see [SECURITY.md](../SECURITY.md)
