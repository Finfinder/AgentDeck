import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCodeIndexer } from '@agentdeck/code-indexer';

function tempDir(): string {
  const dir = join(tmpdir(), `agentdeck-err-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('CodeIndexer error handling', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = tempDir();
  });

  afterEach(() => {
    try { if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('indexFile error paths', () => {
    it('should handle file read errors gracefully', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: [workDir],
        indexVersion: 'v1',
      });
      // Non-existent file should throw
      await expect(indexer.indexFile(join(workDir, 'nonexistent.ts'))).rejects.toThrow();
    });

    it('should handle tree-sitter parse errors with fallback', async () => {
      const filePath = join(workDir, 'test.ts');
      // Write content that might cause tree-sitter issues
      writeFileSync(filePath, 'const x = ;'); // Invalid syntax

      const indexer = createCodeIndexer({
        workspaceRoots: [workDir],
        indexVersion: 'v1',
      });
      // Should fallback to line-based chunking
      const result = await indexer.indexFile(filePath);
      expect(result.chunks).toBeDefined();
    });
  });

  describe('rebuildIndex error paths', () => {
    it('should handle rebuild with non-existent roots', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'v1',
      });
      const result = await indexer.rebuildIndex(['/non/existent/path']);
      expect(result.chunks).toBeDefined();
      expect(result.stats).toBeDefined();
    });

    it('should handle rebuild with empty roots', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'v1',
      });
      const result = await indexer.rebuildIndex([]);
      expect(result.chunks).toBeDefined();
      expect(result.stats.chunks).toBe(0);
    });
  });

  describe('retrieve edge cases', () => {
    it('should handle retrieve with no results', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'v1',
      });
      const results = await indexer.retrieve({ text: 'nonexistent' });
      expect(results).toEqual([]);
    });

    it('should handle retrieve with maxResults 0', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'v1',
      });
      const results = await indexer.retrieve({ text: 'test', maxResults: 0 });
      expect(results).toBeDefined();
    });

    it('should handle retrieve with very large maxResults', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'v1',
      });
      const results = await indexer.retrieve({ text: 'test', maxResults: 10000 });
      expect(results).toBeDefined();
    });
  });

  describe('indexWorkspaceFolders edge cases', () => {
    it('should handle non-existent directory', async () => {
      const indexer = createCodeIndexer({
        workspaceRoots: ['/tmp'],
        indexVersion: 'v1',
      });
      const chunks = await indexer.indexWorkspaceFolders(['/non/existent/dir']);
      expect(chunks).toEqual([]);
    });

    it('should handle directory with only binary files', async () => {
      writeFileSync(join(workDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47]));
      writeFileSync(join(workDir, 'data.bin'), Buffer.from([0x00, 0x01, 0x02]));

      const indexer = createCodeIndexer({
        workspaceRoots: [workDir],
        indexVersion: 'v1',
      });
      const chunks = await indexer.indexWorkspaceFolders([workDir]);
      expect(chunks).toBeDefined();
    });
  });
});
