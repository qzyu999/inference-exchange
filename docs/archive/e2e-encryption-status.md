# E2E Encryption — Current Status and Design

## What Works Now

Both request and response paths are encrypted when using the IE SDK.

```
Consumer (IE SDK)        Coordinator              Provider
  encrypts prompt ------> opaque relay --------> agent decrypts
  decrypts response <---- opaque relay <-------- agent encrypts response
```

**Request path (consumer prompt -> provider): ENCRYPTED**
- Coordinator encrypts messages using the provider's X25519 public key
- Fresh ephemeral keypair per request (forward secrecy)
- Provider decrypts with its private key
- Algorithm: X25519 ECDH + XSalsa20-Poly1305 (NaCl Box)

**Response path (provider tokens -> consumer): ENCRYPTED (IE SDK mode)**
- When consumer sends `ocip_consumer_public_key`, the agent encrypts
  each response token to the consumer's key before sending
- Coordinator relays opaque blobs (cannot decrypt)
- Consumer IE SDK decrypts locally
- Standard OpenAI SDK mode: responses are plaintext (backward compatible)

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

See [provider-architecture.md](provider-architecture.md) for the complete design.

The short version: Option C from first-principles analysis. Both the agent
and inference server run inside a hardened boundary. The agent encrypts
response tokens to the consumer's public key before they leave the
hardened boundary. The coordinator relays opaque blobs. Neither the
coordinator nor the provider operator sees plaintext.

Consumer-side decryption is handled by the IE SDK, which wraps the
OpenAI SDK interface. Consumers who don't need response encryption use
the standard OpenAI SDK (prompts are still encrypted).

## Current OCIP Confidence Levels vs Encryption

| Level | Description | Request Encrypted | Response Encrypted |
|---|---|---|---|
| L0 Open | No protection | No | No |
| L1 Contained | Process isolation | Yes (current) | No (TLS only) |
| L2 Hardened | Anti-debug + hardened runtime | Yes (current) | No (TLS only) |
| L3 Confidential | Hardware TEE | Yes | Yes (future, Option B/C) |

Full response encryption is a **Level 3** feature. Levels 0-2 rely on
TLS for response confidentiality, which is industry-standard.
