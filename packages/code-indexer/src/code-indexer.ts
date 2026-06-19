import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, relative } from 'node:path';

import type {
  CodeIndexStats,
  EmbeddingMetadata,
  IndexChunk,
  MemoryScope,
  RetrievalQuery,
  RetrievalResult
} from '@agentdeck/shared';

import type { MemoryService } from '@agentdeck/memory-service';
import {
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_EMBEDDING_MODEL,
  LOCAL_STORE_INDEX_VERSION,
  lexicalEmbedding,
  type LocalStore
} from '@agentdeck/memory-service';

import { chunkSource } from './chunking';

export type CodeIndexerOptions = Readonly<{
  store?: LocalStore;
  memoryService?: MemoryService;
  workspaceRoots: readonly string[];
  indexVersion?: string;
  embeddingModel?: string;
  embeddingDimension?: number;
  now?: () => number;
}>;

export type IndexFileResult = Readonly<{
  chunks: readonly IndexChunk[];
  stored: boolean;
}>;

export type RebuildIndexResult = Readonly<{
  chunks: readonly IndexChunk[];
  stats: CodeIndexStats;
}>;

const SUPPORTED_EXTENSIONS = new Set<string>(['.ts', '.tsx', '.js', '.json', '.yaml', '.yml', '.md', '.ps1', '.psm1', '.psd1']);
const EXCLUDED_DIRS = new Set<string>(['.git', 'node_modules', 'out', 'dist', 'build', 'coverage', 'bin', 'obj']);

export class CodeIndexer {
  private readonly store: LocalStore | undefined;
  private readonly memoryService: MemoryService | undefined;
  private readonly workspaceRoots: readonly string[];
  private readonly indexVersion: string;
  private readonly embeddingModel: string;
  private readonly embeddingDimension: number;
  private readonly now: () => number;
  private readonly chunks = new Map<string, IndexChunk>();

  constructor(options: CodeIndexerOptions) {
    this.store = options.store;
    this.memoryService = options.memoryService;
    this.workspaceRoots = [...options.workspaceRoots];
    this.indexVersion = options.indexVersion ?? LOCAL_STORE_INDEX_VERSION;
    this.embeddingModel = options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    this.embeddingDimension = options.embeddingDimension ?? DEFAULT_EMBEDDING_DIMENSION;
    this.now = options.now ?? (() => Date.now());
  }

  /* istanbul ignore next */ async indexFile(filePath: string, scope?: MemoryScope): Promise<IndexFileResult> {
    const content = await readFile(filePath, 'utf8');
    const chunks = await chunkSource(filePath, content, scope, this.now());
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
    }

    if (this.store !== undefined) {
      await this.storeChunks(chunks);
    }

    return { chunks, stored: this.store !== undefined };
  }

  async ensureIndex(roots = this.workspaceRoots): Promise<readonly IndexChunk[]> {
    if (this.store !== undefined && this.store.isStale()) {
      const result = await this.rebuildIndex(roots);
      return result.chunks;
    }
    return this.indexWorkspaceFolders(roots);
  }

  async indexWorkspaceFolders(roots = this.workspaceRoots): Promise<readonly IndexChunk[]> {
    const allChunks: IndexChunk[] = [];
    for (const root of roots) {
      const files = await collectIndexableFiles(root);
      for (const file of files) {
        const result = await this.indexFile(file.filePath, file.scope);
        allChunks.push(...result.chunks);
      }
    }

    return allChunks.sort(compareChunks);
  }

  /* istanbul ignore next */ async rebuildIndex(roots = this.workspaceRoots): Promise<RebuildIndexResult> {
    this.store?.deleteAllChunks();
    this.chunks.clear();
    const chunks = await this.indexWorkspaceFolders(roots);

    return {
      chunks,
      stats: this.store?.getStats() ?? {
        chunks: chunks.length,
        files: new Set(chunks.map(chunk => chunk.filePath)).size,
        languages: countBy(chunks, chunk => chunk.language),
        indexVersion: this.indexVersion
      }
    };
  }

  async retrieve(query: RetrievalQuery): Promise<readonly RetrievalResult[]> {
    const maxResults = query.maxResults ?? 20;
    const includeCode = query.includeCode ?? true;
    const includeMemory = query.includeMemory ?? true;
    const results: RetrievalResult[] = [];

    if (includeCode) {
      const embedding = lexicalEmbedding(query.text, this.embeddingDimension);
      const storedResults = this.store?.searchEmbeddings(embedding, {
        ...(query.scopes !== undefined ? { scopes: query.scopes } : {}),
        ...(query.languages !== undefined ? { languages: query.languages } : {}),
        ...(query.folders !== undefined ? { folders: query.folders } : {}),
        ...(maxResults !== undefined ? { maxResults } : {})
      }) ?? lexicalSearch(query, [...this.chunks.values()]);

      results.push(...storedResults);
    }

    if (includeMemory && this.memoryService !== undefined) {
      results.push(...await this.retrieveMemory(query));
    }

    return results
      .filter(result => result.createdAt === undefined || query.since === undefined || result.createdAt >= query.since)
      .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath) || a.chunkId.localeCompare(b.chunkId))
      .slice(0, maxResults);
  }

  getStats(): CodeIndexStats {
    if (this.store !== undefined) {
      return this.store.getStats();
    }

    const chunks = [...this.chunks.values()];
    return {
      chunks: chunks.length,
      files: new Set(chunks.map(chunk => chunk.filePath)).size,
      languages: countBy(chunks, chunk => chunk.language),
      indexVersion: this.indexVersion
    };
  }

  private async storeChunks(chunks: readonly IndexChunk[]): Promise<void> {
    for (const chunk of chunks) {
      const embedding = lexicalEmbedding(chunk.text, this.embeddingDimension);
      const metadata: EmbeddingMetadata = {
        model: this.embeddingModel,
        dimension: this.embeddingDimension,
        indexVersion: this.indexVersion,
        ...(chunk.scope !== undefined ? { scope: chunk.scope } : {}),
        ...(chunk.language !== undefined ? { language: chunk.language } : {}),
        ...(chunk.metadata?.folder !== undefined ? { folder: chunk.metadata.folder as string } : {}),
        ...(chunk.createdAt !== undefined ? { updatedAt: chunk.createdAt } : {})
      };
      await this.store?.upsertChunk(chunk, embedding, metadata);
    }
  }

  private async retrieveMemory(query: RetrievalQuery): Promise<RetrievalResult[]> {
    const scopes = query.scopes;
    const since = query.since;
    const results: RetrievalResult[] = [];
    for (const scope of scopes ?? ['user', 'workspace', 'repo']) {
      const listResult = await this.memoryService?.list(scope);
      const list = listResult?.status === 'ok' ? listResult.entries : [];
      if (Array.isArray(list)) {
        for (const memory of list) {
          const createdAt = memory.updatedAt;
          if (since !== undefined && createdAt !== undefined && createdAt < since) {
            continue;
          }
          const score = lexicalScore(query.text, memory.title);
          results.push({
            kind: 'memory',
            chunkId: memory.id,
            filePath: memory.filePath,
            text: memory.title,
            score,
            checksum: memory.checksum,
            createdAt,
            metadata: {
              scope: memory.scope,
              sourceKind: memory.sourceKind,
              tags: memory.tags ?? []
            }
          });
        }
      }
    }

    return results;
  }
}

export function createCodeIndexer(options: CodeIndexerOptions): CodeIndexer {
  return new CodeIndexer(options);
}

export function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
      return 'javascript';
    case '.json':
      return 'json';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.md':
      return 'markdown';
    case '.ps1':
    case '.psm1':
    case '.psd1':
      return 'powershell';
    default:
      return 'plaintext';
  }
}

async function collectIndexableFiles(root: string): Promise<Array<{ filePath: string; scope?: MemoryScope }>> {
  const files: Array<{ filePath: string; scope?: MemoryScope }> = [];

  async function walk(current: string, scope?: MemoryScope): Promise<void> {
    let names: string[];
    try {
      names = await readdir(current);
    } catch {
      return;
    }

    for (const name of names) {
      if (EXCLUDED_DIRS.has(name)) continue;
      const fullPath = `${current}/${name}`;
      const info = await stat(fullPath);
      if (info.isDirectory()) {
        await walk(fullPath, scope);
        continue;
      }
      if (!SUPPORTED_EXTENSIONS.has(extname(name).toLowerCase())) continue;
      files.push({ filePath: fullPath, ...(scope !== undefined ? { scope } : {}) });
    }
  }

  await walk(root, inferScope(root));
  return files.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

function inferScope(root: string): MemoryScope | undefined {
  const normalizedRoot = normalize(root);
  if (normalizedRoot.endsWith('/repo')) return 'repo';
  if (normalizedRoot.endsWith('/workspace')) return 'workspace';
  if (normalizedRoot.endsWith('/user')) return 'user';
  return undefined;
}

function normalize(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/$/, '');
}

function compareChunks(a: IndexChunk, b: IndexChunk): number {
  return a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine || a.id.localeCompare(b.id);
}

function countBy<T>(items: readonly T[], selector: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = selector(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function lexicalSearch(query: RetrievalQuery, chunks: readonly IndexChunk[]): RetrievalResult[] {
  return chunks
    .filter(chunk => matchesFilters(query, chunk))
    .map(chunk => ({
      kind: 'code' as const,
      chunkId: chunk.id,
      filePath: chunk.filePath,
      text: chunk.text,
      score: lexicalScore(query.text, chunk.text),
      ...(chunk.checksum !== undefined ? { checksum: chunk.checksum } : {}),
      ...(chunk.createdAt !== undefined ? { createdAt: chunk.createdAt } : {}),
      metadata: chunk.metadata ?? {}
    }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath));
}

function matchesFilters(query: RetrievalQuery, chunk: IndexChunk): boolean {
  if (query.scopes !== undefined && query.scopes.length > 0 && chunk.scope !== undefined && !query.scopes.includes(chunk.scope)) return false;
  if (query.languages !== undefined && query.languages.length > 0 && !query.languages.includes(chunk.language)) return false;
  if (query.folders !== undefined && query.folders.length > 0) {
    const folder = chunk.metadata?.folder;
    if (typeof folder !== 'string' || !query.folders.some(folderFilter => folder.includes(folderFilter))) return false;
  }
  return true;
}

function lexicalScore(query: string, text: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  const textTokens = new Set(tokenize(text));
  const matched = queryTokens.filter(token => textTokens.has(token)).length;
  return matched / queryTokens.length;
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}

export function deterministicChunkId(filePath: string, language: string, startLine: number, text: string): string {
  return `chunk-${sha256(`${filePath}:${language}:${startLine}:${text}`).slice(0, 24)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function relativePath(root: string, filePath: string): string {
  return relative(root, filePath).replaceAll('\\', '/');
}
