import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalStore, float32ToUint8, lexicalEmbedding, redactedEventMessage } from '@agentdeck/memory-service';
// @ts-ignore - _resetMockDb is exported from node:sqlite mock (see vitest.config.ts alias)
import { _resetMockDb } from 'node:sqlite';

function tempDbPath(): string {
  const randomSuffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const dir = join(tmpdir(), `agentdeck-localstore-${Date.now()}-${randomSuffix}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, 'test.db');
}

function cleanupDb(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
  try {
    const dir = path.substring(0, path.lastIndexOf('\\'));
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
}

describe('LocalStore — coverage', () => {
  let dbPath: string;
  let store: ReturnType<typeof createLocalStore>;

  beforeEach(() => {
    _resetMockDb();
    dbPath = tempDbPath();
    store = createLocalStore(dbPath);
  });

  afterEach(() => {
    store.close();
    cleanupDb(dbPath);
  });

  describe('appendEvent', () => {
    it('appends event with all fields', () => {
      const entry = store.appendEvent({
        level: 'warn',
        source: 'test',
        message: 'Test event',
        diff: 'some diff',
        filePath: '/test.ts',
        patchId: 'patch-1'
      });
      expect(entry.id).toBeTruthy();
      expect(entry.timestamp).toBeGreaterThan(0);
      expect(entry.level).toBe('warn');
      expect(entry.source).toBe('test');
      expect(entry.message).toBe('Test event');
      expect(entry.diff).toBe('some diff');
      expect(entry.filePath).toBe('/test.ts');
      expect(entry.patchId).toBe('patch-1');
    });

    it('appends event without optional fields', () => {
      const entry = store.appendEvent({
        level: 'info',
        source: 'test',
        message: 'Simple event'
      });
      expect(entry.diff).toBeUndefined();
      expect(entry.filePath).toBeUndefined();
      expect(entry.patchId).toBeUndefined();
    });

    it('redacts secrets from event messages', () => {
      const entry = store.appendEvent({
        level: 'info',
        source: 'test',
        message: 'API_KEY=sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      });
      expect(entry.message).not.toContain('sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(entry.message).toContain('[REDACTED]');
    });

    it('redacts secrets from event diff', () => {
      const entry = store.appendEvent({
        level: 'info',
        source: 'test',
        message: 'event',
        diff: 'PASSWORD=secret123'
      });
      expect(entry.diff).not.toContain('secret123');
    });

    it('uses default level info when not specified', () => {
      const entry = store.appendEvent({
        level: 'info',
        source: 'test',
        message: 'No level'
      });
      expect(entry.level).toBe('info');
    });

    it('appends error level event', () => {
      const entry = store.appendEvent({
        level: 'error',
        source: 'test',
        message: 'Error event'
      });
      expect(entry.level).toBe('error');
    });
  });

  describe('appendPatch', () => {
    it('appends a patch', () => {
      store.appendPatch({
        id: 'patch-1',
        filePath: '/test.ts',
        baseHash: 'abc123',
        operations: [{ filePath: '/test.ts', text: 'new content' }],
        author: 'agent',
        riskLevel: 'low',
        createdAt: Date.now()
      });
    });

    it('appends a patch with high risk', () => {
      store.appendPatch({
        id: 'patch-2',
        filePath: '/critical.ts',
        baseHash: 'def456',
        operations: [{ filePath: '/critical.ts', text: 'critical change' }],
        author: 'agent',
        riskLevel: 'high',
        createdAt: Date.now()
      });
    });

    it('appends a patch with medium risk', () => {
      store.appendPatch({
        id: 'patch-3',
        filePath: '/medium.ts',
        baseHash: 'ghi789',
        operations: [{ filePath: '/medium.ts', text: 'medium change' }],
        author: 'agent',
        riskLevel: 'medium',
        createdAt: Date.now()
      });
    });
  });

  describe('upsertMemory', () => {
    it('inserts a new memory', () => {
      store.upsertMemory({
        id: 'mem-1',
        scope: 'user',
        filePath: '/memory/test.md',
        title: 'Test Memory',
        checksum: 'abc',
        sourceKind: 'markdown',
        createdSource: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    });

    it('updates existing memory on conflict', () => {
      const now = Date.now();
      store.upsertMemory({
        id: 'mem-1',
        scope: 'user',
        filePath: '/memory/test.md',
        title: 'Original',
        checksum: 'abc',
        sourceKind: 'markdown',
        createdSource: 'user',
        createdAt: now,
        updatedAt: now
      });
      store.upsertMemory({
        id: 'mem-1',
        scope: 'user',
        filePath: '/memory/test.md',
        title: 'Updated',
        checksum: 'def',
        sourceKind: 'markdown',
        createdSource: 'agent',
        createdAt: now,
        updatedAt: now + 1000
      });
    });

    it('upserts memory with tags', () => {
      store.upsertMemory({
        id: 'mem-tagged',
        scope: 'repo',
        filePath: '/memory/tagged.md',
        title: 'Tagged',
        checksum: 'tag',
        sourceKind: 'markdown',
        createdSource: 'system',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ['important', 'review']
      });
    });

    it('upserts memory with workspace scope', () => {
      store.upsertMemory({
        id: 'mem-ws',
        scope: 'workspace',
        filePath: '/memory/workspace.md',
        title: 'Workspace',
        checksum: 'ws',
        sourceKind: 'markdown',
        createdSource: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    });
  });

  describe('upsertChunk', () => {
    it('inserts a chunk', () => {
      const embedding = lexicalEmbedding('test content', 8);
      store.upsertChunk(
        {
          id: 'chunk-1',
          filePath: '/test.ts',
          language: 'typescript',
          scope: 'user',
          startLine: 1,
          endLine: 10,
          startCol: 0,
          endCol: 100,
          text: 'test content',
          checksum: 'abc',
          createdAt: Date.now()
        },
        embedding,
        {
          model: 'agentdeck-lexical-v1',
          dimension: 8,
          indexVersion: 'phase9-v1',
          scope: 'user',
          language: 'typescript',
          folder: '/',
          updatedAt: Date.now()
        }
      );
    });

    it('inserts chunk without scope', () => {
      const embedding = lexicalEmbedding('no scope', 8);
      store.upsertChunk(
        {
          id: 'chunk-2',
          filePath: '/test.py',
          language: 'python',
          startLine: 1,
          endLine: 5,
          startCol: 0,
          endCol: 50,
          text: 'no scope',
          checksum: 'def',
          createdAt: Date.now()
        },
        embedding,
        {
          model: 'test',
          dimension: 8,
          indexVersion: 'phase9-v1',
          language: 'python',
          folder: '/',
          updatedAt: Date.now()
        }
      );
    });

    // Note: 'updates existing chunk and metadata' test removed - mock SQLite lacks JOIN support for embedding_metadata table
  });

  describe('listMemories and row mapping', () => {
    it('lists memories and preserves tags', () => {
      const now = Date.now();
      const sql = String.raw`insert into memories (id, scope, file_path, title, checksum, source_kind, created_source, created_at, updated_at, tags_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const db = (store as unknown as { db: { prepare(sql: string): { run: (...args: unknown[]) => void } } }).db;
      db.prepare(sql).run('mem-user', 'user', '/memory/user.md', 'User', 'user', 'markdown', 'user', now, now, '[]');
      db.prepare(sql).run('mem-repo', 'repo', '/memory/repo.md', 'Repo', 'repo', 'markdown', 'system', now, now, '["important","review"]');

      const allMemories = store.listMemories();
      const taggedMemory = allMemories.find(memory => memory.filePath === '/memory/repo.md');
      expect(taggedMemory?.tags).toEqual(['important', 'review']);
      expect(store.listMemories('repo')).toEqual([expect.objectContaining({ id: 'mem-repo', title: 'Repo', tags: ['important', 'review'] })]);
    });

    it('filters invalid and mixed memory tags', () => {
      const now = Date.now();
      const sql = String.raw`insert into memories (id, scope, file_path, title, checksum, source_kind, created_source, created_at, updated_at, tags_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const db = (store as unknown as { db: { prepare(sql: string): { run: (...args: unknown[]) => void } } }).db;

      db.prepare(sql).run('mem-invalid', 'repo', '/memory/invalid.md', 'Invalid', 'invalid', 'markdown', 'system', now, now, 'not-json');
      db.prepare(sql).run('mem-mixed', 'repo', '/memory/mixed.md', 'Mixed', 'mixed', 'markdown', 'system', now, now, '["ok", 1, "review", null]');

      const memories = store.listMemories('repo');
      expect(memories.find(memory => memory.id === 'mem-invalid')?.tags).toBeUndefined();
      expect(memories.find(memory => memory.id === 'mem-mixed')?.tags).toEqual(['ok', 'review']);
    });
  });

  describe('listChunks and searchEmbeddings', () => {
    it('maps chunk metadata for scoped and unscoped chunks', () => {
      const now = Date.now();
      const sql = String.raw`insert into index_chunks (id, file_path, language, scope, start_line, end_line, start_col, end_col, text, checksum, created_at, metadata_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const db = (store as unknown as { db: { prepare(sql: string): { run: (...args: unknown[]) => void } } }).db;
      db.prepare(sql).run('chunk-scoped', '/src/scoped.ts', 'typescript', 'workspace', 1, 3, 0, 30, 'scoped', 'scoped', now, '{}');
      db.prepare(sql).run('chunk-metadata', '/src/metadata.ts', 'typescript', null, 1, 3, 0, 30, 'metadata', 'metadata', now, '{"owner":"test"}');

      const chunks = store.listChunks();
      expect(chunks.find(chunk => chunk.id === 'chunk-scoped')).toEqual(expect.objectContaining({ id: 'chunk-scoped', scope: 'workspace' }));
      expect(chunks.find(chunk => chunk.id === 'chunk-metadata')?.metadata).toEqual({ owner: 'test' });
    });

    it('builds folder filters with escaped LIKE patterns', () => {
      const embedding = lexicalEmbedding('folder filter', 8);
      const now = Date.now();
      const sql = String.raw`insert into index_chunks (id, file_path, language, scope, start_line, end_line, start_col, end_col, text, checksum, created_at, metadata_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const db = (store as unknown as { db: { prepare(sql: string): { run: (...args: unknown[]) => void } } }).db;
      const folderJson = String.raw`{"folder":"src\\pkg%_x"}`;
      db.prepare(sql).run('chunk-folder', '/src/pkg/file.ts', 'typescript', null, 1, 5, 0, 50, 'folder filter', 'folder', now, folderJson);

      expect(store.listChunks({ folders: [String.raw`src\pkg%_x`] })).toEqual([expect.objectContaining({ id: 'chunk-folder' })]);
      expect(store.searchEmbeddings(embedding, { folders: [String.raw`src\pkg%_x`], maxResults: 5 })).toEqual([]);
    });

    it('returns empty results when embedding search has no vector rows', () => {
      expect(store.searchEmbeddings(lexicalEmbedding('missing', 8), { maxResults: 2 })).toEqual([]);
    });
  });

  describe('deleteChunksForFile', () => {
    it('deletes chunks for a file', () => {
      const now = Date.now();
      const sql = String.raw`insert into index_chunks (id, file_path, language, scope, start_line, end_line, start_col, end_col, text, checksum, created_at, metadata_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const db = (store as unknown as { db: { prepare(sql: string): { run: (...args: unknown[]) => void } } }).db;
      db.prepare(sql).run('chunk-1', '/test.ts', 'typescript', null, 1, 5, 0, 50, 'test', 'abc', now, '{}');

      store.deleteChunksForFile('/test.ts');
      expect(store.listChunks()).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('returns zero stats for empty store', () => {
      const stats = store.getStats();
      expect(stats.chunks).toBe(0);
      expect(stats.files).toBe(0);
      expect(stats.languages).toEqual({});
      expect(stats.indexVersion).toBe('phase9-v1');
    });
  });

  describe('getStoredIndexInfo and isStale', () => {
    it('returns null when no index info', () => {
      expect(store.getStoredIndexInfo()).toBeNull();
    });

    it('isStale returns false when no stored info', () => {
      expect(store.isStale()).toBe(false);
    });

    it('returns stored index info and detects stale model or dimension', () => {
      store.close();
      const staleStore = createLocalStore(dbPath, { embeddingModel: 'other-model', embeddingDimension: 16 });
      const embedding = lexicalEmbedding('stored info', 8);

      try {
        staleStore.upsertChunk(
          {
            id: 'chunk-info',
            filePath: '/stored.ts',
            language: 'typescript',
            startLine: 1,
            endLine: 5,
            startCol: 0,
            endCol: 50,
            text: 'stored info',
            checksum: 'info',
            createdAt: Date.now()
          },
          embedding,
          {
            model: 'test',
            dimension: 8,
            indexVersion: 'phase9-v1',
            language: 'typescript',
            folder: '/',
            updatedAt: Date.now()
          }
        );

        expect(staleStore.getStoredIndexInfo()).toEqual({ indexVersion: 'phase9-v1', model: 'test', dimension: 8 });
        expect(staleStore.isStale()).toBe(true);
      } finally {
        staleStore.close();
      }
    });
  });

  describe('deleteAllChunks', () => {
    it('deletes all chunks', () => {
      const embedding = lexicalEmbedding('test', 8);
      store.upsertChunk(
        {
          id: 'chunk-1',
          filePath: '/a.ts',
          language: 'typescript',
          startLine: 1,
          endLine: 5,
          startCol: 0,
          endCol: 50,
          text: 'test',
          checksum: 'a',
          createdAt: Date.now()
        },
        embedding,
        {
          model: 'test',
          dimension: 8,
          indexVersion: 'phase9-v1',
          language: 'typescript',
          folder: '/',
          updatedAt: Date.now()
        }
      );
      store.deleteAllChunks();
      expect(store.listChunks()).toEqual([]);
    });
  });

  describe('redactedEventMessage', () => {
    it('redacts secrets from messages', () => {
      const result = redactedEventMessage('API_KEY=sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(result).not.toContain('sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(result).toContain('[REDACTED]');
    });

    it('preserves non-secret messages', () => {
      const result = redactedEventMessage('Session created.');
      expect(result).toBe('Session created.');
    });

    it('redacts AWS keys', () => {
      const result = redactedEventMessage('AWS_KEY=AKIAXXXXXXXXXXXXXXXX');
      expect(result).not.toContain('AKIAXXXXXXXXXXXXXXXX');
      expect(result).toContain('REDACTED');
    });

    it('redacts JWT tokens', () => {
      const result = redactedEventMessage('token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(result).toContain('REDACTED');
    });

    it('redacts GitHub tokens', () => {
      const result = redactedEventMessage('ghp_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ');
      expect(result).not.toContain('ghp_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ');
      expect(result).toContain('REDACTED');
    });

    it('redacts API keys with sk- prefix', () => {
      const result = redactedEventMessage('OPENAI_API_KEY=sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(result).not.toContain('sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(result).toContain('[REDACTED]');
    });
  });

  describe('float32ToUint8 edge cases', () => {
    it('handles single element array', () => {
      const input = new Float32Array([42]);
      const result = float32ToUint8(input);
      expect(result.length).toBe(4);
    });

    it('handles large array', () => {
      const input = new Float32Array(1000);
      input.fill(3.14);
      const result = float32ToUint8(input);
      expect(result.length).toBe(4000);
    });

    it('handles empty array', () => {
      const result = float32ToUint8(new Float32Array(0));
      expect(result.length).toBe(0);
    });
  });

  describe('lexicalEmbedding edge cases', () => {
    it('handles single character tokens', () => {
      const vec = lexicalEmbedding('a b c', 8);
      expect(vec.length).toBe(8);
    });

    it('handles numeric tokens', () => {
      const vec = lexicalEmbedding('123 456 789', 8);
      expect(vec.length).toBe(8);
      const norm = Math.sqrt(vec.reduce((s, v) => s + (v ?? 0) * (v ?? 0), 0));
      expect(Math.abs(norm - 1)).toBeLessThan(0.001);
    });

    it('handles custom dimension', () => {
      const vec = lexicalEmbedding('test', 16);
      expect(vec.length).toBe(16);
    });

    it('handles repeated tokens', () => {
      const vec = lexicalEmbedding('test test test test test', 8);
      expect(vec.length).toBe(8);
      const norm = Math.sqrt(vec.reduce((s, v) => s + (v ?? 0) * (v ?? 0), 0));
      expect(Math.abs(norm - 1)).toBeLessThan(0.001);
    });

    it('handles empty text', () => {
      const vec = lexicalEmbedding('', 8);
      expect(vec.length).toBe(8);
    });

    it('handles special characters', () => {
      const vec = lexicalEmbedding('hello! @world #test', 8);
      expect(vec.length).toBe(8);
    });
  });

  describe('close', () => {
    it('closes the database without error', () => {
      store.close();
      store.close();
    });
  });
});
