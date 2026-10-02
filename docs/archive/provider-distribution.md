# Provider Binary Distribution — Rough Design

How we build, sign, and distribute hardened provider binaries so that
providers download and run instead of building from source.

## Why This Matters

The current model asks providers to clone a repo, apply a patch, build
from source, and codesign themselves. This is broken in two ways:

1. **UX:** 6-phase manual build process. Nobody will do this at scale.
2. **Trust:** We can't verify what they actually built. A provider who
   skips PT_DENY_ATTACH or adds `get-task-allow` claims L2 while being
   open. The coordinator checks binary hashes in attestation but has no
   canonical hash to check against because we didn't build the binary.

The fix: **we build and sign, they download and run.** The coordinator
verifies the hash against our published manifest.

## The Two Binaries

Providers need two things:

```
┌──────────────────┐      ┌──────────────────────┐
│  ie-agent         │      │  inference engine     │
│  (OCIP protocol)  │─────▶│  (model execution)    │
│                   │ unix │                       │
│  • WS to coord   │ sock │  • llama-server       │
│  • X25519 crypto  │  or  │  • ollama             │
│  • attestation    │ http │  • vllm               │
│  • token relay    │      │  • mlx-server         │
└──────────────────┘      └──────────────────────┘
```

**ie-agent** — the OCIP agent binary. This is ours, we control it
entirely. Handles coordinator communication, encryption, attestation,
token streaming. One binary, all platforms.

**Inference engine** — the thing that actually runs the model. Multiple
options exist (llama.cpp, ollama, vllm, mlx). We can't reasonably build
and distribute ALL of them. But we CAN build hardened versions of the
ones we officially support.

## Distribution Strategy

### Tier 1: Agent Binary (we always build this)

The agent is our code. We build it in CI for every release.

| Platform | Format | Build method |
|---|---|---|
| macOS arm64 | Binary (PyInstaller onedir) | GitHub Actions macOS runner |
| macOS arm64 | Standalone binary (Nuitka, future) | GitHub Actions macOS runner |
| Linux x86_64 | Binary (PyInstaller) | GitHub Actions Linux runner |
| Linux arm64 | Binary (PyInstaller) | GitHub Actions Linux arm64 runner |

The agent binary is:
- Codesigned with Developer ID (macOS) or GPG-signed (Linux)
- Notarized with Apple (macOS)
- SHA-256 hash published to release manifest
- Hardened Runtime enabled (macOS)
- PT_DENY_ATTACH compiled in (macOS)

### Tier 2: Hardened Inference Engines (we build supported engines)

We build hardened versions of officially supported inference engines.
Providers choose which engine they want.

**Initially supported:**

| Engine | Platform | Why | Build complexity |
|---|---|---|---|
| llama-server (llama.cpp) | macOS arm64, Linux | Best Metal support, C++ static binary, easy to harden | Low — static build + codesign |
| ollama | macOS arm64, Linux | Popular, Go binary, built-in model management | Medium — need to patch + rebuild |

**Future:**

| Engine | Platform | Why | Build complexity |
|---|---|---|---|
| vllm | Linux (CUDA) | Best for NVIDIA GPUs, continuous batching | High — Python + CUDA |
| mlx-server | macOS arm64 | Native Apple framework | Medium — Swift/Python hybrid |

**What "hardened" means per engine:**

For each engine we build:
1. Apply our hardening patch (PT_DENY_ATTACH, core dump disable, SIP check)
2. Build as static binary (no dylib dependencies)
3. Codesign with Hardened Runtime + our entitlements (no get-task-allow)
4. Notarize with Apple
5. Compute SHA-256 hash post-signing
6. Publish hash to release manifest

### Tier 3: Bring Your Own Engine (advanced, lower trust)

Providers who want to use an unsupported engine (custom vllm setup,
TensorRT-LLM, etc.) can run the ie-agent with any OpenAI-compatible
server. The coordinator:
- Marks them as "unverified engine" (binary hash won't match manifest)
- Can still verify the AGENT is our build (agent hash matches)
- Trust level capped at L1 (contained) unless engine hash also matches

## Provider Experience

### Simple path (download + run)

```bash
# One command to install
curl -fsSL https://install.inference.exchange | sh

# This downloads:
#   ~/.ie/bin/ie-agent           (hardened agent)
#   ~/.ie/bin/ie-llama-server    (hardened inference engine)
#   ~/.ie/bin/ie-provider        (wrapper script)

# Start providing
ie-provider start --model llama-3.1-8b
# Downloads model if needed, starts engine + agent, connects to exchange
```

The `ie-provider` wrapper:
1. Checks for updates (compares local version to latest release)
2. Downloads model weights if not cached
3. Starts the hardened inference engine (background)
4. Starts the hardened agent (connects to coordinator)
5. Reports binary hashes during attestation

### Advanced path (choose engine)

```bash
# Install agent + specific engine
ie-provider install --engine ollama

# Or bring your own
ie-provider start --model llama-3.1-8b --engine-url http://localhost:11434
# Agent connects to existing Ollama, but trust level capped at L1
```

## CI Pipeline (GitHub Actions)

### Release workflow (on tag push)

```yaml
# .github/workflows/release-provider.yml
name: Release Provider Binaries

on:
  push:
    tags: ['v*']

jobs:
  build-agent-macos:
    runs-on: macos-14  # Apple Silicon runner
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -e . pyinstaller
      - run: ./provider-hardened/build-agent.sh
      # TODO: replace ad-hoc signing with Developer ID
      # - run: codesign --sign "$DEVELOPER_ID" ...
      # - run: xcrun notarytool submit ...
      - run: shasum -a 256 provider-hardened/ie-agent/ie-agent > ie-agent.sha256
      - uses: actions/upload-artifact@v4
        with:
          name: ie-agent-macos-arm64
          path: provider-hardened/ie-agent/

  build-llama-server-macos:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - run: |
          git clone --depth 1 https://github.com/ggerganov/llama.cpp /tmp/llama.cpp
          cp provider-hardened/hardening.c /tmp/llama.cpp/tools/server/ocip_hardening.c
          cp provider-hardened/hardening.h /tmp/llama.cpp/tools/server/ocip_hardening.h
          # ... apply patches, build static, codesign
      - run: shasum -a 256 /tmp/llama.cpp/build/bin/llama-server > ie-llama-server.sha256
      - uses: actions/upload-artifact@v4
        with:
          name: ie-llama-server-macos-arm64
          path: /tmp/llama.cpp/build/bin/llama-server

  # TODO: build-agent-linux, build-llama-server-linux

  publish-release:
    needs: [build-agent-macos, build-llama-server-macos]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - run: |
          # Combine all SHA-256 hashes into a manifest
          cat */*.sha256 > release-manifest.sha256
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            ie-agent-macos-arm64/**
            ie-llama-server-macos-arm64/**
            release-manifest.sha256
```

### The release manifest

```
# release-manifest.sha256 (published with every release)
a1b2c3d4...  ie-agent-macos-arm64
e5f6g7h8...  ie-llama-server-macos-arm64
i9j0k1l2...  ie-agent-linux-x86_64
m3n4o5p6...  ie-llama-server-linux-x86_64
```

The coordinator stores this manifest. During attestation, it compares
the provider's reported hashes against the manifest for the latest
release (and the N-1 release for upgrade grace period).

## Hash Verification Flow

```
Provider connects → attestation challenge → provider reports:
  {
    "agent_binary_hash": "a1b2c3d4...",
    "server_binary_hash": "e5f6g7h8...",
    "agent_version": "0.3.0",
    "server_engine": "llama-server",
    "server_version": "b4521",
    ...
  }

Coordinator checks:
  1. agent_binary_hash in release_manifest[latest] or release_manifest[latest-1]?
     YES → agent verified
     NO  → agent unverified (degraded trust)

  2. server_binary_hash in release_manifest?
     YES → engine verified, eligible for L2
     NO  → engine unverified, capped at L1

  3. Both verified + SIP + hardened runtime flags → L2 confirmed
```

## Open Questions

- **Pinned llama.cpp version or tracking HEAD?** We'd need to pick a
  stable commit of llama.cpp to build against and update periodically.
  Tracking HEAD is risky (breaking changes). Pinning means we're
  responsible for backporting security fixes.

- **Model download:** Should the agent handle model downloads (like
  ollama does) or expect the provider to have models already? If we
  handle it, we can also hash-verify models against HuggingFace.

- **Auto-update mechanism:** How aggressive? Silent background update
  + restart? Prompt the provider? What if they're mid-inference?

- **Multiple engines per provider:** Can a provider run llama-server
  for some models and ollama for others? The agent would need to
  route to different engine instances.

- **Code signing identity:** Need an Apple Developer ID ($99/year)
  for production. Ad-hoc signing works for testing but won't pass
  Gatekeeper on other machines and can't be notarized.

- **Linux hardening:** PT_DENY_ATTACH is macOS-specific. Linux
  equivalent is `prctl(PR_SET_DUMPABLE, 0)` + seccomp filters +
  potentially SELinux/AppArmor profiles. Different binary, different
  hardening path.

- **Installer vs raw binary:** `curl | sh` is simple but some
  providers may want Homebrew, a .pkg installer, or a .dmg.
  Start with curl, add others based on demand.

## Relationship to Trust Levels

| What's verified | Trust level achievable |
|---|---|
| Nothing (provider runs whatever) | L0 Open |
| Agent hash matches manifest | L1 Contained (agent is ours, engine unknown) |
| Agent + engine hash both match | L2 Hardened (both binaries verified) |
| Agent + engine + hardware attestation (SE/TPM) | L3 Confidential (future) |

This makes the trust levels *verifiable* rather than *self-declared*.
The binary hash is the minimum attestation evidence for L2. Hardware
attestation (Secure Enclave signature over the binary measurement)
is the evidence for L3.
