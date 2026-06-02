import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import type {
  EditorDiagnostic,
  EditorLanguage,
  EditorTab,
  FileReadResult,
  FileWriteResult
} from '@agentdeck/shared';

// Map file extensions to Monaco language identifiers.
const EXTENSION_LANGUAGE_MAP: Record<string, EditorLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.cts': 'typescript',
  '.mts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.cjs': 'javascript',
  '.mjs': 'javascript',
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.psd1': 'powershell',
  '.txt': 'plaintext'
};

export function resolveLanguage(filePath: string): EditorLanguage {
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] ?? 'plaintext';
}

export function createTabId(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex').slice(0, 12);
}

export function createEditorTab(filePath: string): EditorTab {
  return {
    id: createTabId(filePath),
    filePath,
    fileName: basename(filePath),
    language: resolveLanguage(filePath),
    isDirty: false,
    isPinned: false
  };
}

// In-memory store for open editor tabs and their dirty state.
// Maps filePath -> { content, hash, isDirty }
type EditorBuffer = {
  content: string;
  hash: string;
  isDirty: boolean;
};

const editorBuffers = new Map<string, EditorBuffer>();

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function readEditorFile(filePath: string): Promise<FileReadResult> {
  try {
    const content = await readFile(filePath, 'utf8');
    const hash = computeHash(content);
    editorBuffers.set(filePath, { content, hash, isDirty: false });
    return { status: 'ok', content, encoding: 'utf8' };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return { status: 'error', code: 'FILE_NOT_FOUND', message: `File not found: ${filePath}` };
    }
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return { status: 'error', code: 'ACCESS_DENIED', message: `Access denied: ${filePath}` };
    }
    return { status: 'error', code: 'UNKNOWN', message: err.message ?? 'Unknown error' };
  }
}

export async function writeEditorFile(filePath: string, content: string): Promise<FileWriteResult> {
  const buffer = editorBuffers.get(filePath);

  // Check for write conflict: file on disk has changed since we last read it.
  if (buffer) {
    try {
      const diskContent = await readFile(filePath, 'utf8');
      const diskHash = computeHash(diskContent);
      if (diskHash !== buffer.hash) {
        return {
          status: 'error',
          code: 'WRITE_CONFLICT',
          message: `File ${filePath} has been modified on disk since it was opened.`
        };
      }
    } catch {
      // File may have been deleted on disk � allow write (recreate).
    }
  }

  try {
    await writeFile(filePath, content, 'utf8');
    const hash = computeHash(content);
    editorBuffers.set(filePath, { content, hash, isDirty: false });
    return { status: 'ok' };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return { status: 'error', code: 'ACCESS_DENIED', message: `Access denied: ${filePath}` };
    }
    return { status: 'error', code: 'UNKNOWN', message: err.message ?? 'Unknown error' };
  }
}

export function markBufferDirty(filePath: string): void {
  const buffer = editorBuffers.get(filePath);
  if (buffer) {
    buffer.isDirty = true;
  }
}

export function getBufferDirty(filePath: string): boolean {
  return editorBuffers.get(filePath)?.isDirty ?? false;
}

export function closeBuffer(filePath: string): void {
  editorBuffers.delete(filePath);
}

export function getOpenBuffers(): readonly string[] {
  return Array.from(editorBuffers.keys());
}

// Minimal diagnostics stub � returns empty array.
// LSP integration will replace this in a later phase.
export async function getDiagnostics(): Promise<readonly EditorDiagnostic[]> {
  return [];
}

// Clear all buffers � useful for testing.
export function clearBuffers(): void {
  editorBuffers.clear();
}

