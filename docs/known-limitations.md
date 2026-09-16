# Known Limitations — Public Alpha

This document describes what the alpha does and does not provide. Read this before relying on any security claims or running the system in any environment where privacy matters.

## Security limitations

### L2 is not a TEE

The L2 (Hardened) security profile uses macOS platform controls — Hardened Runtime, SIP, PT_DENY_ATTACH, code signing. These prevent a provider operator from reading process memory using supported user-space mechanisms.

L2 is **not** hardware-level confidential computing (like Intel SGX, AMD SEV-SNP, or Apple PCC). A kernel exploit or physical attack bypasses L2. See the [PCC comparison](security/pcc-comparison.md) for a detailed analysis.

### No provider identity verification (App Attest)

The alpha does not verify that a provider is running genuine, unmodified software on real Apple hardware. App Attest verification code exists in the coordinator, but the native macOS App Attest client requires an Apple Developer Program enrollment ($99/yr) that has not been done for alpha.

This means: a malicious entity could set up a fake provider that claims to be hardened but isn't. The consumer has no cryptographic proof of the provider's identity. For alpha testing on a trusted LAN, this is acceptable. For production, App Attest is required.

### GPU/unified memory protection is untested

PT_DENY_ATTACH and Hardened Runtime protect CPU process memory. Whether Metal GPU buffers in Apple Silicon unified memory are equally protected from an operator with admin access is not documented by Apple and has not been tested. This is flagged as an open question in the L2 threat model.

### Response encryption uses per-token NaCl Box

Each response token is individually encrypted with a fresh NaCl Box (X25519 ephemeral + XSalsa20-Poly1305). This provides forward secrecy but no replay protection or sequence binding on the response direction. The AES-GCM session protocol with sequence numbers and directional keys is implemented but not yet wired into the live path.

### Billing in confidential mode trusts the provider

The coordinator cannot count tokens in encrypted requests or responses. Input token count comes from the SDK's estimate (~4 chars/token heuristic). Output token count comes from the provider's self-report. A malicious provider could over-report output tokens to earn more. TPS anomaly detection provides a rough sanity check but is not a strong defense.

### Password hashing is alpha-grade

User passwords are hashed with SHA-256 + random salt. This is not bcrypt or argon2. Sufficient for alpha testing with dummy accounts. Do not use real passwords.

### JWT secret regenerates on restart

Unless the `IE_JWT_SECRET` environment variable is set, the coordinator generates a fresh JWT signing secret on each restart. This invalidates all existing web sessions. For alpha this is fine; for production, set the env var.

## Operational limitations

### Single coordinator, no horizontal scaling

The alpha runs a single coordinator process. There is no PostgreSQL, no Redis, no load balancer. Provider WebSocket connections, rate limit counters, reputation scores, and TPS measurements are all in-memory and lost on restart. Billing and API keys persist in SQLite.

### No TLS

The alpha runs over plaintext HTTP and WebSocket. E2E encryption protects prompt and response content, but metadata (API keys in headers, session IDs, ciphertext lengths, timing) is visible to any network observer. For LAN testing this is acceptable. For internet deployment, TLS (via Caddy, nginx, or Fly.io) is required.

### No geographic routing

Provider selection does not consider network latency between consumer and provider. All providers on the exchange are treated as equal distance.

### Context window not enforced

The coordinator does not check whether a consumer's request fits within the provider's context window. A long conversation can overflow the provider's `n_ctx`, producing truncated or garbage output with no clear error.

### Session affinity is a soft preference

The matching engine gives a 20% score bonus to the provider that previously served the same session. This is not a hard pin — a cheaper or less loaded provider can still win, which means KV cache benefits may not materialize.

## Platform limitations

### Apple Silicon only for L2

The L2 hardening profile (PT_DENY_ATTACH + Hardened Runtime + SIP) is macOS/Apple Silicon specific. Linux and Windows providers can connect but cannot advertise L2 hardening. A Linux L2 profile (AMD SEV-SNP or similar) is a future goal, not an alpha feature.

### Model size constrained by unified memory

Apple Silicon uses unified memory shared between CPU and GPU. The maximum model size is limited by total RAM (minus OS and other processes). An M2 Max with 32GB can comfortably run 8B-parameter Q4 models. 70B models require M2 Ultra (192GB) or similar.

### No streaming decryption in OpenAI SDK mode

The `ConfidentialTransport` plugin decrypts non-streaming responses correctly. Streaming response decryption (rebuilding the SSE stream with decrypted content) is implemented but not fully tested with the OpenAI SDK's streaming parser. For alpha, use `stream=False` for the confidential path.

## What IS secure

Despite the limitations above, the following security properties are validated:

1. **The coordinator cannot read prompts on the confidential path.** The `/v1/confidential/infer` endpoint rejects plaintext and relays encrypted envelopes unchanged. Validated on hardware (Intel MBP coordinator → M2 MBP provider).

2. **Each request has forward secrecy.** A fresh ephemeral X25519 keypair is generated per NaCl Box encryption. Compromising the provider's long-term key cannot decrypt past requests.

3. **The hardened inference server resists the provider operator (L2).** PT_DENY_ATTACH blocks debuggers. Hardened Runtime blocks memory reading and code injection. SIP blocks kernel extensions. Verified on Apple Silicon with macOS Sequoia.

4. **Billing is mathematically consistent.** Property-based tests verify that total consumer spend equals total provider earnings plus platform fees across 1000 random events.

5. **API keys are not stored in plaintext.** Keys are SHA-256 hashed before storage. The raw key is shown once at creation.
