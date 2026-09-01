# Apple Silicon Hardening — M3 Step-by-Step Guide

Tested for: M3 company laptop with possible IT restrictions.

## Prerequisites Check (5 minutes)

Open Terminal and run each of these. If any fail, that tells you where
the company restrictions bite.

```bash
# Check 1: Do you have Xcode Command Line Tools?
xcode-select -p
# If YES → prints a path like /Library/Developer/CommandLineTools
# If NO  → run: xcode-select --install

# Check 2: Do you have git?
git --version
# Should work if Xcode CLT is installed

# Check 3: Can you install cmake?
# Option A — Homebrew (if you have it):
brew install cmake
# Option B — Download cmake.app from https://cmake.org/download/
#            (the macOS .dmg, drag to Applications, then add to PATH):
#            export PATH="/Applications/CMake.app/Contents/bin:$PATH"
# Option C — It might already be there:
cmake --version

# Check 4: SIP status (should be enabled on company laptops)
csrutil status
# Expected: "System Integrity Protection status: enabled."

# Check 5: Python 3 (for the OCIP agent)
python3 --version

# Check 6: Can you download a GGUF model?
# This is just downloading a file — any browser or curl works.
# ~350MB for the smallest useful model:
curl -L -o ~/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf \
  "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
```

If checks 1-3 pass, you can build. If check 6 is blocked, download
the model on a personal device and transfer via USB/AirDrop.

---

## Phase 1: Build Unhardened llama-server (Prove Metal Works)

No hardening, no signing. Just prove the inference engine runs on your M3.

```bash
# Clone llama.cpp
cd ~/Desktop
git clone --depth 1 https://github.com/ggerganov/llama.cpp
cd llama.cpp

# Build with Metal GPU support
cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=ON
cmake --build build --target llama-server -j$(sysctl -n hw.ncpu)

# Test it (replace model path with wherever you put the GGUF)
./build/bin/llama-server \
    --model ~/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf \
    --port 8081 \
    --n-gpu-layers -1
```

In another terminal tab:

```bash
# Send a test request
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "test",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "max_tokens": 50
  }'
```

**If you get a response with "4" in it, Metal GPU inference works on your M3.**

Kill the server: Ctrl+C in the first terminal.

---

## Phase 2: Apply Hardening Patch

This adds ~20 lines of C to the server. No Developer ID needed yet.

```bash
cd ~/Desktop/llama.cpp

# Copy the hardening files from the repo
# (adjust path to wherever you cloned inference-exchange)
cp /path/to/inference-exchange/provider-hardened/hardening.c tools/server/ocip_hardening.c
cp /path/to/inference-exchange/provider-hardened/hardening.h tools/server/ocip_hardening.h
```

Now patch two files. You can do this manually in any text editor:

**File 1: `tools/server/main.cpp`**

This is the entry point (only 6 lines). Replace its contents with:
```cpp
#include "ocip_hardening.h"

int llama_server(int argc, char ** argv);

int main(int argc, char ** argv) {
    if (ocip_harden() != 0) { return 1; }
    return llama_server(argc, argv);
}
```

**File 2: `tools/server/CMakeLists.txt`**

Find the section near the bottom that builds `llama-server` executable:

```cmake
set(TARGET llama-server)

add_executable(${TARGET} main.cpp)
```

Change it to:

```cmake
set(TARGET llama-server)

add_executable(${TARGET} main.cpp ocip_hardening.c)
```

That's it — just add `ocip_hardening.c` next to `main.cpp`.

**Rebuild:**

```bash
cmake --build build --target llama-server -j$(sysctl -n hw.ncpu)
```

---

## Phase 3: Test Hardening (No Signing Required)

Start the hardened server:

```bash
./build/bin/llama-server \
    --model ~/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf \
    --port 8081 \
    --n-gpu-layers -1
```

You should see in the output:
```
[OCIP] Applying security hardening...
[OCIP] ✓ Debugger attachment blocked (PT_DENY_ATTACH)
[OCIP] ✓ Core dumps disabled
[OCIP] ✓ SIP verified enabled
[OCIP] Hardening complete. Process is protected.
```

**Test that debuggers can't attach:**

```bash
# In another terminal:
lldb -p $(pgrep llama-server)
# Expected: "error: attach failed: Operation not permitted"
```

**Test inference still works:**

```bash
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "test",
    "messages": [{"role": "user", "content": "Say hello"}],
    "max_tokens": 20
  }'
```

**If debugger is blocked AND inference works: hardening is working.**

---

## Phase 4: Ad-Hoc Codesign (POC Level)

This gives you Hardened Runtime without a $99 Apple Developer ID.
Ad-hoc signing works on the same machine but not on other machines.

```bash
codesign --sign - \
         --options runtime \
         --entitlements /path/to/inference-exchange/provider-hardened/entitlements.plist \
         --force \
         build/bin/llama-server
```

Verify:

```bash
codesign -dv build/bin/llama-server 2>&1
# Should show "Runtime Version" in the output
```

With Hardened Runtime, you get the additional protections:
- task_for_pid() blocked (no external process can read your memory)
- DYLD_INSERT_LIBRARIES blocked (no dylib injection)
- These work even for root users

---

## Phase 5: Wire to OCIP Agent (Full E2E Test)

This proves the two-process architecture works with a hardened server.

**Terminal 1 — Start hardened server on Unix socket:**

```bash
# llama-server supports --host with a unix socket path
./build/bin/llama-server \
    --model ~/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf \
    --host 127.0.0.1 \
    --port 9999 \
    --n-gpu-layers -1
```

(Note: llama-server may or may not support Unix sockets depending on
version. If not, localhost:9999 is fine for the POC — the agent connects
over HTTP either way. Unix socket is a production refinement.)

**Terminal 2 — Start the coordinator (on same machine or your Windows):**

If running on the M3:
```bash
cd /path/to/inference-exchange
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
python -m inference_exchange.coordinator
```

Or point to your Windows coordinator if it's already running.

**Terminal 3 — Start the OCIP agent:**

```bash
cd /path/to/inference-exchange
source .venv/bin/activate
python ocip_agent/agent.py \
    --name "m3-hardened" \
    --price-output 0.10 \
    --trust hardened \
    --coordinator ws://localhost:8000/ws/provider
```

The agent will:
1. Spawn the inference server (or connect to the already-running one)
2. Register with the coordinator
3. Start serving encrypted inference requests

**Terminal 4 — Send a request through the full stack:**

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(curl -s http://localhost:8000/health | python3 -c 'import sys,json; print(json.load(sys.stdin)["default_api_key"])')" \
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "What is the capital of France?"}],
    "stream": false
  }'
```

---

## What You're Proving at Each Phase

| Phase | What it proves | Blocked by company IT? |
|-------|---------------|----------------------|
| 1 — Unhardened build | Metal GPU inference works on M3 | Only if git/cmake blocked |
| 2 — Patch applied | Hardening code compiles | No (just C code) |
| 3 — PT_DENY_ATTACH | Debuggers can't attach | No |
| 4 — Ad-hoc codesign | Hardened Runtime active | No (no Apple ID needed) |
| 5 — Full E2E | Two-process arch + coordinator + encrypted | Only if Python/pip blocked |

**For production (not on company laptop):**
- Phase 6 would be: real Apple Developer ID ($99/yr) for proper codesigning
- Phase 7: notarization (so it runs on other people's Macs)
- Phase 8: distribution (provider downloads signed binary, doesn't build)

---

## Troubleshooting

**`xcode-select --install` fails or is blocked:**
- Check if it's already installed: `xcode-select -p`
- Try: `pkgutil --pkg-info=com.apple.pkg.CLTools_Executables` — if this returns info, you have CLT

**`brew install cmake` blocked:**
- Download cmake directly: https://cmake.org/download/ (macOS .dmg)
- Or use the cmake that comes with Xcode: `/Applications/Xcode.app/Contents/Developer/usr/bin/cmake`

**`git clone` fails (network blocked):**
- Download the llama.cpp zip from GitHub in a browser
- Or clone on a personal machine, zip it, transfer via USB

**PT_DENY_ATTACH returns ENOSYS:**
- You're probably not on macOS. This is a Darwin-only syscall.

**`codesign` fails:**
- Ad-hoc signing (`--sign -`) always works, no account needed
- If it fails, you may be in a directory your MDM restricts writes to. Try ~/Desktop/

**Metal not detected:**
- Run: `system_profiler SPDisplaysDataType | grep Metal`
- M3 should show "Metal Family: Metal 3" or similar
- If missing, macOS may need an update

**Model download blocked:**
- HuggingFace URLs might be blocked by corporate proxy
- Download on phone, AirDrop to Mac
- Or use a personal hotspot for the download
