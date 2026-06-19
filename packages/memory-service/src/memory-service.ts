import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
// readdir used dynamically in list()

import type { MemoryApplyResult, MemoryChangeProposal, MemoryEntry, MemoryScope, PatchOperation, PatchSet, ToolRiskLevel } from '@agentdeck/shared';

import { redactSecrets } from './redaction';

export type MemoryServiceOptions = Readonly<{
  author: string;
  baseDir: string;
  riskLevel?: ToolRiskLevel;
}>;

export type MemoryEdit = Readonly<{
  scope: MemoryScope;
  filePath: string;
  text: string;
}>;

export type MemoryReadResult =
  | Readonly<{ status: 'ok'; entry: MemoryEntry; content: string }>
  | Readonly<{ status: 'error'; code: 'FILE_NOT_FOUND' | 'UNKNOWN'; message: string }>;

export type MemoryWriteProposalResult =
  | Readonly<{ status: 'ok'; proposal: MemoryChangeProposal }>
  | Readonly<{ status: 'error'; code: 'FILE_NOT_FOUND' | 'UNKNOWN'; message: string }>;

export type ListMemoryFilesResult =
  | Readonly<{ status: 'ok'; entries: readonly MemoryEntry[] }>
  | Readonly<{ status: 'error'; code: 'UNKNOWN'; message: string }>;

export function createMemoryService(options: MemoryServiceOptions): MemoryService {
  return new MemoryService(options);
}

export class MemoryService {
  private readonly author: string;
  private readonly baseDir: string;
  private readonly riskLevel: ToolRiskLevel;

  constructor(options: MemoryServiceOptions) {
    this.author = options.author;
    this.baseDir = options.baseDir;
    this.riskLevel = options.riskLevel ?? 'low';
  }

  async ensureScope(scope: MemoryScope): Promise<string> {
    const scopeDir = join(this.baseDir, 'memories', scope);
    await mkdir(scopeDir, { recursive: true });
    return scopeDir;
  }

  async read(scope: MemoryScope, filePath: string): Promise<MemoryReadResult> {
    try {
      const content = await readFile(filePath, 'utf8');
      return {
        status: 'ok',
        entry: this.describeEntry(scope, filePath, content),
        content
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        return { status: 'error', code: 'FILE_NOT_FOUND', message: 'Memory file not found.' };
      }
      return { status: 'error', code: 'UNKNOWN', message: String(error) };
    }
  }

  async list(scope?: MemoryScope): Promise<ListMemoryFilesResult> {
    try {
      const root = scope === undefined ? join(this.baseDir, 'memories') : join(this.baseDir, 'memories', scope);
      const entries = await collectMarkdownEntries(root, scope);
      return { status: 'ok', entries };
    } catch (error) {
      return { status: 'error', code: 'UNKNOWN', message: String(error) };
    }
  }

  async proposeEdit(edit: MemoryEdit): Promise<MemoryWriteProposalResult> {
    try {
      const currentContent = await readFile(edit.filePath, 'utf8');
      const baseHash = sha256(currentContent);
      const patch = this.createPatch(edit.filePath, currentContent, edit.text, baseHash);
      return {
        status: 'ok',
        proposal: {
          scope: edit.scope,
          filePath: edit.filePath,
          patch,
          diff: this.generateDiff(currentContent, edit.text)
        }
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        return { status: 'error', code: 'FILE_NOT_FOUND', message: 'Memory file not found.' };
      }
      return { status: 'error', code: 'UNKNOWN', message: String(error) };
    }
  }
  async applyEdit(proposal: MemoryChangeProposal): Promise<MemoryApplyResult> {
    try {
      const currentContent = await readFile(proposal.filePath, "utf8");
      const currentHash = sha256(currentContent);

      // Conflict detection: hash mismatch
      if (currentHash !== proposal.patch.baseHash) {
        // For memory files, full replacement — attempt auto-merge via line-based diff
        const merged = this.tryAutoMergeMemory(currentContent, proposal.patch);
        if (merged !== null) {
          const entry = await this.write(proposal.scope, proposal.filePath, merged);
          return { status: "ok", entry, autoMerged: true };
        }
        return {
          status: "error",
          code: "CONFLICT",
          message: `Plik ${proposal.filePath} został zmodyfikowany od momentu propozycji (hash mismatch).`,
          conflict: {
            id: `mem-conflict-${sha256(proposal.patch.id + currentHash).slice(0, 16)}`,
            kind: "memory-conflict",
            proposalId: proposal.patch.id,
            filePath: proposal.filePath,
            description: `Plik pamięci ${proposal.filePath} został zmodyfikowany od momentu utworzenia propozycji.`,
            riskLevel: proposal.patch.riskLevel,
            createdAt: Date.now()
          }
        };
      }

      // No conflict — apply directly
      const newContent = this.extractNewContent(proposal.patch);
      const entry = await this.write(proposal.scope, proposal.filePath, newContent);
      return { status: "ok", entry };
    } catch (error) {
      if (isMissingFileError(error)) {
        return { status: "error", code: "FILE_NOT_FOUND", message: "Plik pamięci nie znaleziony." };
      }
      return { status: "error", code: "UNKNOWN", message: String(error) };
    }
  }

  generateDiff(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diff: string[] = [];
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i] ?? '';
      const newLine = newLines[i] ?? '';
      if (oldLine === newLine) {
        diff.push(` ${oldLine}`);
      } else {
        if (i < oldLines.length) diff.push(`-${oldLine}`);
        if (i < newLines.length) diff.push(`+${newLine}`);
      }
    }
    return diff.join('\n');
  }

  private extractNewContent(patch: PatchSet): string {
    if (patch.operations.length === 0) return '';
    const fullReplacement = patch.operations.find(op => !op.range);
    if (fullReplacement) return fullReplacement.text;
    return patch.operations.at(-1)?.text ?? '';
  }

  private tryAutoMergeMemory(currentContent: string, patch: PatchSet): string | null {
    const newContent = this.extractNewContent(patch);
    // Simple auto-merge: if current content is a subset of new (append-only), allow
    if (newContent.includes(currentContent)) return newContent;
    // If new content is a subset of current (truncation), allow
    if (currentContent.includes(newContent)) return newContent;
    // Otherwise, conflict — cannot auto-merge
    return null;
  }


  async write(scope: MemoryScope, filePath: string, content: string): Promise<MemoryEntry> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, redactSecrets(content), 'utf8');
    return this.describeEntry(scope, filePath, content);
  }

  describeEntry(scope: MemoryScope, filePath: string, content: string): MemoryEntry {
    const title = extractMarkdownTitle(content);
    const now = Date.now();
    return {
      id: memoryId(scope, filePath),
      scope,
      filePath,
      title,
      checksum: sha256(content),
      sourceKind: 'markdown',
      createdSource: 'user',
      createdAt: now,
      updatedAt: now,
      tags: extractMarkdownTags(content)
    };
  }

  private createPatch(filePath: string, currentContent: string, newContent: string, baseHash: string): PatchSet {
    const operations: PatchOperation[] = currentContent === newContent
      ? []
      : [
          {
            filePath,
            text: newContent,
            contextBefore: [],
            contextAfter: []
          }
        ];
    const patchIdInput = [filePath, baseHash, newContent].join(':');

    return {
      id: `mem-${sha256(patchIdInput).slice(0, 16)}`,
      filePath,
      baseHash,
      operations,
      author: this.author,
      riskLevel: this.riskLevel,
      createdAt: Date.now()
    };
  }
}

async function collectMarkdownEntries(root: string, scope?: MemoryScope): Promise<MemoryEntry[]> {
  const { readdir, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const entries: MemoryEntry[] = [];

  async function walk(current: string): Promise<void> {
    const names = await readdir(current);
    for (const name of names) {
      const fullPath = join(current, name);
      const info = await stat(fullPath);
      if (info.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!name.endsWith('.md')) continue;
      const content = await readFile(fullPath, 'utf8');
      const entryScope = scope ?? inferScope(root, fullPath);
      entries.push(memoryEntryFromContent(entryScope, fullPath, content));
    }
  }

  try {
    await walk(root);
  } catch {
    return [];
  }

  return entries.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

function memoryEntryFromContent(scope: MemoryScope, filePath: string, content: string): MemoryEntry {
  return {
    id: memoryId(scope, filePath),
    scope,
    filePath,
    title: extractMarkdownTitle(content),
    checksum: sha256(content),
    sourceKind: 'markdown',
    createdSource: 'user',
    createdAt: 0,
    updatedAt: 0,
    tags: extractMarkdownTags(content)
  };
}

function inferScope(root: string, filePath: string): MemoryScope {
  const normalizedRoot = root.replaceAll('\\', '/');
  const normalizedFile = filePath.replaceAll('\\', '/');
  const relative = normalizedFile.slice(normalizedRoot.length + 1);
  if (relative.startsWith('workspace/')) return 'workspace';
  if (relative.startsWith('repo/')) return 'repo';
  return 'user';
}

function memoryId(scope: MemoryScope, filePath: string): string {
  return `${scope}-${sha256(filePath).slice(0, 16)}`;
}

function extractMarkdownTitle(content: string): string {
  const match = /^#{1,6}\s+([^\n\r#]{1,120})/m.exec(content);
  return match?.[1]?.trim() ?? 'Untitled memory';
}

function extractMarkdownTags(content: string): string[] {
  const match = /(?:^|\n)\s*tags\s*:\s*([^\n\r;]{1,120})/i.exec(content);
  if (!match?.[1]) return [];
  return match[1]
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}