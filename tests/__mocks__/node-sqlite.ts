// Mock for node:sqlite to allow Vitest to bundle tests.
// Provides a lightweight in-memory SQL-like store that supports
// basic CRUD operations needed by LocalStore and other modules.

interface MockTable {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
  primaryKey: string | null;
  uniqueColumns: Set<string>;
}

interface MockIndex {
  name: string;
  table: string;
}

interface MockTrigger {
  name: string;
  event: 'update' | 'delete';
  table: string;
  message: string;
}

interface ParsedCreateTable {
  tableName: string;
  columns: string[];
  primaryKey: string | null;
  uniqueColumns: Set<string>;
}

interface ParsedInsert {
  tableName: string;
  row: Record<string, unknown>;
}

interface ParsedSelect {
  tableName: string;
  columns: string[];
  where: string | null;
  orderBy: string | null;
  limit: string | null;
}

interface ParsedDelete {
  tableName: string;
  where: string | null;
}

interface ParsedUpdate {
  tableName: string;
  setClause: Record<string, unknown>;
  where: string | null;
}

interface ConditionResult {
  matched: boolean;
  nextArgIdx: number;
}

interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

const CREATE_TABLE_PATTERN = /create table\s+(?:if not exists\s+)?(\w+)\s*\((.+)\)/is;
const PRIMARY_KEY_PATTERN = /primary key\s*\((\w+)\)/i;
const UNIQUE_PATTERN = /unique\s*\((\w+)\)/i;
const COLUMN_NAME_PATTERN = /^(\w+)\s+/;
const CREATE_TRIGGER_PATTERN = /create trigger\s+[\s\S]*?(\w+)\s+(before\s+(?:update|delete))\s+on\s+(\w+)\s+begin\s+select\s+raise\(abort,\s*'([^']+)'/is;
const CREATE_INDEX_PATTERN = /create index(?:\s+if not exists)?\s+(\w+)\s+on\s+(\w+)/i;
const INSERT_PATTERN = /insert\s+(?:or\s+(?:replace|ignore)\s+)?into\s+(\w+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/is;
const UPSERT_PATTERN = /insert\s+into\s+(\w+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)\s+on\s+conflict/is;
const UPSERT_SET_PATTERN = /on conflict\(?\w*\)?\s+do update set\s+(.+?)(?:\s+where|$)/is;
const SET_ASSIGNMENT_PATTERN = /(\w+)\s*=\s*excluded\.(\w+)/i;
const SELECT_TABLE_PATTERN = /select\s+(.+?)\s+from\s+(\w+)(?:\s+as\s+\w+)?/i;
const ORDER_PATTERN = /\s+order\s+by\s+(.+?)(?=\s+limit\s+|$)/is;
const LIMIT_PATTERN = /\s+limit\s+(.+?)$/is;
const EMBEDDING_JOIN_HINT_PATTERN = /from\s+(\w+)\s+v\s+join\s+(\w+)\s+c\s+on\s+c\.id\s*=\s*v\.chunk_id/i;
const DELETE_PATTERN = /delete\s+from\s+(\w+)(?:\s+where\s+(.+))?$/is;
const UPDATE_PATTERN = /update\s+(\w+)\s+set\s+(.+?)(?:\s+where\s+(.+))?$/is;
const UPDATE_ASSIGNMENT_PATTERN = /(\w+)\s*=\s*(?:\?|'[^']*'|\d+|null)/i;
const AND_SPLIT_PATTERN = /\s+and\s+/i;
const EQUAL_PATTERN = /^(\w+(?:\.\w+)*)\s*=\s*\?$/i;
const IN_PATTERN = /^(\w+(?:\.\w+)*)\s+in\s*\(([^)]+)\)/i;
const IS_NULL_PATTERN = /^(\w+(?:\.\w+)*)\s+is\s+null$/i;
const LIKE_PATTERN = /^(\w+(?:\.\w+)*)\s+like\s+\?$/i;
const NULL_OR_LIKE_PATTERN = /^(\w+)\s+is\s+null\s+or\s+\1\s+like\s+\?$/i;
const SQLITE_MASTER_TYPE_PATTERN = /type\s*=\s*'(\w+)'/i;
const SQLITE_MASTER_NAME_PATTERN = /name\s*=\s*\?/i;
const PRAGMA_TABLE_PATTERN = /pragma_table_info\('([^']+)'\)/i;

const tables = new Map<string, MockTable>();
const indexes: MockIndex[] = [];
const triggers: MockTrigger[] = [];
let _seqCounter = 1;

function nextSeq(): number {
  return _seqCounter++;
}

function emptyRunResult(): RunResult {
  return { changes: 0, lastInsertRowid: 0 };
}

function normalizeSql(sql: string): string {
  return sql.trim().toLowerCase();
}

function expectMatch(sql: string, pattern: RegExp): RegExpExecArray {
  const match = pattern.exec(sql);
  if (!match) throw new Error(`Mock SQLite nie obsługuje zapytania: ${sql}`);
  return match;
}

function capture(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error('Brak oczekiwanej grupy w zapytaniu SQL');
  return value;
}

function createRowFromColumns(columns: string[], args: unknown[]): Record<string, unknown> {
  return columns.reduce<Record<string, unknown>>((row, col, index) => {
    row[col] = args[index];
    return row;
  }, {});
}

function getColumnRef(row: Record<string, unknown>, ref: string): unknown {
  return row[ref.split('.').pop()!.toLowerCase()];
}

function sqlLikePattern(value: unknown): string {
  return String(value).replaceAll(/[%_]/g, match => match === '%' ? '.*' : '.');
}

function parseWhere(sql: string): string | null {
  const lowered = sql.toLowerCase();
  const whereIndex = lowered.indexOf(' where ');
  if (whereIndex < 0) return null;

  const body = sql.slice(whereIndex + 7);
  const orderIndex = body.toLowerCase().indexOf(' order by ');
  const limitIndex = body.toLowerCase().indexOf(' limit ');
  const endIndex = [orderIndex, limitIndex].filter(index => index >= 0).sort((a, b) => a - b)[0] ?? body.length;

  return body.slice(0, endIndex).trim();
}

function parseOrderBy(sql: string): string | null {
  const match = ORDER_PATTERN.exec(sql);
  return match ? match[1]!.trim() : null;
}

function parseLimit(sql: string): string | null {
  const match = LIMIT_PATTERN.exec(sql);
  return match ? match[1]!.trim() : null;
}

function parsePrimaryKeyConstraint(trimmed: string, parsed: ParsedCreateTable): boolean {
  // Handle table-level: PRIMARY KEY (col)
  const match = PRIMARY_KEY_PATTERN.exec(trimmed);
  if (match) {
    parsed.primaryKey = match[1]!.toLowerCase();
    return true;
  }
  // Handle inline: col type primary key
  const inlineMatch = /^(\w+)\s+\w+\s+primary key/i.exec(trimmed);
  if (inlineMatch) {
    parsed.primaryKey = inlineMatch[1]!.toLowerCase();
    return true;
  }
  return false;
}

function parseUniqueConstraint(trimmed: string, parsed: ParsedCreateTable): boolean {
  const match = UNIQUE_PATTERN.exec(trimmed);
  if (!match) return false;

  parsed.uniqueColumns.add(match[1]!.toLowerCase());
  return true;
}

function parseColumnDefinition(trimmed: string, parsed: ParsedCreateTable): void {
  const lowered = trimmed.toLowerCase();
  const match = expectMatch(trimmed, COLUMN_NAME_PATTERN);

  const colName = capture(match, 1).toLowerCase();
  parsed.columns.push(colName);
  if (lowered.includes(' unique')) parsed.uniqueColumns.add(colName);
  if (lowered.includes(' primary key')) parsed.primaryKey = colName;
}

function splitColumns(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

function parseCreateTable(sql: string): ParsedCreateTable | null {
  const match = expectMatch(sql, CREATE_TABLE_PATTERN);

  const parsed: ParsedCreateTable = {
    tableName: capture(match, 1).toLowerCase(),
    columns: [],
    primaryKey: null,
    uniqueColumns: new Set<string>()
  };

  for (const part of splitColumns(capture(match, 2))) {
    const trimmed = part.trim();
    if (parsePrimaryKeyConstraint(trimmed, parsed)) continue;
    if (parseUniqueConstraint(trimmed, parsed)) continue;
    if (trimmed.toLowerCase().startsWith('foreign key') || trimmed.toLowerCase().startsWith('check')) continue;
    parseColumnDefinition(trimmed, parsed);
  }

  return parsed;
}

function parseCreateTrigger(sql: string): MockTrigger | null {
  const match = expectMatch(sql, CREATE_TRIGGER_PATTERN);

  return {
    name: capture(match, 1).toLowerCase(),
    event: capture(match, 2).toLowerCase().includes('update') ? 'update' : 'delete',
    table: capture(match, 3).toLowerCase(),
    message: capture(match, 4)
  };
}

function parseCreateIndex(sql: string): MockIndex | null {
  const match = expectMatch(sql, CREATE_INDEX_PATTERN);

  return {
    name: capture(match, 1).toLowerCase(),
    table: capture(match, 2).toLowerCase()
  };
}

function parseInsert(sql: string, args: unknown[]): ParsedInsert | null {
  const match = INSERT_PATTERN.exec(sql);
  if (match) {
    const cols = capture(match, 2).split(',').map(c => c.trim().toLowerCase());
    return { tableName: capture(match, 1).toLowerCase(), row: createRowFromColumns(cols, args) };
  }

  return parseUpsertInsert(sql, args);
}

function parseUpsertInsert(sql: string, args: unknown[]): ParsedInsert | null {
  const upsertMatch = expectMatch(sql, UPSERT_PATTERN);

  const upsertCols = capture(upsertMatch, 2).split(',').map(c => c.trim().toLowerCase());
  return { tableName: capture(upsertMatch, 1).toLowerCase(), row: createRowFromColumns(upsertCols, args) };
}

function parseUpsertSetClause(sql: string): Record<string, string> | null {
  const match = UPSERT_SET_PATTERN.exec(sql);
  if (!match) return null;

  return match[1]!.split(',').reduce<Record<string, string>>((result, part) => {
    const kv = SET_ASSIGNMENT_PATTERN.exec(part.trim());
    if (kv) result[kv[1]!.toLowerCase()] = kv[2]!.toLowerCase();
    return result;
  }, {});
}

function parseSelect(sql: string): ParsedSelect | null {
  const match = expectMatch(sql, SELECT_TABLE_PATTERN);

  if (EMBEDDING_JOIN_HINT_PATTERN.exec(sql)) {
    return {
      tableName: 'vec_embedding_store',
      columns: ['*'],
      where: parseWhere(sql),
      orderBy: 'v.distance',
      limit: parseLimit(sql)
    };
  }

  return {
    tableName: capture(match, 2).toLowerCase(),
    columns: capture(match, 1).split(',').map(c => c.trim()),
    where: parseWhere(sql),
    orderBy: parseOrderBy(sql),
    limit: parseLimit(sql)
  };
}

function parseDelete(sql: string): ParsedDelete | null {
  const match = DELETE_PATTERN.exec(sql);
  if (!match) return null;

  const where = match[2];
  return { tableName: capture(match, 1).toLowerCase(), where: where ? where.trim() : null };
}

function parseUpdate(sql: string, args: unknown[]): ParsedUpdate | null {
  const match = expectMatch(sql, UPDATE_PATTERN);

  const setClause: Record<string, unknown> = {};
  let argIdx = 0;
  for (const part of splitColumns(capture(match, 2))) {
    const kv = expectMatch(part.trim(), UPDATE_ASSIGNMENT_PATTERN);
    if (kv) {
      setClause[capture(kv, 1).toLowerCase()] = args[argIdx];
      argIdx++;
    }
  }

  return {
    tableName: capture(match, 1).toLowerCase(),
    setClause,
    where: match[3] ? match[3].trim() : null
  };
}

function handleEqual(row: Record<string, unknown>, ref: string, args: unknown[], argIdx: number): ConditionResult {
  return { matched: getColumnRef(row, ref) === args[argIdx], nextArgIdx: argIdx + 1 };
}

function handleIn(row: Record<string, unknown>, ref: string, placeholders: string, args: unknown[], argIdx: number): ConditionResult {
  const values = args.slice(argIdx, argIdx + placeholders.split(',').length);
  return { matched: values.includes(getColumnRef(row, ref)), nextArgIdx: argIdx + values.length };
}

function handleNull(ref: string, row: Record<string, unknown>): ConditionResult {
  return { matched: getColumnRef(row, ref) === null, nextArgIdx: 0 };
}

function handleLike(row: Record<string, unknown>, ref: string, args: unknown[], argIdx: number): ConditionResult {
  const pattern = `^${sqlLikePattern(args[argIdx])}$`;
  const matched = new RegExp(pattern, 'i').test(String(getColumnRef(row, ref) ?? ''));
  return { matched, nextArgIdx: argIdx + 1 };
}

function handleNullOrLike(row: Record<string, unknown>, col: string, args: unknown[], argIdx: number): ConditionResult {
  const value = getColumnRef(row, col);
  if (value === null) {
    return { matched: true, nextArgIdx: argIdx + 1 };
  }

  const pattern = `^${sqlLikePattern(args[argIdx])}$`;
  return { matched: new RegExp(pattern, 'i').test(String(value ?? '')), nextArgIdx: argIdx + 1 };
}

function matchesCondition(row: Record<string, unknown>, condition: string, args: unknown[], argIdx: number): ConditionResult {
  const trimmed = condition.trim();
  const equalMatch = EQUAL_PATTERN.exec(trimmed);
  if (equalMatch) return handleEqual(row, equalMatch[1]!, args, argIdx);

  const inMatch = IN_PATTERN.exec(trimmed);
  if (inMatch) return handleIn(row, inMatch[1]!, inMatch[2]!, args, argIdx);

  const nullMatch = IS_NULL_PATTERN.exec(trimmed);
  if (nullMatch) return handleNull(nullMatch[1]!, row);

  const likeMatch = LIKE_PATTERN.exec(trimmed);
  if (likeMatch) return handleLike(row, likeMatch[1]!, args, argIdx);

  const nullOrLikeMatch = NULL_OR_LIKE_PATTERN.exec(trimmed);
  if (nullOrLikeMatch) return handleNullOrLike(row, nullOrLikeMatch[1]!, args, argIdx);

  if (trimmed.includes('match')) {
    return { matched: true, nextArgIdx: argIdx + 1 };
  }

  return { matched: true, nextArgIdx: argIdx };
}

function matchesWhere(row: Record<string, unknown>, where: string | null, args: unknown[], argOffset: number): boolean {
  if (!where) return true;

  let argIdx = argOffset;
  return where.split(AND_SPLIT_PATTERN).every(condition => {
    const result = matchesCondition(row, condition, args, argIdx);
    argIdx = result.nextArgIdx;
    return result.matched;
  });
}

function getConflictColumn(tableName: string): string | null {
  if (tableName === 'memories') return 'file_path';
  if (tableName === 'index_chunks') return 'id';
  if (tableName === 'embedding_metadata') return 'chunk_id';
  return null;
}

function applyUpsert(table: MockTable, parsed: ParsedInsert, upsertSet: Record<string, string>): RunResult | null {
  const conflictColumn = getConflictColumn(parsed.tableName);
  if (!conflictColumn) return null;

  const existingIdx = table.rows.findIndex(row => row[conflictColumn] === parsed.row[conflictColumn]);
  const existingRow = table.rows[existingIdx];
  if (!existingRow) return null;

  for (const [col] of Object.entries(upsertSet)) {
    if (parsed.row[col] !== undefined) {
      existingRow[col] = parsed.row[col];
    }
  }

  return { changes: 1, lastInsertRowid: 0 };
}

function hasUniqueConflict(table: MockTable, parsed: ParsedInsert, upsertSet: Record<string, string> | null): boolean {
  if (upsertSet) return false;

  return Array.from(table.uniqueColumns).some((col: string) => {
    const value = parsed.row[col];
    return value !== undefined && value !== null && table.rows.some(row => row[col] === value);
  });
}

function mergePrimaryKeyRow(table: MockTable, parsed: ParsedInsert, upsertSet: Record<string, string> | null): RunResult | null {
  const primaryKey = table.primaryKey;
  if (!primaryKey || !parsed.row[primaryKey] || upsertSet) return null;

  const existingIdx = table.rows.findIndex(row => row[primaryKey] === parsed.row[primaryKey]);
  const existingRow = table.rows[existingIdx];
  if (!existingRow) return null;

  table.rows[existingIdx] = { ...parsed.row };
  return { changes: 1, lastInsertRowid: 0 };
}

function appendRow(table: MockTable, parsed: ParsedInsert): RunResult {
  table.rows.push({ ...parsed.row });
  return { changes: 1, lastInsertRowid: nextSeq() };
}

function getInsertResult(table: MockTable, parsed: ParsedInsert, upsertSet: Record<string, string> | null): RunResult {
  const upsertResult = upsertSet ? applyUpsert(table, parsed, upsertSet) : null;
  if (upsertResult) return upsertResult;

  if (hasUniqueConflict(table, parsed, upsertSet)) {
    return { changes: 0, lastInsertRowid: 0 };
  }

  const primaryKeyResult = mergePrimaryKeyRow(table, parsed, upsertSet);
  if (primaryKeyResult) return primaryKeyResult;

  return appendRow(table, parsed);
}

function enforceTrigger(tableName: string, event: 'update' | 'delete'): void {
  const trigger = triggers.find(t => t.table === tableName && t.event === event);
  if (trigger) throw new Error(trigger.message);
}

function getMatchingRows(selectInfo: ParsedSelect, args: unknown[]): Record<string, unknown>[] {
  if (selectInfo.tableName === 'sqlite_master') return querySqliteMaster(selectInfo, args);
  if (selectInfo.tableName === 'pragma_table_info') return queryPragmaTableInfo(selectInfo, args);

  const table = tables.get(selectInfo.tableName);
  if (!table) return [];

  return table.rows.filter(row => matchesWhere(row, selectInfo.where, args, 0));
}

function querySqliteMaster(selectInfo: ParsedSelect, args: unknown[]): Record<string, unknown>[] {
  const typeMatch = selectInfo.where ? SQLITE_MASTER_TYPE_PATTERN.exec(selectInfo.where) : null;
  const nameMatch = selectInfo.where ? SQLITE_MASTER_NAME_PATTERN.exec(selectInfo.where) : null;
  const expectedType = typeMatch ? typeMatch[1]!.toLowerCase() : null;
  const expectedName = nameMatch ? String(args[0]).toLowerCase() : null;

  const rows: Record<string, unknown>[] = [
    ...[...tables.values()].map(table => ({ type: 'table', name: table.name })),
    ...indexes.map(index => ({ type: 'index', name: index.name })),
    ...triggers.map(trigger => ({ type: 'trigger', name: trigger.name }))
  ];

  return rows.filter(row => {
    if (expectedType && String(row.type).toLowerCase() !== expectedType) return false;
    return !expectedName || String(row.name).toLowerCase() === expectedName;
  });
}

function queryPragmaTableInfo(selectInfo: ParsedSelect, args: unknown[]): Record<string, unknown>[] {
  const whereMatch = selectInfo.where ? expectMatch(selectInfo.where, PRAGMA_TABLE_PATTERN) : null;
  const tableName = whereMatch ? capture(whereMatch, 1).toLowerCase() : String(args[0] ?? '').toLowerCase();
  const table = tables.get(tableName);
  if (!table) return [];

  return table.columns.map(column => ({
    name: column,
    type: column === table.primaryKey ? 'text' : 'integer',
    notnull: table.uniqueColumns.has(column) || column === table.primaryKey ? 1 : 0
  }));
}

function isCountSelect(selectInfo: ParsedSelect): boolean {
  return selectInfo.columns.some(column => column.toLowerCase().startsWith('count(') || column.toLowerCase().includes('count(distinct'));
}

function applyLimit(rows: Record<string, unknown>[], selectInfo: ParsedSelect, args: unknown[]): Record<string, unknown>[] {
  if (selectInfo.limit !== '?') return rows;

  const limitArg = args.at(-1);
  const limitVal = typeof limitArg === 'number' && Number.isFinite(limitArg) ? limitArg : 20;
  return rows.slice(0, limitVal);
}

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      current += ch;
      if (ch === stringChar && sql[i - 1] !== '\\') inString = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }
    if (ch === ';') {
      statements.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) statements.push(current);
  return statements;
}

export class DatabaseSync {
  private _isOpen = true;
  loadExtension(name: string, entrypoint?: string): void {
    if (name.length === 0 && entrypoint !== undefined) {
      throw new Error('SQLite extension name is required');
    }
  }

  prepare(sql: string) {
    return {
      run: (...args: unknown[]): RunResult => this.runStatement(sql, args),
      get: (...args: unknown[]): Record<string, unknown> | { count: number } | undefined => this.readOne(sql, args),
      all: (...args: unknown[]): Record<string, unknown>[] => this.readAll(sql, args)
    };
  }

  private runStatement(sql: string, args: unknown[]): RunResult {
    if (!this._isOpen) throw new Error('Database is closed');

    const trimmedSql = sql.trim();
    const loweredSql = normalizeSql(trimmedSql);

    if (loweredSql === 'begin' || loweredSql === 'commit' || loweredSql === 'rollback') {
      return emptyRunResult();
    }

    if (loweredSql.startsWith('create table')) return this.createTable(trimmedSql);
    if (loweredSql.startsWith('create index')) return this.createIndex(trimmedSql);
    if (loweredSql.startsWith('create trigger')) return this.createTrigger(trimmedSql);
    if (loweredSql.startsWith('insert')) return this.insertRow(trimmedSql, args);
    if (loweredSql.startsWith('update')) return this.updateRows(trimmedSql, args);
    if (loweredSql.startsWith('delete')) return this.deleteRows(trimmedSql, args);

    return emptyRunResult();
  }

  private createTable(sql: string): RunResult {
    const parsed = parseCreateTable(sql);
    if (parsed && !tables.has(parsed.tableName)) {
      tables.set(parsed.tableName, {
        name: parsed.tableName,
        columns: parsed.columns,
        rows: [],
        primaryKey: parsed.primaryKey,
        uniqueColumns: parsed.uniqueColumns
      });
    }
    return emptyRunResult();
  }

  private createIndex(sql: string): RunResult {
    const parsed = parseCreateIndex(sql);
    if (parsed && !indexes.some(index => index.name === parsed.name)) {
      indexes.push(parsed);
    }
    return emptyRunResult();
  }

  private createTrigger(sql: string): RunResult {
    const trigger = parseCreateTrigger(sql);
    if (trigger && !triggers.some(existing => existing.name === trigger.name)) {
      triggers.push(trigger);
    }
    return emptyRunResult();
  }

  private insertRow(sql: string, args: unknown[]): RunResult {
    const upsertSet = parseUpsertSetClause(sql);
    const parsed = parseInsert(sql, args);
    if (!parsed) return emptyRunResult();

    const table = tables.get(parsed.tableName);
    return table ? getInsertResult(table, parsed, upsertSet) : emptyRunResult();
  }

  private updateRows(sql: string, args: unknown[]): RunResult {
    const parsed = parseUpdate(sql, args);
    if (!parsed) return emptyRunResult();

    const table = tables.get(parsed.tableName);
    if (!table) return emptyRunResult();

    enforceTrigger(table.name, 'update');

    let changes = 0;
    for (const row of table.rows) {
      if (!matchesWhere(row, parsed.where, args, Object.keys(parsed.setClause).length)) continue;
      for (const [column, value] of Object.entries(parsed.setClause)) {
        row[column] = value;
      }
      changes++;
    }

    return { changes, lastInsertRowid: 0 };
  }

  private deleteRows(sql: string, args: unknown[]): RunResult {
    const parsed = parseDelete(sql);
    if (!parsed) return emptyRunResult();

    const table = tables.get(parsed.tableName);
    if (!table) return emptyRunResult();

    enforceTrigger(table.name, 'delete');

    const before = table.rows.length;
    table.rows = table.rows.filter(row => !matchesWhere(row, parsed.where, args, 0));
    return { changes: before - table.rows.length, lastInsertRowid: 0 };
  }

  private readOne(sql: string, args: unknown[]): Record<string, unknown> | { count: number } | undefined {
    if (!this._isOpen) throw new Error('Database is closed');

    const selectInfo = parseSelect(sql.trim());
    if (!selectInfo) return undefined;

    const rows = getMatchingRows(selectInfo, args);
    if (isCountSelect(selectInfo)) {
      return { count: rows.length };
    }

    return rows.length > 0 ? { ...rows[0]! } : undefined;
  }

  private readAll(sql: string, args: unknown[]): Record<string, unknown>[] {
    if (!this._isOpen) throw new Error('Database is closed');

    const trimmedSql = sql.trim();
    if (normalizeSql(trimmedSql).includes('join')) {
      return [];
    }

    const selectInfo = parseSelect(trimmedSql);
    if (!selectInfo) return [];

    return applyLimit(getMatchingRows(selectInfo, args), selectInfo, args).map(row => ({ ...row }));
  }

  exec(sql: string): void {
    const trimmedSql = sql.trim();
    const loweredSql = normalizeSql(trimmedSql);

    if (trimmedSql === '__RESET_MOCK_DB__') {
      tables.clear();
      indexes.length = 0;
      triggers.length = 0;
      _seqCounter = 1;
      return;
    }

    if (loweredSql === 'begin' || loweredSql === 'commit' || loweredSql === 'rollback') {
      return;
    }

    for (const statement of splitStatements(trimmedSql)) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      const lowered = normalizeSql(trimmed);

      if (lowered === 'begin' || lowered === 'commit' || lowered === 'rollback') continue;
      if (lowered.startsWith('create table')) { this.createTable(trimmed); continue; }
      if (lowered.startsWith('create index')) { this.createIndex(trimmed); continue; }
      if (lowered.startsWith('create trigger')) { this.createTrigger(trimmed); continue; }
      if (lowered.startsWith('insert')) { this.insertRow(trimmed, []); continue; }
      if (lowered.startsWith('update')) { this.updateRows(trimmed, []); continue; }
      if (lowered.startsWith('delete')) { this.deleteRows(trimmed, []); continue; }
    }
  }

  close(): void {
    this._isOpen = false;
  }
}

export function _resetMockDb(): void {
  tables.clear();
  indexes.length = 0;
  triggers.length = 0;
  _seqCounter = 1;
}
