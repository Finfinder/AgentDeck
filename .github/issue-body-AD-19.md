## Objective
Add optional premium cloud embeddings (for example `text-embedding-3-large`) alongside the local/default `bge-m3`.

## Context
The MVP is designed to operate locally with predictable costs, but some teams may accept cloud costs for improved retrieval quality. Offering an optional premium path allows teams to choose quality over cost where appropriate.

## Scope
- Add configuration to select embeddings provider: local `bge-m3` (default) or optional premium cloud models (example: `text-embedding-3-large`).
- Implement a provider interface and selection logic with safe fallback to local embeddings when cloud is unavailable.
- Add telemetry and benchmark scripts to compare retrieval quality and cost across representative datasets.
- Implement quota/cost limits, rate-limiting and explicit opt-in confirmation for premium embeddings.
- Document usage and cost implications in `docs/embedding.md`.

## Rationale
Local, predictable costs support the MVP, but offering premium cloud embeddings can materially improve semantic search quality in very large repositories where local embeddings are insufficient.

## Benefits
- Improved semantic search relevance for large codebases and monorepos.
- Fewer false-positive context reads and better retrieval precision.
- Flexibility for teams to trade cost for retrieval quality.

## Definition of Done
- [ ] Configuration option exists to select embeddings provider.
- [ ] Example implementation for a premium provider (`text-embedding-3-large`) with safe fallback to `bge-m3`.
- [ ] Benchmark scripts and documentation in `docs/embedding.md`.
- [ ] Labels and roadmap entry created.

## Milestone
1.0 Stabilizacja MVP
