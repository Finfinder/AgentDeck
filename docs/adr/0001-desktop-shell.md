# ADR-001: Desktop Shell

| Field | Value |
| --- | --- |
| Status | Accepted for MVP |
| Date | 2026-05-31 |

## Context

AgentDeck needs a Windows desktop application with a VS Code-like workbench, local filesystem access through controlled services and future integration with MCP, LSP, terminal and local model providers.

## Decision

Use Electron with a React renderer, Monaco-ready workbench package and Node/TypeScript services.

## Consequences

- The MVP can move quickly with one primary language and a mature desktop shell.
- Renderer security depends on strict IPC, context isolation and no direct Node access.
- Tauri and web-first architectures remain possible future alternatives, not MVP targets.