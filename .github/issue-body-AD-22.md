## Objective
Investigate and plan the migration from the deprecated `esbuild` config field to the native Vite 8 `oxc` configuration in `electron.vite.config.ts`.

## Context
Vite 8 introduces a native `oxc` configuration namespace as the replacement for the `esbuild` field, which is deprecated. The project currently does not use any `esbuild` options, so there is no immediate breakage, but future configuration needs (for example `define`, `jsxInject`) should use the `oxc.*` path.

## Scope
- Audit the current `electron.vite.config.ts` for any `esbuild` field usage.
- Research the Vite 8 `oxc` configuration API and map any future `esbuild` options to their `oxc` equivalents.
- Document the migration path and recommended configuration patterns in `docs/vite-config.md` or similar.
- If the project adds JS transformation options (define, jsxInject, targets, etc.), implement them under `oxc.*` rather than `esbuild.*`.
- Add a deprecation warning or lint rule that flags new `esbuild.*` usage in the config.

## Rationale
The project does not currently use `esbuild` options, so there is no urgency. However, preparing the migration path now avoids a breaking-change surprise when Vite removes the `esbuild` compat layer in a future major release.

## Benefits
- Proactively prepares the configuration for the removal of the `esbuild` compat layer.
- Reduces the risk of a breaking change on the next Vite major update.
- Provides clear guidance for contributors adding transformation options in the future.

## Definition of Done
- [ ] Audit confirms no `esbuild` field usage in `electron.vite.config.ts`.
- [ ] Migration path and `oxc` equivalents documented.
- [ ] Any new transformation options use `oxc.*` instead of `esbuild.*`.
- [ ] Lint rule or deprecation warning flags new `esbuild.*` usage.

## Milestone
1.0 Stabilizacja MVP
