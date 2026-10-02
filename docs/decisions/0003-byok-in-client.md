# 0003: External providers use the user's key, in the client

- Status: Accepted
- Date: 2026-10-01
- Principles: P4, P5

## Context

At launch, there are not many local providers. Routing to external providers (first: OpenRouter) gives users a working product on the first day. If the coordinator calls external providers, it must hold keys and pay bills.

## Decision

The coordinator returns a ranked quote. The SDK sends the request. If the best option is external, the SDK calls the external provider directly with the user's own key. The SDK checks the routing policy locally and has a fixed list of permitted external hosts.

## Consequences

- The coordinator does not hold external keys and is not in the payment path.
- A compromised coordinator cannot get external keys or send traffic to an unknown host.
- The browser chat cannot use this path until a design for browser keys exists.
- External providers must be labelled as not private and need opt-in for each request (ROUTE-009).
- Check the terms of service of each external provider before use (#67).
