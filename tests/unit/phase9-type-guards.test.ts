import { describe, it, expect } from 'vitest';
import {
  isMemoryScope,
  isMemoryEntry,
  isRetrievalQuery,
  isIndexChunk,
  isCodeIndexStats
} from '@agentdeck/shared';

describe('Phase 9 type guards', () => {
  describe('isMemoryScope', () => {
    it('should accept valid scopes', () => {
      expect(isMemoryScope('user')).toBe(true);
      expect(isMemoryScope('workspace')).toBe(true);
      expect(isMemoryScope('repo')).toBe(true);
    });

    it('should reject invalid scopes', () => {
      expect(isMemoryScope('invalid')).toBe(false);
      expect(isMemoryScope(123)).toBe(false);
      expect(isMemoryScope(null)).toBe(false);
    });
  });

  describe('isMemoryEntry', () => {
    it('should accept valid memory entry', () => {
      expect(isMemoryEntry({
        id: 'test-1',
        scope: 'user',
        filePath: '/tmp/test.md',
        title: 'Test',
        checksum: 'abc123',
        sourceKind: 'markdown',
        createdSource: 'user',
        createdAt: 1000,
        updatedAt: 1000
      })).toBe(true);
    });

    it('should reject invalid memory entry', () => {
      expect(isMemoryEntry(null)).toBe(false);
      expect(isMemoryEntry({})).toBe(false);
      expect(isMemoryEntry({
        id: 'test',
        scope: 'invalid',
        filePath: '/tmp/test.md',
        title: 'Test',
        checksum: 'abc',
        sourceKind: 'markdown',
        createdSource: 'user',
        createdAt: 1000,
        updatedAt: 1000
      })).toBe(false);
    });
  });

  describe('isRetrievalQuery', () => {
    it('should accept valid query', () => {
      expect(isRetrievalQuery({ text: 'search' })).toBe(true);
    });

    it('should accept query with optional fields', () => {
      expect(isRetrievalQuery({
        text: 'search',
        scopes: ['user', 'workspace'],
        languages: ['typescript'],
        folders: ['src'],
        since: 1000,
        maxResults: 10,
        includeMemory: true,
        includeCode: true
      })).toBe(true);
    });

    it('should reject invalid query', () => {
      expect(isRetrievalQuery(null)).toBe(false);
      expect(isRetrievalQuery({})).toBe(false);
      expect(isRetrievalQuery({ text: 123 })).toBe(false);
    });
  });

  describe('isIndexChunk', () => {
    it('should accept valid chunk', () => {
      expect(isIndexChunk({
        id: 'chunk-1',
        filePath: '/tmp/file.ts',
        language: 'typescript',
        startLine: 1,
        endLine: 10,
        startCol: 0,
        endCol: 20,
        text: 'const x = 1;',
        checksum: 'abc',
        createdAt: 1000
      })).toBe(true);
    });

    it('should reject invalid chunk', () => {
      expect(isIndexChunk(null)).toBe(false);
      expect(isIndexChunk({})).toBe(false);
    });
  });

  describe('isCodeIndexStats', () => {
    it('should accept valid stats', () => {
      expect(isCodeIndexStats({
        chunks: 10,
        files: 5,
        languages: { typescript: 8, javascript: 2 },
        indexVersion: 'phase9-v1'
      })).toBe(true);
    });

    it('should reject invalid stats', () => {
      expect(isCodeIndexStats(null)).toBe(false);
      expect(isCodeIndexStats({})).toBe(false);
    });
  });
});
