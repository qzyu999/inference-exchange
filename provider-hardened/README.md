# Hardened Inference Server (Apple Silicon)

A security-hardened build of llama.cpp's `llama-server` for OCIP providers.

Requires a macOS kernel exploit ($500k+) or physical attack to observe prompts.
Full Metal GPU acceleration. No vendor lock-in.

## Quick Start (on Apple Silicon Mac)

```bash
# 1. Build the hardened server
./build.sh

# 2. Start it (listens on Unix socket)
./run.sh --model ~/.cache/huggingface/models/your-model.gguf

# 3. In another terminal, start the OCIP agent
python -m inference_exchange.provider \
    --name "my-hardened-mac" \
    --trust hardened \
    --inference-socket /tmp/ocip-inference.sock
```

## What It Does

- Adds `PT_DENY_ATTACH` (blocks all debuggers, even from root)
- Builds with Hardened Runtime (blocks external memory reading)
- Disables core dumps (no memory written to disk)
- Verifies SIP at startup (refuses to run if SIP is off)
- Listens on Unix socket only (not TCP — immune to tcpdump)
- Full Metal GPU support (same speed as stock llama.cpp)

## Requirements

- Apple Silicon Mac (M1+)
- macOS 14+ (Sonoma)
- Xcode Command Line Tools (`xcode-select --install`)
- Apple Developer ID for code signing ($99/year)
- CMake (`brew install cmake`)
