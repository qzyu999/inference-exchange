# InferenceExchange (IE) ⚡

> **A Decentralized Level-2 (L2) Continuous Limit Order Book for LLM Compute**

InferenceExchange turns compute providers (such as Apple Silicon Macs running MLX/llama.cpp and GPU clusters running vLLM) into **Market Makers** offering real-time spot capacity, and gives API consumers an **OpenAI-compatible gateway** that automatically matches requests with the lowest effective price per token in microseconds.

---

## 🌟 Why InferenceExchange?

Traditional aggregators (like OpenRouter) use **static retail rate cards** set behind the scenes. InferenceExchange introduces a **Continuous Limit Order Book (CLOB)**:

1. **Dynamic Level-2 Order Book**: Providers continuously quote input ($P_{in}$) and output ($P_{out}$) prices per 1M tokens, concurrency slots, and max context windows.
2. **Sub-Millisecond Matching Engine**: Automatically routes requests based on **Composite Effective Price** ($P_{eff} = P_{in} + 3.0 \cdot P_{out}$), SLA (TPS guarantee), and trust tiers.
3. **Outbound Provider Tunnel**: Provider nodes connect *outbound* via WebSockets — **no open ports, port forwarding, or firewall configuration required**.
4. **Real-time Streaming Escrow**: Locks pre-flight maximum cost, meters SSE chunks in real time, and instantly settles micro-USD upon completion with zero financial slippage.
5. **Dynamic Pricing Agent**: Provider daemon auto-adjusts ask quotes based on local hardware load (CPU/GPU thermals, time of day, queue depth).
6. **100% OpenAI & Anthropic Drop-in Compatible**: Switch one `base_url` in standard SDKs.

---

## 🏛️ Architecture

```
                                [ API Consumers / Takers ]
                     (OpenAI / Anthropic SDK · Trading Bots · Web UI)
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        InferenceExchange Core Gateway (Rust)                           │
│                                                                                        │
│   ┌──────────────────────────┐   ┌─────────────────────────────────────────────────┐   │
│   │  OpenAI / Anthropic API  │   │          Real-time L2 Order Book Core           │   │
│   │  - POST /v1/chat/...     │   │  - Per-model Bid / Ask Depth Books              │   │
│   │  - GET /v1/models        │──▶│  - Composite Pricing: P_eff = P_in + α * P_out  │   │
│   │  - GET /v1/orderbook/:id │   │  - Price-Time-SLA Priority Matching Engine      │   │
│   └──────────────────────────┘   └─────────────────────────────────────────────────┘   │
│                │                                          │                            │
│                ▼                                          ▼                            │
│   ┌──────────────────────────┐   ┌─────────────────────────────────────────────────┐   │
│   │ Escrow & Metering Engine │   │       Provider WebSocket Tunnel & Router        │   │
│   │  - Pre-flight micro-hold │   │  - Outbound WS session multiplexer              │   │
│   │  - SSE chunk token meter │   │  - Dynamic Heartbeat & SLA tracking (TPS, TTFT) │   │
│   │  - Instant settlement    │   │  - Zero-port inbound NAT traversal              │   │
│   └──────────────────────────┘   └─────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                           │ (Outbound WebSockets)
                                           ▼
                          [ Compute Providers / Makers ]
   ┌───────────────────────────────────────────────────────────────────────────────────┐
   │ `ie-node` Provider Daemon:                                                        │
   │  - Dynamic Pricing Engine (Auto-adjust Asks based on thermals, load, idle time)   │
   │  - In-process or local backend inference runner (MLX / llama.cpp / vLLM / Ollama) │
   │  - Slot Concurrency & KV-Cache capacity manager                                   │
   └───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quickstart

### 1. Build the Workspace
```bash
cargo build --release
```

### 2. Run the Gateway & Matching Engine
```bash
./target/release/ie-gateway --port 8080
```
- **Web UI & L2 Depth Chart:** `http://localhost:8080`
- **OpenAI Endpoint:** `http://localhost:8080/v1/chat/completions`
- **L2 Order Book Depth:** `http://localhost:8080/v1/orderbook/llama-3.3-70b-instruct`
- **Real-Time Market Feed:** `ws://localhost:8080/v1/market/feed`

---

### 3. Connect a Provider Node (Compute Maker)

Run on an Apple Silicon Mac or GPU server:
```bash
./target/release/ie-node \
  --gateway-url "ws://127.0.0.1:8080/v1/provider/tunnel" \
  --name "Mac Studio M2 Ultra (192GB)" \
  --model "llama-3.3-70b-instruct" \
  --price-in 0.05 \
  --price-out 0.20 \
  --slots 4 \
  --tps 38.5 \
  --dynamic-pricing true
```

Optional: Forward to a local engine (e.g. Ollama, llama.cpp, or MLX):
```bash
  --local-backend-url "http://127.0.0.1:11434/v1"
```

---

### 4. Execute Spot Inference (Consumer / Taker)

Use the standard **Python OpenAI SDK**:
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="demo-user-key",
    default_headers={
        "X-IE-Max-Price-Output": "0.50",   # Max $ / 1M output tokens (Slippage guard)
        "X-IE-Min-TPS": "25",              # Minimum throughput SLA
    }
)

stream = client.chat.completions.create(
    model="llama-3.3-70b-instruct",
    messages=[{"role": "user", "content": "Explain Level-2 order books for AI compute."}],
    stream=True,
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

Or with `curl`:
```bash
curl -N http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer demo-user-key" \
  -d '{
    "model": "llama-3.3-70b-instruct",
    "messages": [{"role": "user", "content": "Hello InferenceExchange!"}],
    "stream": true
  }'
```

---

## 🧪 Running Automated Tests & E2E Verification

```bash
# Run unit tests
cargo test

# Run complete multi-node live exchange simulation
./scripts/demo_exchange.sh
```

---

## 📂 Repository Structure

- `crates/ie-core/`: In-memory Continuous Limit Order Book (CLOB), Price-Time-SLA matching engine, and micro-escrow ledger.
- `crates/ie-gateway/`: OpenAI/Anthropic SSE reverse proxy, provider WebSocket tunnel hub, and real-time market data feed.
- `crates/ie-node/`: Provider daemon with hardware thermal/load dynamic pricing controller and streaming inference engine.
- `web/`: Live web dashboard with real-time Level-2 depth chart, order book table, trade ticker, and prompt playground.
- `scripts/`: Integration verification scripts.

---

## 📄 License & IP

InferenceExchange is built **100% clean-room from scratch** under the **Apache-2.0 License**. Zero proprietary code, schemas, or scripts were copied from any proprietary third-party codebase.
