# Apple Silicon Hardened Provider — Implementation Plan

## Goal

Build a hardened inference provider for Apple Silicon that requires a macOS kernel
exploit (0-day) or physical attack to observe prompts. Uses existing open-source
inference engines (ollama, llama.cpp, MLX) with security hardening applied.

## Requirements

- Apple Silicon Mac (M1 or later) — needed for Metal GPU + Secure Enclave
- macOS 14+ (Sonoma)
- Apple Developer ID certificate (for code signing — $99/year Apple Developer Program)
- Xcode Command Line Tools

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Provider Machine (Apple Silicon, SIP enabled)                    │
│                                                                   │
│  ┌─────────────────────────────┐   ┌───────────────────────────┐ │
│  │  ocip-agent (Python)         │   │  ocip-llama-server        │ │
│  │                              │   │  (hardened llama.cpp fork) │ │
│  │  • WebSocket → coordinator   │   │                           │ │
│  │  • X25519 decrypt/encrypt    │   │  • PT_DENY_ATTACH         │ │
│  │  • Attestation (SE signing)  │   │  • Hardened Runtime        │ │
│  │  • Passes plaintext via ─────────▶• Unix socket listener     │ │
│  │    Unix socket               │   │  • Metal GPU inference    │ │
│  │  • Receives tokens ◀────────────── Returns token stream      │ │
│  │  • Re-encrypts for network   │   │  • No network access      │ │
│  └─────────────────────────────┘   │  • Code-signed + notarized│ │
│                                     └───────────────────────────┘ │
│                                                                   │
│  Network traffic (observable by operator): ALL ENCRYPTED          │
│  Unix socket traffic: requires kernel exploit to observe          │
│  Inference memory: requires kernel exploit to read                │
└──────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Build Hardened llama-server

llama.cpp includes `llama-server` — a ready-made HTTP inference server.
We fork it minimally: add anti-debug, switch from TCP to Unix socket.

```bash
# Clone llama.cpp
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp

# Apply hardening patch (see below)
git apply ../ocip-hardening.patch

# Build with Metal support
cmake -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_METAL=ON \
  -DLLAMA_CURL=OFF

cmake --build build --target llama-server -j

# Code-sign with Hardened Runtime
codesign --sign "Developer ID Application: YOUR NAME (TEAM_ID)" \
         --options runtime \
         --entitlements entitlements.plist \
         --force \
         build/bin/llama-server

# Notarize (required for Gatekeeper on other machines)
xcrun notarytool submit build/bin/llama-server \
  --apple-id YOUR_APPLE_ID \
  --password APP_SPECIFIC_PASSWORD \
  --team-id TEAM_ID \
  --wait
```

### Step 2: The Hardening Patch

Minimal changes to `llama.cpp/tools/server/main.cpp` (the server entry point):

The entire `main.cpp` is replaced with:

```cpp
#include "ocip_hardening.h"

int llama_server(int argc, char ** argv);

int main(int argc, char ** argv) {
    if (ocip_harden() != 0) { return 1; }
    return llama_server(argc, argv);
}
```

The `ocip_hardening.c` and `ocip_hardening.h` files are copied into
`tools/server/` and contain the actual hardening logic (see
`provider-hardened/hardening.c` for the full source):

- `ptrace(PT_DENY_ATTACH)` -- blocks all debuggers permanently
- `setrlimit(RLIMIT_CORE, 0)` -- disables core dumps
- `csrutil status` check -- refuses to run if SIP is off

Also add `ocip_hardening.c` to the CMakeLists.txt `add_executable` line:

```cmake
add_executable(${TARGET} main.cpp ocip_hardening.c)
```

**Additionally, modify the server to listen on Unix socket instead of TCP:**

In the server startup code, replace the TCP listen with:

```cpp
// Instead of:  
//   server.listen("127.0.0.1", port);
// Use:
//   server.listen_unix("/tmp/ocip-inference-XXXX.sock");

// The socket path comes from an environment variable or CLI arg:
//   --socket /tmp/ocip-inference.sock
```

(llama.cpp's httplib already supports Unix sockets — you just need to add
a CLI flag to use it instead of TCP.)

### Step 3: Entitlements File

Create `entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- DO NOT include com.apple.security.get-task-allow -->
    <!-- That entitlement would allow debugger attachment -->

    <!-- Allow reading model files -->
    <key>com.apple.security.files.user-selected.read-only</key>
    <true/>
</dict>
</plist>
```

The critical thing: **no `get-task-allow`**. Without it, the kernel blocks
`task_for_pid()` against this process, which blocks all external memory reading.

### Step 4: OCIP Agent (Python, your existing code)

The provider agent from inference-exchange, with one change: instead of
calling llama-cpp-python in-process, it connects to the hardened server
over a Unix socket:

```python
# In provider/inference.py, replace the Llama() call with:

import httpx

class HardenedInferenceClient:
    """Connects to the hardened llama-server over Unix socket."""

    def __init__(self, socket_path: str):
        # httpx supports Unix sockets via transport
        self._transport = httpx.HTTPTransport(uds=socket_path)
        self._client = httpx.Client(transport=self._transport, base_url="http://localhost")

    def generate_stream(self, messages, max_tokens=1024, temperature=0.7):
        """Stream tokens from the hardened inference server."""
        response = self._client.post(
            "/v1/chat/completions",  # llama-server supports OpenAI format
            json={
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "stream": True,
            },
            timeout=120,
        )
        # Parse SSE stream
        for line in response.iter_lines():
            if line.startswith("data: ") and line != "data: [DONE]":
                import json
                chunk = json.loads(line[6:])
                content = chunk["choices"][0]["delta"].get("content")
                if content:
                    yield content
```

### Step 5: Launch Script

```bash
#!/bin/bash
# start-ocip-provider.sh

SOCKET_PATH="/tmp/ocip-inference-$$.sock"

# Start hardened inference server (background)
./ocip-llama-server \
    --model ~/.cache/huggingface/models/llama-3-8b-Q4_K_M.gguf \
    --socket "$SOCKET_PATH" \
    --ctx-size 4096 \
    --n-gpu-layers -1 \
    &
SERVER_PID=$!

# Wait for socket to appear
sleep 2

# Start OCIP agent (foreground)
python -m inference_exchange.provider \
    --name "my-hardened-mac" \
    --price-output 0.15 \
    --trust hardened \
    --inference-socket "$SOCKET_PATH"

# Cleanup
kill $SERVER_PID
rm -f "$SOCKET_PATH"
```

### Step 6: Verification (Prove It's Actually Hardened)

Run these tests to verify the operator cannot observe inference:

```bash
# 1. Try to attach debugger (should fail)
lldb -p $(pgrep llama-server)
# Expected: "error: attach failed: Operation not permitted"

# 2. Try to read memory (should fail)
vmmap $(pgrep llama-server)
# Expected: "Failed to get task port" or empty output

# 3. Try to trace syscalls (should fail with SIP)
sudo dtruss -p $(pgrep llama-server)
# Expected: "dtrace: system integrity protection is on, some features will not work"

# 4. Try to capture Unix socket traffic (should fail)
sudo tcpdump -i any -w /tmp/cap.pcap
# Unix sockets don't appear on any network interface — nothing captured

# 5. Verify code signature
codesign -dv --verbose=4 ./ocip-llama-server
# Should show: "Runtime Version" and NO "get-task-allow"
```

## What This Achieves

| Attack | Blocked? | Mechanism |
|--------|----------|-----------|
| `lldb` / debugger | ✅ | PT_DENY_ATTACH |
| Memory read (Mach API) | ✅ | Hardened Runtime (no get-task-allow) |
| `dtrace` / Instruments | ✅ | SIP blocks on hardened processes |
| Core dump analysis | ✅ | RLIMIT_CORE = 0 |
| Network sniffing | ✅ | All network traffic is encrypted |
| Unix socket sniffing | ✅ | Not a network interface; kernel access required |
| Binary replacement | ✅ | Code signature + SIP |
| Dylib injection | ✅ | Hardened Runtime blocks DYLD_INSERT_LIBRARIES |
| Kernel extension | ✅ | SIP blocks unsigned kexts on Apple Silicon |
| **Kernel 0-day** | ❌ | Nothing protects against this (~$500k exploit) |
| **Physical memory probe** | ❌ | Requires desoldering (infeasible on Apple Silicon) |

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Chip | Apple M1 | M2 Pro or later |
| RAM | 8 GB | 32+ GB (for larger models) |
| macOS | 14.0 (Sonoma) | Latest stable |
| Secure Enclave | Required (all Apple Silicon has it) | — |
| SIP | Must be enabled | — |
| Developer ID | Required for code signing ($99/yr) | — |

## Alternative: Hardened Ollama (Even Simpler)

If you'd rather harden ollama instead of llama.cpp:

1. Ollama is written in Go
2. Add the PT_DENY_ATTACH via cgo (5 lines)
3. Build: `go build -o ocip-ollama ./cmd/ollama`
4. Codesign: `codesign --sign "..." --options runtime --entitlements entitlements.plist ocip-ollama`

Ollama already supports Unix sockets (or you can use its standard localhost API
and accept the minor tcpdump risk — see "Tradeoffs" below).

## Alternative: Hardened MLX

MLX is Python — harder to harden because the Python interpreter is the process.
Options:
- Use PyInstaller or Nuitka to compile to a standalone binary, then codesign that
- Use mlx through llama.cpp's Metal backend (llama.cpp supports MLX-style Metal compute)
- Run mlx inside the hardened llama-server (llama.cpp uses Metal natively)

Recommended: just use llama.cpp with Metal. It uses the same Apple GPU via Metal
and achieves comparable speed to MLX for most models.

