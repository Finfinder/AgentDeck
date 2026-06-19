import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
// SQLInputValue used in type assertions for sqlite queries
import * as sqliteVec from 'sqlite-vec';

import type {
  CodeIndexStats,
  EmbeddingMetadata,
  EventLogEntry,
  EventLogLevel,
  IndexChunk,
  MemoryEntry,
  MemoryScope,
  PatchSet,
  RetrievalResult
} from '@agentdeck/shared';

import { redactSecrets } from './redaction';

export const LOCAL_STORE_INDEX_VERSION = 'phase9-v1';
export const DEFAULT_EMBEDDING_DIMENSION = 8;
export const DEFAULT_EMBEDDING_MODEL = 'agentdeck-lexical-v1';

type Migration = Readonly<{
  version: number;
  name: string;
  sql: string;
}>;

type ChunkRow = Readonly<{
  id: string;
  file_path: string;
  language: string;
  scope: string | null;
  start_line: number;
  end_line: number;
  start_col: number;
  end_col: number;
  text: string;
  checksum: string;
  created_at: number;
  metadata_json: string | null;
}>;

type MemoryRow = Readonly<{
  id: string;
  scope: MemoryScope;
  file_path: string;
  title: string;
  checksum: string;
  source_kind: string;
  created_source: string;
  created_at: number;
  updated_at: number;
  tags_json: string | null;
}>;

type EmbeddingRow = Readonly<{
  chunk_id: string;
  distance: number;
  file_path: string;
  language: string;
  scope: string | null;
  start_line: number;
  end_line: number;
  start_col: number;
  end_col: number;
  text: string;
  checksum: string;
  metadata_json: string | null;
}>;

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-local-store',
    sql: `
      create table if not exists schema_migrations (
        version integer primary key,
        name text not null,
        applied_at integer not null,
        created_at integer not null
      );

      create table if not exists sessions (
        id text primary key,
        started_at integer not null,
        ended_at integer,
        status text not null check (status in ('running', 'stopped', 'crashed')),
        metadata_json text,
        created_at integer not null
      );

      create index if not exists idx_sessions_status on sessions(status);
      create index if not exists idx_sessions_started_at on sessions(started_at);

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
      create index if not exists idx_events_file_path on events(file_path);

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
      create index if not exists idx_patches_author on patches(author);
      create index if not exists idx_patches_risk_level on patches(risk_level);

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
      create index if not exists idx_memories_updated_at on memories(updated_at);
      create index if not exists idx_memories_source_kind on memories(source_kind);
      create index if not exists idx_memories_created_source on memories(created_source);

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
      create index if not exists idx_chunks_checksum on index_chunks(checksum);

      create table if not exists embedding_metadata (
        chunk_id text primary key,
        model text not null,
        dimension integer not null,
        index_version text not null,
        scope text,
        language text,
        folder text,
        updated_at integer not null,
        foreign key (chunk_id) references index_chunks(id) on delete cascade
      );

      create virtual table if not exists vec_embedding_store using vec0(
        chunk_id text primary key,
        scope text,
        language text,
        folder text,
        embedding float[8]
      );

      create index if not exists idx_embedding_metadata_model on embedding_metadata(model);
      create index if not exists idx_embedding_metadata_index_version on embedding_metadata(index_version);
      create index if not exists idx_embedding_metadata_scope on embedding_metadata(scope);
      create index if not exists idx_embedding_metadata_language on embedding_metadata(language);
      create index if not exists idx_embedding_metadata_folder on embedding_metadata(folder);
    `
  },
  {
    version: 2,
    name: 'add-created-at-and-session-indexes',
    sql: `
      alter table schema_migrations add column created_at integer not null default (strftime('%s', 'now'));

      alter table embedding_metadata add column created_at integer not null default (strftime('%s', 'now'));

      create index if not exists idx_sessions_status on sessions(status);
      create index if not exists idx_sessions_started_at on sessions(started_at);
      create index if not exists idx_events_file_path on events(file_path);
      create index if not exists idx_patches_author on patches(author);
      create index if not exists idx_patches_risk_level on patches(risk_level);
      create index if not exists idx_memories_updated_at on memories(updated_at);
      create index if not exists idx_memories_source_kind on memories(source_kind);
      create index if not exists idx_memories_created_source on memories(created_source);
      create index if not exists idx_chunks_checksum on index_chunks(checksum);
      create index if not exists idx_embedding_metadata_scope on embedding_metadata(scope);
      create index if not exists idx_embedding_metadata_language on embedding_metadata(language);
      create index if not exists idx_embedding_metadata_folder on embedding_metadata(folder);
    `
  }
];

export type LocalStoreOptions = Readonly<{
  indexVersion?: string;
  embeddingModel?: string;
  embeddingDimension?: number;
}>;

export type AppendEventInput = Omit<EventLogEntry, 'id' | 'timestamp' | 'createdAt'> & Readonly<{
  level?: EventLogLevel;
}>;

export type SearchEmbeddingFilters = Readonly<{
  scopes?: readonly MemoryScope[];
  languages?: readonly string[];
  folders?: readonly string[];
  maxResults?: number;
}>;

export function createLocalStore(dbPath: string, options: LocalStoreOptions = {}): LocalStore {
  return new LocalStore(dbPath, options);
}

export class LocalStore {
  private readonly db: DatabaseSync;
  private readonly indexVersion: string;
  private readonly embeddingModel: string;
  private readonly embeddingDimension: number;

  constructor(dbPath: string, options: LocalStoreOptions = {}) {
    this.indexVersion = options.indexVersion ?? LOCAL_STORE_INDEX_VERSION;
    this.embeddingModel = options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    this.embeddingDimension = options.embeddingDimension ?? DEFAULT_EMBEDDING_DIMENSION;
    this.db = new DatabaseSync(dbPath, { allowExtension: true });
    sqliteVec.load(this.db);
    this.migrate();
  }

  migrate(): void {
    this.db.exec(
      'create table if not exists schema_migrations (version integer primary key, name text not null, applied_at integer not null)'
    );

    for (const migration of MIGRATIONS) {
      const existing = this.db
        .prepare('select count(*) as count from schema_migrations where version = ?')
        .get(migration.version) as { count: number };
      if (existing.count === 0) {
        this.db.exec('begin');
        try {
          this.db.exec(migration.sql);
          this.db
            .prepare('insert into schema_migrations (version, name, applied_at) values (?, ?, ?)')
            .run(migration.version, migration.name, Date.now());
          this.db.exec('commit');
        } catch (error) {
          this.db.exec('rollback');
          throw error;
        }
      }
    }
  }

  appendEvent(input: AppendEventInput): EventLogEntry {
    const id = generateId('evt');
    const timestamp = Date.now();
    const entry: EventLogEntry = {
      id,
      timestamp,
      level: input.level ?? 'info',
      source: input.source,
      message: redactSecrets(input.message),
      ...(input.diff === undefined ? {} : { diff: redactSecrets(input.diff) }),
      ...(input.filePath === undefined ? {} : { filePath: input.filePath }),
      ...(input.patchId === undefined ? {} : { patchId: input.patchId })
    };

    this.db
      .prepare(
        `insert into events (id, timestamp, level, source, message, diff, file_path, patch_id, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.timestamp,
        entry.level,
        entry.source,
        entry.message,
        entry.diff ?? null,
        entry.filePath ?? null,
        entry.patchId ?? null,
        timestamp
      );

    return entry;
  }

  appendPatch(patch: PatchSet): void {
    this.db
      .prepare(
        `insert into patches (id, file_path, base_hash, operations_json, author, risk_level, created_at, status)
         values (?, ?, ?, ?, ?, ?, ?, 'proposed')`
      )
      .run(patch.id, patch.filePath, patch.baseHash, JSON.stringify(patch.operations), patch.author, patch.riskLevel, patch.createdAt);
  }

  upsertMemory(entry: MemoryEntry): void {
    this.db
      .prepare(
        `insert into memories (id, scope, file_path, title, checksum, source_kind, created_source, created_at, updated_at, tags_json)
         values (?, ?, ?, ?, ?, 'markdown', ?, ?, ?, ?)
         on conflict(file_path) do update set
           title = excluded.title,
           checksum = excluded.checksum,
           created_source = excluded.created_source,
           updated_at = excluded.updated_at,
           tags_json = excluded.tags_json`
      )
      .run(entry.id, entry.scope, entry.filePath, entry.title, entry.checksum, entry.createdSource, entry.createdAt, entry.updatedAt, JSON.stringify(entry.tags ?? []));
  }

  listMemories(scope?: MemoryScope): readonly MemoryEntry[] {
    const rows = scope === undefined
      ? this.db.prepare('select * from memories order by scope, title').all() as MemoryRow[]
      : this.db.prepare('select * from memories where scope = ? order by title').all(scope) as MemoryRow[];

    return rows.map(rowToMemoryEntry);
  }

  upsertChunk(chunk: IndexChunk, embedding: Float32Array, metadata: EmbeddingMetadata): void {
    const folder = metadata.folder ?? '';
    this.db.exec('begin');
    try {
      this.db
        .prepare(
          `insert into index_chunks (id, file_path, language, scope, start_line, end_line, start_col, end_col, text, checksum, created_at, metadata_json)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict(id) do update set
             file_path = excluded.file_path,
             language = excluded.language,
             scope = excluded.scope,
             start_line = excluded.start_line,
             end_line = excluded.end_line,
             start_col = excluded.start_col,
             end_col = excluded.end_col,
             text = excluded.text,
             checksum = excluded.checksum,
             created_at = excluded.created_at,
             metadata_json = excluded.metadata_json`
        )
        .run(
          chunk.id,
          chunk.filePath,
          chunk.language,
          chunk.scope ?? null,
          chunk.startLine,
          chunk.endLine,
          chunk.startCol,
          chunk.endCol,
          chunk.text,
          chunk.checksum,
          chunk.createdAt,
          JSON.stringify(chunk.metadata ?? {})
        );

      this.db
        .prepare(
          `insert into embedding_metadata (chunk_id, model, dimension, index_version, scope, language, folder, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?)
           on conflict(chunk_id) do update set
             model = excluded.model,
             dimension = excluded.dimension,
             index_version = excluded.index_version,
             scope = excluded.scope,
             language = excluded.language,
             folder = excluded.folder,
             updated_at = excluded.updated_at`
        )
        .run(
          chunk.id,
          metadata.model,
          metadata.dimension,
          metadata.indexVersion,
          metadata.scope ?? null,
          metadata.language ?? null,
          folder,
          metadata.updatedAt ?? Date.now()
        );

      this.db.prepare('delete from vec_embedding_store where chunk_id = ?').run(chunk.id);
      this.db
        .prepare('insert into vec_embedding_store (chunk_id, scope, language, folder, embedding) values (?, ?, ?, ?, ?)')
        .run(chunk.id, metadata.scope ?? null, metadata.language ?? null, folder, float32ToUint8(embedding));

      this.db.exec('commit');
    } catch (error) {
      this.db.exec('rollback');
      throw error;
    }
  }

  deleteChunksForFile(filePath: string): void {
    this.db.prepare('delete from index_chunks where file_path = ?').run(filePath);
  }

  listChunks(filters?: SearchEmbeddingFilters): readonly IndexChunk[] {
    const { where, params } = buildChunkFilters(filters);
    const rows = this.db.prepare(`select * from index_chunks ${where} order by file_path, start_line, id`).all(...(params as unknown as SQLInputValue[])) as ChunkRow[];
    return rows.map(rowToIndexChunk);
  }

  searchEmbeddings(embedding: Float32Array, filters: SearchEmbeddingFilters = {}): readonly RetrievalResult[] {
    const { where, params } = buildChunkFilters({ ...filters, maxResults: filters.maxResults ?? 20 });
    const sql = `
      select
        v.chunk_id,
        v.distance,
        c.file_path,
        c.language,
        c.scope,
        c.start_line,
        c.end_line,
        c.start_col,
        c.end_col,
        c.text,
        c.checksum,
        c.metadata_json
      from vec_embedding_store v
      join index_chunks c on c.id = v.chunk_id
      where v.embedding match ? ${where}
      order by v.distance
      limit ?
    `;
    const rows = this.db.prepare(sql).all(float32ToUint8(embedding), ...(params as unknown as SQLInputValue[]), filters.maxResults ?? 20) as EmbeddingRow[];

    return rows.map(row => ({
      kind: 'code',
      chunkId: row.chunk_id,
      filePath: row.file_path,
      text: row.text,
      score: 1 / (1 + row.distance),
      checksum: row.checksum,
      metadata: {
        distance: row.distance,
        scope: row.scope ?? undefined,
        language: row.language,
        startLine: row.start_line,
        endLine: row.end_line,
        startCol: row.start_col,
        endCol: row.end_col,
        metadata: parseJson<Record<string, unknown>>(row.metadata_json)
      }
    }));
  }

  getStats(): CodeIndexStats {
    const totalRow = this.db.prepare('select count(*) as count from index_chunks').get() as unknown as { count: number } | undefined;
    const filesRow = this.db.prepare('select count(distinct file_path) as count from index_chunks').get() as unknown as { count: number } | undefined;
    const languageRows = this.db.prepare('select language, count(*) as count from index_chunks group by language order by language').all() as Array<{ language: string; count: number }>;

    return {
      chunks: totalRow?.count ?? 0,
      files: filesRow?.count ?? 0,
      languages: Object.fromEntries(languageRows.map(row => [row.language, row.count])),
      indexVersion: this.indexVersion
    };
  }

  getStoredIndexInfo(): Readonly<{ indexVersion: string; model: string; dimension: number } | null> {
    const row = this.db
      .prepare('select index_version, model, dimension from embedding_metadata limit 1')
      .get() as { index_version: string; model: string; dimension: number } | undefined;
    if (row === undefined) {
      return null;
    }

    return { indexVersion: row.index_version, model: row.model, dimension: row.dimension };
  }

  isStale(): boolean {
    const stored = this.getStoredIndexInfo();
    if (stored === null) return false;
    return stored.indexVersion !== this.indexVersion
      || stored.model !== this.embeddingModel
      || stored.dimension !== this.embeddingDimension;
  }

  deleteAllChunks(): void {
    this.db.prepare('delete from index_chunks').run();
  }

  close(): void {
    this.db.close();
  }
}

export function float32ToUint8(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function lexicalEmbedding(text: string, dimension = DEFAULT_EMBEDDING_DIMENSION): Float32Array {
  const vector = new Float32Array(dimension);
  const tokens = text
    .toLowerCase()
    .match(/[a-z0-9_]+/g) ?? [];

  for (const token of tokens) {
    const index = hashToken(token) % dimension;
    vector[index] = (vector[index] ?? 0) + 1;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value ?? 0) * (value ?? 0), 0)) || 1;
  for (let i = 0; i < vector.length; i++) {
    vector[i] = (vector[i] ?? 0) / norm;
  }

  return vector;
}

export function redactedEventMessage(message: string): string {
  return redactSecrets(message);
}

function buildChunkFilters(filters?: SearchEmbeddingFilters): Readonly<{ where: string; params: readonly unknown[] }> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.scopes !== undefined && filters.scopes.length > 0) {
    clauses.push(`c.scope in (${filters.scopes.map(() => '?').join(', ')})`);
    params.push(...filters.scopes);
  }

  if (filters?.languages !== undefined && filters.languages.length > 0) {
    clauses.push(`c.language in (${filters.languages.map(() => '?').join(', ')})`);
    params.push(...filters.languages);
  }

  if (filters?.folders !== undefined && filters.folders.length > 0) {
    clauses.push(`(c.metadata_json is null or c.metadata_json like ?)`);
    params.push(...filters.folders.map(folder => `%${escapeLike(folder)}%`));
  }

  return {
    where: clauses.length > 0 ? `and ${clauses.join(' and ')}` : '',
    params
  };
}

function rowToMemoryEntry(row: MemoryRow): MemoryEntry {
  const tags = parseStringArray(row.tags_json);
  const entry: MemoryEntry = {
    id: row.id,
    scope: row.scope,
    filePath: row.file_path,
    title: row.title,
    checksum: row.checksum,
    sourceKind: row.source_kind as MemoryEntry['sourceKind'],
    createdSource: row.created_source as MemoryEntry['createdSource'],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  if (tags.length > 0) {
    return { ...entry, tags };
  }

  return entry;
}

function rowToIndexChunk(row: ChunkRow): IndexChunk {
  const metadata = parseJson<Record<string, unknown>>(row.metadata_json);
  const chunk: IndexChunk = {
    id: row.id,
    filePath: row.file_path,
    language: row.language,
    startLine: row.start_line,
    endLine: row.end_line,
    startCol: row.start_col,
    endCol: row.end_col,
    text: row.text,
    checksum: row.checksum,
    createdAt: row.created_at
  };

  if (row.scope !== null) {
    return { ...chunk, scope: row.scope as MemoryScope };
  }

  if (Object.keys(metadata).length > 0) {
    return { ...chunk, metadata };
  }

  return chunk;
}

function parseStringArray(value: string | null): string[] {
  const parsed = parseJson<unknown>(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === 'string');
}

function parseJson<T>(value: string | null): T {
  if (value === null || value.trim() === '') {
    return {} as T;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return {} as T;
  }
}

function escapeLike(value: string): string {
  const backslash = String.raw`\\`.slice(0, 1);
  const escapedBackslash = String.raw`\\`;
  const escapedPercent = `${backslash}%`;
  const escapedUnderscore = `${backslash}_`;

  return value.replaceAll(backslash, escapedBackslash).replaceAll('%', escapedPercent).replaceAll('_', escapedUnderscore);
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
