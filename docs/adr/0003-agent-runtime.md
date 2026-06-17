# ADR-003: Agent Runtime

| Field | Value |
| --- | --- |
| Status | Accepted for MVP |
| Date | 2026-05-31 |

## Context

Chat tabs, subagents and long-running tool loops must not block the UI or share uncontrolled mutable context.

## Decision

Use a local Agent Runtime with isolated workers managed by a Session Broker. The runtime exposes parent sessions, worker lifecycle, subagent task creation, scoped permissions and immutable snapshots. Desktop IPC and the Model Gateway expose a controlled API for starting subagents with an explicit name, goal, model and allowed-tools scope.

## Consequences

- Each session can carry its own model, event log and permission scope.
- Subagents are represented as runtime tasks with `kind: 'subagent'`, optional `parentTaskId` and scoped `permissionScope.allowedTools`.
- The Model Gateway filters tools passed to the provider using the active permission scope, so a subagent cannot receive tools outside its allowed-tools list.
- Worker crashes can be reported without terminating the workbench.
- Patch and conflict brokering remain explicit runtime responsibilities.
