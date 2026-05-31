# ADR-003: Agent Runtime

| Field | Value |
| --- | --- |
| Status | Accepted for MVP |
| Date | 2026-05-31 |

## Context

Chat tabs, subagents and long-running tool loops must not block the UI or share uncontrolled mutable context.

## Decision

Use a local Agent Runtime with isolated workers managed by a future Session Broker.

## Consequences

- Each session can carry its own model, event log and permission scope.
- Worker crashes can be reported without terminating the workbench.
- Patch and conflict brokering become explicit runtime responsibilities.