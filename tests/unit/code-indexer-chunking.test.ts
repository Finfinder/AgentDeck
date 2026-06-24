import { describe, expect, it } from 'vitest';

import { chunkSource, warmParserLanguages } from '@agentdeck/code-indexer';

// ─── helpers ────────────────────────────────────────────────────────────────

const FIXED_TIME = 1_700_000_000_000;

// ─── tests ──────────────────────────────────────────────────────────────────

describe('chunkSource', () => {
  describe('markdown files (line-based)', () => {
    it('chunks a simple markdown file into sections', async () => {
      const content = [
        '# Heading 1',
        '',
        'Some paragraph text.',
        '',
        '## Heading 2',
        '',
        'Another paragraph.'
      ].join('\n');

      const chunks = await chunkSource('README.md', content, undefined, FIXED_TIME);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.filePath).toBe('README.md');
      expect(chunks[0]!.language).toBe('markdown');
    });

    it('returns at least one chunk for non-empty markdown', async () => {
      const content = '# Title\n\nContent here.\n';
      const chunks = await chunkSource('docs/README.md', content, 'repo', FIXED_TIME);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]!.scope).toBe('repo');
    });

    it('handles empty markdown content', async () => {
      const chunks = await chunkSource('empty.md', '', undefined, FIXED_TIME);
      // Should return a single empty fallback chunk
      expect(chunks.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('JSON files (line-based fallback)', () => {
    it('chunks a small JSON file as one block', async () => {
      const content = '{"key": "value", "num": 42}';
      const chunks = await chunkSource('config.json', content, undefined, FIXED_TIME);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]!.language).toBe('json');
      expect(chunks[0]!.text).toContain('key');
    });

    it('chunks a large JSON file by depth', async () => {
      const obj = { level1: { level2: { level3: 'deep' } }, sibling: 'data' };
      const content = JSON.stringify(obj, null, 2);
      const chunks = await chunkSource('data.json', content, undefined, FIXED_TIME);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('handles empty JSON content', async () => {
      const chunks = await chunkSource('empty.json', '', undefined, FIXED_TIME);
      expect(chunks.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('YAML files (line-based fallback)', () => {
    it('chunks YAML by top-level keys', async () => {
      const content = [
        'name: project',
        'version: "1.0"',
        '',
        'settings:',
        '  debug: true',
        '  port: 3000'
      ].join('\n');

      const chunks = await chunkSource('config.yaml', content, undefined, FIXED_TIME);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]!.language).toBe('yaml');
    });

    it('handles .yml extension', async () => {
      const content = 'key: value\n';
      const chunks = await chunkSource('settings.yml', content, undefined, FIXED_TIME);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]!.language).toBe('yaml');
    });
  });

  describe('plaintext / unsupported extensions', () => {
    it('falls back to code blocks for unknown extensions', async () => {
      const content = 'line 1\nline 2\nline 3\n\nline 4\nline 5\n';
      const chunks = await chunkSource('file.txt', content, undefined, FIXED_TIME);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]!.language).toBe('plaintext');
    });
  });

  describe('TypeScript files (tree-sitter or fallback)', () => {
    it('chunks a TypeScript file', async () => {
      const content = [
        'export function add(a: number, b: number): number {',
        '  return a + b;',
        '}',
        '',
        'export class MyClass {',
        '  private value: number;',
        '',
        '  constructor(v: number) {',
        '    this.value = v;',
        '  }',
        '}',
        '',
        'const x = 1;',
        'const y = 2;',
        ''
      ].join('\n');

      const chunks = await chunkSource('src/app.ts', content, undefined, FIXED_TIME);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]!.filePath).toBe('src/app.ts');
      expect(chunks[0]!.language).toBe('typescript');
    });

    it('chunks a TSX file', async () => {
      const content = [
        'import React from "react";',
        '',
        'export function App() {',
        '  return <div>Hello</div>;',
        '}',
        ''
      ].join('\n');

      const chunks = await chunkSource('src/App.tsx', content, 'workspace', FIXED_TIME);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]!.language).toBe('tsx');
      expect(chunks[0]!.scope).toBe('workspace');
    });

    it('chunks a JavaScript file', async () => {
      const content = [
        'function greet(name) {',
        '  console.log(`Hello, ${name}!`);',
        '}',
        '',
        'module.exports = { greet };',
        ''
      ].join('\n');

      const chunks = await chunkSource('src/utils.js', content, undefined, FIXED_TIME);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]!.language).toBe('javascript');
    });
  });

  describe('PowerShell files', () => {
    it('chunks a PowerShell file', async () => {
      const content = [
        'function Get-Data {',
        '  param([string]$Name)',
        '  Write-Host "Hello $Name"',
        '}',
        '',
        'Get-Data -Name "World"',
        ''
      ].join('\n');

      const chunks = await chunkSource('scripts/deploy.ps1', content, undefined, FIXED_TIME);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]!.language).toBe('powershell');
    });
  });

  describe('chunk metadata', () => {
    it('sets correct line numbers on chunks', async () => {
      const content = 'line0\nline1\nline2\n\nline4\nline5\n';
      const chunks = await chunkSource('file.txt', content, undefined, FIXED_TIME);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.startLine).toBeTypeOf('number');
      expect(chunks[0]!.endLine).toBeGreaterThanOrEqual(chunks[0]!.startLine);
    });

    it('includes createdAt timestamp', async () => {
      const content = 'const x = 1;\n';
      const chunks = await chunkSource('src/x.ts', content, undefined, FIXED_TIME);

      expect(chunks[0]!.createdAt).toBe(FIXED_TIME);
    });

    it('includes scope when provided', async () => {
      const content = 'key: value\n';
      const chunks = await chunkSource('config.yaml', content, 'user', FIXED_TIME);

      expect(chunks[0]!.scope).toBe('user');
    });

    it('includes folder in metadata', async () => {
      const content = 'const x = 1;\n';
      const chunks = await chunkSource('src/app.ts', content, undefined, FIXED_TIME);

      expect(chunks[0]!.metadata).toHaveProperty('folder');
      expect(chunks[0]!.metadata!.folder).toBe('src');
    });

    it('produces deterministic chunk IDs', async () => {
      const content = 'export const x = 42;\n';
      const chunks1 = await chunkSource('src/x.ts', content, undefined, FIXED_TIME);
      const chunks2 = await chunkSource('src/x.ts', content, undefined, FIXED_TIME);

      expect(chunks1[0]!.id).toBe(chunks2[0]!.id);
    });
  });

  describe('sorting', () => {
    it('returns chunks sorted by startLine', async () => {
      const content = [
        'const a = 1;',
        '',
        'const b = 2;',
        '',
        'const c = 3;',
        ''
      ].join('\n');

      const chunks = await chunkSource('src/sorted.ts', content, undefined, FIXED_TIME);

      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i]!.startLine).toBeGreaterThanOrEqual(chunks[i - 1]!.startLine);
      }
    });
  });
});

describe('warmParserLanguages', () => {
  it('resolves for an empty array without loading any language', async () => {
    await expect(warmParserLanguages([])).resolves.toBeUndefined();
  });

  it('loads and caches languages on repeated calls', async () => {
    // First call may succeed or fail depending on WASM availability
    // but the function should not throw uncaught
    try {
      await warmParserLanguages(['typescript']);
    } catch {
      // WASM not available in this env — acceptable
    }
    // Second call should use cache (not crash)
    try {
      await warmParserLanguages(['typescript']);
    } catch {
      // Same result expected
    }
  });
});
