import { describe, expect, it } from 'vitest';

import {
  detectLanguage,
  deterministicChunkId,
  deterministicChecksum,
  relativePath,
  inferScopeFromPath,
  normalizePath
} from '@agentdeck/code-indexer';

describe('detectLanguage', () => {
  it('returns "typescript" for .ts files', () => {
    expect(detectLanguage('src/app.ts')).toBe('typescript');
  });

  it('returns "tsx" for .tsx files', () => {
    expect(detectLanguage('src/app.tsx')).toBe('tsx');
  });

  it('returns "javascript" for .js files', () => {
    expect(detectLanguage('src/app.js')).toBe('javascript');
  });

  it('returns "json" for .json files', () => {
    expect(detectLanguage('config.json')).toBe('json');
  });

  it('returns "yaml" for .yaml files', () => {
    expect(detectLanguage('config.yaml')).toBe('yaml');
  });

  it('returns "yaml" for .yml files', () => {
    expect(detectLanguage('config.yml')).toBe('yaml');
  });

  it('returns "markdown" for .md files', () => {
    expect(detectLanguage('README.md')).toBe('markdown');
  });

  it('returns "powershell" for .ps1 files', () => {
    expect(detectLanguage('script.ps1')).toBe('powershell');
  });

  it('returns "powershell" for .psm1 files', () => {
    expect(detectLanguage('module.psm1')).toBe('powershell');
  });

  it('returns "powershell" for .psd1 files', () => {
    expect(detectLanguage('manifest.psd1')).toBe('powershell');
  });

  it('returns "plaintext" for unknown extensions', () => {
    expect(detectLanguage('file.unknown')).toBe('plaintext');
  });

  it('returns "plaintext" for files without extension', () => {
    expect(detectLanguage('Makefile')).toBe('plaintext');
  });

  it('handles uppercase extensions', () => {
    expect(detectLanguage('FILE.TS')).toBe('typescript');
  });

  it('handles paths with directories', () => {
    expect(detectLanguage('/home/user/project/src/index.ts')).toBe('typescript');
  });
});

describe('deterministicChunkId', () => {
  it('returns a string starting with "chunk-"', () => {
    const id = deterministicChunkId('src/app.ts', 'typescript', 0, 'const x = 1;');
    expect(id).toMatch(/^chunk-/);
  });

  it('returns the same ID for the same inputs', () => {
    const id1 = deterministicChunkId('src/app.ts', 'typescript', 0, 'const x = 1;');
    const id2 = deterministicChunkId('src/app.ts', 'typescript', 0, 'const x = 1;');
    expect(id1).toBe(id2);
  });

  it('returns different IDs for different file paths', () => {
    const id1 = deterministicChunkId('src/app.ts', 'typescript', 0, 'const x = 1;');
    const id2 = deterministicChunkId('src/other.ts', 'typescript', 0, 'const x = 1;');
    expect(id1).not.toBe(id2);
  });

  it('returns different IDs for different start lines', () => {
    const id1 = deterministicChunkId('src/app.ts', 'typescript', 0, 'const x = 1;');
    const id2 = deterministicChunkId('src/app.ts', 'typescript', 5, 'const x = 1;');
    expect(id1).not.toBe(id2);
  });

  it('returns different IDs for different text content', () => {
    const id1 = deterministicChunkId('src/app.ts', 'typescript', 0, 'const x = 1;');
    const id2 = deterministicChunkId('src/app.ts', 'typescript', 0, 'const y = 2;');
    expect(id1).not.toBe(id2);
  });

  it('produces a 28-character hash suffix (chunk- + 24 hex chars)', () => {
    const id = deterministicChunkId('src/app.ts', 'typescript', 0, 'const x = 1;');
    expect(id).toHaveLength(30); // "chunk-" (6) + 24 hex chars
  });
});



describe('relativePath', () => {
  it('returns relative path with forward slashes', () => {
    const result = relativePath('/home/user/project', '/home/user/project/src/app.ts');
    expect(result).toBe('src/app.ts');
  });

  it('converts backslashes to forward slashes', () => {
    const result = relativePath('C:\\project', 'C:\\project\\src\\app.ts');
    expect(result).toBe('src/app.ts');
  });
});

describe('deterministicChecksum', () => {
  it('returns a hex string', () => {
    const checksum = deterministicChecksum('typescript', 0, 'const x = 1;');
    expect(checksum).toMatch(/^[0-9a-f]+$/);
  });

  it('returns the same checksum for the same inputs', () => {
    const c1 = deterministicChecksum('typescript', 0, 'const x = 1;');
    const c2 = deterministicChecksum('typescript', 0, 'const x = 1;');
    expect(c1).toBe(c2);
  });

  it('returns different checksums for different languages', () => {
    const c1 = deterministicChecksum('typescript', 0, 'const x = 1;');
    const c2 = deterministicChecksum('javascript', 0, 'const x = 1;');
    expect(c1).not.toBe(c2);
  });

  it('returns different checksums for different text', () => {
    const c1 = deterministicChecksum('typescript', 0, 'const x = 1;');
    const c2 = deterministicChecksum('typescript', 0, 'const y = 2;');
    expect(c1).not.toBe(c2);
  });

  it('returns different checksums for different start lines', () => {
    const c1 = deterministicChecksum('typescript', 0, 'const x = 1;');
    const c2 = deterministicChecksum('typescript', 5, 'const x = 1;');
    expect(c1).not.toBe(c2);
  });
});

describe('inferScopeFromPath', () => {
  it('returns "repo" for path ending with /repo', () => {
    expect(inferScopeFromPath('/data/repo')).toBe('repo');
  });

  it('returns "workspace" for path ending with /workspace', () => {
    expect(inferScopeFromPath('/data/workspace')).toBe('workspace');
  });

  it('returns "user" for path ending with /user', () => {
    expect(inferScopeFromPath('/data/user')).toBe('user');
  });

  it('returns undefined for other paths', () => {
    expect(inferScopeFromPath('/data/other')).toBeUndefined();
  });

  it('handles trailing slash in path', () => {
    expect(inferScopeFromPath('/data/repo/')).toBe('repo');
  });

  it('handles Windows-style paths with backslashes', () => {
    expect(inferScopeFromPath('C:\\data\\repo')).toBe('repo');
  });

  it('returns undefined for path with no recognized scope', () => {
    expect(inferScopeFromPath('/home/user/projects')).toBeUndefined();
  });

  it('returns "repo" for deeply nested repo path', () => {
    expect(inferScopeFromPath('/home/user/workspace/myproject/repo')).toBe('repo');
  });
});

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('C:\\Users\\project')).toBe('C:/Users/project');
  });

  it('removes trailing slash', () => {
    expect(normalizePath('/src/components/')).toBe('/src/components');
  });

  it('preserves path without trailing slash', () => {
    expect(normalizePath('/src/components')).toBe('/src/components');
  });

  it('handles empty string', () => {
    expect(normalizePath('')).toBe('');
  });

  it('handles root path (single slash) — removes the only slash', () => {
    // The regex /\/$/ removes the trailing slash, leaving empty string
    expect(normalizePath('/')).toBe('');
  });

  it('removes one trailing slash', () => {
    expect(normalizePath('/src/')).toBe('/src');
  });

  it('does not remove non-trailing slashes', () => {
    expect(normalizePath('/src/components')).toBe('/src/components');
  });

  it('handles mixed slashes', () => {
    expect(normalizePath('C:\\Users\\project/src')).toBe('C:/Users/project/src');
  });
});


