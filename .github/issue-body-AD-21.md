## Objective
Update the `electron-vite` pin in `package.json` from `6.0.0-beta.1` to the stable `6.0.0` once it is released without a `-beta` suffix.

## Context
The current plan intentionally uses `electron-vite@6.0.0-beta.1` because it is the only available release supporting Vite 8. A stable GA release will eliminate the risk of further breaking changes before official release.

## Scope
- Monitor the `electron-vite` npm registry for a stable `6.0.0` (or later) release without a prerelease suffix.
- Update the version pin in `package.json` and run `npm install`.
- Run the full validation suite (typecheck, lint, unit tests, architecture tests, build, E2E) to confirm no regressions.
- Update `CHANGELOG.md` and any documentation referencing the beta version.
- Remove any workarounds or beta-specific configuration introduced for `6.0.0-beta.1`.

## Rationale
Using a beta dependency in production increases the risk of unexpected breaking changes on every install. A stable release provides a fixed, tested API surface and removes the need for the `@beta` npm tag.

## Benefits
- Eliminates the risk of unexpected breaking changes on fresh `npm install`.
- Removes the need for the `@beta` npm dist-tag during installation.
- Greater confidence in the stability of the `electron-vite` public API.
- Cleaner dependency manifest without prerelease markers.

## Definition of Done
- [ ] `package.json` pins `electron-vite` at a stable version (no `-beta` suffix).
- [ ] Full validation suite passes after the update.
- [ ] `CHANGELOG.md` documents the version bump.
- [ ] Beta-specific workarounds are removed.

## Milestone
1.0 Stabilizacja MVP
