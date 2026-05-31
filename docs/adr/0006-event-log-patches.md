# ADR-006: Event Log And Patches

| Field | Value |
| --- | --- |
| Status | Accepted for MVP |
| Date | 2026-05-31 |

## Context

Agent sessions must be recoverable and auditable across model messages, tool calls, permission decisions, patches and conflicts.

## Decision

Use an append-only SQLite event log with patch sets stored as separate records and exportable JSONL later.

## Consequences

- Runtime diagnostics can be reconstructed after failures.
- Secret redaction and retention policy are required before broad usage.
- Patch review and conflict resolution can link back to session events.