# 0011: Vendors and providers are separate kinds of supply

- Status: Accepted
- Date: 2026-11-26
- Principles: P3, P8

## Context

IE gets inference from two kinds of supplier. Hosted API companies such as DeepInfra, Together and Fireworks sell a serverless API. They run no IE software. Community and operator machines run the IE agent and speak OCIP. The first design called both "directions" of one supply and described both in OCIP terms.

## Decision

Use two terms and two code areas.

| | Vendor | Provider |
|---|---|---|
| Who | A hosted inference API company | A machine that runs the IE agent |
| IE software on their side | None | IE agent, OCIP |
| Credential | IE's API key for that vendor | IE provider token |
| Trust | `external`, never above `open` | Admitted level from evidence |
| Money | IE pays the vendor's invoice | IE credits the provider |
| Code | `supply/vendors/` | `supply/providers/` |

- A vendor is configuration: a row with the base URL, a secret reference, model mappings, rates, limits, capability flags and an approval state. A transport is code. The first transport is `openai_compatible`. A vendor with another API gets a new transport, not a change to the request lifecycle.
- A vendor route is eligible only after it passes the vendor contract suite.
- An IE model ID names an exact checkpoint, revision and precision. A route maps it to a vendor model ID. IE does not infer a mapping from names.
- Vendor code does not import OCIP code. Provider code does not import vendor code.
- Routing, holds, settlement and recovery see both as an `Offer`. That is the only shared type.
- DeepInfra is the first approved vendor.

## Consequences

- A new vendor is a configuration row and a contract run.
- The paid beta can use vendors before providers. Providers stay on simulated credit until a payout requirement exists.
