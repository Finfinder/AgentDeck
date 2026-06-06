import { describe, expect, it } from 'vitest';

import {
  isStartupState,
  isWorkspaceSelection,
  isWorkspaceEditInput,
  isWorkspaceEditResult,
  isDiffInput,
  isDiffResult
} from '@agentdeck/shared';

describe('ipc guards extra cases', () => {
  it('accepts error startup state with INVALID_STARTUP_STATE', () => {
    const state = { status: 'error', appVersion: '1.0.0', code: 'INVALID_STARTUP_STATE', message: 'Invalid' };
    expect(isStartupState(state)).toBe(true);
  });

  it('rejects startup state when services invalid', () => {
    const state = { status: 'ready', appVersion: '1.0.0', services: [{ id: 'unknown', label: 'x', status: 'ready' }] };
    expect(isStartupState(state)).toBe(false);
  });

  it('workspace selection rejects missing name or path', () => {
    expect(isWorkspaceSelection({ status: 'selected', kind: 'workspace-file', path: '/x' })).toBe(false);
    expect(isWorkspaceSelection({ status: 'selected', kind: 'workspace-file', name: 'A' })).toBe(false);
  });

  describe('isWorkspaceEditInput', () => {
    it('accepts valid workspace edit input with range', () => {
      const input = {
        operations: [{
          filePath: '/test.ts',
          range: { startLine: 1, startCol: 1, endLine: 5, endCol: 1 },
          text: 'new content'
        }]
      };
      expect(isWorkspaceEditInput(input)).toBe(true);
    });

    it('accepts valid workspace edit input without range', () => {
      const input = {
        operations: [{ filePath: '/test.ts', text: 'full replacement' }]
      };
      expect(isWorkspaceEditInput(input)).toBe(true);
    });

    it('rejects when operations is not array', () => {
      expect(isWorkspaceEditInput({ operations: 'not-array' })).toBe(false);
    });

    it('rejects when filePath is missing', () => {
      const input = {
        operations: [{ text: 'content' }]
      };
      expect(isWorkspaceEditInput(input)).toBe(false);
    });

    it('rejects null', () => {
      expect(isWorkspaceEditInput(null)).toBe(false);
    });
  });

  describe('isWorkspaceEditResult', () => {
    it('accepts ok result', () => {
      expect(isWorkspaceEditResult({ status: 'ok' })).toBe(true);
    });

    it('accepts error result with FILE_NOT_FOUND', () => {
      expect(isWorkspaceEditResult({ status: 'error', code: 'FILE_NOT_FOUND', message: 'not found' })).toBe(true);
    });

    it('accepts error result with ACCESS_DENIED', () => {
      expect(isWorkspaceEditResult({ status: 'error', code: 'ACCESS_DENIED', message: 'denied' })).toBe(true);
    });

    it('accepts error result with WRITE_CONFLICT', () => {
      expect(isWorkspaceEditResult({ status: 'error', code: 'WRITE_CONFLICT', message: 'conflict' })).toBe(true);
    });

    it('accepts error result with UNKNOWN', () => {
      expect(isWorkspaceEditResult({ status: 'error', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    });

    it('rejects invalid error code', () => {
      expect(isWorkspaceEditResult({ status: 'error', code: 'INVALID', message: 'test' })).toBe(false);
    });

    it('rejects null', () => {
      expect(isWorkspaceEditResult(null)).toBe(false);
    });
  });

  describe('isDiffInput', () => {
    it('accepts valid diff input', () => {
      expect(isDiffInput({ original: 'original', modified: 'modified' })).toBe(true);
    });

    it('accepts diff input with filePath', () => {
      expect(isDiffInput({ original: 'original', modified: 'modified', filePath: '/test.ts' })).toBe(true);
    });

    it('rejects when original is missing', () => {
      expect(isDiffInput({ modified: 'modified' })).toBe(false);
    });

    it('rejects when modified is missing', () => {
      expect(isDiffInput({ original: 'original' })).toBe(false);
    });

    it('rejects null', () => {
      expect(isDiffInput(null)).toBe(false);
    });
  });

  describe('isDiffResult', () => {
    it('accepts ok result with diff string', () => {
      expect(isDiffResult({ status: 'ok', diff: '--- a\\n+++ b\\n' })).toBe(true);
    });

    it('accepts error result with UNKNOWN', () => {
      expect(isDiffResult({ status: 'error', code: 'UNKNOWN', message: 'diff failed' })).toBe(true);
    });

    it('rejects ok result without diff', () => {
      expect(isDiffResult({ status: 'ok' })).toBe(false);
    });

    it('rejects error result with wrong code', () => {
      expect(isDiffResult({ status: 'error', code: 'FILE_NOT_FOUND', message: 'test' })).toBe(false);
    });

    it('rejects null', () => {
      expect(isDiffResult(null)).toBe(false);
    });
  });
});
