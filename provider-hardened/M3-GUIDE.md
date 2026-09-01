# Apple Silicon Hardening -- M3 Step-by-Step Guide

Tested on: M3 company laptop (macOS Sequoia). All phases verified working.

## Prerequisites Check (5 minutes)

Open Terminal and run each of these.

```bash
# Check 1: Xcode Command Line Tools
xcode-select -p

# Check 2: git
git --version

# Check 3: cmake
cmake --version
# If missing: brew install cmake (or download from https://cmake.org/download/)

# Check 4: SIP enabled (company laptops should have this)
csrutil status

# Check 5: Python 3
python3 --version
```

You also need a GGUF model. If you have Ollama installed, you already
have models at `~/.ollama/models/blobs/`. Otherwise download one:

```bash
curl -L -o ~/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf \
  "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
```

---

## Phase 1: Build Unhardened llama-server (Prove Metal Works)

```bash
cd ~/Desktop
git clone --depth 1 https://github.com/ggerganov/llama.cpp
cd llama.cpp

cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=ON
cmake --build build --target llama-server -j$(sysctl -n hw.ncpu)

# Test (use your model path -- Ollama blob paths work too)
./build/bin/llama-server -m ~/path/to/model.gguf -ngl -1 --port 8081
```

In another terminal:

```bash
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"test","messages":[{"role":"user","content":"What is 2+2?"}],"max_tokens":50}'
```

If you get a response: Metal GPU inference works. Kill the server (Ctrl+C).

---

## Phase 2: Apply Hardening Patch

Copy the hardening files (adjust path to your inference-exchange clone):

```bash
cd ~/Desktop/llama.cpp
cp /path/to/inference-exchange/provider-hardened/hardening.c tools/server/ocip_hardening.c
cp /path/to/inference-exchange/provider-hardened/hardening.h tools/server/ocip_hardening.h
```

**Important:** Fix the include in the copied .c file (the repo version
references `hardening.h` but the copy is named `ocip_hardening.h`):

```bash
sed -i '' 's/#include "hardening.h"/#include "ocip_hardening.h"/' tools/server/ocip_hardening.c
```

**Edit `tools/server/main.cpp`** -- replace its entire contents with:

```cpp
#include "ocip_hardening.h"

int llama_server(int argc, char ** argv);

int main(int argc, char ** argv) {
    if (ocip_harden() != 0) { return 1; }
    return llama_server(argc, argv);
}
```

**Edit `tools/server/CMakeLists.txt`** -- find the line near the bottom:

```cmake
add_executable(${TARGET} main.cpp)
```

Change to:

```cmake
add_executable(${TARGET} main.cpp ocip_hardening.c)
```

**Rebuild:**

```bash
cmake --build build --target llama-server -j$(sysctl -n hw.ncpu)
```

---

## Phase 3: Test Hardening (No Signing Required)

```bash
./build/bin/llama-server -m ~/path/to/model.gguf -ngl -1 --port 8081
```

You should see:
```
[OCIP] Applying security hardening...
[OCIP] ✓ Debugger attachment blocked (PT_DENY_ATTACH)
[OCIP] ✓ Core dumps disabled
[OCIP] ✓ SIP verified enabled
[OCIP] Hardening complete. Process is protected.
```

**Verify debugger is blocked** (in another terminal):

```bash
lldb -p $(pgrep llama-server) -o "quit" 2>&1
```

You may see a "Developer Tools Access" popup -- you can dismiss it.
The lldb prompt will show "no target" or "attach failed". That means
PT_DENY_ATTACH is working.

**Verify inference still works:**

```bash
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"test","messages":[{"role":"user","content":"Say hello"}],"max_tokens":20}'
```

Kill the server (Ctrl+C).

---

## Phase 4: Static Build + Codesign with Hardened Runtime

Hardened Runtime requires codesigning, and codesigned binaries reject
loading dylibs signed by a different team. The solution: build
everything as a single static binary with no external dylib dependencies.

**This is the critical step. Delete the old build and rebuild from scratch:**

```bash
cd ~/Desktop/llama.cpp
rm -rf build
cmake -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_METAL=ON \
  -DLLAMA_CURL=OFF \
  -DBUILD_SHARED_LIBS=OFF \
  -DOPENSSL_ROOT_DIR=/nonexistent
cmake --build build --target llama-server -j$(sysctl -n hw.ncpu)
```

The flags:
- `BUILD_SHARED_LIBS=OFF` -- static linking, no dylibs
- `LLAMA_CURL=OFF` -- no curl dependency
- `OPENSSL_ROOT_DIR=/nonexistent` -- prevents cmake from finding
  Homebrew's OpenSSL (it would link a dylib that Hardened Runtime
  then rejects due to Team ID mismatch). We don't need OpenSSL --
  the server only listens on localhost.

**Codesign (ad-hoc, no Apple Developer ID needed):**

```bash
codesign --sign - --options runtime --entitlements /path/to/inference-exchange/provider-hardened/entitlements.plist --force build/bin/llama-server
```

**Verify Hardened Runtime is active:**

```bash
codesign -dv build/bin/llama-server 2>&1
```

Look for `flags=0x10002(adhoc,runtime)` and `Runtime Version` in the output.

**Test it runs:**

```bash
./build/bin/llama-server -m ~/path/to/model.gguf -ngl -1 --port 9999
```

You should see the OCIP hardening messages, then the normal llama-server
startup. Test with curl from another terminal:

```bash
curl http://localhost:9999/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"test","messages":[{"role":"user","content":"What is 2+2?"}],"max_tokens":20}'
```

---

## Phase 5: Wire to OCIP Agent (Full E2E Test)

This proves the two-process architecture: hardened inference server +
OCIP agent + coordinator + encrypted routing.

**Terminal 1 -- Hardened inference server (already running from Phase 4):**

```bash
./build/bin/llama-server -m ~/path/to/model.gguf -ngl -1 --port 9999
```

**Terminal 2 -- Coordinator:**

If running on the M3:
```bash
cd /path/to/inference-exchange
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
python -m inference_exchange.coordinator
```

Or use the coordinator already running on your Windows machine (change
the WebSocket URL in Terminal 3 accordingly).

**Terminal 3 -- OCIP agent:**

```bash
cd /path/to/inference-exchange
source .venv/bin/activate
python ocip_agent/agent.py \
    --name "m3-hardened" \
    --price-output 0.10 \
    --trust hardened \
    --coordinator ws://localhost:8000/ws/provider
```

**Terminal 4 -- Send a request through the full stack:**

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(curl -s http://localhost:8000/health | python3 -c 'import sys,json; print(json.load(sys.stdin)["default_api_key"])')" \
  -d '{"model":"default","messages":[{"role":"user","content":"What is the capital of France?"}],"stream":false}'
```

---

## Summary: What Each Phase Proves

| Phase | What it proves | Time |
|-------|---------------|------|
| 1 -- Unhardened build | Metal GPU inference works on M3 | ~10 min |
| 2 -- Patch applied | OCIP hardening compiles into llama.cpp | ~2 min |
| 3 -- PT_DENY_ATTACH | Debuggers blocked, inference unaffected | ~1 min |
| 4 -- Static + codesign | Hardened Runtime active, kernel protections | ~5 min |
| 5 -- Full E2E | Two-process arch + coordinator + routing | ~10 min |

**For production (not on company laptop):**
- Phase 6: real Apple Developer ID ($99/yr) for proper codesigning
- Phase 7: notarization (runs on other people's Macs via Gatekeeper)
- Phase 8: distribution (providers download signed binary, no build needed)

---

## Troubleshooting

**`xcode-select --install` blocked:**
Check if already installed: `xcode-select -p`

**`cmake` not found:**
Download from https://cmake.org/download/ (macOS .dmg).

**`#include "hardening.h" not found`:**
You forgot the sed command. Run:
`sed -i '' 's/#include "hardening.h"/#include "ocip_hardening.h"/' tools/server/ocip_hardening.c`

**`Undefined symbols: ocip_harden()` linker error:**
The header needs `extern "C"`. Make sure you pulled the latest
`hardening.h` which includes the `extern "C"` wrapper.

**`Library not loaded: libllama-server-impl.dylib` (Team ID mismatch):**
You built with shared libs. Rebuild with `rm -rf build` then
`-DBUILD_SHARED_LIBS=OFF` (see Phase 4).

**`Library not loaded: libssl.3.dylib` (Team ID mismatch):**
OpenSSL from Homebrew is a dylib. Rebuild with
`-DOPENSSL_ROOT_DIR=/nonexistent` to exclude it (see Phase 4).

**`lldb` shows a "Developer Tools Access" popup:**
Dismiss it. The lldb prompt showing "no target" means the attach
was blocked -- that's the success case.

**Model download blocked by corporate proxy:**
Download on phone, AirDrop to Mac. Or use Ollama models already
on disk at `~/.ollama/models/blobs/`.
