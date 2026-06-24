import { createHash } from 'node:crypto';
import { extname, relative } from 'node:path';
import type { MemoryScope } from '@agentdeck/shared';

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

export function deterministicChunkId(filePath: string, language: string, startLine: number, text: string): string {
  const chunkInput = [filePath, language, startLine, text].join(':');
  return `chunk-${sha256(chunkInput).slice(0, 24)}`;
}

export function deterministicChecksum(language: string, startLine: number, text: string): string {
  const checksumInput = [language, startLine, text].join(':');
  return sha256(checksumInput);
}

export function relativePath(root: string, filePath: string): string {
  return relative(root, filePath).replaceAll('\\', '/');
}

export function inferScopeFromPath(root: string): MemoryScope | undefined {
  const normalizedRoot = normalizePath(root);
  if (normalizedRoot.endsWith('/repo')) return 'repo';
  if (normalizedRoot.endsWith('/workspace')) return 'workspace';
  if (normalizedRoot.endsWith('/user')) return 'user';
  return undefined;
}

export function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/$/, '');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
