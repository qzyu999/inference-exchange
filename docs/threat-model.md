# Threat Model -- Inference Exchange

## System Scope

Inference Exchange (IE) is a marketplace where consumers send LLM inference
requests and providers serve them using their own hardware. The coordinator
routes, bills, and matches. The protocol (OCIP) provides configurable
privacy from Level 0 (open) to Level 2 (hardened).

This document enumerates every party, every asset they want to protect,
every attacker, and every attack surface. It then maps each attack to the
defense and identifies gaps.

## Parties and Trust Relationships

```
  Consumer          Coordinator          Provider Operator       Provider Hardware
  (sends prompts)   (routes/bills)       (owns the machine)      (runs inference)
       │                 │                      │                       │
       │                 │                      │                       │
  Trusts: nobody    Trusts: nobody         Trusts: nobody          Trusts: nobody
  Wants: privacy    Wants: billing         Wants: earnings         N/A (hardware)
         accuracy         integrity              reputation
         integrity        availability           availability
```

Nobody trusts anybody. That's the design premise. The consumer doesn't
trust the coordinator with their prompts. The consumer doesn't trust the
provider with their prompts. The coordinator doesn't trust the provider
to report honest metrics. The provider doesn't trust the coordinator to
pay them fairly.

## Protected Assets

| Asset | Owner | Sensitivity |
|---|---|---|
| Prompt content | Consumer | HIGH -- may contain PII, proprietary code, medical/legal data |
| Response content | Consumer | MEDIUM-HIGH -- model output may reflect sensitive input |
| API keys | Consumer | HIGH -- bearer token, grants spending authority |
| Account balance | Consumer | HIGH -- real money |
| Billing ledger | Platform | HIGH -- financial record of all transactions |
| Provider private key | Provider | HIGH -- decrypts all requests to that provider |
| Consumer private key | Consumer | HIGH -- decrypts all responses (IE SDK mode) |
| Model weights | Provider | LOW -- typically public (HuggingFace) |
| Provider identity | Provider | MEDIUM -- reputation, earnings tied to it |

## Attackers

### A1: Malicious Coordinator Operator

The coordinator operator controls the server, database, and all network
traffic passing through. They are the most powerful attacker in the system.

**Capabilities:**
- Read all HTTP requests/responses (headers, bodies)
- Read all WebSocket frames
- Read the SQLite database (API keys, billing, provider data)
- Modify routing decisions (send requests to a chosen provider)
- Modify billing (steal from consumers or providers)
- Log and analyze traffic patterns (who talks to whom, when, how much)

**Motivation:** Sell user data, mine prompts for competitive intelligence,
manipulate billing.

### A2: Malicious Provider Operator

The provider operator controls the machine running the inference engine
and OCIP agent. At L0/L1, they have full access. At L2, they face
kernel-level protections.

**Capabilities (L0/L1):**
- Attach debugger to any process
- Read all process memory (prompts, responses, keys)
- Modify the inference engine (return fake responses)
- Log all prompts and responses
- Refuse to serve certain requests

**Capabilities (L2 Hardened):**
- See that processes are running (ps, Activity Monitor)
- See resource usage (CPU, RAM, GPU)
- See encrypted network traffic
- CANNOT read process memory (PT_DENY_ATTACH + Hardened Runtime)
- CANNOT attach debugger
- CANNOT inject code (DYLD_INSERT_LIBRARIES blocked)
- CANNOT replace binaries (code signature + SIP)
- CAN kill the process (denial of service, not confidentiality)

**Motivation:** Sell prompt data, train competing models on user prompts,
targeted surveillance.

### A3: Network Observer

Passive attacker on the same network (WiFi sniffer, ISP, corporate proxy).

**Capabilities:**
- See all unencrypted network traffic
- See IP addresses of all parties
- See traffic volume and timing
- CANNOT break TLS (with valid certs)
- CANNOT break NaCl encryption

### A4: Malicious Consumer

A consumer trying to exploit the system for free inference or to attack
providers.

**Capabilities:**
- Send crafted requests to the coordinator
- Create multiple API keys
- Attempt to bypass billing
- Send adversarial prompts (jailbreaks)

### A5: External Attacker

Attacker with no access to any party, targeting the system remotely.

**Capabilities:**
- Network scanning, port probing
- DDoS
- Exploit known CVEs in dependencies
- Social engineering

## Attack Surface Analysis

### Surface 1: Consumer <-> Coordinator (HTTP/SSE)

```
Consumer ──HTTP──> Coordinator
         <──SSE──
```

| Attack | Attacker | Defense | Status |
|---|---|---|---|
| Read prompts in transit | A3 (network) | TLS (HTTPS) | NOT IMPLEMENTED -- HTTP only |
| Read prompts at coordinator | A1 (coordinator) | E2E encryption -- coordinator encrypts to provider key, never decrypts | IMPLEMENTED |
| Steal API key in transit | A3 (network) | TLS | NOT IMPLEMENTED |
| Steal API key from DB | A1 (coordinator) | Keys stored as SHA-256 hashes | IMPLEMENTED |
| Forge API key | A5 (external) | 256-bit random keys, hash-checked | IMPLEMENTED |
| Replay request | A3 (network) | Per-request UUID | PARTIAL -- no nonce/timestamp check |
| Read response in transit | A3 (network) | TLS / E2E (IE SDK mode) | TLS: NOT IMPL, E2E: IMPLEMENTED |
| Read response at coordinator | A1 (coordinator) | IE SDK mode: response encrypted to consumer key | IMPLEMENTED |
| Manipulate billing | A1 (coordinator) | Financial invariant tests, auditable ledger | IMPLEMENTED (tests) |
| DDoS coordinator | A5 (external) | Rate limiting (30 req/min per key) | IMPLEMENTED |
| Enumerate API keys | A5 (external) | Timing-safe comparison, no key listing without auth | PARTIAL |

### Surface 2: Coordinator <-> Provider (WebSocket)

```
Coordinator ──WS──> Provider Agent
            <──WS──
```

| Attack | Attacker | Defense | Status |
|---|---|---|---|
| Read prompts in WS frames | A3 (network) | E2E encryption (request encrypted to provider key) | IMPLEMENTED |
| Read prompts at coordinator | A1 (coordinator) | Coordinator encrypts but cannot decrypt (no provider private key) | IMPLEMENTED |
| Impersonate provider | A5 (external) | Provider registers over WS, ID assigned by coordinator | WEAK -- no auth on WS connect |
| MITM the WS connection | A3 (network) | WSS (TLS) | NOT IMPLEMENTED -- WS only |
| Read response tokens in WS | A1/A3 | IE SDK mode: tokens encrypted to consumer key | IMPLEMENTED |
| Provider sends fake tokens | A2 (provider) | Attestation challenge-response | PARTIAL -- no content verification |
| Provider reports fake TPS | A2 (provider) | TPS anomaly detection (EMA vs hardware lookup) | IMPLEMENTED |

### Surface 3: Provider Agent <-> Inference Engine (localhost)

```
Agent ──HTTP──> Inference Engine (localhost:9999)
      <──SSE──
```

| Attack | Attacker | Defense | Status |
|---|---|---|---|
| Read prompts on localhost | A2 (provider, L0/L1) | None at L0/L1 | GAP at L0/L1, OK at L2 |
| Read prompts on localhost | A2 (provider, L2) | PT_DENY_ATTACH + Hardened Runtime on both processes | PARTIALLY IMPLEMENTED (server hardened, agent NOT yet) |
| Sniff localhost traffic | A2 (provider) | Unix socket (not on network interfaces) / localhost only | IMPLEMENTED (port 9999 localhost) |
| Read process memory | A2 (provider, L2) | Hardened Runtime blocks task_for_pid | IMPLEMENTED (server only) |
| Replace binary | A2 (provider, L2) | Code signature + SIP | IMPLEMENTED (server only) |
| Inject dylib | A2 (provider, L2) | Hardened Runtime blocks DYLD_INSERT | IMPLEMENTED (server only) |
| Kill process (DoS) | A2 (provider) | Agent detects and restarts | IMPLEMENTED |

### Surface 4: Persistent State (SQLite)

| Attack | Attacker | Defense | Status |
|---|---|---|---|
| Read API keys from DB | A1 (coordinator) | Keys hashed (SHA-256), originals not stored | IMPLEMENTED |
| Modify balances | A1 (coordinator) | Auditable ledger, financial invariant tests | IMPLEMENTED |
| Delete billing records | A1 (coordinator) | None -- coordinator owns the DB | GAP (no external audit log) |
| SQLite injection | A4 (consumer) | Parameterized queries throughout | IMPLEMENTED |

### Surface 5: Attestation

| Attack | Attacker | Defense | Status |
|---|---|---|---|
| Provider lies about trust level | A2 (provider) | Attestation challenge (nonce echo) | WEAK -- nonce echo doesn't prove anything |
| Provider lies about hardware | A2 (provider) | TPS anomaly detection | IMPLEMENTED |
| Provider lies about model | A2 (provider) | HF hash verification | IMPLEMENTED |
| Provider lies about hardening | A2 (provider) | No verification of PT_DENY_ATTACH from remote | GAP |

## Critical Gaps (Must Fix Before Alpha)

### GAP 1: Agent Not Hardened (HIGH)

**Attack:** Provider operator attaches debugger to the Python OCIP agent,
reads decrypted prompts and responses from memory.

**Impact:** Complete break of L2 privacy claim. Provider sees everything.

**Fix:** Freeze the agent with PyInstaller, codesign with Hardened Runtime,
add PT_DENY_ATTACH. Ship as part of the hardened package.

**Difficulty:** Medium -- PyInstaller + codesign is well-understood.

### GAP 2: No TLS (HIGH for production, LOW for private alpha)

**Attack:** Network observer reads API keys, prompts (standard SDK mode),
and responses in transit.

**Impact:** Any WiFi sniffer or corporate proxy can read everything except
E2E-encrypted content.

**Fix:** TLS on coordinator (Caddy reverse proxy or Fly.io auto-TLS).

**Difficulty:** Low -- standard deployment concern, not a code change.

### GAP 3: No WebSocket Authentication (MEDIUM)

**Attack:** Anyone can connect a fake provider, register, and receive
encrypted requests. They can't decrypt them (no private key for E2E
requests), but they can waste queue slots and see metadata.

**Fix:** Provider registration requires a signed token (API key or
device-code auth flow).

**Difficulty:** Medium -- needs a provider auth flow.

### GAP 4: Attestation Is Weak (MEDIUM)

**Attack:** Provider claims trust_level="hardened" but actually runs unhardened.
The nonce-echo attestation doesn't verify anything about the provider's
security posture -- it just proves the WS connection is alive.

**Impact:** Consumer requests routed to "hardened" providers that aren't
actually hardened.

**Fix (short term):** Coordinator-initiated checks (request codesign info,
check for known hardened binary hashes). Not foolproof but raises the bar.

**Fix (long term):** Apple App Attest or Secure Enclave key attestation.
Provider proves its binary is signed and running with Hardened Runtime via
a hardware-backed cryptographic proof.

**Difficulty:** Short term: Medium. Long term: Hard (requires Apple Developer
Program + Secure Enclave integration).

### GAP 5: No External Audit Log (LOW)

**Attack:** Coordinator operator modifies billing records. No way to prove
the original transactions.

**Fix:** Append-only audit log with signed entries (or publish hashes to a
public ledger).

**Difficulty:** Medium.

## What IS Secure (Validated Claims)

These claims are backed by implemented code and tested:

1. **The coordinator cannot read prompts.** The coordinator encrypts
   requests using the provider's X25519 public key. It does not have the
   provider's private key. Decryption requires the private key, which
   exists only in the provider agent's memory. The NaCl Box construction
   (X25519 ECDH + XSalsa20-Poly1305) is a standard, audited cryptographic
   primitive from libsodium.

2. **The coordinator cannot read responses (IE SDK mode).** When the
   consumer uses the IE SDK, responses are encrypted to the consumer's
   key inside the hardened agent. The coordinator relays opaque blobs.

3. **Each request has forward secrecy.** A fresh ephemeral X25519 keypair
   is generated per request and discarded after encryption. Compromising
   the provider's long-term key cannot retroactively decrypt past requests.

4. **The hardened inference server resists the provider operator (L2).**
   PT_DENY_ATTACH blocks debuggers. Hardened Runtime blocks task_for_pid
   (memory reading), DYLD_INSERT_LIBRARIES (code injection), and unsigned
   code. SIP blocks kernel extensions. Verified on M3 with macOS Sequoia.

5. **Billing is mathematically consistent.** Property-based tests run 1000
   random billing events and verify: total consumer spend equals total
   provider earnings plus platform fees, no money is created or destroyed.

6. **API keys are not stored in plaintext.** Keys are hashed with SHA-256
   before storage. The original key is shown once at creation time.

## What Is NOT Secure (Known Limitations)

1. **The OCIP agent can be observed by the provider operator.** It's plain
   Python. This is GAP 1 above.

2. **No TLS in transit.** HTTP/WS, not HTTPS/WSS. E2E encryption protects
   content, but metadata is visible.

3. **The coordinator can manipulate routing.** It can route requests to a
   chosen provider (e.g., one the operator controls). E2E encryption still
   protects content, but the operator controls which provider gets which
   request.

4. **The coordinator can deny service.** It can drop requests, refuse to
   route, or return errors. This is inherent to a centralized coordinator.

5. **Attestation is honor-system.** Providers self-declare their trust level.
   No remote verification of hardening state.

6. **Token billing in E2E mode is trust-based.** The coordinator can't
   count tokens in encrypted responses. It trusts the agent's reported count.

## Risk Matrix

| Risk | Likelihood | Impact | Priority |
|---|---|---|---|
| Provider reads prompts (unhardened agent) | High (any L0/L1 provider) | High (privacy breach) | P0 |
| Network sniffing (no TLS) | Medium (depends on network) | High (keys + metadata) | P0 for prod, P2 for private alpha |
| Fake provider connects | Low (needs coordinator URL) | Low (can't decrypt E2E) | P1 |
| Weak attestation | Medium | Medium (wrong trust routing) | P1 |
| Coordinator billing manipulation | Low (we control it) | High (financial) | P2 |
| SQLite corruption | Low | Medium (data loss) | P2 |

## Recommended Pre-Alpha Hardening Order

1. **Harden the agent** (PyInstaller + codesign) -- closes GAP 1, the P0 risk
2. **Add provider WS auth** -- closes GAP 3, prevents unauthorized providers
3. **Write this threat model** -- you're reading it
4. **Deploy with TLS** -- closes GAP 2 when going public
5. **Strengthen attestation** -- closes GAP 4 over time
