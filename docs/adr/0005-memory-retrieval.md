# ADR-005: Memory And Retrieval

| Field | Value |
| --- | --- |
| Status | Accepted for MVP |
| Date | 2026-05-31 |

## Context

AgentDeck needs auditable memory and semantic retrieval for code and AI customization files without requiring an external vector service.

## Decision

Use Markdown files as source of truth and SQLite with sqlite-vec as the local metadata and vector index.

## Consequences

- Memory can be reviewed, backed up and patched like normal files.
- Index schema, embedding model version and rebuild strategy must be explicit.
- Qdrant or LanceDB can be evaluated after the local MVP is validated.