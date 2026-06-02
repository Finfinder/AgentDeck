import { describe, expect, it } from 'vitest';

import {
  isEditorLanguage,
  isEditorTab,
  isFileReadResult,
  isFileWriteResult
} from '@agentdeck/shared';

describe('editor IPC guards', () => {
  describe('isEditorLanguage', () => {
    it('accepts valid languages', () => {
      expect(isEditorLanguage('typescript')).toBe(true);
      expect(isEditorLanguage('javascript')).toBe(true);
      expect(isEditorLanguage('json')).toBe(true);
      expect(isEditorLanguage('yaml')).toBe(true);
      expect(isEditorLanguage('markdown')).toBe(true);
      expect(isEditorLanguage('powershell')).toBe(true);
      expect(isEditorLanguage('plaintext')).toBe(true);
    });

    it('rejects invalid languages', () => {
      expect(isEditorLanguage('python')).toBe(false);
      expect(isEditorLanguage('')).toBe(false);
      expect(isEditorLanguage(42)).toBe(false);
      expect(isEditorLanguage(null)).toBe(false);
      expect(isEditorLanguage(undefined)).toBe(false);
    });
  });

  describe('isEditorTab', () => {
    it('accepts valid editor tab', () => {
      expect(isEditorTab({
        id: 'abc123',
        filePath: '/src/app.ts',
        fileName: 'app.ts',
        language: 'typescript',
        isDirty: false,
        isPinned: false
      })).toBe(true);
    });

    it('rejects when id is missing', () => {
      expect(isEditorTab({
        filePath: '/src/app.ts',
        fileName: 'app.ts',
        language: 'typescript',
        isDirty: false,
        isPinned: false
      })).toBe(false);
    });

    it('rejects when language is invalid', () => {
      expect(isEditorTab({
        id: 'abc123',
        filePath: '/src/app.ts',
        fileName: 'app.ts',
        language: 'cobol',
        isDirty: false,
        isPinned: false
      })).toBe(false);
    });

    it('rejects when isDirty is not boolean', () => {
      expect(isEditorTab({
        id: 'abc123',
        filePath: '/src/app.ts',
        fileName: 'app.ts',
        language: 'typescript',
        isDirty: 'yes',
        isPinned: false
      })).toBe(false);
    });

    it('rejects null', () => {
      expect(isEditorTab(null)).toBe(false);
    });
  });

  describe('isFileReadResult', () => {
    it('accepts ok result', () => {
      expect(isFileReadResult({
        status: 'ok',
        content: 'hello',
        encoding: 'utf8'
      })).toBe(true);
    });

    it('accepts error result with FILE_NOT_FOUND', () => {
      expect(isFileReadResult({
        status: 'error',
        code: 'FILE_NOT_FOUND',
        message: 'not found'
      })).toBe(true);
    });

    it('accepts error result with ACCESS_DENIED', () => {
      expect(isFileReadResult({
        status: 'error',
        code: 'ACCESS_DENIED',
        message: 'denied'
      })).toBe(true);
    });

    it('accepts error result with ENCODING_ERROR', () => {
      expect(isFileReadResult({
        status: 'error',
        code: 'ENCODING_ERROR',
        message: 'encoding'
      })).toBe(true);
    });

    it('accepts error result with UNKNOWN', () => {
      expect(isFileReadResult({
        status: 'error',
        code: 'UNKNOWN',
        message: 'unknown'
      })).toBe(true);
    });

    it('rejects invalid error code', () => {
      expect(isFileReadResult({
        status: 'error',
        code: 'INVALID_CODE',
        message: 'test'
      })).toBe(false);
    });

    it('rejects when content is missing in ok result', () => {
      expect(isFileReadResult({
        status: 'ok',
        encoding: 'utf8'
      })).toBe(false);
    });

    it('rejects null', () => {
      expect(isFileReadResult(null)).toBe(false);
    });
  });

  describe('isFileWriteResult', () => {
    it('accepts ok result', () => {
      expect(isFileWriteResult({ status: 'ok' })).toBe(true);
    });

    it('accepts error result with WRITE_CONFLICT', () => {
      expect(isFileWriteResult({
        status: 'error',
        code: 'WRITE_CONFLICT',
        message: 'conflict'
      })).toBe(true);
    });

    it('accepts error result with ACCESS_DENIED', () => {
      expect(isFileWriteResult({
        status: 'error',
        code: 'ACCESS_DENIED',
        message: 'denied'
      })).toBe(true);
    });

    it('accepts error result with UNKNOWN', () => {
      expect(isFileWriteResult({
        status: 'error',
        code: 'UNKNOWN',
        message: 'unknown'
      })).toBe(true);
    });

    it('rejects invalid error code', () => {
      expect(isFileWriteResult({
        status: 'error',
        code: 'INVALID',
        message: 'test'
      })).toBe(false);
    });

    it('rejects null', () => {
      expect(isFileWriteResult(null)).toBe(false);
    });
  });
});
