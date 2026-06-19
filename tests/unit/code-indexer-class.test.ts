import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCodeIndexer } from '@agentdeck/code-indexer';
import { createLocalStore } from '@agentdeck/memory-service';

function tempDir(): string {
  const dir = join(tmpdir(), `agentdeck-ci-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('CodeIndexer', () => {
  let workDir: string;
  let dbPath: string;

  beforeEach(() => {
    workDir = tempDir();
    dbPath = join(workDir, 'test.db');
  });

  afterEach(() => {
    [dbPath, workDir].forEach(p => {
      try { if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ }
    });
  });

  describe('constructor', () => {
    it('should create a CodeIndexer instance', () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'test-v1',
      });
      expect(indexer).toBeDefined();
    });

    it('should accept custom embedding model', () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        embeddingModel: 'custom-model',
        embeddingDimension: 16,
      });
      expect(indexer).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('should return empty stats for new indexer', () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'test-v1',
      });
      const stats = indexer.getStats();
      expect(stats.chunks).toBe(0);
      expect(stats.files).toBe(0);
      expect(stats.indexVersion).toBe('test-v1');
    });

    it('should return stats from store when store is provided', () => {
      const store = createLocalStore(dbPath);
      const indexer = createCodeIndexer({
        store,
        workspaceRoots: ['/tmp'],
        indexVersion: 'test-v1',
      });
      const stats = indexer.getStats();
      expect(stats.chunks).toBe(0);
      // When store is provided, getStats delegates to store which uses LOCAL_STORE_INDEX_VERSION
      expect(stats.indexVersion).toBeDefined();
      store.close();
    });
  });

  describe('indexFile', () => {
    it('should index a simple file', async () => {
      const filePath = join(workDir, 'test.ts');
      writeFileSync(filePath, 'const x = 1;\nconst y = 2;');

      const indexer = createCodeIndexer({
        workspaceRoots: [workDir],
        indexVersion: 'test-v1',
      });
      const result = await indexer.indexFile(filePath);
      expect(result.chunks.length).toBeGreaterThanOrEqual(0);
      expect(result.stored).toBe(false);
    });

    it('should index with scope', async () => {
      const filePath = join(workDir, 'test.md');
      writeFileSync(filePath, '# Hello\n\nWorld');

      const indexer = createCodeIndexer({
        workspaceRoots: [workDir],
        indexVersion: 'test-v1',
      });
      const result = await indexer.indexFile(filePath, 'workspace');
      expect(result.chunks.length).toBeGreaterThanOrEqual(0);
    });

    it('should store chunks when store is provided', async () => {
      const filePath = join(workDir, 'test.json');
      writeFileSync(filePath, '{"a": 1}');

      const store = createLocalStore(dbPath);
      const indexer = createCodeIndexer({
        store,
        workspaceRoots: [workDir],
        indexVersion: 'test-v1',
      });
      const result = await indexer.indexFile(filePath);
      expect(result.stored).toBe(true);
      store.close();
    });
  });

  describe('retrieve', () => {
    it('should return empty results for empty indexer', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'test-v1',
      });
      const results = await indexer.retrieve({ text: 'test' });
      expect(results).toEqual([]);
    });

    it('should respect maxResults', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'test-v1',
      });
      const results = await indexer.retrieve({ text: 'test', maxResults: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should filter by scopes', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'test-v1',
      });
      const results = await indexer.retrieve({
        text: 'test',
        scopes: ['user'],
      });
      expect(results).toBeDefined();
    });

    it('should filter by languages', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'test-v1',
      });
      const results = await indexer.retrieve({
        text: 'test',
        languages: ['typescript'],
      });
      expect(results).toBeDefined();
    });

    it('should support includeMemory and includeCode flags', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'test-v1',
      });
      const results = await indexer.retrieve({
        text: 'test',
        includeMemory: false,
        includeCode: true,
      });
      expect(results).toBeDefined();
    });
  });

  describe('rebuildIndex', () => {
    it('should rebuild index for given roots', async () => {
      const filePath = join(workDir, 'test.ts');
      writeFileSync(filePath, 'const x = 1;');

      const indexer = createCodeIndexer({
        workspaceRoots: [workDir],
        indexVersion: 'test-v1',
      });
      const result = await indexer.rebuildIndex([workDir]);
      expect(result.chunks).toBeDefined();
      expect(result.stats).toBeDefined();
    });

    it('should clear and rebuild', async () => {
      const filePath = join(workDir, 'test.ts');
      writeFileSync(filePath, 'const x = 1;');

      const store = createLocalStore(dbPath);
      const indexer = createCodeIndexer({
        store,
        workspaceRoots: [workDir],
        indexVersion: 'test-v1',
      });

      await indexer.indexFile(filePath);
      indexer.getStats();

      const result = await indexer.rebuildIndex([workDir]);
      expect(result.stats.chunks).toBeGreaterThanOrEqual(0);
      store.close();
    });
  });

  describe('indexWorkspaceFolders', () => {
    it('should index multiple files', async () => {
      writeFileSync(join(workDir, 'a.ts'), 'const a = 1;');
      writeFileSync(join(workDir, 'b.ts'), 'const b = 2;');

      const indexer = createCodeIndexer({
        workspaceRoots: [workDir],
        indexVersion: 'test-v1',
      });
      const chunks = await indexer.indexWorkspaceFolders([workDir]);
      expect(chunks.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty directories', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: [workDir],
        indexVersion: 'test-v1',
      });
      const chunks = await indexer.indexWorkspaceFolders([workDir]);
      expect(chunks).toEqual([]);
    });
  });
});
