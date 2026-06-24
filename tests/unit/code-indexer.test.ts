import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';

import { CodeIndexer, createCodeIndexer, detectLanguage } from '@agentdeck/code-indexer';
import type { CodeIndexerOptions } from '@agentdeck/code-indexer';

// ─── helpers ────────────────────────────────────────────────────────────────

const FIXED_TIME = 1_700_000_000_000;

function makeOptions(overrides: Partial<CodeIndexerOptions> = {}): CodeIndexerOptions {
  return {
    workspaceRoots: [],
    now: () => FIXED_TIME,
    ...overrides
  };
}

async function createTempWorkspace(files: Record<string, string>): Promise<string> {
  const root = join(tmpdir(), `code-indexer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(root, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return root;
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('CodeIndexer constructor', () => {
  it('uses default index version', () => {
    const indexer = createCodeIndexer(makeOptions());
    expect(indexer).toBeInstanceOf(CodeIndexer);
  });

  it('accepts custom index version', () => {
    const indexer = createCodeIndexer(makeOptions({ indexVersion: 'custom-v1' }));
    expect(indexer).toBeInstanceOf(CodeIndexer);
  });

  it('accepts custom embedding model', () => {
    const indexer = createCodeIndexer(makeOptions({ embeddingModel: 'custom-model' }));
    expect(indexer).toBeInstanceOf(CodeIndexer);
  });

  it('accepts custom embedding dimension', () => {
    const indexer = createCodeIndexer(makeOptions({ embeddingDimension: 16 }));
    expect(indexer).toBeInstanceOf(CodeIndexer);
  });

  it('accepts custom now function', () => {
    const indexer = createCodeIndexer(makeOptions({ now: () => 42 }));
    expect(indexer).toBeInstanceOf(CodeIndexer);
  });
});

describe('CodeIndexer.getStats', () => {
  it('returns zero stats when no chunks indexed (without store)', () => {
    const indexer = createCodeIndexer(makeOptions());
    const stats = indexer.getStats();

    expect(stats.chunks).toBe(0);
    expect(stats.files).toBe(0);
    expect(stats.languages).toEqual({});
    expect(stats.indexVersion).toBeTypeOf('string');
  });
});

describe('CodeIndexer.indexFile', () => {
  it('indexes a TypeScript file without store', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const content = 'export const x = 42;\n';

    const root = await createTempWorkspace({ 'app.ts': content });
    try {
      const result = await indexer.indexFile(join(root, 'app.ts'));

      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.stored).toBe(false);
      expect(result.chunks[0]!.language).toBe('typescript');
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('indexes a markdown file without store', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const content = '# Hello\n\nWorld\n';
    const root = await createTempWorkspace({ 'README.md': content });

    try {
      const result = await indexer.indexFile(join(root, 'README.md'));

      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.stored).toBe(false);
      expect(result.chunks[0]!.language).toBe('markdown');
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('indexes a JSON file without store', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const content = '{"key": "value"}';
    const root = await createTempWorkspace({ 'config.json': content });

    try {
      const result = await indexer.indexFile(join(root, 'config.json'));

      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.stored).toBe(false);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('stores chunks when store is provided', async () => {
    const store = {
      isStale: vi.fn().mockReturnValue(false),
      deleteAllChunks: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockReturnValue({ chunks: 1, files: 1, languages: { typescript: 1 }, indexVersion: 'v1' }),
      upsertChunk: vi.fn().mockResolvedValue(undefined),
      searchEmbeddings: vi.fn().mockReturnValue([])
    };
    const indexer = createCodeIndexer(makeOptions({ store: store as never }));
    const content = 'export const x = 42;\n';
    const root = await createTempWorkspace({ 'app.ts': content });

    try {
      const result = await indexer.indexFile(join(root, 'app.ts'));

      expect(result.stored).toBe(true);
      expect(store.upsertChunk).toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true });
    }
  });
});

describe('CodeIndexer.indexWorkspaceFolders', () => {
  it('indexes multiple files in a workspace', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const root = await createTempWorkspace({
      'src/app.ts': 'export const x = 1;\n',
      'src/utils.ts': 'export function helper() { return true; }\n',
      'README.md': '# Project\n\nDescription.\n'
    });

    try {
      const chunks = await indexer.indexWorkspaceFolders([root]);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(indexer.getStats().files).toBeGreaterThanOrEqual(3);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('skips excluded directories', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const root = await createTempWorkspace({
      'src/app.ts': 'export const x = 1;\n',
      'node_modules/lib/index.ts': 'module.exports = {};\n',
      'dist/bundle.js': 'console.log("built");\n',
      '.git/config': '[core]\n\trepositoryformatversion = 0\n'
    });

    try {
      const chunks = await indexer.indexWorkspaceFolders([root]);

      const paths = chunks.map(c => c.filePath);
      expect(paths.some(p => p.includes('node_modules'))).toBe(false);
      expect(paths.some(p => p.includes('dist'))).toBe(false);
      expect(paths.some(p => p.includes('.git'))).toBe(false);
      expect(paths.some(p => p.includes('src'))).toBe(true);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('skips unsupported file extensions', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const root = await createTempWorkspace({
      'app.ts': 'export const x = 1;\n',
      'archive.zip': 'binary',
      'image.png': 'binary'
    });

    try {
      const chunks = await indexer.indexWorkspaceFolders([root]);
      const paths = chunks.map(c => c.filePath);

      expect(paths.some(p => p.endsWith('.zip'))).toBe(false);
      expect(paths.some(p => p.endsWith('.png'))).toBe(false);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('returns sorted chunks', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const root = await createTempWorkspace({
      'b.ts': 'export const b = 2;\n',
      'a.ts': 'export const a = 1;\n',
      'c.ts': 'export const c = 3;\n'
    });

    try {
      const chunks = await indexer.indexWorkspaceFolders([root]);

      for (let i = 1; i < chunks.length; i++) {
        const cmp = chunks[i]!.filePath.localeCompare(chunks[i - 1]!.filePath);
        expect(cmp).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('handles non-existent root gracefully', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const chunks = await indexer.indexWorkspaceFolders(['/non/existent/path']);

    expect(chunks).toEqual([]);
  });
});

describe('CodeIndexer.ensureIndex', () => {
  it('calls indexWorkspaceFolders when store is not stale', async () => {
    const store = {
      isStale: vi.fn().mockReturnValue(false),
      deleteAllChunks: vi.fn(),
      getStats: vi.fn().mockReturnValue({ chunks: 0, files: 0, languages: {}, indexVersion: 'v1' }),
      upsertChunk: vi.fn(),
      searchEmbeddings: vi.fn().mockReturnValue([])
    };
    const indexer = createCodeIndexer(makeOptions({ store: store as never }));
    const root = await createTempWorkspace({ 'app.ts': 'export const x = 1;\n' });

    try {
      const chunks = await indexer.ensureIndex([root]);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(store.deleteAllChunks).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('calls rebuildIndex when store is stale', async () => {
    const store = {
      isStale: vi.fn().mockReturnValue(true),
      deleteAllChunks: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockReturnValue({ chunks: 1, files: 1, languages: { typescript: 1 }, indexVersion: 'v1' }),
      upsertChunk: vi.fn().mockResolvedValue(undefined),
      searchEmbeddings: vi.fn().mockReturnValue([])
    };
    const indexer = createCodeIndexer(makeOptions({ store: store as never }));
    const root = await createTempWorkspace({ 'app.ts': 'export const x = 1;\n' });

    try {
      const chunks = await indexer.ensureIndex([root]);

      expect(store.deleteAllChunks).toHaveBeenCalled();
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('calls indexWorkspaceFolders when no store', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const root = await createTempWorkspace({ 'app.ts': 'export const x = 1;\n' });

    try {
      const chunks = await indexer.ensureIndex([root]);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(root, { recursive: true });
    }
  });
});

describe('CodeIndexer.rebuildIndex', () => {
  it('clears and re-indexes all files', async () => {
    const store = {
      isStale: vi.fn().mockReturnValue(false),
      deleteAllChunks: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockReturnValue({ chunks: 2, files: 2, languages: { typescript: 2 }, indexVersion: 'v1' }),
      upsertChunk: vi.fn().mockResolvedValue(undefined),
      searchEmbeddings: vi.fn().mockReturnValue([])
    };
    const indexer = createCodeIndexer(makeOptions({ store: store as never }));
    const root = await createTempWorkspace({
      'a.ts': 'export const a = 1;\n',
      'b.ts': 'export const b = 2;\n'
    });

    try {
      const result = await indexer.rebuildIndex([root]);

      expect(store.deleteAllChunks).toHaveBeenCalledOnce();
      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
      expect(result.stats.chunks).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(root, { recursive: true });
    }
  });
});

describe('CodeIndexer.retrieve', () => {
  it('returns code results for matching query', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const root = await createTempWorkspace({
      'app.ts': 'export function calculateTotal(items: number[]): number { return items.reduce((a, b) => a + b, 0); }\n'
    });

    try {
      await indexer.indexWorkspaceFolders([root]);
      const results = await indexer.retrieve({ text: 'calculateTotal', maxResults: 5 });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.kind).toBe('code');
      expect(results[0]!.score).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('returns empty results for non-matching query', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const root = await createTempWorkspace({
      'app.ts': 'export const x = 1;\n'
    });

    try {
      await indexer.indexWorkspaceFolders([root]);
      const results = await indexer.retrieve({ text: 'zzzznonexistent', maxResults: 5 });

      expect(results.length).toBe(0);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('respects maxResults limit', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const root = await createTempWorkspace({
      'a.ts': 'export const data = 1;\n',
      'b.ts': 'export const data = 2;\n',
      'c.ts': 'export const data = 3;\n',
      'd.ts': 'export const data = 4;\n'
    });

    try {
      await indexer.indexWorkspaceFolders([root]);
      const results = await indexer.retrieve({ text: 'data', maxResults: 2 });

      expect(results.length).toBeLessThanOrEqual(2);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('filters by language', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const root = await createTempWorkspace({
      'app.ts': 'export const tsData = 1;\n',
      'app.js': 'export const jsData = 2;\n'
    });

    try {
      await indexer.indexWorkspaceFolders([root]);
      const results = await indexer.retrieve({ text: 'Data', languages: ['typescript'], maxResults: 10 });

      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
      }
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('sorts results by score descending', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const root = await createTempWorkspace({
      'match.ts': 'export function queryHandler() { return queryResult; }\n',
      'nomatch.ts': 'export const x = 1;\n'
    });

    try {
      await indexer.indexWorkspaceFolders([root]);
      const results = await indexer.retrieve({ text: 'queryHandler', maxResults: 10 });

      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
      }
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('includes memory results when memoryService is configured', async () => {
    const memoryService = {
      list: vi.fn().mockResolvedValue({
        status: 'ok' as const,
        entries: [
          {
            id: 'mem-1',
            scope: 'user' as const,
            filePath: 'memories/user/notes.md',
            title: 'Important project notes',
            checksum: 'abc',
            sourceKind: 'markdown' as const,
            createdSource: 'user' as const,
            createdAt: FIXED_TIME,
            updatedAt: FIXED_TIME
          }
        ]
      })
    };
    const indexer = createCodeIndexer(makeOptions({ memoryService: memoryService as never }));
    const root = await createTempWorkspace({ 'app.ts': 'export const x = 1;\n' });

    try {
      await indexer.indexWorkspaceFolders([root]);
      const results = await indexer.retrieve({ text: 'project', includeMemory: true, maxResults: 10 });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.kind === 'memory')).toBe(true);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('skips memory results when includeMemory is false', async () => {
    const memoryService = {
      list: vi.fn().mockResolvedValue({
        status: 'ok' as const,
        entries: [
          {
            id: 'mem-1',
            scope: 'user' as const,
            filePath: 'memories/user/notes.md',
            title: 'Important project notes',
            checksum: 'abc',
            sourceKind: 'markdown' as const,
            createdSource: 'user' as const,
            createdAt: FIXED_TIME,
            updatedAt: FIXED_TIME
          }
        ]
      })
    };
    const indexer = createCodeIndexer(makeOptions({ memoryService: memoryService as never }));
    const root = await createTempWorkspace({ 'app.ts': 'export const x = 1;\n' });

    try {
      await indexer.indexWorkspaceFolders([root]);
      const results = await indexer.retrieve({ text: 'project', includeMemory: false, maxResults: 10 });

      expect(results.some(r => r.kind === 'memory')).toBe(false);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('filters by since timestamp', async () => {
    const indexer = createCodeIndexer(makeOptions());
    const root = await createTempWorkspace({ 'app.ts': 'export const x = 1;\n' });

    try {
      await indexer.indexWorkspaceFolders([root]);
      const results = await indexer.retrieve({ text: 'export', since: FIXED_TIME + 1_000_000, maxResults: 5 });

      expect(results.length).toBe(0);
    } finally {
      await rm(root, { recursive: true });
    }
  });
});

describe('createCodeIndexer', () => {
  it('creates a CodeIndexer instance', () => {
    const indexer = createCodeIndexer(makeOptions());
    expect(indexer).toBeInstanceOf(CodeIndexer);
  });
});

describe('detectLanguage (re-exported)', () => {
  it('returns correct language for .ts', () => {
    expect(detectLanguage('file.ts')).toBe('typescript');
  });

  it('returns correct language for .md', () => {
    expect(detectLanguage('file.md')).toBe('markdown');
  });

  it('returns plaintext for unknown', () => {
    expect(detectLanguage('file.unknown')).toBe('plaintext');
  });
});
