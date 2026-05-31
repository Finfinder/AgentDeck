# AgentDeck Domain Contract

This document is the MVP domain boundary contract for AgentDeck. It defines ownership, public contracts and dependency direction for the first implementation slice. Code may depend on public package entrypoints, not on implementation files hidden behind a module boundary.

## Modules

| Module | Responsibility | Owns Data | Public Contract |
| --- | --- | --- | --- |
| Workbench UI | React renderer, startup shell, future views and panels | View state only | `@agentdeck/workbench` React entrypoint and typed preload API consumption |
| Desktop Shell | Electron main and preload process | Window lifecycle and IPC handler registration | `apps/desktop/src/main`, `apps/desktop/src/preload` |
| Shared | Cross-process types, IPC channel names and stable domain metadata | Shared contracts only | `@agentdeck/shared` |
| Services | Node/TypeScript desktop services and service bootstrap | Service startup state | `@agentdeck/services` |
| Agent Runtime | Agent sessions, workers, tasks and event stream contracts | Agent session state | `@agentdeck/agent-runtime` |
| Workspace Service | Future `.code-workspace`, file tree and file system watchers | Workspace metadata | Public service facade only |
| Editor Service | Future Monaco models, tabs, dirty state and diff commands | Editor model state | Controlled editor API through workbench/service contracts |
| Model Gateway | Future provider adapters and normalized model metadata | Provider capability metadata | Adapter contract with timeout/cancellation semantics |
| Permission Broker | Future deny-first approvals and policy decisions | Permission decisions and audit facts | Single approval API for mutating tools |
| Conflict Broker | Future patch application, merge checks and conflict decisions | Patch sets and conflicts | Patch validation/apply facade |
| Memory Service | Future Markdown-backed user/workspace/repo memory | Memory entry metadata | Auditable memory entry facade |
| Code Indexer | Future chunks, embeddings and retrieval query metadata | Index metadata | Retrieval query API |
| MCP Manager | Future `mcp.json`, server lifecycle and tool/resource/prompt registry | MCP server profiles | MCP server lifecycle facade |
| Extension Host | Future extension manifests, activation and VS Code-compatible subset | Extension registry and activation logs | Compatibility-layer API |
| Identity Service | Future GitHub profile and token availability status | Identity session metadata only | Auth status facade; token material never crosses to renderer |

## Domain Objects

| Object | Owner | Responsibility | Public Contract |
| --- | --- | --- | --- |
| `ChatTab` | Agent Runtime / Workbench UI | A visible conversation tab with selected agent, model, history reference and tool usage view. | Renderer receives display metadata and event stream references only. |
| `AgentDefinition` | Agent Runtime / Customizations Registry | Agent name, instructions, allowed tools, default model and handoff metadata. | Immutable definition loaded through registry facade. |
| `Worker` | Agent Runtime | Isolated execution unit for an agent task or subagent with scoped permissions. | Lifecycle: start, stop, crash report and resume metadata. |
| `AgentTask` | Agent Runtime | User-visible unit of work with status, input, output, tool calls and patch links. | Append-only task status updates. |
| `PatchSet` | Conflict Broker | Text operations with base file hash/version, author session and risk level. | Validated patch proposal before any mutation. |
| `Conflict` | Conflict Broker / Permission Broker | A patch collision, high-risk change or policy violation requiring user decision. | Structured review item linked to event log. |
| `MemoryEntry` | Memory Service | Auditable memory pointer backed by Markdown source, scope and checksum. | Metadata plus patch-based write proposal. |
| `RetrievalQuery` | Code Indexer / Memory Service | Semantic query with filters for scope, language, folder and freshness. | Read-only query object and ranked result metadata. |
| `McpServerProfile` | MCP Manager | User/workspace server configuration, trust state and lifecycle status. | Profile status without secret material. |
| `ExtensionManifest` | Extension Host / VSIX Installer | Normalized extension manifest and supported contribution points. | Compatibility result, activation events and contribution metadata. |
| `IdentitySession` | Identity Service | GitHub profile, auth status and secure-storage token availability. | Token presence and profile metadata; never raw tokens. |

## Dependency Direction

Allowed direction for production code:

```text
Workbench UI -> Shared
Workbench UI -> preload API only
Desktop Shell -> Shared
Desktop Shell -> Services
Desktop Shell -> Agent Runtime
Services -> Shared
Agent Runtime -> Shared
Future feature services -> Shared
Future feature services -> their explicit upstream facades only
```

Disallowed direction:

- Renderer code in `packages/workbench/src` must not import Node built-ins or `electron`.
- Feature packages must not import another package's `src/internal` files.
- Agent Runtime must not import Workbench UI components.
- Provider adapters must not import Workbench UI or Extension Host implementation.
- Mutating tool calls must go through the future Permission Broker contract.

The current enforcement is `.dependency-cruiser.cjs`, which blocks cycles, renderer imports of Node/Electron and imports from package `internal` folders.

## Public API Policy

- Each package exposes public code through `src/index.ts` and its package `exports` field.
- No `export *` from internal folders is allowed.
- Shared contracts may contain serializable DTOs, type guards and domain metadata.
- Runtime implementations stay behind package facades and may evolve without becoming public API.

## Phase 1 Scope

Phase 1 intentionally implements only the startup shell, preload IPC contract, service bootstrap placeholder, domain metadata and architecture rules. Workspace parsing, Monaco editor behavior, model providers, MCP, memory, retrieval and extension compatibility are separate phases in the implementation plan.