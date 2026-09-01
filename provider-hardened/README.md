# Hardened Inference Server

Security-hardened llama.cpp server for OCIP providers on Apple Silicon.

Requires a macOS kernel exploit (~$500k) or physical attack to observe prompts.
Full Metal GPU acceleration. No vendor lock-in.

## Two Paths

### POC (no Apple Developer ID needed)

For testing on your own machine. Ad-hoc signing gives you PT_DENY_ATTACH +
Hardened Runtime. Won't run on other machines.

```bash
# Build
chmod +x build-poc.sh
./build-poc.sh

# Run (standalone, no coordinator)
./ocip-llama-server --model ~/path/to/model.gguf --port 8081 -ngl -1

# Verify hardening
./verify-poc.sh

# Run with coordinator
./run-poc.sh --model ~/path/to/model.gguf --coordinator ws://localhost:8000/ws/provider
```

See **M3-GUIDE.md** for detailed instructions on a company M3 laptop.

### Production (requires $99/yr Apple Developer ID)

For distribution to other providers. Properly signed + notarized.

```bash
# Set your Developer ID
export SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"

# Build + sign
./build.sh

# Notarize (so it runs on other machines without Gatekeeper complaints)
xcrun notarytool submit ./ocip-llama-server \
  --apple-id your@email.com \
  --password app-specific-password \
  --team-id TEAMID \
  --wait
```

## What's Protected

| Attack vector | Blocked | Mechanism |
|---|---|---|
| lldb / debugger | ✅ | PT_DENY_ATTACH |
| Memory read (Mach API) | ✅ | Hardened Runtime |
| dtrace / Instruments | ✅ | SIP |
| Core dump analysis | ✅ | RLIMIT_CORE=0 |
| Network sniffing | ✅ | All traffic encrypted (OCIP) |
| Binary replacement | ✅ | Code signature + SIP |
| Dylib injection | ✅ | Hardened Runtime |
| Kernel 0-day | ❌ | ~$500k exploit required |
| Physical probe | ❌ | Infeasible on Apple Silicon SoC |

## Requirements

| | POC | Production |
|---|---|---|
| Apple Silicon (M1+) | ✅ | ✅ |
| macOS 14+ | ✅ | ✅ |
| Xcode CLT | ✅ | ✅ |
| cmake | ✅ | ✅ |
| Apple Developer ID | ❌ | ✅ ($99/yr) |
| Notarization | ❌ | ✅ |
| Works on other Macs | ❌ | ✅ |

## Files

```
provider-hardened/
├── M3-GUIDE.md          Step-by-step for M3 company laptop
├── README.md            This file
├── build-poc.sh         POC build (no Developer ID)
├── build.sh             Production build (Developer ID)
├── run-poc.sh           Start server + OCIP agent
├── verify-poc.sh        Verify hardening works (no sudo)
├── verify.sh            Full verification (some tests need sudo)
├── hardening.c          C module: PT_DENY_ATTACH, core dump, SIP check
├── hardening.h          Header for hardening module
├── hardening_windows.c  Windows equivalent (separate)
├── entitlements.plist   Entitlements for codesigning
└── llama.cpp/           (created by build script, gitignored)
```
