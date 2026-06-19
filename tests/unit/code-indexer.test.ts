import { describe, it, expect } from 'vitest';
import { detectLanguage, deterministicChunkId, relativePath } from '@agentdeck/code-indexer';

describe('CodeIndexer utils', () => {
  describe('detectLanguage', () => {
    it('should detect TypeScript', () => {
      expect(detectLanguage('file.ts')).toBe('typescript');
    });

    it('should detect TSX', () => {
      expect(detectLanguage('file.tsx')).toBe('tsx');
    });

    it('should detect JavaScript', () => {
      expect(detectLanguage('file.js')).toBe('javascript');
    });

    it('should detect JSON', () => {
      expect(detectLanguage('file.json')).toBe('json');
    });

    it('should detect YAML', () => {
      expect(detectLanguage('file.yaml')).toBe('yaml');
      expect(detectLanguage('file.yml')).toBe('yaml');
    });

    it('should detect Markdown', () => {
      expect(detectLanguage('file.md')).toBe('markdown');
    });

    it('should detect PowerShell', () => {
      expect(detectLanguage('file.ps1')).toBe('powershell');
    });

    it('should default to plaintext', () => {
      expect(detectLanguage('file.unknown')).toBe('plaintext');
    });
  });

  describe('deterministicChunkId', () => {
    it('should generate consistent IDs', () => {
      const id1 = deterministicChunkId('file.ts', 'typescript', 0, 'const x = 1;');
      const id2 = deterministicChunkId('file.ts', 'typescript', 0, 'const x = 1;');
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different content', () => {
      const id1 = deterministicChunkId('file.ts', 'typescript', 0, 'const x = 1;');
      const id2 = deterministicChunkId('file.ts', 'typescript', 0, 'const y = 2;');
      expect(id1).not.toBe(id2);
    });

    it('should start with chunk-', () => {
      const id = deterministicChunkId('file.ts', 'typescript', 0, 'test');
      expect(id.startsWith('chunk-')).toBe(true);
    });
  });

  describe('relativePath', () => {
    it('should compute relative path', () => {
      const result = relativePath('/project', '/project/src/file.ts');
      expect(result).toBe('src/file.ts');
    });
  });
});
