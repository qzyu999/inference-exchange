# E2E Encryption — Current Status and Design

## What Works Now

```
Consumer ────HTTP/SSE────▶ Coordinator ────WS (encrypted)────▶ Provider
  (plaintext)                  │                                   │
                               │ encrypts request                  │ decrypts request
                               │ using provider's                  │ using private key
                               │ X25519 public key                 │
                               │                                   │
                               │◀───WS (PLAINTEXT tokens)──────────│
  (plaintext)◀──SSE────────────│                                   │
```

**Request path (consumer prompt -> provider): ENCRYPTED**
- Coordinator encrypts messages using the provider's X25519 public key
- Fresh ephemeral keypair per request (forward secrecy)
- Provider decrypts with its private key
- Coordinator never has the provider's private key -- it cannot decrypt what it encrypts
- Algorithm: X25519 ECDH + XSalsa20-Poly1305 (NaCl Box)

**Response path (provider tokens -> consumer): PLAINTEXT**
- Provider streams tokens back as plain JSON over WebSocket
- Coordinator reads tokens to assemble OpenAI-format SSE stream
- Coordinator can read every generated token

## Why the Response Path Is Not Encrypted

The coordinator needs to read response tokens for three operational reasons:

1. **Billing** — tokens are counted and billed per-request. The coordinator
   must count output tokens to charge the consumer and credit the provider.

2. **SSE assembly** — the coordinator converts provider wire format
   (InferenceResponseChunk) into OpenAI-compatible SSE format. If tokens
   were opaque encrypted blobs, it couldn't build the SSE stream.

3. **OpenAI SDK compatibility** — consumers use the standard OpenAI Python/JS
   SDK with just a base_url change. If the response were encrypted, every
   consumer would need a custom SDK that decrypts.

## Threat Model Implications

| Scenario | Request (prompt) | Response (tokens) |
|---|---|---|
| Coordinator operator reads WS traffic | Cannot read (encrypted) | CAN read (plaintext) |
| Network observer (WiFi sniffer) | Cannot read (encrypted in WS) | CAN read (in WS frame) |
| Consumer's HTTP connection | Plaintext (consumer sent it) | Plaintext (consumer receives it) |

The current design protects **prompts** from the coordinator but not
**responses**. This is still meaningful: prompts often contain sensitive
data (PII, proprietary code, medical info), while responses are the
model's output which is less likely to be secret.

But for a full confidentiality claim, the response path needs encryption too.

## Full E2E Design (Future)

To encrypt the response path while maintaining OpenAI SDK compatibility:

### Option A: TLS-only Response Security

The consumer-to-coordinator connection uses HTTPS (TLS). The
coordinator-to-provider connection uses WSS (TLS). Each hop is encrypted
in transit, but the coordinator can read at the junction.

This is what most "encrypted" API services do. It's honest about the
threat model: you trust the coordinator with your responses but not with
your prompts.

### Option B: Consumer-Side Decryption (Full E2E)

```
Consumer SDK ────encrypted────▶ Coordinator ────encrypted────▶ Provider
  (decrypts response)              │ (opaque relay)               │
                                   │ cannot read                  │
                                   │ request or response          │
                                   │                              │
                                   │◀──encrypted tokens───────────│
  (decrypts)◀──encrypted───────────│                              │
```

Flow:
1. Consumer generates an X25519 keypair (per-session or per-request)
2. Consumer sends its public key in the request header
3. Coordinator forwards consumer's public key to the provider (inside the encrypted request)
4. Provider encrypts each token to the consumer's public key
5. Coordinator relays the opaque encrypted chunks (cannot read them)
6. Consumer SDK decrypts each chunk locally

Tradeoffs:
- Breaks raw OpenAI SDK compatibility (needs a wrapper that decrypts)
- Billing must use declared token counts (coordinator can't verify)
- Higher latency (encrypt/decrypt per token)
- Consumer needs crypto dependency (nacl)

### Option C: Symmetric Session Key (Hybrid)

1. Consumer generates a random AES-256 key per request
2. Consumer encrypts the session key to the provider's public key (included in request)
3. Provider decrypts the session key
4. Provider encrypts each token with AES-GCM using the session key
5. Coordinator relays opaque encrypted chunks
6. Consumer decrypts with its session key

Lower per-token overhead than Option B (AES-GCM vs NaCl Box), but
same tradeoff: breaks raw SDK compatibility.

### Recommendation

For MVP / initial product launch: **Option A** (TLS-only). Be honest in
docs that the coordinator sees responses but not prompts. This matches
what OpenRouter, Together AI, and every other inference API proxy does.

For differentiated product / enterprise: **Option C** (symmetric session key).
Build an IE SDK wrapper that handles key exchange and decryption transparently.
The wrapper looks like the OpenAI SDK to the application code.

## Current OCIP Confidence Levels vs Encryption

| Level | Description | Request Encrypted | Response Encrypted |
|---|---|---|---|
| L0 Open | No protection | No | No |
| L1 Contained | Process isolation | Yes (current) | No (TLS only) |
| L2 Hardened | Anti-debug + hardened runtime | Yes (current) | No (TLS only) |
| L3 Confidential | Hardware TEE | Yes | Yes (future, Option B/C) |

Full response encryption is a **Level 3** feature. Levels 0-2 rely on
TLS for response confidentiality, which is industry-standard.
