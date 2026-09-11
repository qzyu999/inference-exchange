# Confidential Inference Protocol and Provider Admission

**Status:** Public Alpha design

This document is the normative protocol design for confidential inference. It deliberately separates four properties that are easy to conflate:

1. transport confidentiality,
2. provider application authenticity,
3. L2 runtime confidentiality,
4. workload/artifact identity.

App Attest is an **admission/authenticity primitive**. It is not a TEE and is not itself proof of L2 confidentiality.

## 1. Security goal

For a confidential provider session, the coordinator is a routing/admission relay, not a plaintext trust boundary.

Under the documented threat model, a compromised coordinator may observe and manipulate routing traffic, but must not obtain the inference plaintext or the session secrets. The protocol must also prevent a compromised coordinator from silently substituting an unauthenticated provider key when the consumer verifies the provider admission binding.

The protocol does **not** attempt to hide all metadata. Provider selection, timing, ciphertext length, traffic volume, and other metadata may remain observable unless a future traffic-analysis/privacy layer is added.

## 2. Key hierarchy

Do not use one long-lived symmetric encryption key for all inference traffic. Separate identity, admission, and session keys.

### 2.1 Provider App Attest key

The provider has an App Attest key managed by Apple's `DCAppAttestService` where supported. It establishes provider application authenticity for admission.

This key is **not** the inference encryption key.

### 2.2 Provider identity signing key

The provider has a long-lived identity signing keypair:

```text
provider_identity_public_key
provider_identity_private_key
```

The private key never leaves the provider. Its purpose is authentication and binding, not bulk encryption.

The identity public key is bound to the provider's verified App Attest identity and provider admission profile. The exact native key-storage mechanism is platform work and must not be represented as Secure Enclave protection until experimentally verified.

### 2.3 Ephemeral session keys

For each confidential inference session:

- the consumer generates a fresh ephemeral X25519 keypair;
- the provider generates a fresh ephemeral X25519 keypair;
- the two sides derive a shared secret with X25519;
- HKDF derives directional AEAD keys from the shared secret and transcript context.

The ephemeral private keys are never sent through the coordinator.

This provides session separation and protects past sessions from compromise of a later session key, subject to the usual assumptions of the chosen primitives and endpoint security.

### 2.4 AEAD message keys

Inference requests and responses are encrypted with AEAD using keys derived from the session secret.

The implementation must use a standard, audited AEAD construction available from the chosen cryptographic library. The protocol must authenticate the session identifier, direction, message sequence number, and relevant handshake transcript as associated data or equivalent authenticated context.

Never invent a custom encryption construction.

## 3. Provider admission record

A confidential provider publishes an admission record containing at least:

```text
provider_id
app_attest_key_id
app_id / signing identity
provider_identity_public_key
provider_artifact_or_build_hash
security_profile = L2
protocol_version
issued_at
expires_at
```

The provider identity public key is cryptographically bound to the verified App Attest identity. The binding must cover the exact key bytes and provider profile so that a coordinator cannot replace the provider's key without detection.

The admission record is short-lived and must be revalidated according to provider policy.

## 4. Trust model for provider key authentication

E2E encryption is only meaningful against a compromised coordinator if the consumer can authenticate the provider key independently of the coordinator's ability to rewrite the key.

The preferred Alpha design is:

1. the provider creates its long-lived identity signing key;
2. the provider registers/binds that key during App Attest admission;
3. the coordinator verifies the App Attest evidence and records the binding;
4. the provider signs its ephemeral session key and relevant handshake transcript with the provider identity key;
5. the consumer verifies the provider signature against the authenticated provider identity key and admission binding;
6. only then does the consumer accept the derived session.

For a fully decentralized provider marketplace, the consumer ultimately needs an independently verifiable trust anchor for the provider identity. A coordinator-only trust decision is insufficient against a malicious coordinator because the coordinator could otherwise replace the provider key and perform a man-in-the-middle attack.

Public Alpha may use an explicitly documented coordinator trust root for provider discovery while implementing the cryptographic binding needed for later independent verification. The protocol must not claim protection against active coordinator MITM until the consumer has an independent verification path.

## 5. Session establishment

The confidential flow is:

```text
Consumer                         Coordinator                    Provider Agent
   │                                  │                              │
   │ 1. routing metadata             │                              │
   │─────────────────────────────────►│                              │
   │                                  │ 2. select admitted provider │
   │                                  │─────────────────────────────►│
   │                                  │                              │
   │◄──────── provider admission ─────│                              │
   │                                  │                              │
   │ 3. fresh consumer X25519 key     │                              │
   │────────────────────────────────────────────────────────────────►│
   │                                  │                              │
   │ 4. provider ephemeral X25519 key + identity signature            │
   │◄────────────────────────────────────────────────────────────────│
   │                                  │                              │
   │ 5. verify provider binding/signature                            │
   │                                  │                              │
   │ 6. X25519 → HKDF → session keys  │                              │
   │                                  │                              │
   │ 7. encrypted inference request   │                              │
   │═════════════════════════════════►│═════════════════════════════►│
   │                                  │                              │
   │                                  │                              │ 8. decrypt
   │                                  │                              │ 9. local inference
   │                                  │                              │ 10. encrypt
   │                                  │                              │
   │◄════════════════════════════════│◄═════════════════════════════│
   │       encrypted response        │                              │
```

The coordinator sees routing metadata and ciphertext, but does not receive a plaintext `messages` field on the confidential path.

## 6. Handshake transcript binding

The authenticated provider handshake must bind at minimum:

```text
protocol_version
session_id
provider_id
provider_identity_public_key
provider_ephemeral_public_key
consumer_ephemeral_public_key
provider admission/profile identifier
freshness value / challenge
```

The provider signs the canonical transcript with its provider identity signing key. The consumer rejects the handshake if any bound value changes.

The exact canonical serialization must be deterministic and specified before implementation. JSON field ordering must not be relied upon unless canonicalized.

## 7. Key derivation

Conceptually:

```text
consumer_ephemeral_private
        ×
provider_ephemeral_public
        │
      X25519
        │
        ▼
 shared_secret
        │
       HKDF
        │
        ├── consumer → provider AEAD key
        └── provider → consumer AEAD key
```

The HKDF salt/info must include the protocol version and authenticated handshake transcript/session context so that keys are not accidentally reused across sessions or protocol contexts.

Directional keys must be distinct. A message sent in one direction must not be decryptable as a valid message in the opposite direction.

## 8. Message protection

Each encrypted message contains enough public framing information to route and order ciphertext, for example:

```text
protocol_version
session_id
direction
sequence_number
nonce
ciphertext
```

The plaintext is authenticated with AEAD. The sequence number must be monotonic within a session and replayed, duplicated, or invalid messages must be rejected.

Nonce reuse under the same AEAD key is prohibited.

The implementation must define maximum message sizes and reject malformed envelopes before decryption where possible.

## 9. Blind coordinator requirement

The confidential coordinator API must never accept plaintext inference content.

The current implementation has a known architectural violation: the coordinator API receives plaintext `messages` and encrypts them after provider selection. That is **not** E2E/blind-coordinator behavior.

The replacement flow must be:

```text
Consumer
  │ plaintext exists here only
  │ local encryption
  ▼
Encrypted inference envelope
  │
  ▼
Coordinator
  │ routing + admission + ciphertext relay
  ▼
Provider Agent
  │ local decryption
  ▼
Protected inference boundary
```

This is tracked as **#21**.

An ordinary OpenAI-compatible client cannot provide this property if it sends plaintext directly to the coordinator. Public Alpha therefore needs a consumer-side encrypted client/proxy/envelope path rather than merely changing the coordinator's downstream transport.

## 10. Coordinator compromise

If the coordinator is fully compromised, the confidential protocol aims for the following:

### Coordinator can

- observe routing metadata;
- observe provider/consumer identifiers exposed by the protocol;
- observe ciphertext lengths, timing, and traffic volume;
- drop, delay, reorder, or block messages;
- cause denial of service;
- attempt replay or ciphertext modification.

### Coordinator cannot, under the cryptographic and endpoint assumptions

- read inference plaintext;
- obtain consumer private session keys;
- obtain provider private session keys;
- derive the X25519 shared secret;
- decrypt recorded ciphertext;
- forge provider handshake signatures;
- modify authenticated ciphertext without detection;
- replay an accepted message when sequence/replay checks are correctly enforced.

### Important limitation

A coordinator that is trusted as the **only** provider-authentication root can still substitute a malicious provider and mount an active MITM. Therefore, the project must distinguish:

1. **blind against passive/compromised routing:** coordinator cannot read ciphertext;
2. **active coordinator resistance:** consumer independently authenticates the provider identity/key.

Public Alpha must state which property is implemented rather than implying the stronger one prematurely.

## 11. Provider Agent security boundary

Cryptography cannot compensate for a compromised Agent.

The plaintext confidentiality boundary includes the components that handle decrypted inference content:

```text
App Attest / native identity
          │
          ▼
     Hardened Agent
          │
     protected IPC
          │
          ▼
       llama.cpp
```

The Agent must therefore be treated as security-critical code. A Unix-domain socket alone is not sufficient. The implementation must address:

- process identity and endpoint permissions;
- process replacement/injection;
- debugger attachment;
- memory inspection;
- crash/core-dump leakage;
- logs and diagnostic output;
- environment/configuration leakage;
- temporary files;
- IPC peer authentication;
- code signing and Hardened Runtime configuration;
- minimal entitlements;
- absence of development/debug entitlements in release artifacts.

L2 claims are empirical: the attack suite must attempt to recover a unique plaintext canary rather than merely checking that one command returns `EPERM`.

This work remains part of **#3/#4/#5/#6/#7/#8** and the provider hardening track.

## 12. Apple security primitives

For the current confidential provider target, the platform profile is **macOS 27+ on Apple Silicon** with the required security state enabled.

Relevant primitives include:

- App Attest for provider application admission/authenticity;
- code signing and notarization for artifact identity/distribution;
- Hardened Runtime for runtime integrity protections;
- SIP and platform security state for host-level protections;
- Keychain/Secure Enclave-backed key storage where the final native implementation demonstrates that the desired key operations and access controls are actually supported.

Do not claim that App Attest is a TEE, that Secure Enclave protects arbitrary Python process memory, or that these primitives alone prove L2 inference confidentiality.

## 13. Failure behavior

Fail closed for confidential inference when:

- provider admission is absent, expired, or invalid;
- provider identity binding is invalid;
- provider handshake signature is invalid;
- protocol version is unsupported;
- transcript binding fails;
- key agreement fails;
- AEAD authentication fails;
- sequence/replay checks fail;
- provider security profile is below the requested profile;
- required runtime security checks fail.

Failure must not fall back to sending plaintext inference to the coordinator.

If a confidential provider cannot satisfy the protocol, the request should fail or be routed to another provider only after a new authenticated session is established.

## 14. App Attest admission

For an Apple provider on a supported App Attest platform, the coordinator issues a fresh, one-time random challenge. The provider's native App Attest client hashes that challenge and calls Apple's `DCAppAttestService.attestKey`.

The provider returns:

- App Attest key identifier;
- App Attest attestation object;
- App ID / signing identifier;
- environment;
- provider identity public key;
- provider artifact/build hash;
- declared provider security profile.

The coordinator verifies the attestation object before admitting the provider. Verification includes the Apple App Attest format, certificate chain, nonce/challenge binding, RP/App ID binding, credential/key binding, AAGUID, and initial counter requirements defined by Apple's protocol.

## 15. Relationship to L2

App Attest answers roughly:

> "Is this a legitimate instance of the expected signed Apple app, and can the server cryptographically verify that identity?"

L2 attack testing answers:

> "Can an ordinary provider operator recover inference plaintext through the tested OS/user-space inspection mechanisms?"

Both are required for the strongest Alpha provider profile, but neither replaces the other.

## 16. Platform policy

The attested provider profile requires a platform that supports the required App Attest semantics. The current target is **macOS 27+ on Apple Silicon**.

Older macOS releases may support a hardened/non-attested provider profile, but they must not be represented as equivalent to an App-Attest-admitted confidential provider.

## 17. Current implementation status

- Server-side App Attest verification primitives: implemented on the `feat/app-attest-admission` branch.
- Protocol fields for App Attest evidence and admission: implemented on that branch.
- Normative authenticated E2E session design: defined here; implementation tracked by **#21**.
- Native `DCAppAttestService` provider client/package: **#22**.
- L2 capability and empirical attack validation: **#2/#3/#4/#5/#6/#7/#8**.

The Public Alpha must not close the admission/confidentiality milestone until the native client, server verification, provider-key binding, consumer-side key verification, blind routing path, admission gating, Agent hardening, and negative tests pass together.
