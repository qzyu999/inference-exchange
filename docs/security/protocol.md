# Confidential Inference Protocol and Provider Admission

**Status:** Public Alpha design

This document separates four properties that are easy to conflate:

1. transport confidentiality,
2. provider application authenticity,
3. L2 runtime confidentiality,
4. workload/artifact identity.

App Attest is an **admission/authenticity primitive**. It is not a TEE and is not itself proof of L2 confidentiality.

## 1. Target flow

```text
Consumer
  │ plaintext exists here only
  │ encrypt request locally
  ▼
Encrypted request envelope
  │
  ▼
Coordinator
  │ routing metadata + ciphertext
  │ fresh provider admission challenge
  ▼
Provider App / Agent
  │ App Attest evidence + artifact identity + L2 evidence
  ▼
Coordinator admission decision
  │
  ├── reject → no sensitive request release
  │
  └── admit → short-lived provider admission record
              │
              ▼
         Encrypted inference request
              │
              ▼
         Provider Agent
              │ decrypt
              ▼
      Protected local inference boundary
              │ plaintext
              ▼
         Provider Agent
              │ encrypt
              ▼
        Encrypted response
              │
              ▼
         Coordinator (blind relay)
              │
              ▼
           Consumer
```

**Important implementation gap:** the current coordinator API receives plaintext `messages` and encrypts them after provider selection. That is not yet a blind coordinator. This is tracked as **#21** and must be fixed before claiming coordinator blindness.

## 2. App Attest admission

For an Apple provider on a supported App Attest platform, the coordinator issues a fresh, one-time random challenge. The provider's native App Attest client hashes that challenge and calls Apple's `DCAppAttestService.attestKey`.

The provider returns:

- App Attest key identifier,
- App Attest attestation object,
- App ID / signing identifier,
- environment,
- provider encryption public key,
- provider artifact/build hash,
- declared provider security profile.

The coordinator verifies the attestation object before admitting the provider. Verification includes:

- Apple App Attest format,
- certificate chain to the pinned Apple App Attestation Root CA,
- certificate validity/signatures,
- App Attest nonce/challenge binding,
- RP/App ID binding,
- credential ID ↔ key ID binding,
- credential public-key hash ↔ key ID binding,
- production/development AAGUID,
- initial assertion counter.

Apple documents this server-side validation flow and requires subsequent assertions to be checked using the stored public key and monotonically increasing counter. citeturn0search0turn0search5

## 3. Admission binding

A successful App Attest verification is not sufficient by itself. The coordinator additionally binds the verified App Attest identity to:

```text
App Attest key ID
+ App ID / signing identity
+ provider encryption public key
+ provider artifact/build hash
+ protocol version
+ declared security profile
```

The resulting admission record is short-lived and must expire/revalidate. The provider's encryption private key never leaves the provider.

## 4. Freshness and replay

Each admission attempt has a unique challenge. A challenge is single-use and expires quickly.

For subsequent assertions:

- the challenge is fresh,
- the App Attest key ID is already registered,
- the assertion signature is verified against the stored App Attest public key,
- the RP ID is checked,
- the counter must increase strictly,
- the request/admission binding is checked,
- stale or replayed evidence is rejected.

## 5. Security boundaries

### Consumer → Coordinator

The confidential path must send ciphertext to the coordinator. Provider selection may use non-sensitive routing metadata, but the coordinator must not need plaintext prompts.

### Coordinator → Provider

The coordinator is a relay and admission authority. It must not be able to decrypt confidential inference payloads.

### Provider Agent → Inference Engine

This local channel is inside the provider confidentiality boundary. A Unix socket alone is not sufficient: endpoint permissions, process identity, replacement/injection resistance, logging, crash dumps, and runtime hardening must be tested.

### Provider → Coordinator

Responses leave the provider encrypted. The coordinator may relay ciphertext and accounting metadata but must not receive plaintext output on the confidential path.

## 6. Relationship to L2

App Attest answers roughly:

> "Is this a legitimate instance of the expected signed Apple app, and can the server cryptographically verify that identity?"

L2 attack testing answers:

> "Can an ordinary provider operator recover inference plaintext through the tested OS/user-space inspection mechanisms?"

Both are required for the strongest alpha provider profile, but neither replaces the other.

## 7. Platform policy

The attested provider profile requires a platform that supports the required App Attest semantics. The current target is **macOS 27+ on Apple Silicon**.

Older macOS releases may support the hardened/non-attested provider profile, but they must not be represented as equivalent to an App-Attest-admitted confidential provider.

## 8. Current implementation status

- Server-side App Attest verification primitives: implemented on the `feat/app-attest-admission` branch.
- Protocol fields for App Attest evidence and admission: implemented on that branch.
- Native `DCAppAttestService` provider client/package: **#22**.
- Blind consumer-to-provider encryption: **#21**.
- L2 capability and empirical attack validation: **#2/#3/#4/#5/#6/#7/#8**.

The Public Alpha must not close the admission milestone until the native client, server verification, key binding, admission gating, and negative tests all pass together.
