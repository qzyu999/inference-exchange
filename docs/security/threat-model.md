# Inference Exchange L2 Threat Model

**Status:** Draft for Public Alpha

## 1. Purpose

This document defines the security claim made by an **L2 (Hardened)** provider in Inference Exchange. It is intentionally narrower than a general claim that the provider is "secure" or "confidential."

The goal is a falsifiable statement that can be tested against the actual provider implementation.

## 2. Alpha scope

The initial Public Alpha target is **Apple Silicon + macOS 14+ + the hardened provider runtime**.

The L2 model is platform-specific. Other platforms must define and independently validate their own L2 backend before advertising the same guarantees.

The current reference hardening implementation uses macOS security mechanisms including Hardened Runtime, `PT_DENY_ATTACH`, core-dump restrictions, and SIP verification. These mechanisms are evidence for the claim; their presence alone is not sufficient proof of the claim.

## 3. Security claim

### 3.1 L2 confidentiality claim

> While an approved L2 provider runtime is executing normally on a macOS system with the required platform security state enabled, a local provider operator with ordinary user/administrator control of the host cannot recover inference plaintext using supported user-space or OS-level inspection mechanisms.

Here **inference plaintext** means consumer prompt/input data, generated output data, and provider-held inference state that contains or directly reconstructs that data.

The intended bypass boundary is a compromise below the provider process, such as a successful kernel-level exploit, hypervisor/firmware compromise, or physical attack.

### 3.2 Critical qualification: L2 is not remote attestation

L2 is an **execution-environment property**, not by itself proof that a remote provider is honest or is running the expected binary.

A malicious provider operator who is able to substitute a different provider implementation before execution may simply create a program that intentionally copies plaintext once the request is decrypted. Process hardening cannot prevent a program from exposing its own plaintext.

Therefore the alpha claim is explicitly conditional on the provider runtime being the approved implementation/configuration. The current system does **not** treat local code signing or a provider self-report as equivalent to hardware-backed remote attestation.

Remote verification of provider identity/code state is a separate capability and must not be implied by the L2 label until implemented and validated.

## 4. Protected assets

L2 protects the following while they are handled by the approved provider runtime:

1. Consumer prompts and input tokens.
2. Generated outputs and output tokens.
3. Decrypted request contents.
4. Conversation/session state containing consumer data.
5. KV cache and other reusable inference state containing consumer data.
6. Intermediate CPU/GPU/unified-memory state that contains or directly reconstructs consumer data, **to the extent the relevant memory is actually covered by the tested L2 isolation boundary**.
7. Ephemeral cryptographic session material held by the provider process, except material intentionally exposed by protocol design.

## 5. Non-assets / metadata that L2 does not hide

L2 does not by itself hide:

- Provider uptime or availability.
- CPU/RAM/GPU utilization.
- Approximate request timing.
- Network endpoints and traffic volume where visible to the host.
- Model identity or other information intentionally advertised by the provider.
- The fact that an inference workload is executing.
- Billing/accounting metadata intentionally handled by the coordinator.

Traffic confidentiality between consumer and coordinator/provider is provided by the OCIP confidential transport layer and is a separate property from host-process hardening.

## 6. Threat actor

### 6.1 In-scope attacker: local provider operator

Assume the operator has ordinary administrative/user control of the provider machine and is actively attempting to recover consumer plaintext.

The operator may:

- Inspect ordinary files readable by the operator.
- Inspect process lists and command-line arguments.
- Observe CPU, RAM, GPU, disk, and network metadata.
- Read application/runtime logs available to the operator.
- Start, stop, and restart the provider.
- Kill the provider process.
- Attempt debugger attachment.
- Attempt supported OS process-memory inspection.
- Attempt to obtain core dumps or crash artifacts.
- Attempt dynamic-library injection.
- Attempt user-space process modification.
- Change ordinary user-space configuration.
- Attempt to observe data through temporary files or ordinary telemetry paths.

The operator is **not trusted merely because they own or operate the machine**.

### 6.2 Out-of-scope attacker: compromised platform

The following are outside the L2 guarantee:

- Successful kernel exploit or kernel-level compromise.
- Firmware compromise.
- Hypervisor compromise or successful VM escape where a VM implementation is used.
- Platform security mechanisms deliberately disabled outside the supported provider configuration.
- Physical probing, invasive hardware attacks, or forensic attacks outside the software threat model.
- Malicious hardware or a compromised hardware root of trust.
- Supply-chain compromise of the build/signing infrastructure.
- Side-channel attacks unless explicitly added to scope and tested.

L2 should therefore **not** be described as protection against a nation-state/0-day-class attacker or as hardware confidential computing.

## 7. Malicious provider binary limitation

This is one of the most important boundaries in the model.

If the operator can cause an intentionally modified provider program to execute, and that program is allowed to decrypt requests, then process hardening cannot make that program confidential against its own behavior.

Therefore:

**L2 does not currently provide cryptographic proof that a remote provider is executing the approved code.**

The current alpha architecture should treat:

- code identity,
- binary signing,
- runtime integrity,
- provider attestation,

as separate properties that must eventually be verified rather than inferred from the L2 label.

This is precisely why the OCIP attestation layer is a future/independent component of the trust model.

## 8. Security boundary

```text
                    INFERENCE EXCHANGE

 Consumer
    |
    | encrypted request
    v
 Coordinator
    |
    | encrypted relay
    v
 +-----------------------------+
 | Approved L2 Provider Runtime |
 |                             |
 |  decrypt -> tokenize ->     |
 |  infer -> generate ->       |
 |  encrypt response           |
 |                             |
 |  plaintext exists here      |
 +-----------------------------+
    ^
    |
    | OS/process security boundary
    |
 Provider Host / Operator

Operator may observe metadata and control availability,
but must not have a supported path to inspect the runtime's
protected plaintext state.
```

### Boundary A — Consumer → Coordinator

The coordinator must not require or receive consumer inference plaintext.

### Boundary B — Coordinator → Provider

The request remains encrypted until it reaches the provider runtime capable of decrypting it.

### Boundary C — Inside provider runtime

Plaintext necessarily exists during tokenization and inference. The security claim begins by limiting access to that plaintext to the approved provider process/runtime.

### Boundary D — Provider operator → Provider runtime

The operator may control the host and availability but must not have a supported OS/user-space mechanism to read protected process state.

### Boundary E — Runtime → external artifacts

Prompts, outputs, keys, and sensitive inference state must not escape through logs, crash dumps, temporary files, telemetry, or debugging interfaces.

## 9. Required L2 properties

A conforming Apple Silicon/macOS L2 implementation must establish evidence for all of the following:

| Property | Required result | Verification |
|---|---|---|
| Debugger resistance | Supported debugger attachment cannot inspect protected state | Automated attack test |
| Process-memory resistance | Supported external memory inspection cannot recover plaintext | Automated/repeatable attack test |
| Core-dump resistance | Provider plaintext is not recoverable from generated core dumps | Automated test |
| Injection resistance | Supported library/process injection cannot cause protected-state disclosure | Automated/repeatable test |
| Runtime integrity | Provider runs the intended hardened runtime under the documented deployment procedure | Build/signature/runtime verification |
| Logging confidentiality | Plaintext does not appear in provider logs | Static review + regression test |
| Artifact confidentiality | Plaintext does not appear in temp/crash artifacts | Regression/security test |
| Coordinator confidentiality | Coordinator does not receive inference plaintext | Protocol/cryptographic test |
| GPU/unified-memory boundary | If inference uses GPU/unified memory, external supported mechanisms cannot recover protected inference data | Platform-specific attack test |
| Platform security state | Required macOS security protections are enabled | Startup self-test + independent verification |

A property is **not considered proven merely because the implementation contains a corresponding API call or configuration flag**.

## 10. Apple Silicon alpha assumptions

The initial implementation currently relies on macOS mechanisms including:

- Hardened Runtime.
- `PT_DENY_ATTACH`.
- System Integrity Protection (SIP).
- Disabled core dumps.
- Code signing for the production distribution path.
- OCIP encrypted transport for consumer/provider request confidentiality.

The exact effectiveness of each mechanism must be demonstrated by attack tests. In particular, tests must distinguish:

1. A mechanism being configured.
2. A mechanism actually preventing the intended attack.
3. A mechanism preventing the attack for the entire inference data path, including GPU/unified memory where applicable.

## 11. Availability is not confidentiality

An L2 operator can still:

- Kill the provider.
- Restart it.
- Disconnect it from the network.
- Prevent it from serving requests.
- Potentially observe resource-usage metadata.

These are availability/metadata capabilities and do not violate the L2 confidentiality claim.

## 12. Integrity claim

L2 should **not** currently be advertised as providing strong end-to-end integrity against a malicious provider operator.

Process hardening can prevent an operator from modifying an already-running protected process through supported mechanisms, but it cannot by itself prove that the process that was launched was the intended implementation.

Strong remote runtime integrity requires an additional provider-authentication/attestation mechanism.

For Public Alpha, the safe claim is therefore:

> L2 provides process-level confidentiality against supported local OS inspection of an approved runtime; it does not provide hardware-backed remote attestation or proof of honest provider behavior.

## 13. Test methodology

Security tests should use a known secret prompt that is not otherwise present on the machine, for example a randomly generated marker.

Each attack test should attempt to recover that marker rather than merely checking whether a command returned an error.

For each test record:

- Platform and OS version.
- Hardware model.
- Provider build identifier/hash.
- Security configuration state.
- Attack command/tool used.
- Whether the attack obtained plaintext.
- Relevant logs/output.
- Pass/fail result.

A command returning `EPERM`, `denied`, or another error is useful evidence but is not by itself sufficient if another supported path can still recover the secret.

## 14. L2 acceptance boundary

The Public Alpha L2 label is acceptable only when:

1. The provider passes its platform self-test.
2. The documented attack suite passes.
3. No known supported user-space/OS inspection path recovers the test secret.
4. Logging and artifact paths have been audited.
5. The limitations in this document are publicly disclosed.
6. The provider is not represented as hardware-confidential or remotely attested unless those properties are separately verified.

## 15. Relationship to higher levels

L2 is intentionally weaker than hardware-backed confidential computing.

- **L2:** relies on OS/process isolation and assumes the kernel/platform security boundary holds.
- **L3:** moves the confidentiality boundary into hardware-enforced encrypted memory / TEE mechanisms.
- **L4:** additionally protects accelerator memory and the broader inference pipeline with hardware-backed confidential computing.

Therefore L2 should be marketed as protection against the **ordinary local operator**, not protection against a compromised kernel or physical attacker.

## 16. Open questions before declaring L2 proven

- [ ] Exactly which macOS APIs/tools can an administrator use to inspect another process under the supported configuration?
- [ ] Does the chosen llama.cpp/Metal execution path place sensitive inference state in GPU/unified memory that has an independently testable protection boundary?
- [ ] Can an administrator launch a modified/unsigned replacement provider while bypassing the intended deployment controls?
- [ ] What exact code identity is checked for a production provider?
- [ ] Can the coordinator or consumer independently verify that identity?
- [ ] What crash-reporting mechanisms could capture plaintext?
- [ ] What telemetry/debugging facilities are enabled by default?
- [ ] Which claims can be tested automatically in CI versus only on a real Apple Silicon security-test host?

These questions are blockers for stronger wording, but they do not need to be solved by the same mechanism. The threat model should remain explicit about what is known, what is tested, and what is still an assumption.
