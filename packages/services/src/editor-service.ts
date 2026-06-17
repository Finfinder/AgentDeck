import { open, readFile, writeFile } from 'node:fs/promises';

// Cross-platform utilities that work in both Node and browser environments.
function pathBasename(p: string): string {
  const normalized = p.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? p : normalized.slice(idx + 1);
}

function pathExtname(p: string): string {
  const normalized = p.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('.');
  const slashIdx = normalized.lastIndexOf('/');
  if (idx === -1 || idx < slashIdx) return '';
  return normalized.slice(idx);
}

// Simple hash for tab IDs - works without node:crypto.
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.codePointAt(i) ?? 0;
    hash = ((hash << 5) - hash) + char;
    hash = Math.trunc(hash);
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

import type {
  DiffResult,
  EditorDiagnostic,
  EditorLanguage,
  EditorTab,
  FileReadResult,
  FileWriteResult,
  WorkspaceEditInput,
  WorkspaceEditResult
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
  '.py': 'python',
  '.pyw': 'python',
  '.pyi': 'python',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.h': 'c',
  '.c': 'c',
  '.cs': 'csharp',
  '.csx': 'csharp',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.htm': 'html',
  '.mako': 'html',
  '.ipynb': 'json',
  '.txt': 'plaintext'
};

// Map exact file names (no extension) to Monaco language identifiers.
const FILENAME_LANGUAGE_MAP: Record<string, EditorLanguage> = {
  'Dockerfile': 'dockerfile',
  'dockerfile': 'dockerfile',
  'Makefile': 'plaintext',
  'makefile': 'plaintext',
  'GNUmakefile': 'plaintext'
};

export function resolveLanguage(filePath: string): EditorLanguage {
  // First check by exact filename (e.g. Dockerfile, Makefile).
  const name = pathBasename(filePath);
  if (FILENAME_LANGUAGE_MAP[name]) {
    return FILENAME_LANGUAGE_MAP[name];
  }
  // Then check by extension.
  const ext = pathExtname(filePath).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] ?? 'plaintext';
}

export function createTabId(filePath: string): string {
  // Use a simple hash that works in both Node and browser environments.
  return simpleHash(filePath);
}

export function createEditorTab(filePath: string, line?: number, col?: number, pattern?: string, revealNonce?: number): EditorTab {
  return {
    id: createTabId(filePath),
    filePath,
    fileName: pathBasename(filePath),
    language: resolveLanguage(filePath),
    isDirty: false,
    isPinned: false,
    revealLine: line ?? null,
    revealCol: col ?? null,
    revealPattern: pattern ?? null,
    revealNonce: revealNonce ?? 0
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
  return simpleHash(content);
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
      // File may have been deleted on disk - allow write (recreate).
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

export async function createEditorFile(filePath: string, content: string): Promise<FileWriteResult> {
  try {
    const handle = await open(filePath, 'wx');
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
    const hash = computeHash(content);
    editorBuffers.set(filePath, { content, hash, isDirty: false });
    return { status: 'ok' };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EEXIST') {
      return { status: 'error', code: 'WRITE_CONFLICT', message: `File already exists: ${filePath}` };
    }
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

// ?? WorkspaceEdit implementation ??
// Applies text edits to files. Each operation can target a specific range or replace entire file.
export async function applyWorkspaceEdit(operations: WorkspaceEditInput): Promise<WorkspaceEditResult> {
  for (const op of operations.operations) {
    const buffer = editorBuffers.get(op.filePath);
    if (!buffer) {
      return { status: 'error', code: 'FILE_NOT_FOUND', message: `File not found in buffers: ${op.filePath}` };
    }

    // Check for write conflict
    try {
      const diskContent = await readFile(op.filePath, 'utf8');
      const diskHash = computeHash(diskContent);
      if (diskHash !== buffer.hash) {
        return {
          status: 'error',
          code: 'WRITE_CONFLICT',
          message: `File ${op.filePath} has been modified on disk since it was opened.`
        };
      }
    } catch {
      // File may have been deleted on disk - allow write (recreate)
    }

    // Apply the edit
    let newContent: string;
    if (op.range) {
      const beforeRange = buffer.content.substring(0, getCharIndex(buffer.content, op.range.startLine, op.range.startCol));
      const afterRange = buffer.content.substring(getCharIndex(buffer.content, op.range.endLine, op.range.endCol));
      newContent = beforeRange + op.text + afterRange;
    } else {
      // Replace entire file content
      newContent = op.text;
    }

    // Write to disk
    try {
      await writeFile(op.filePath, newContent, 'utf8');
      const hash = computeHash(newContent);
      editorBuffers.set(op.filePath, { content: newContent, hash, isDirty: false });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        return { status: 'error', code: 'ACCESS_DENIED', message: `Access denied: ${op.filePath}` };
      }
      return { status: 'error', code: 'UNKNOWN', message: err.message ?? 'Unknown error' };
    }
  }

  return { status: 'ok' };
}

// Helper to convert line/col to character index (1-indexed line/col)
function getCharIndex(content: string, line: number, col: number): number {
  const lines = content.split('\n');
  let index = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    index += lines[i]!.length + 1; // +1 for newline
  }
  return index + col - 1;
}

// ?? Diff implementation ??
// Generates unified diff between original and modified content
export function showDiff(original: string, modified: string): DiffResult {
  try {
    const diff = generateUnifiedDiff(original, modified);
    return { status: 'ok', diff };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { status: 'error', code: 'UNKNOWN', message };
  }
}

// Simple unified diff generator
function generateUnifiedDiff(original: string, modified: string): string {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  const diffLines: string[] = ['--- original', '+++ modified'];

  let i = 0;
  let j = 0;
  let hunkStartOld = 1;
  let hunkStartNew = 1;

  while (i < originalLines.length || j < modifiedLines.length) {
    if (i < originalLines.length && j < modifiedLines.length && originalLines[i] === modifiedLines[j]) {
      i++;
      j++;
      hunkStartOld++;
      hunkStartNew++;
    } else if (j < modifiedLines.length && (i >= originalLines.length || originalLines[i] !== modifiedLines[j])) {
      // Addition
      diffLines.push(`@@ -${hunkStartOld},${i - hunkStartOld + 1} +${hunkStartNew},${modifiedLines.length - j} @@`);
      while (j < modifiedLines.length && (i >= originalLines.length || originalLines[i] !== modifiedLines[j])) {
        diffLines.push(`+${modifiedLines[j]}`);
        j++;
        hunkStartNew++;
      }
    } else if (i < originalLines.length) {
      // Deletion
      diffLines.push(`@@ -${hunkStartOld},${originalLines.length - i} +${hunkStartNew},${j - hunkStartNew} @@`);
      while (i < originalLines.length && (j >= modifiedLines.length || originalLines[i] !== modifiedLines[j])) {
        diffLines.push(`-${originalLines[i]}`);
        i++;
        hunkStartOld++;
      }
    }
  }

  return diffLines.join('\n');
}

// Minimal diagnostics stub - returns empty array.
// LSP integration will replace this in a later phase.
export async function getDiagnostics(): Promise<readonly EditorDiagnostic[]> {
  return [];
}

// Clear all buffers - useful for testing.
export function clearBuffers(): void {
  editorBuffers.clear();
}

