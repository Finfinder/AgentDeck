# Changelog

Wszystkie istotne zmiany w projektu s─ů dokumentowane w tym pliku.

Format zgodny z [Keep a Changelog](https://keepachangelog.com/pl/1.0.0/).

## [Unreleased]
### Changed

- Zaktualizowano electron z 42.4.0 do 42.5.1 — poprawki bezpieczeństwa i aktualizacja Chromium/Node.js.
- Zaktualizowano @vitejs/plugin-react z 6.0.2 do 6.0.3 — bugfix release.
- Zaktualizowano @types/node z 25.9.3 do 26.0.1 — aktualizacja typów Node.js 26.
- Zaktualizowano vite z 8.0.16 do 8.1.0 — bugfix release.
- Zaktualizowano @playwright/test z 1.60.0 do 1.61.1 — bugfix release.

### Fixed

- Naprawiono `relativePath` w code-indexer — obsługa Windows-style backslash paths (normalizacja przed `path.relative`).
- Naprawiono podwójny flag `i` w regex `extractMarkdownTags` w memory-service (TS1500).

### Added

- Dodano 105 testów jednostkowych dla code-indexer (chunking, code-indexer, utils, index) — pokrycie testami wzrosło do >80% dla wszystkich modułów code-indexer.
- Dodano 171 testów jednostkowych dla session-broker, local-store, memory-service, tool-router i ipc type guards — pokrycie testami wzrosło do >80% dla wszystkich wymienionych modułów.
- Dodano testy error paths dla AgentRuntime (createSession, startWorker, runWorker, stopWorker, resumeWorker, stopSession, startSubagent, updateSessionModel, updateSessionAllowedTools, waitForWorker).
- Dodano testy dla LocalStore (appendEvent, appendPatch, upsertMemory, upsertChunk, deleteChunksForFile, getStats, getStoredIndexInfo, isStale, deleteAllChunks, redactedEventMessage).
- Dodano testy dla MemoryService (read, list, proposeEdit, applyEdit, write, describeEntry, generateDiff, riskLevel).
- Dodano testy dla ToolRouter z memory service integration i event logging.
- Dodano exhaustive testy dla IPC type guards (permission, identity, editor, file operation, tool, patch, conflict, agent runtime).
- Naprawiono mock node-sqlite — normalizacja undefined do null w readAll.
- Dodano pakiet `@agentdeck/memory-service` — zarządzanie pamięcią agenta z listowaniem, odczytem, propozycjami edycji, rozwiązywaniem konfliktów i redakcją.
- Dodano pakiet `@agentdeck/code-indexer` — indeksowanie kodu z chunkingiem, wykrywaniem języka, budowaniem indeksem i retrievalem.
- Dodano IPC handlery Phase 9 (listMemories, readMemory, proposeMemoryChange, applyMemoryChange, memoryConflictResolve, indexCodeFile, retrieveCode, rebuildCodeIndex).
- Dodano `MemoryReviewDialog` do przeglądania i zarządzania plikami pamięci.
- Dodano 17 testów jednostkowych dla memory-service, code-indexer, redaction, local-store i MemoryReviewDialog.
### Fixed

- Zaktualizowano dompurify z 3.4.8 do 3.4.11 poprzez npm overrides — naprawiono podatność GHSA-vxr8-fq34-vvx9 (Trusted Types policy survives clearConfig).

### Changed

- Zaktualizowano electron z 42.3.3 do 42.4.0 ÔÇö poprawki bezpiecze┼ästwa (CVE-2026-9115, CVE-2026-9116), naprawa crashu przy webContents.reload(), poprawki win.center() dla frameless windows, aktualizacja Chromium do 148.0.7778.254 i Node.js do v24.16.0.
- Zaktualizowano typescript-eslint z 8.61.0 do 8.61.1 — version bump bez zmian kodu.

## [0.2.0] - 2026-06-11

### Added

- Dodano narz─Ödzie agenta create_file do tworzenia nowych plik├│w tekstowych bez nadpisywania istniej─ůcych ┼Ťcie┼╝ek.
- Dodano backendowy @agentdeck/agent-runtime z Session Brokerem, worker lifecycle, stopSession, retry/cancellation, crash/resume, subagent tasks, scoped permissions i immutable snapshots.

### Changed

- Otwarcie cyklu rozwojowego 0.2.0.
- Zaktualizowano typescript-eslint z 8.60.0 do 8.61.0 ÔÇö version bump bez zmian kodu.
- Zaktualizowano @monaco-editor/loader z 1.5.0 do 1.7.0 ÔÇö backward compatibility dla monaco-editor 0.53/0.54, update do 0.55.1.
- Zaktualizowano react i react-dom z 19.2.6 do 19.2.7 ÔÇö poprawka dla Server Actions (FormData entries w Server Components). react 19.2.7 wymagany przez peer dep react-dom 19.2.7.

### Fixed

- Usuni─Öto xecFile z defaultOpenUrl ÔÇö zast─ůpiono przez wymagany openUrl callback z Electron shell.openExternal, eliminuj─ůc CodeQL alert js/command-line-injection (CWE-78).
- Naprawiono 12 ESLint errors: usuni─Öto unused imports (isDiffInput, isWorkspaceEditInput, DiffResult, WorkspaceEditResult) z preload, unused filePath parameter z editorShowDiff, unused sampleDiagnostics z integration tests, dodano eslint-disable dla deprecated monaco.languages API. Wszystkie quality gates przechodz─ů (lint, typecheck, 439/439 testy).
- Zaktualizowano dompurify z 3.2.7 do 3.4.8 poprzez npm overrides ÔÇö naprawiono podatno┼Ťci XSS (CWE-79), URI validation bypass (CWE-183), Prototype Pollution (CWE-1321) w monaco-editor.

## [0.1.0] - 2026-06-02

### Added

- Editor Service z Monaco: karty, dirty state, zapis plik├│w, wykrywanie j─Özyk├│w (TS/JS/JSON/YAML/Markdown/PowerShell)
- IPC handlery read/write/diagnostics
- EditorTabs, EditorSurface, MonacoEditorSurface, useEditorStore hook
- 190 test├│w jednostkowych dla Editor Service

### Changed

- MonacoEditorSurface: dodano eslint-disable dla deprecated monaco.languages API (Monaco 0.55 wymaga any type casting)
- editorShowDiff: usuni─Öto unused filePath parameter
- preload/index.ts: usuni─Öto unused imports (isDiffInput, isWorkspaceEditInput, DiffResult, WorkspaceEditResult)

## [0.0.1] - 2026-05-31

### Added

- Szkielet Electron/React/TypeScript z contextIsolation, nodeIntegration disabled
- Preload IPC z type guards i wersjonowanymi kana┼éami
- Settings Service z theme persistence i bezpiecznymi fallbackami
- Workbench shell z ciemnym motywem, activity bar, sidebar, editor area, panel, status bar
- Workspace Service z parserem .code-workspace
- Dependency-cruiser dla architektonicznych test├│w
- docs/domain.md z kontraktem domenowym
- ADR-001..ADR-008

