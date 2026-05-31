# ADR-002: IPC And Process Boundaries

| Field | Value |
| --- | --- |
| Status | Accepted for MVP |
| Date | 2026-05-31 |

## Context

The React renderer must not directly access filesystem, token storage, terminal APIs or process-spawning capabilities.

## Decision

Expose versioned IPC through Electron preload with an allowlisted contract. Renderer code consumes the typed preload API only.

## Consequences

- Every new capability requires an explicit IPC channel and payload validation.
- The renderer can be tested as browser code without Node APIs.
- Main/preload remain the only Electron-aware layers.