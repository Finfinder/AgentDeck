# ADR-004: GitHub Login

| Field | Value |
| --- | --- |
| Status | Accepted for MVP |
| Date | 2026-05-31 |

## Context

AgentDeck needs GitHub identity for profile and repository metadata, but token material must never be stored in renderer storage or workspace files.

## Decision

Use system browser OAuth with loopback callback as the default flow and Device Authorization Flow as fallback.

## Consequences

- OAuth state validation, minimal scopes, logout and revocation handling are required in the Identity Service phase.
- Tokens stay in OS secure storage or an equivalent abstraction.
- The renderer receives only profile and token-availability status.