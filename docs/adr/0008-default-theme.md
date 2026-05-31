# ADR-008: Default Theme

| Field | Value |
| --- | --- |
| Status | Accepted for MVP |
| Date | 2026-05-31 |

## Context

AgentDeck should start with a developer-focused dark workbench baseline and avoid a light-theme flash on startup.

## Decision

Use a dark theme as the default and express visual values through CSS tokens.

## Consequences

- Future theming must build on tokens instead of scattered color literals.
- Focus and status colors must keep WCAG 2.1 AA contrast for critical UI.
- Theme persistence belongs to the Settings Service phase.