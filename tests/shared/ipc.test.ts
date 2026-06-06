import { describe, it, expect } from 'vitest';
import {
  isThemeSettings,
  isWorkspaceOpenRequest,
  isWorkspaceSelection,
  isStartupState,
  isWorkspaceModel,
  isDirectoryListing,
  isFsChangeEvent,
  isFileWriteResult,
  isFileReadResult,
  isWorkspaceEditInput,
  isWorkspaceEditResult,
  isDiffInput,
  isDiffResult
} from '@agentdeck/shared';

describe('packages/shared ipc type guards', () => {
  it('validates theme settings', () => {
    expect(isThemeSettings({ theme: 'dark' })).toBe(true);
    expect(isThemeSettings({ theme: 'light' })).toBe(true);
    expect(isThemeSettings({})).toBe(false);
    expect(isThemeSettings({ theme: 'unknown' })).toBe(false);
  });

  it('validates workspace open request', () => {
    expect(isWorkspaceOpenRequest({ kind: 'folder' })).toBe(true);
    expect(isWorkspaceOpenRequest({ kind: 'workspace-file' })).toBe(true);
    expect(isWorkspaceOpenRequest({})).toBe(false);
    expect(isWorkspaceOpenRequest({ kind: 'file' })).toBe(false);
  });

  it('validates workspace selection', () => {
    expect(isWorkspaceSelection({ status: 'cancelled' })).toBe(true);

    expect(
      isWorkspaceSelection({
        status: 'selected',
        kind: 'folder',
        path: '/some/path',
        name: 'proj'
      })
    ).toBe(true);

    // invalid: missing name
    expect(isWorkspaceSelection({ status: 'selected', kind: 'folder', path: '/x' })).toBe(false);
  });

  it('validates startup state (ready and error)', () => {
    const ready = {
      status: 'ready',
      appVersion: '0.1.0',
      services: [
        { id: 'workspace-service', label: 'Workspace', status: 'ready' }
      ]
    };
    expect(isStartupState(ready)).toBe(true);

    const err = {
      status: 'error',
      appVersion: '0.1.0',
      code: 'DESKTOP_SERVICES_UNAVAILABLE',
      message: 'Unavailable'
    };
    expect(isStartupState(err)).toBe(true);

    // invalid: missing appVersion
    expect(isStartupState({ status: 'ready', services: [] })).toBe(false);
  });

  it('validates workspace model', () => {
    const okModel = {
      status: 'ok',
      filePath: '/wspace.code-workspace',
      kind: 'workspace-file',
      folders: [{ path: '/a', name: 'A' }]
    };
    expect(isWorkspaceModel(okModel)).toBe(true);

    const errModel = {
      status: 'error',
      code: 'INVALID_JSONC',
      message: 'bad'
    };
    expect(isWorkspaceModel(errModel)).toBe(true);

    // invalid: folders not an array
    expect(isWorkspaceModel({ status: 'ok', filePath: '/x', kind: 'folder', folders: {} as unknown })).toBe(false);
  });

  it('validates directory listing and file entries', () => {
    const listing = {
      path: '/root',
      entries: [
        { name: 'a.txt', path: '/root/a.txt', kind: 'file', isSensitive: false }
      ]
    };
    expect(isDirectoryListing(listing)).toBe(true);

    // invalid entry
    expect(isDirectoryListing({ path: '/root', entries: [{ name: 'x' }] })).toBe(false);
  });

  it('validates fs change events', () => {
    expect(isFsChangeEvent({ kind: 'add', path: '/a' })).toBe(true);
    expect(isFsChangeEvent({ kind: 'change', path: '/a' })).toBe(true);
    expect(isFsChangeEvent({ kind: 'unlink', path: '/a' })).toBe(true);
    expect(isFsChangeEvent({ kind: 'addDir', path: '/a' })).toBe(true);
    expect(isFsChangeEvent({ kind: 'unknown', path: '/a' })).toBe(false);
  });

  it('validates file write result — ok', () => {
    expect(isFileWriteResult({ status: 'ok' })).toBe(true);
  });

  it('validates file write result — WRITE_CONFLICT error', () => {
    expect(isFileWriteResult({
      status: 'error',
      code: 'WRITE_CONFLICT',
      message: 'File /src/app.ts has been modified on disk since it was opened.'
    })).toBe(true);
  });

  it('validates file write result — ACCESS_DENIED error', () => {
    expect(isFileWriteResult({
      status: 'error',
      code: 'ACCESS_DENIED',
      message: 'Access denied: /src/app.ts'
    })).toBe(true);
  });

  it('validates file write result — UNKNOWN error', () => {
    expect(isFileWriteResult({
      status: 'error',
      code: 'UNKNOWN',
      message: 'Something went wrong'
    })).toBe(true);
  });

  it('rejects file write result with invalid code', () => {
    expect(isFileWriteResult({
      status: 'error',
      code: 'INVALID_CODE',
      message: 'nope'
    })).toBe(false);
  });

  it('rejects file write result with missing message', () => {
    expect(isFileWriteResult({
      status: 'error',
      code: 'WRITE_CONFLICT'
    })).toBe(false);
  });

  it('rejects file write result with non-object', () => {
    expect(isFileWriteResult(null)).toBe(false);
    expect(isFileWriteResult('error')).toBe(false);
    expect(isFileWriteResult(42)).toBe(false);
  });

  it('validates file read result — ok', () => {
    expect(isFileReadResult({
      status: 'ok',
      content: 'const x = 1;',
      encoding: 'utf8'
    })).toBe(true);
  });

  it('validates file read result — error variants', () => {
    expect(isFileReadResult({
      status: 'error',
      code: 'FILE_NOT_FOUND',
      message: 'File not found: /missing.ts'
    })).toBe(true);
    expect(isFileReadResult({
      status: 'error',
      code: 'ACCESS_DENIED',
      message: 'Access denied: /secret.key'
    })).toBe(true);
    expect(isFileReadResult({
      status: 'error',
      code: 'ENCODING_ERROR',
      message: 'Cannot decode binary file'
    })).toBe(true);
    expect(isFileReadResult({
      status: 'error',
      code: 'UNKNOWN',
      message: 'Unexpected'
    })).toBe(true);
  });

  it('rejects file read result with invalid code', () => {
    expect(isFileReadResult({
      status: 'error',
      code: 'WRITE_CONFLICT',
      message: 'wrong code for read'
    })).toBe(false);
  });

  // WorkspaceEdit guards
  it('validates workspace edit input with operations', () => {
    expect(isWorkspaceEditInput({
      operations: [{ filePath: '/test.ts', text: 'new text' }]
    })).toBe(true);
  });

  it('validates workspace edit input with range', () => {
    expect(isWorkspaceEditInput({
      operations: [{
        filePath: '/test.ts',
        range: { startLine: 1, startCol: 1, endLine: 5, endCol: 1 },
        text: 'replacement'
      }]
    })).toBe(true);
  });

  it('rejects workspace edit input with missing operations', () => {
    expect(isWorkspaceEditInput({})).toBe(false);
  });

  it('rejects workspace edit input with invalid operation', () => {
    expect(isWorkspaceEditInput({
      operations: [{ filePath: 123, text: 'new text' }]
    })).toBe(false);
  });

  it('validates workspace edit result — ok', () => {
    expect(isWorkspaceEditResult({ status: 'ok' })).toBe(true);
  });

  it('validates workspace edit result — error variants', () => {
    expect(isWorkspaceEditResult({
      status: 'error',
      code: 'FILE_NOT_FOUND',
      message: 'File not found'
    })).toBe(true);
    expect(isWorkspaceEditResult({
      status: 'error',
      code: 'ACCESS_DENIED',
      message: 'Access denied'
    })).toBe(true);
    expect(isWorkspaceEditResult({
      status: 'error',
      code: 'WRITE_CONFLICT',
      message: 'Conflict'
    })).toBe(true);
    expect(isWorkspaceEditResult({
      status: 'error',
      code: 'UNKNOWN',
      message: 'Unknown error'
    })).toBe(true);
  });

  // Diff guards
  it('validates diff input', () => {
    expect(isDiffInput({
      original: 'original content',
      modified: 'modified content'
    })).toBe(true);
  });

  it('validates diff input with optional filePath', () => {
    expect(isDiffInput({
      original: 'original',
      modified: 'modified',
      filePath: '/test.ts'
    })).toBe(true);
  });

  it('rejects diff input with missing original', () => {
    expect(isDiffInput({ modified: 'modified' })).toBe(false);
  });

  it('rejects diff input with missing modified', () => {
    expect(isDiffInput({ original: 'original' })).toBe(false);
  });

  it('validates diff result — ok', () => {
    expect(isDiffResult({ status: 'ok', diff: '--- a\n+++ b\n' })).toBe(true);
  });

  it('validates diff result — error', () => {
    expect(isDiffResult({
      status: 'error',
      code: 'UNKNOWN',
      message: 'Diff failed'
    })).toBe(true);
  });

  it('rejects diff result with invalid code', () => {
    expect(isDiffResult({
      status: 'error',
      code: 'FILE_NOT_FOUND',
      message: 'wrong code'
    })).toBe(false);
  });
});
