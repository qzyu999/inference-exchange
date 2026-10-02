# Local Testing Plan — Proving the Real Thing Works

## Overview

Incremental levels of testing, each proving a deeper layer of the system works.
Levels 0-3 run on Windows with no special hardware. Level 4 needs Docker or ngrok.
Level 5 needs an Apple Silicon Mac.

## Running the Automated Tests

```bash
# Run all levels (0-3):
.venv\Scripts\python tests/local_e2e_test.py

# Run up to a specific level:
.venv\Scripts\python tests/local_e2e_test.py --level 1
```

The script starts/stops all processes automatically. No manual setup needed
beyond having the venv activated and at least one model downloaded.

## Level 0: Basic E2E ✅

**What it proves:** The core pipeline works — request routing, inference, billing, encryption.

Tests:
- Health endpoint returns provider count
- Non-streaming inference returns a response with usage stats
- Streaming inference delivers tokens via SSE
- Billing deducts from consumer balance
- E2E encryption is active (provider shows encrypted=true)
- Decision traces are recorded with scoring breakdown

## Level 1: Preference Routing ✅

**What it proves:** Different consumer preferences route to different providers.

Tests:
- Three providers with different prices/speeds/trust levels
- "cheapest" preference routes to the $0.08 provider
- "fastest" preference routes to the 120 tok/s provider
- "most_secure" preference routes to the confidential provider
- At least 2 different winners across the 3 preferences

## Level 2: Two-Process Architecture ✅

**What it proves:** The production OCIP agent + inference server split works.

Tests:
- OCIP agent starts and manages its own inference server
- Agent registers with trust="hardened"
- E2E encryption works through the agent relay
- Model identity flows from server → agent → coordinator
- Requests succeed through the two-process pipeline

## Level 3: Consumer SDK Integration ✅

**What it proves:** Real-world tools work as drop-in replacements.

Tests:
- Official OpenAI Python SDK: list models, non-streaming, streaming
- Multi-tenant: two API keys with isolated billing
- Different consumers have separate balances and request counts

## Level 4: Network Boundary (Manual)

**What it proves:** The system works when provider is on a different network.

### Option A: Docker
```bash
docker build -f Dockerfile.provider -t ie-provider .
docker run --rm -e COORDINATOR_URL=ws://host.docker.internal:8000/ws/provider ie-provider
```

### Option B: ngrok (free, no Docker)
```bash
ngrok http 8000
# Copy the https URL
python -m inference_exchange.provider --coordinator wss://<ngrok-url>/ws/provider
```

### Option C: Disconnect/Reconnect
```bash
# Start provider, send request, kill provider mid-stream
# Verify: consumer gets clean error, provider reconnects, next request works
```

## Level 5: Hardened Inference (Apple Silicon Mac)

```bash
cd provider-hardened && ./build.sh
./verify.sh  # Proves lldb/vmmap/dtrace are all blocked
python ocip_agent/agent.py --name "hardened-mac" --trust hardened
```

## Unit Tests (Run Separately)

```bash
# Full unit test suite (290+ tests, <1 second):
.venv\Scripts\python -m pytest tests/ -v --tb=short

# Specific module:
.venv\Scripts\python -m pytest tests/test_store.py -v
.venv\Scripts\python -m pytest tests/test_financial_invariants.py -v
```
