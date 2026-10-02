# 0002: Admit only L2 or higher providers

- Status: Accepted
- Date: 2026-10-01
- Principles: P1, P3

## Context

OCIP defines levels L0 to L4. An L0 or L1 provider can read prompts. For a user who does not need privacy, an external provider (#67) gives the same result. The value of local providers on the exchange is private inference.

## Decision

The exchange admits only providers with verified L2 or higher (PROV-005). L0 and L1 stay in the OCIP specification for other implementers.

## Consequences

- Supply is smaller: mostly Apple Silicon Macs with the hardened runtime at first.
- Verification is a launch blocker. Today, providers report their own level (PROV-004). Until verification exists, the UI and API must show the level as self-reported (PRIV-004).
- DGX Spark support depends on a verifiable L2 path on Linux (#65).
