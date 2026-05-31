## Objective
Expand the `vscode` shim to cover additional namespaces and APIs to increase extension compatibility.

## Context
The current `vscode` shim implements a minimal subset of the VS Code Extension APIs required by priority extensions. A larger compatibility surface will enable more extensions to run with fewer runtime errors and lower migration effort.

## Scope
- Extend the `vscode` shim with additional namespaces (for example: `scm`, `comment`, `notebook`, `webview`, `customEditors`) and common API surfaces used by web extensions and notebooks.
- Implement compatibility behaviors for web extensions and common `vscode.env` / `vscode.workspace` interactions.
- Provide graceful fallback shims and feature-detection that log clear warnings when an API is not supported.
- Add integration tests and sample extensions exercising SCM, Comments API, Notebooks and Custom Editors.
- Document limitations and provide a migration guide for extension authors.

## Rationale
Full VS Code API parity is a large product; the MVP implemented only the minimal subset. Targeted expansion will allow more extensions to work in AgentDeck and reduce engineering friction for users migrating from VS Code.

## Benefits
- Increased number of working extensions and reduced migration effort for users.
- Fewer runtime errors for installed extensions and clearer guidance for unsupported features.
- Better compatibility testing for priority extension scenarios (notebooks, SCM, comments, custom editors).

## Definition of Done
- [ ] `vscode` shim implements the listed namespaces with documented limitations.
- [ ] Integration tests or sample extensions exercise SCM, Comments API, Notebooks and Custom Editors.
- [ ] Migration guide and compatibility notes added to `docs/compatibility.md` or similar.
- [ ] Labels and roadmap entry created.

## Milestone
1.0 Stabilizacja MVP
