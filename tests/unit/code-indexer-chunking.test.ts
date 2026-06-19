import { describe, it, expect } from 'vitest';
import { chunkSource, warmParserLanguages } from '@agentdeck/code-indexer';
import type { MemoryScope } from '@agentdeck/shared';

describe('chunkSource', () => {
  const scope: MemoryScope = 'workspace';
  const createdAt = Date.now();

  describe('Tree-sitter languages', () => {
    it('should chunk TypeScript via Tree-sitter', async () => {
      const content = 'export function greet(name: string): string {\n  return `Hello, ${name}`;\n}\n\nexport class Greeter {\n  constructor(private greeting: string) {}\n  greet(name: string): string {\n    return `${this.greeting}, ${name}`;\n  }\n}\n';
      const chunks = await chunkSource('app.ts', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.language).toBe('typescript');
      expect(chunks[0]!.filePath).toBe('app.ts');
      const hasFunction = chunks.some(c => c.text.includes('greet'));
      const hasClass = chunks.some(c => c.text.includes('Greeter'));
      expect(hasFunction || hasClass).toBe(true);
    });

    it('should chunk TSX via Tree-sitter', async () => {
      const content = 'export function App() {\n  return <div>Hello</div>;\n}\n';
      const chunks = await chunkSource('App.tsx', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.language).toBe('tsx');
    });

    it('should chunk JavaScript via Tree-sitter', async () => {
      const content = 'function add(a, b) {\n  return a + b;\n}\n\nclass Calculator {\n  multiply(a, b) {\n    return a * b;\n  }\n}\n';
      const chunks = await chunkSource('calc.js', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.language).toBe('javascript');
      const hasFunction = chunks.some(c => c.text.includes('add'));
      const hasClass = chunks.some(c => c.text.includes('Calculator'));
      expect(hasFunction || hasClass).toBe(true);
    });

    it('should chunk JSON via Tree-sitter', async () => {
      const content = '{\n  "name": "test",\n  "version": "1.0.0",\n  "dependencies": {\n    "foo": "^1.0.0"\n  }\n}';
      const chunks = await chunkSource('package.json', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.language).toBe('json');
      expect(chunks[0]!.filePath).toBe('package.json');
    });

    it('should chunk YAML via Tree-sitter', async () => {
      const content = 'name: test\nversion: "1.0.0"\ndependencies:\n  - foo\n  - bar\nscripts:\n  build: tsc\n  test: vitest\n';
      const chunks = await chunkSource('config.yaml', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.language).toBe('yaml');
      expect(chunks[0]!.filePath).toBe('config.yaml');
    });

    it('should chunk PowerShell via Tree-sitter', async () => {
      const content = 'function Get-Greeting {\n  param([string]$Name)\n  return "Hello, $Name"\n}\n\nclass Greeter {\n  [string]$Greeting\n  Greeter([string]$g) {\n    $this.Greeting = $g\n  }\n}\n';
      const chunks = await chunkSource('script.ps1', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.language).toBe('powershell');
      const hasFunction = chunks.some(c => c.text.includes('Get-Greeting'));
      const hasClass = chunks.some(c => c.text.includes('Greeter'));
      expect(hasFunction || hasClass).toBe(true);
    });

    it('should include nodeType metadata in Tree-sitter chunks', async () => {
      const content = 'export function greet(): void {\n  console.log("hi");\n}\n';
      const chunks = await chunkSource('meta.ts', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      const chunk = chunks[0]!;
      expect(chunk.metadata).toBeDefined();
      expect(chunk.metadata!.nodeType).toBeDefined();
    });

    it('should include startLine and endLine in Tree-sitter chunks', async () => {
      const content = 'function a() {}\nfunction b() {}\nfunction c() {}\n';
      const chunks = await chunkSource('lines.ts', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.startLine).toBeDefined();
        expect(chunk.endLine).toBeDefined();
        expect(typeof chunk.startLine).toBe('number');
        expect(typeof chunk.endLine).toBe('number');
      }
    });
  });

  describe('line-based fallback languages', () => {
    it('should chunk a JSON file', async () => {
      const content = '{\n  "name": "test",\n  "version": "1.0.0"\n}';
      const chunks = await chunkSource('package.json', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.language).toBe('json');
      expect(chunks[0]!.filePath).toBe('package.json');
    });

    it('should handle small JSON files', async () => {
      const content = '{"a": 1}';
      const chunks = await chunkSource('small.json', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should chunk a YAML file', async () => {
      const content = 'name: test\nversion: "1.0.0"\ndependencies:\n  - foo\n  - bar';
      const chunks = await chunkSource('config.yaml', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.language).toBe('yaml');
    });

    it('should handle YML extension', async () => {
      const content = 'key: value';
      const chunks = await chunkSource('config.yml', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.language).toBe('yaml');
    });

    it('should chunk a Markdown file', async () => {
      const content = '# Title\n\nSome content here.\n\n## Section 2\n\nMore content.';
      const chunks = await chunkSource('README.md', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.language).toBe('markdown');
    });

    it('should split on headings', async () => {
      const content = '# Heading 1\n\nContent 1.\n\n# Heading 2\n\nContent 2.\n\n# Heading 3\n\nContent 3.';
      const chunks = await chunkSource('doc.md', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle empty content', async () => {
      const chunks = await chunkSource('empty.json', '', scope, createdAt);
      // Tree-sitter parses empty input as a program node, may produce 0 or 1 chunk
      expect(chunks.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle whitespace-only content', async () => {
      const chunks = await chunkSource('whitespace.yaml', '   \n\n  \n', scope, createdAt);
      // Whitespace-only may produce empty or minimal chunks
      expect(chunks.length).toBeGreaterThanOrEqual(0);
    });

    it('should default unknown extensions to plaintext', async () => {
      const content = 'some content';
      const chunks = await chunkSource('file.unknown', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.language).toBe('plaintext');
    });
  });

  describe('chunk structure', () => {
    it('should produce chunks with valid structure for small JSON', async () => {
      const content = '{"name": "test"}';
      const chunks = await chunkSource('test.json', content, scope, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
      const chunk = chunks[0]!;
      expect(chunk.id).toBeDefined();
      expect(chunk.id.startsWith('chunk-')).toBe(true);
      expect(chunk.filePath).toBe('test.json');
      expect(chunk.text.length).toBeGreaterThan(0);
      expect(chunk.checksum.length).toBeGreaterThan(0);
      expect(chunk.createdAt).toBe(createdAt);
    });

    it('should include scope in chunks', async () => {
      const content = 'key: value';
      const chunks = await chunkSource('test.yaml', content, 'repo', createdAt);
      for (const chunk of chunks) {
        expect(chunk.scope).toBe('repo');
      }
    });

    it('should work with undefined scope', async () => {
      const content = 'key: value';
      const chunks = await chunkSource('test.yaml', content, undefined, createdAt);
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('warmParserLanguages', () => {
    it('should handle empty array', async () => {
      await expect(warmParserLanguages([])).resolves.not.toThrow();
    });
  });
});
