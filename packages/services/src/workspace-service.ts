import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, relative } from 'node:path';

import type {
  DirectoryListing,
  FileEntry,
  FileOperationResult,
  FsChangeEvent,
  RecentWorkspace,
  SearchQuery,
  SearchResult,
  WorkspaceFolder,
  WorkspaceModel,
  WorkspaceOpenKind
} from '@agentdeck/shared';

// Patterns indicating a file path may contain secrets or credentials.
// Used to mark entries for the Permission Broker - not to block access.
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /\.env($|\.)/i,
  /\.(key|pem|crt|cer|p12|pfx|jks)$/i,
  /\/secrets?\//i,
  /\.storage_state\.json$/i,
  /credentials?(\.|$)/i,
  /\.(npmrc|yarnrc)$/i,
  /[/\\]\.ssh[/\\]/i,
  /keystore/i,
  /[/\\]\.aws[/\\]/i,
  /[/\\]\.azure[/\\]/i,
  /id_rsa/i,
  /id_ed25519/i
];

// Directories skipped during directory listing and search to avoid noise.
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.tox', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.nyc_output']);

// Binary file extensions - skip when searching text.
export const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar',
  '.exe', '.dll', '.pdb', '.so', '.dylib', '.node',
  '.pth', '.pyc', '.pkl', '.npy', '.npz',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm'
]);

/** Check whether a file path has a binary extension. */
export function isBinaryFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return BINARY_EXTS.has(ext);
}

export function isSensitivePath(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/');
  return SENSITIVE_PATH_PATTERNS.some(p => p.test(normalized));
}

// Convert a single glob pattern to a regular expression string.
function globToRegex(pattern: string): string {
  let p = pattern.replaceAll('\\', '/');
  if (p.startsWith('./')) p = p.slice(2);
  if (p.startsWith('/')) p = p.slice(1);

  // Use placeholders for wildcards so we can escape other regex chars safely.
  const DSTAR = '___DSTAR___';
  const STAR = '___STAR___';
  const QMARK = '___QMARK___';

  p = p.replaceAll('**', DSTAR);
  p = p.replaceAll('*', STAR);
  p = p.replaceAll('?', QMARK);

  // Escape remaining regex-special characters.
  p = p.replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`);

  // Replace placeholders with regex equivalents.
  p = p.replaceAll(DSTAR, '.*'); // matches across path separators
  p = p.replaceAll(STAR, '[^/]*'); // matches within a path segment
  p = p.replaceAll(QMARK, '.');

  return p;
}

function compileGlobPatterns(spec?: string): RegExp[] {
  if (!spec) return [];
  const parts = spec.split(',').map(s => s.trim()).filter(Boolean);
  return parts.map(p => new RegExp('^' + globToRegex(p) + '$', 'i'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRecentWorkspace(value: unknown): value is RecentWorkspace {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === 'string' &&
    typeof value.name === 'string' &&
    (value.kind === 'folder' || value.kind === 'workspace-file') &&
    typeof value.lastOpened === 'number'
  );
}

// Scan from the opening `"` and return the index past the closing `"`.
function scanString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '"') return i + 1;
    i++;
  }
  return i;
}

// Advance past a single-line comment; stops at the newline (does not consume it).
function skipLineComment(text: string, start: number): number {
  let i = start;
  while (i < text.length && text[i] !== '\n') i++;
  return i;
}

// Advance past a block comment, consuming the closing `*/`.
function skipBlockComment(text: string, start: number): number {
  let i = start + 2;
  while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
  return i + 2;
}

// Strip JSONC comments (// and /* */) and trailing commas so the result
// is valid JSON parseable by JSON.parse.
export function stripJsoncComments(text: string): string {
  const chars: string[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '"') {
      const end = scanString(text, i);
      chars.push(text.slice(i, end));
      i = end;
      continue;
    }

    if (ch === '/' && text[i + 1] === '/') {
      i = skipLineComment(text, i);
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      i = skipBlockComment(text, i);
      continue;
    }

    chars.push(ch ?? '');
    i++;
  }

  // Remove trailing commas before } or ]
  return chars.join('').replaceAll(/,(\s*[}\]])/g, '$1');
}

function isWorkspaceFolderEntry(value: unknown): value is { path: string; name?: string } {
  return isRecord(value) && typeof value.path === 'string' && (value.name === undefined || typeof value.name === 'string');
}

export function parseCodeWorkspace(text: string, filePath: string): WorkspaceModel {
  let stripped: string;
  try {
    stripped = stripJsoncComments(text);
  } catch {
    return { status: 'error', code: 'INVALID_JSONC', message: 'Failed to process workspace file comments.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return {
      status: 'error',
      code: 'INVALID_JSONC',
      message: `Invalid JSON in workspace file: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.folders)) {
    return { status: 'error', code: 'EMPTY_WORKSPACE', message: 'Workspace file must contain a "folders" array.' };
  }

  const workspaceDir = dirname(filePath);
  const folders: WorkspaceFolder[] = [];

  for (const entry of parsed.folders) {
    if (isWorkspaceFolderEntry(entry)) {
      const resolved = resolve(workspaceDir, entry.path);
      folders.push(entry.name === undefined ? { path: resolved } : { path: resolved, name: entry.name });
    }
  }

  if (folders.length === 0) {
    return { status: 'error', code: 'EMPTY_WORKSPACE', message: 'Workspace has no valid folder entries.' };
  }

  return { status: 'ok', filePath, kind: 'workspace-file', folders };
}

// ?? Shared file operation helpers ???????????????????????????????????????

async function performFileDelete(filePath: string): Promise<FileOperationResult> {
  try {
    await unlink(filePath);
    return { status: 'ok' };
  } catch (err) {
    const code = isRecord(err) && err.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'UNKNOWN';
    return { status: 'error', code, message: err instanceof Error ? err.message : String(err) };
  }
}

async function performFileRename(oldPath: string, newPath: string): Promise<FileOperationResult> {
  try {
    await rename(oldPath, newPath);
    return { status: 'ok' };
  } catch (err) {
    const code = isRecord(err) && err.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'UNKNOWN';
    return { status: 'error', code, message: err instanceof Error ? err.message : String(err) };
  }
}

async function performListDirectory(dirPath: string): Promise<DirectoryListing> {
  try {
    const dirents = await readdir(dirPath, { withFileTypes: true });
    const entries: FileEntry[] = dirents.map(d => ({
      name: d.name,
      path: join(dirPath, d.name),
      kind: d.isDirectory() ? 'directory' : 'file',
      isSensitive: isSensitivePath(join(dirPath, d.name))
    } satisfies FileEntry));
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { path: dirPath, entries };
  } catch {
    return { path: dirPath, entries: [] };
  }
}

async function performSearchFiles(query: SearchQuery): Promise<readonly SearchResult[]> {
  const results: SearchResult[] = [];
  const pattern = query.pattern.toLowerCase();
  const limits = { maxResults: 50, maxFileSize: 512 * 1024 };
  const includeRegs = compileGlobPatterns(query.include);
  const excludeRegs = compileGlobPatterns(query.exclude);

  for (const root of query.workspaceRoots) {
    if (results.length >= limits.maxResults) break;
    await searchInDirRecursive(root, pattern, results, limits, { includeRegs, excludeRegs }, root);
  }

  return results;
}

export class WorkspaceService extends EventEmitter {
  private readonly recentFilePath: string;
  private activeWatchers: FSWatcher[] = [];
  private currentFolders: readonly WorkspaceFolder[] = [];

  constructor(userDataPath: string) {
    super();
    this.recentFilePath = join(userDataPath, 'recent-workspaces.json');
  }

  getWorkspaceRoots(): readonly string[] {
    return this.currentFolders.map(f => f.path);
  }

  async openWorkspace(path: string, kind: WorkspaceOpenKind): Promise<WorkspaceModel> {
    this.stopWatchers();

    if (kind === 'workspace-file') {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (err) {
        const code = isRecord(err) && err.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'INVALID_JSONC';
        return { status: 'error', code, message: `Cannot read workspace file: ${path}` };
      }

      const model = parseCodeWorkspace(text, path);

      if (model.status === 'ok') {
        this.currentFolders = model.folders;
        this.startWatchers(model.folders.map(f => f.path));
        await this.saveRecentWorkspace({ path, name: basename(path), kind, lastOpened: Date.now() });
      }

      return model;
    }

    // Folder workspace
    this.currentFolders = [{ path }];
    this.startWatchers([path]);
    await this.saveRecentWorkspace({ path, name: basename(path), kind: 'folder', lastOpened: Date.now() });
    return { status: 'ok', filePath: path, kind: 'folder', folders: [{ path }] };
  }

  closeWorkspace(): void {
    this.stopWatchers();
    this.currentFolders = [];
  }

  async deleteFile(filePath: string): Promise<FileOperationResult> {
    return performFileDelete(filePath);
  }

  async renameFile(oldPath: string, newPath: string): Promise<FileOperationResult> {
    return performFileRename(oldPath, newPath);
  }

  async listDirectory(dirPath: string): Promise<DirectoryListing> {
    return performListDirectory(dirPath);
  }

  async searchFiles(query: SearchQuery): Promise<readonly SearchResult[]> {
    return performSearchFiles(query);
  }

  async getRecentWorkspaces(): Promise<readonly RecentWorkspace[]> {
    try {
      const text = await readFile(this.recentFilePath, 'utf8');
      const data: unknown = JSON.parse(text);
      if (!Array.isArray(data)) return [];
      return data.filter(isRecentWorkspace).slice(0, 10);
    } catch {
      return [];
    }
  }

  private normalizeRelPath(root: string, fullPath: string): string {
    return relative(root, fullPath).replaceAll('\\', '/');
  }

  private isPathExcluded(relPath: string, excludeRegs: RegExp[]): boolean {
    return excludeRegs.some(r => r.test(relPath));
  }

  private matchesInclude(relFile: string, includeRegs: RegExp[]): boolean {
    return includeRegs.length === 0 || includeRegs.some(r => r.test(relFile));
  }

  private async saveRecentWorkspace(entry: RecentWorkspace): Promise<void> {
    try {
      const existing = await this.getRecentWorkspaces();
      const filtered = existing.filter(r => r.path !== entry.path);
      const updated = [entry, ...filtered].slice(0, 10);
      await mkdir(dirname(this.recentFilePath), { recursive: true });
      await writeFile(this.recentFilePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    } catch {
      // Best-effort - do not crash when saving recents fails
    }
  }

  private startWatchers(roots: readonly string[]): void {
    for (const root of roots) {
      try {
        const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
          if (!filename) return;
          const fullPath = join(root, filename);
          const event: FsChangeEvent = { kind: 'change', path: fullPath };
          this.emit('fs-event', event);
        });
        this.activeWatchers.push(watcher);
      } catch {
        // Permission or path errors are non-fatal - watcher is optional
      }
    }
  }

  private stopWatchers(): void {
    for (const w of this.activeWatchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this.activeWatchers = [];
  }

  private async searchInDir(
    dir: string,
    pattern: string,
    results: SearchResult[],
    limits: { maxResults: number; maxFileSize: number },
    includeRegs: RegExp[],
    excludeRegs: RegExp[],
    root: string
  ): Promise<void> {
    if (results.length >= limits.maxResults) return;

    const dirents = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!dirents) return;

    for (const dirent of dirents) {
      if (results.length >= limits.maxResults) break;
      await this.processDirent(dirent, dir, pattern, results, limits, { includeRegs, excludeRegs }, root);
    }
  }

  private async processDirent(
    dirent: { name: string | Buffer; isDirectory(): boolean; isFile(): boolean },
    dir: string,
    pattern: string,
    results: SearchResult[],
    limits: { maxResults: number; maxFileSize: number },
    filters: { includeRegs: RegExp[]; excludeRegs: RegExp[] },
    root: string
  ): Promise<void> {
    const name = String(dirent.name);
    const fullPath = join(dir, name);

    if (dirent.isDirectory()) {
      await this.handleDirectory(name, fullPath, pattern, results, limits, filters, root);
    } else if (dirent.isFile()) {
      await this.handleFile(fullPath, pattern, results, limits, filters, root);
    }
  }

  private async handleDirectory(
    name: string,
    fullPath: string,
    pattern: string,
    results: SearchResult[],
    limits: { maxResults: number; maxFileSize: number },
    filters: { includeRegs: RegExp[]; excludeRegs: RegExp[] },
    root: string
  ): Promise<void> {
    if (SKIP_DIRS.has(name)) return;

    const relDir = this.normalizeRelPath(root, fullPath);
    if (this.isPathExcluded(relDir, filters.excludeRegs)) return;

    await this.searchInDir(fullPath, pattern, results, limits, filters.includeRegs, filters.excludeRegs, root);
  }

  private async handleFile(
    fullPath: string,
    pattern: string,
    results: SearchResult[],
    limits: { maxResults: number; maxFileSize: number },
    filters: { includeRegs: RegExp[]; excludeRegs: RegExp[] },
    root: string
  ): Promise<void> {
    const relFile = this.normalizeRelPath(root, fullPath);

    if (this.isPathExcluded(relFile, filters.excludeRegs)) return;
    if (!this.matchesInclude(relFile, filters.includeRegs)) return;

    await this.searchInFile(fullPath, pattern, results, limits);
  }

  private async searchInFile(
    filePath: string,
    pattern: string,
    results: SearchResult[],
    limits: { maxResults: number; maxFileSize: number }
  ): Promise<void> {
    if (BINARY_EXTS.has(extname(filePath).toLowerCase())) return;

    try {
      const fileStat = await stat(filePath);
      if (fileStat.size > limits.maxFileSize) return;

      const text = await readFile(filePath, 'utf8');
      const sensitive = isSensitivePath(filePath);
      const lines = text.split('\n');

      for (let idx = 0; idx < lines.length; idx++) {
        if (results.length >= limits.maxResults) break;
        const line = lines[idx] ?? '';
        const col = line.toLowerCase().indexOf(pattern);
        if (col === -1) continue;

        results.push({
          id: `${filePath}:${idx + 1}:${col + 1}`,
          file: filePath,
          line: idx + 1,
          col: col + 1,
          snippet: line.trim().slice(0, 200),
          isSensitive: sensitive
        });
      }
    } catch {
      // Unreadable files are silently skipped
    }
  }
}

export function createWorkspaceService(userDataPath: string): WorkspaceService {
  return new WorkspaceService(userDataPath);
}

// ?? Standalone file operations for Tool Router ???????????????????????????
// These delegate to private helpers shared with WorkspaceService class methods.

export async function deleteFileStandalone(filePath: string): Promise<FileOperationResult> {
  return performFileDelete(filePath);
}

export async function renameFileStandalone(oldPath: string, newPath: string): Promise<FileOperationResult> {
  return performFileRename(oldPath, newPath);
}

export async function listDirectoryStandalone(dirPath: string): Promise<DirectoryListing> {
  return performListDirectory(dirPath);
}

export async function searchFilesStandalone(query: SearchQuery): Promise<readonly SearchResult[]> {
  return performSearchFiles(query);
}

function shouldSkipFile(relPath: string, ext: string, includeRegs: RegExp[], excludeRegs: RegExp[]): boolean {
  if (BINARY_EXTS.has(ext)) return true;
  if (includeRegs.length > 0 && !includeRegs.some(r => r.test(relPath))) return true;
  return excludeRegs.some(r => r.test(relPath));
}

function shouldSkipDir(name: string, relPath: string, excludeRegs: RegExp[]): boolean {
  return SKIP_DIRS.has(name) || excludeRegs.some(r => r.test(relPath));
}

async function searchInFile(
  filePath: string,
  pattern: string,
  results: SearchResult[],
  maxResults: number,
  maxFileSize: number
): Promise<void> {
  const fileStat = await stat(filePath);
  if (fileStat.size > maxFileSize) return;

  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length && results.length < maxResults; i++) {
    const line = lines[i]!;
    const col = line.toLowerCase().indexOf(pattern);
    if (col === -1) continue;

    results.push({
      id: `${filePath}:${i + 1}:${col + 1}`,
      file: filePath,
      line: i + 1,
      col: col + 1,
      snippet: line.trim().slice(0, 120),
      isSensitive: isSensitivePath(filePath)
    });
  }
}

interface SearchFilters {
  includeRegs: RegExp[];
  excludeRegs: RegExp[];
}

async function processSearchDirent(
  dirent: { name: string; isDirectory(): boolean; isFile(): boolean },
  dir: string,
  pattern: string,
  results: SearchResult[],
  limits: { maxResults: number; maxFileSize: number },
  filters: SearchFilters,
  workspaceRoot: string
): Promise<void> {
  if (results.length >= limits.maxResults) return;

  const fullPath = join(dir, dirent.name);
  const relPath = relative(workspaceRoot, fullPath).replaceAll('\\', '/');

  if (dirent.isDirectory() && !shouldSkipDir(dirent.name, relPath, filters.excludeRegs)) {
    await searchInDirRecursive(fullPath, pattern, results, limits, filters, workspaceRoot);
    return;
  }

  if (dirent.isFile() && !shouldSkipFile(relPath, extname(dirent.name).toLowerCase(), filters.includeRegs, filters.excludeRegs)) {
    try {
      await searchInFile(fullPath, pattern, results, limits.maxResults, limits.maxFileSize);
    } catch {
      // Unreadable files are silently skipped
    }
  }
}

async function searchInDirRecursive(
  dir: string,
  pattern: string,
  results: SearchResult[],
  limits: { maxResults: number; maxFileSize: number },
  filters: SearchFilters,
  workspaceRoot: string
): Promise<void> {
  if (results.length >= limits.maxResults) return;

  const dirents = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!dirents) return;

  for (const dirent of dirents) {
    if (results.length >= limits.maxResults) break;
    await processSearchDirent(dirent, dir, pattern, results, limits, filters, workspaceRoot);
  }
}


