# Principles

These principles are the base of the system. Each requirement comes from one or more principles. The code is an implementation of the requirements.

Only the project owner can change a principle. A change to a principle needs a decision record in `decisions/`.

## P1. Do not downgrade trust silently

The system must not send a request to a provider below the trust level that the consumer asks for. If no provider meets the level, the system must stop and tell the consumer. It must not use a lower level as a fallback.

## P2. Make the system transparent, not the users

Publish how the system works: code, configuration, infrastructure, and aggregate metrics. Do not publish data that identifies a user or a single request. Public data must not let a person find, target, or profile a user.

## P3. A claim is not evidence

Keep claims separate from verified facts. A provider can claim a trust level. Only the system can verify it, and only with evidence. Show the two values as different values. Do not show a claim as a fact.

## P4. Do not trust the coordinator

Design as if an attacker controls the coordinator. Where possible, the client must check the routing policy, the provider evidence, and the destination. The coordinator must not hold secrets that it does not need.

## P5. Users keep their own keys

Users keep their own keys for external providers. The coordinator must not store or receive these keys.

## P6. Deny by default

An endpoint is private until a requirement makes it public. In production, do not use shortcuts that are permitted only for development.

## P7. Keep money correct

For each charge, the consumer debit must equal the provider credit plus the platform fee. Do not lose or create money. Use integer arithmetic for money.

## P8. Use simple and open components

Use open-source components. Prefer one simple component to many complex components. Scale up before you scale out.

## P9. Every requirement has a test

A requirement is done only when an automatic test shows that it is done. A requirement without a test must show its status and an issue.
