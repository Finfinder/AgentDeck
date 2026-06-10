# Changelog

Wszystkie istotne zmiany w projekcie są dokumentowane w tym pliku.

Format zgodny z [Keep a Changelog](https://keepachangelog.com/pl/1.0.0/).

## [Unreleased]

### Fixed

- Walidacja znaków URL w `defaultOpenUrl` — dodano allowlist regex `SAFE_URL_RE` oraz jawny `{ shell: false }` w `execFile` aby zapobiec CodeQL alert `js/command-line-injection` (CWE-78).
- Naprawiono 12 ESLint errors: usunięto unused imports (isDiffInput, isWorkspaceEditInput, DiffResult, WorkspaceEditResult) z preload, unused filePath parameter z editorShowDiff, unused sampleDiagnostics z integration tests, dodano eslint-disable dla deprecated monaco.languages API. Wszystkie quality gates przechodzą (lint, typecheck, 439/439 testy).
- Zaktualizowano dompurify z 3.2.7 do 3.4.8 poprzez npm overrides — naprawiono podatności XSS (CWE-79), URI validation bypass (CWE-183), Prototype Pollution (CWE-1321) w monaco-editor.

### Changed

- Zaktualizowano react i react-dom z 19.2.6 do 19.2.7 — poprawka dla Server Actions (FormData entries w Server Components). react 19.2.7 wymagany przez peer dep react-dom 19.2.7.

## [0.1.0] - 2026-06-02

### Added

- Editor Service z Monaco: karty, dirty state, zapis plików, wykrywanie języków (TS/JS/JSON/YAML/Markdown/PowerShell)
- IPC handlery read/write/diagnostics
- EditorTabs, EditorSurface, MonacoEditorSurface, useEditorStore hook
- 190 testów jednostkowych dla Editor Service

### Changed

- MonacoEditorSurface: dodano eslint-disable dla deprecated monaco.languages API (Monaco 0.55 wymaga any type casting)
- editorShowDiff: usunięto unused filePath parameter
- preload/index.ts: usunięto unused imports (isDiffInput, isWorkspaceEditInput, DiffResult, WorkspaceEditResult)

## [0.0.1] - 2026-05-31

### Added

- Szkielet Electron/React/TypeScript z contextIsolation, nodeIntegration disabled
- Preload IPC z type guards i wersjonowanymi kanałami
- Settings Service z theme persistence i bezpiecznymi fallbackami
- Workbench shell z ciemnym motywem, activity bar, sidebar, editor area, panel, status bar
- Workspace Service z parserem .code-workspace
- Dependency-cruiser dla architektonicznych testów
- docs/domain.md z kontraktem domenowym
- ADR-001..ADR-008