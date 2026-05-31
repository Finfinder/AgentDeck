# ADR-007: Extension Compatibility

| Field | Value |
| --- | --- |
| Status | Accepted for MVP |
| Date | 2026-05-31 |

## Context

AgentDeck should support a practical subset of VS Code-like extensions without implementing the full VS Code API or Marketplace.

## Decision

Support local folder and VSIX loading with manifest parsing and a minimal `vscode` shim for priority extensions.

## Consequences

- Compatibility is tracked through an explicit matrix.
- Unsupported APIs must fail with controlled compatibility errors.
- Full VS Code API coverage is outside MVP scope.