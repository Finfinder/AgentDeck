import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

function tempDbPath(): string {
  const dir = join(
    tmpdir(),
    `agentdeck-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
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

// Replicate the migration SQL from local-store.ts for testing
const MIGRATION_V1_SQL = `
  create table if not exists sessions (
    id text primary key,
    started_at integer not null,
    ended_at integer,
    status text not null check (status in ('running', 'stopped', 'crashed')),
    metadata_json text,
    created_at integer not null
  );

  create table if not exists events (
    id text primary key,
    timestamp integer not null,
    level text not null check (level in ('info', 'warn', 'error')),
    source text not null,
    message text not null,
    diff text,
    file_path text,
    patch_id text references patches(id),
    created_at integer not null
  );

  create trigger if not exists events_no_update
  before update on events
  begin
    select raise(abort, 'events are append-only');
  end;

  create trigger if not exists events_no_delete
  before delete on events
  begin
    select raise(abort, 'events are append-only');
  end;

  create index if not exists idx_events_timestamp on events(timestamp);
  create index if not exists idx_events_source on events(source);
  create index if not exists idx_events_patch_id on events(patch_id);

  create table if not exists patches (
    id text primary key,
    file_path text not null,
    base_hash text not null,
    operations_json text not null,
    author text not null check (length(author) > 0),
    risk_level text not null check (risk_level in ('low', 'medium', 'high')),
    created_at integer not null,
    status text not null default 'proposed' check (status in ('proposed', 'applied', 'rejected', 'superseded'))
  );

  create index if not exists idx_patches_file_path on patches(file_path);
  create index if not exists idx_patches_status on patches(status);

  create table if not exists memories (
    id text primary key,
    scope text not null check (scope in ('user', 'workspace', 'repo')),
    file_path text not null unique,
    title text not null,
    checksum text not null,
    source_kind text not null check (source_kind = 'markdown'),
    created_source text not null check (created_source in ('user', 'agent', 'system')),
    created_at integer not null,
    updated_at integer not null,
    tags_json text
  );

  create index if not exists idx_memories_scope on memories(scope);
  create index if not exists idx_memories_title on memories(title);

  create table if not exists index_chunks (
    id text primary key,
    file_path text not null,
    language text not null,
    scope text check (scope in ('user', 'workspace', 'repo')),
    start_line integer not null,
    end_line integer not null,
    start_col integer not null,
    end_col integer not null,
    text text not null,
    checksum text not null,
    created_at integer not null,
    metadata_json text
  );

  create index if not exists idx_chunks_file_path on index_chunks(file_path);
  create index if not exists idx_chunks_language on index_chunks(language);
  create index if not exists idx_chunks_scope on index_chunks(scope);
  create index if not exists idx_chunks_created_at on index_chunks(created_at);

  create table if not exists embedding_metadata (
    chunk_id text primary key,
    model text not null,
    dimension integer not null,
    index_version text not null,
    scope text,
    language text,
    folder text,
    updated_at integer not null,
    created_at integer not null,
    foreign key (chunk_id) references index_chunks(id) on delete cascade
  );

  create index if not exists idx_embedding_metadata_model on embedding_metadata(model);
  create index if not exists idx_embedding_metadata_index_version on embedding_metadata(index_version);
`;

function applyMigrationV1(db: DatabaseSync): void {
  db.exec(
    'create table if not exists schema_migrations (version integer primary key, name text not null, applied_at integer not null, created_at integer not null)'
  );
  db.exec(MIGRATION_V1_SQL);
  db.prepare('insert or ignore into schema_migrations (version, name, applied_at, created_at) values (?, ?, ?, ?)').run(
    1,
    'initial-local-store',
    Date.now(),
    Date.now()
  );
}

function getAppliedMigrationCount(db: DatabaseSync, version: number): number {
  const row = db.prepare('select count(*) as count from schema_migrations where version = ?').get(version) as {
    count: number;
  };
  return row.count;
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("select count(*) as count from sqlite_master where type = 'table' and name = ?")
    .get(tableName) as { count: number };
  return row.count > 0;
}

function indexExists(db: DatabaseSync, indexName: string): boolean {
  const row = db
    .prepare("select count(*) as count from sqlite_master where type = 'index' and name = ?")
    .get(indexName) as { count: number };
  return row.count > 0;
}

function triggerExists(db: DatabaseSync, triggerName: string): boolean {
  const row = db
    .prepare("select count(*) as count from sqlite_master where type = 'trigger' and name = ?")
    .get(triggerName) as { count: number };
  return row.count > 0;
}

describe('LocalStore migrations', () => {
  describe('fresh database (empty → v1)', () => {
    let dbPath: string;

    beforeEach(() => {
      dbPath = tempDbPath();
    });

    afterEach(() => {
      cleanupDb(dbPath);
    });

    it('should apply migration v1 on fresh database', () => {
      const db = new DatabaseSync(dbPath);

      // Before migration, schema_migrations table does not exist yet
      expect(tableExists(db, 'schema_migrations')).toBe(false);

      applyMigrationV1(db);

      expect(tableExists(db, 'schema_migrations')).toBe(true);
      expect(getAppliedMigrationCount(db, 1)).toBe(1);
      db.close();
    });

    it('should create all required tables', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      const expectedTables = [
        'schema_migrations',
        'sessions',
        'events',
        'patches',
        'memories',
        'index_chunks',
        'embedding_metadata',
      ];

      for (const table of expectedTables) {
        expect(tableExists(db, table)).toBe(true);
      }

      db.close();
    });

    it('should create all expected indexes', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      const expectedIndexes = [
        'idx_events_timestamp',
        'idx_events_source',
        'idx_events_patch_id',
        'idx_patches_file_path',
        'idx_patches_status',
        'idx_memories_scope',
        'idx_memories_title',
        'idx_chunks_file_path',
        'idx_chunks_language',
        'idx_chunks_scope',
        'idx_chunks_created_at',
        'idx_embedding_metadata_model',
        'idx_embedding_metadata_index_version',
      ];

      for (const idx of expectedIndexes) {
        expect(indexExists(db, idx)).toBe(true);
      }

      db.close();
    });

    it('should create append-only triggers on events table', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      expect(triggerExists(db, 'events_no_update')).toBe(true);
      expect(triggerExists(db, 'events_no_delete')).toBe(true);

      db.close();
    });

    it('should allow inserting events after migration', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      db.prepare(
        'insert into events (id, timestamp, level, source, message, diff, file_path, patch_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('evt-1', Date.now(), 'info', 'test', 'hello world', null, null, null, Date.now());

      const row = db.prepare('select * from events where id = ?').get('evt-1') as {
        id: string;
        message: string;
      };
      expect(row.message).toBe('hello world');

      db.close();
    });

    it('should allow inserting memories after migration', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      const now = Date.now();
      db.prepare(
        'insert into memories (id, scope, file_path, title, checksum, source_kind, created_source, created_at, updated_at, tags_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('mem-1', 'user', '/test/file.md', 'Test Memory', 'abc123', 'markdown', 'user', now, now, '["test"]');

      const row = db.prepare('select * from memories where id = ?').get('mem-1') as {
        id: string;
        title: string;
        scope: string;
      };
      expect(row.title).toBe('Test Memory');
      expect(row.scope).toBe('user');

      db.close();
    });

    it('should allow inserting patches after migration', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      const now = Date.now();
      db.prepare(
        'insert into patches (id, file_path, base_hash, operations_json, author, risk_level, created_at, status) values (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('patch-1', '/test/file.ts', 'hash123', '[]', 'test-agent', 'low', now, 'proposed');

      const row = db.prepare('select * from patches where id = ?').get('patch-1') as {
        id: string;
        status: string;
      };
      expect(row.status).toBe('proposed');

      db.close();
    });

    it('should enforce events append-only trigger (no update)', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      db.prepare(
        'insert into events (id, timestamp, level, source, message, diff, file_path, patch_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('evt-1', Date.now(), 'info', 'test', 'original', null, null, null, Date.now());

      expect(() => {
        db.prepare('update events set message = ? where id = ?').run('modified', 'evt-1');
      }).toThrow();

      db.close();
    });

    it('should enforce events append-only trigger (no delete)', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      db.prepare(
        'insert into events (id, timestamp, level, source, message, diff, file_path, patch_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('evt-1', Date.now(), 'info', 'test', 'to-delete', null, null, null, Date.now());

      expect(() => {
        db.prepare('delete from events where id = ?').run('evt-1');
      }).toThrow();

      db.close();
    });
  });

  describe('idempotency (migrate called twice)', () => {
    let dbPath: string;

    beforeEach(() => {
      dbPath = tempDbPath();
    });

    afterEach(() => {
      cleanupDb(dbPath);
    });

    it('should not fail when migration SQL is applied twice (if not exists)', () => {
      const db = new DatabaseSync(dbPath);

      applyMigrationV1(db);
      // Second apply should not throw (all create statements are "if not exists")
      expect(() => applyMigrationV1(db)).not.toThrow();

      db.close();
    });

    it('should preserve data after re-migration', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      // Insert data
      db.prepare(
        'insert into events (id, timestamp, level, source, message, diff, file_path, patch_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('evt-before', Date.now(), 'info', 'test', 'pre-migration-data', null, null, null, Date.now());

      // Re-apply migration (idempotent)
      applyMigrationV1(db);

      // Data should still exist
      const row = db.prepare('select * from events where id = ?').get('evt-before') as {
        id: string;
        message: string;
      };
      expect(row.message).toBe('pre-migration-data');

      // Insert more data after re-migration
      db.prepare(
        'insert into events (id, timestamp, level, source, message, diff, file_path, patch_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('evt-after', Date.now(), 'info', 'test', 'post-migration-data', null, null, null, Date.now());

      const allEvents = db.prepare('select count(*) as count from events').get() as { count: number };
      expect(allEvents.count).toBe(2);

      db.close();
    });
  });

  describe('upgrade path (v1 → v2 simulation)', () => {
    let dbPath: string;

    beforeEach(() => {
      dbPath = tempDbPath();
    });

    afterEach(() => {
      cleanupDb(dbPath);
    });

    it('should handle adding a new column to existing table', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      // Insert data
      db.prepare(
        'insert into events (id, timestamp, level, source, message, diff, file_path, patch_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('evt-1', Date.now(), 'info', 'test', 'pre-upgrade', null, null, null, Date.now());

      // Simulate v2: add a new column
      db.exec('alter table events add column session_id text');

      // Verify old data is intact
      const row = db.prepare('select * from events where id = ?').get('evt-1') as {
        id: string;
        message: string;
        session_id: string | null;
      };
      expect(row.message).toBe('pre-upgrade');
      expect(row.session_id).toBeNull();

      // Insert new data with the new column
      db.prepare(
        'insert into events (id, timestamp, level, source, message, diff, file_path, patch_id, created_at, session_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('evt-2', Date.now(), 'info', 'test', 'post-upgrade', null, null, null, Date.now(), 'session-1');

      const newRow = db.prepare('select * from events where id = ?').get('evt-2') as {
        id: string;
        session_id: string;
      };
      expect(newRow.session_id).toBe('session-1');

      db.close();
    });

    it('should handle adding a new table to existing database', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      // Simulate v2: add a new table
      db.exec(`
        create table if not exists migration_log (
          id text primary key,
          from_version integer not null,
          to_version integer not null,
          migrated_at integer not null
        )
      `);

      expect(tableExists(db, 'migration_log')).toBe(true);

      // Original tables should still exist
      expect(tableExists(db, 'events')).toBe(true);
      expect(tableExists(db, 'memories')).toBe(true);
      expect(tableExists(db, 'patches')).toBe(true);

      db.close();
    });

    it('should maintain data integrity across simulated version upgrades', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      // Insert data in v1
      const now = Date.now();
      db.prepare(
        'insert into memories (id, scope, file_path, title, checksum, source_kind, created_source, created_at, updated_at, tags_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('mem-v1', 'user', '/v1/doc.md', 'V1 Doc', 'v1-hash', 'markdown', 'user', now, now, '[]');

      // Simulate v2: add index
      db.exec('create index if not exists idx_events_level on events(level)');

      // Insert data in v2
      db.prepare(
        'insert into memories (id, scope, file_path, title, checksum, source_kind, created_source, created_at, updated_at, tags_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('mem-v2', 'workspace', '/v2/doc.md', 'V2 Doc', 'v2-hash', 'markdown', 'agent', now, now, '[]');

      // Both should exist
      const mems = db.prepare('select count(*) as count from memories').get() as { count: number };
      expect(mems.count).toBe(2);

      // New index should exist
      expect(indexExists(db, 'idx_events_level')).toBe(true);

      db.close();
    });
  });

  describe('schema validation after migration', () => {
    let dbPath: string;

    beforeEach(() => {
      dbPath = tempDbPath();
    });

    afterEach(() => {
      cleanupDb(dbPath);
    });

    it('should have correct column definitions for events table', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      const columns = db.prepare('select name, type, "notnull" from pragma_table_info(\'events\')').all() as Array<{
        name: string;
        type: string;
        notnull: number;
      }>;

      const columnMap = new Map(columns.map((c) => [c.name, c]));

      expect(columnMap.has('id')).toBe(true);
      expect(columnMap.has('timestamp')).toBe(true);
      expect(columnMap.has('level')).toBe(true);
      expect(columnMap.has('source')).toBe(true);
      expect(columnMap.has('message')).toBe(true);
      expect(columnMap.has('diff')).toBe(true);
      expect(columnMap.has('file_path')).toBe(true);
      expect(columnMap.has('patch_id')).toBe(true);
      expect(columnMap.has('created_at')).toBe(true);

      // Verify NOT NULL constraints (note: PK columns show notnull=0 in SQLite pragma_table_info)
      expect(columnMap.get('timestamp')?.notnull).toBe(1);
      expect(columnMap.get('level')?.notnull).toBe(1);
      expect(columnMap.get('source')?.notnull).toBe(1);
      expect(columnMap.get('message')?.notnull).toBe(1);

      db.close();
    });

    it('should have correct column definitions for memories table', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      const columns = db.prepare('select name, type, "notnull" from pragma_table_info(\'memories\')').all() as Array<{
        name: string;
        type: string;
        notnull: number;
      }>;

      const columnMap = new Map(columns.map((c) => [c.name, c]));

      expect(columnMap.has('id')).toBe(true);
      expect(columnMap.has('scope')).toBe(true);
      expect(columnMap.has('file_path')).toBe(true);
      expect(columnMap.has('title')).toBe(true);
      expect(columnMap.has('checksum')).toBe(true);
      expect(columnMap.has('source_kind')).toBe(true);
      expect(columnMap.has('created_source')).toBe(true);
      expect(columnMap.has('created_at')).toBe(true);
      expect(columnMap.has('updated_at')).toBe(true);
      expect(columnMap.has('tags_json')).toBe(true);

      db.close();
    });

    it('should have foreign key in embedding_metadata referencing index_chunks', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      // Enable foreign keys for validation
      db.exec('pragma foreign_keys = on');

      // Insert a chunk first
      const now = Date.now();
      db.prepare(
        'insert into index_chunks (id, file_path, language, scope, start_line, end_line, start_col, end_col, text, checksum, created_at, metadata_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('chunk-1', '/test.ts', 'typescript', 'workspace', 1, 10, 0, 100, 'test', 'hash', now, null);

      // Insert embedding metadata with valid foreign key
      db.prepare(
        'insert into embedding_metadata (chunk_id, model, dimension, index_version, scope, language, folder, updated_at, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('chunk-1', 'test-model', 8, 'v1', 'workspace', 'typescript', '/test', now, now);

      // Try to insert with invalid foreign key - should fail
      expect(() => {
        db.prepare(
          'insert into embedding_metadata (chunk_id, model, dimension, index_version, scope, language, folder, updated_at, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run('nonexistent-chunk', 'test-model', 8, 'v1', null, null, null, now, now);
      }).toThrow();

      db.close();
    });

    it('should enforce check constraints on events level', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      // Valid levels should work
      for (const level of ['info', 'warn', 'error']) {
        db.prepare(
          'insert into events (id, timestamp, level, source, message, diff, file_path, patch_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(`evt-${level}`, Date.now(), level, 'test', `message-${level}`, null, null, null, Date.now());
      }

      // Invalid level should fail
      expect(() => {
        db.prepare(
          'insert into events (id, timestamp, level, source, message, diff, file_path, patch_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run('evt-invalid', Date.now(), 'debug', 'test', 'invalid level', null, null, null, Date.now());
      }).toThrow();

      db.close();
    });

    it('should enforce unique constraint on memories file_path', () => {
      const db = new DatabaseSync(dbPath);
      applyMigrationV1(db);

      const now = Date.now();
      db.prepare(
        'insert into memories (id, scope, file_path, title, checksum, source_kind, created_source, created_at, updated_at, tags_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('mem-1', 'user', '/same/path.md', 'First', 'hash1', 'markdown', 'user', now, now, null);

      // Duplicate file_path should fail
      expect(() => {
        db.prepare(
          'insert into memories (id, scope, file_path, title, checksum, source_kind, created_source, created_at, updated_at, tags_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run('mem-2', 'user', '/same/path.md', 'Second', 'hash2', 'markdown', 'user', now, now, null);
      }).toThrow();

      db.close();
    });
  });

  describe('migration transaction safety', () => {
    let dbPath: string;

    beforeEach(() => {
      dbPath = tempDbPath();
    });

    afterEach(() => {
      cleanupDb(dbPath);
    });

    it('should rollback on migration error', () => {
      const db = new DatabaseSync(dbPath);

      // Create schema_migrations table manually
      db.exec(
        'create table schema_migrations (version integer primary key, name text not null, applied_at integer not null, created_at integer not null)'
      );

      // Attempt a migration with invalid SQL inside a transaction
      db.exec('begin');
      try {
        db.exec('create table test_rollback (id integer primary key)');
        // This will fail - invalid SQL
        db.exec('invalid sql statement');
        db.exec('commit');
      } catch {
        db.exec('rollback');
      }

      // The table should not exist due to rollback
      expect(tableExists(db, 'test_rollback')).toBe(false);

      db.close();
    });
  });
});
