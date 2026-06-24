import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createMemoryService, MemoryService } from '@agentdeck/memory-service';

describe('MemoryService', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'agentdeck-memory-service-'));

  describe('createMemoryService', () => {
    it('should create a MemoryService instance', () => {
      const service = createMemoryService({ author: 'test', baseDir });
      expect(service).toBeInstanceOf(MemoryService);
    });
  });

  describe('generateDiff', () => {
    it('should split and join real newlines', () => {
      const service = createMemoryService({ author: 'test', baseDir });
      const diff = service.generateDiff('line1\nline2', 'line1\nchanged');
      expect(diff).toBe(' line1\n-line2\n+changed');
      expect(diff).not.toContain(String.raw`\n`);
    });
  });

  describe('describeEntry', () => {
    it('should extract title from markdown content', () => {
      const service = createMemoryService({ author: 'test', baseDir });
      const entry = service.describeEntry('user', '/memory/test.md', '# Hello World\n\nSome content.');
      expect(entry.title).toBe('Hello World');
      expect(entry.scope).toBe('user');
      expect(entry.sourceKind).toBe('markdown');
    });

    it('should return Untitled memory when no heading', () => {
      const service = createMemoryService({ author: 'test', baseDir });
      const entry = service.describeEntry('workspace', '/memory/test.md', 'No heading here.');
      expect(entry.title).toBe('Untitled memory');
    });

    it('should extract tags from markdown content', () => {
      const service = createMemoryService({ author: 'test', baseDir });
      const entry = service.describeEntry('repo', '/memory/test.md', '# Test\ntags: foo, bar');
      expect(entry.tags).toEqual(['foo', 'bar']);
    });

    it('should compute checksum', () => {
      const service = createMemoryService({ author: 'test', baseDir });
      const entry1 = service.describeEntry('user', '/memory/test.md', '# Same');
      const entry2 = service.describeEntry('user', '/memory/test.md', '# Same');
      expect(entry1.checksum).toBe(entry2.checksum);
    });
  });
});
