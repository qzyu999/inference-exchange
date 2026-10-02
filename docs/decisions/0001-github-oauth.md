# 0001: GitHub OAuth for public sign-in

- Status: Accepted
- Date: 2026-10-01
- Principles: P6, P8

## Context

The public launch needs accounts. The old code stored passwords with salted SHA-256. That is weak, and password accounts need email verification and password reset. The launch audience mostly has GitHub accounts. Free credits attract fake accounts.

## Decision

Use GitHub OAuth for sign-in in production. Turn off password sign-in in production. Keep the existing user, account, and API key tables. Find users by GitHub ID.

## Consequences

- The coordinator does not store passwords for new users.
- GitHub account age is a simple filter for fake accounts (AUTH-003).
- Users without GitHub cannot sign in. If this becomes a problem, add a second provider. Candidates: Ory Kratos, Zitadel, Keycloak (all Apache 2.0).
