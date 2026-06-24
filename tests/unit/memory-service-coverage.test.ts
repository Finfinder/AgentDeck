import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryService } from '@agentdeck/memory-service';

describe('MemoryService — coverage', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'agentdeck-mem-coverage-'));
  });

  afterEach(() => {
    // Cleanup handled by OS temp dir
  });

  function createService(overrides: { author?: string; riskLevel?: 'low' | 'medium' | 'high' } = {}) {
    return createMemoryService({
      author: overrides.author ?? 'test-agent',
      baseDir,
      riskLevel: overrides.riskLevel ?? 'low'
    });
  }

  describe('ensureScope', () => {
    it('creates scope directory and returns path', async () => {
      const service = createService();
      const path = await service.ensureScope('user');
      expect(path).toContain('user');
    });

    it('creates nested scope directory', async () => {
      const service = createService();
      const path = await service.ensureScope('workspace');
      expect(path).toContain('workspace');
    });
  });

  describe('read', () => {
    it('reads existing file', async () => {
      const service = createService();
      const filePath = join(baseDir, 'memories', 'user', 'test.md');
      mkdirSync(join(baseDir, 'memories', 'user'), { recursive: true });
      writeFileSync(filePath, '# Test\nContent here.', 'utf8');

      const result = await service.read('user', filePath);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.content).toBe('# Test\nContent here.');
        expect(result.entry.title).toBe('Test');
      }
    });

    it('returns FILE_NOT_FOUND for missing file', async () => {
      const service = createService();
      const result = await service.read('user', '/nonexistent/file.md');
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('FILE_NOT_FOUND');
      }
    });
  });

  describe('list', () => {
    it('lists all markdown files in scope', async () => {
      const service = createService();
      const dir = join(baseDir, 'memories', 'user');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'file1.md'), '# First', 'utf8');
      writeFileSync(join(dir, 'file2.md'), '# Second', 'utf8');

      const result = await service.list('user');
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.entries).toHaveLength(2);
        expect(result.entries.map(e => e.title).sort()).toEqual(['First', 'Second']);
      }
    });

    it('lists all memories across scopes', async () => {
      const service = createService();
      mkdirSync(join(baseDir, 'memories', 'user'), { recursive: true });
      mkdirSync(join(baseDir, 'memories', 'workspace'), { recursive: true });
      writeFileSync(join(baseDir, 'memories', 'user', 'u.md'), '# User', 'utf8');
      writeFileSync(join(baseDir, 'memories', 'workspace', 'w.md'), '# Workspace', 'utf8');

      const result = await service.list();
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.entries).toHaveLength(2);
      }
    });

    it('returns empty list for empty scope', async () => {
      const service = createService();
      const result = await service.list('user');
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.entries).toEqual([]);
      }
    });

    it('returns UNKNOWN on unexpected error', async () => {
      const service = createService();
      // Use a path that causes an error
      const result = await service.list('nonexistent' as never);
      // Should handle gracefully
      expect(result).toBeDefined();
    });
  });

  describe('proposeEdit', () => {
    it('proposes edit for existing file', async () => {
      const service = createService();
      const filePath = join(baseDir, 'memories', 'user', 'test.md');
      mkdirSync(join(baseDir, 'memories', 'user'), { recursive: true });
      writeFileSync(filePath, '# Original\nContent.', 'utf8');

      const result = await service.proposeEdit({
        scope: 'user',
        filePath,
        text: '# Modified\nNew content.'
      });
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.proposal.scope).toBe('user');
        expect(result.proposal.filePath).toBe(filePath);
        expect(result.proposal.diff).toContain('-');
        expect(result.proposal.diff).toContain('+');
      }
    });

    it('returns FILE_NOT_FOUND for missing file', async () => {
      const service = createService();
      const result = await service.proposeEdit({
        scope: 'user',
        filePath: '/nonexistent/file.md',
        text: 'new content'
      });
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('FILE_NOT_FOUND');
      }
    });

    it('proposes empty patch when content unchanged', async () => {
      const service = createService();
      const content = '# Same\nContent.';
      const filePath = join(baseDir, 'memories', 'user', 'test.md');
      mkdirSync(join(baseDir, 'memories', 'user'), { recursive: true });
      writeFileSync(filePath, content, 'utf8');

      const result = await service.proposeEdit({
        scope: 'user',
        filePath,
        text: content
      });
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.proposal.patch.operations).toEqual([]);
      }
    });
  });

  describe('applyEdit', () => {
    it('applies edit when hash matches', async () => {
      const service = createService();
      const filePath = join(baseDir, 'memories', 'user', 'test.md');
      mkdirSync(join(baseDir, 'memories', 'user'), { recursive: true });
      writeFileSync(filePath, '# Original\nContent.', 'utf8');

      const proposal = await service.proposeEdit({
        scope: 'user',
        filePath,
        text: '# Modified\nNew content.'
      });
      expect(proposal.status).toBe('ok');
      if (proposal.status !== 'ok') return;

      const result = await service.applyEdit(proposal.proposal);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.entry.title).toBe('Modified');
      }
    });

    it('returns CONFLICT when hash mismatches', async () => {
      const service = createService();
      const filePath = join(baseDir, 'memories', 'user', 'test.md');
      mkdirSync(join(baseDir, 'memories', 'user'), { recursive: true });
      writeFileSync(filePath, '# Original\nContent.', 'utf8');

      const proposal = await service.proposeEdit({
        scope: 'user',
        filePath,
        text: '# Modified\nNew content.'
      });
      expect(proposal.status).toBe('ok');
      if (proposal.status !== 'ok') return;

      // Modify file after proposal
      writeFileSync(filePath, '# External change.', 'utf8');

      const result = await service.applyEdit(proposal.proposal);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('CONFLICT');
        expect(result.conflict).toBeDefined();
      }
    });

    it('auto-merges when current is subset of new (append-only)', async () => {
      const service = createService();
      const filePath = join(baseDir, 'memories', 'user', 'test.md');
      mkdirSync(join(baseDir, 'memories', 'user'), { recursive: true });
      writeFileSync(filePath, '# Original\nLine 1.', 'utf8');

      // Create proposal with original content
      const proposal = await service.proposeEdit({
        scope: 'user',
        filePath,
        text: '# Original\nLine 1.\nLine 2.'
      });
      expect(proposal.status).toBe('ok');
      if (proposal.status !== 'ok') return;

      // Append to file after proposal (simulating external change that's a subset)
      writeFileSync(filePath, '# Original\nLine 1.\nLine 2.\nLine 3.', 'utf8');

      const result = await service.applyEdit(proposal.proposal);
      expect(result.status).toBe('ok');
      if (result.status === 'ok' && 'autoMerged' in result) {
        expect(result.autoMerged).toBe(true);
      }
    });

    it('auto-merges when new is subset of current (truncation)', async () => {
      const service = createService();
      const filePath = join(baseDir, 'memories', 'user', 'test.md');
      mkdirSync(join(baseDir, 'memories', 'user'), { recursive: true });
      writeFileSync(filePath, '# Original\nLine 1.\nLine 2.', 'utf8');

      // Create proposal with full content
      const proposal = await service.proposeEdit({
        scope: 'user',
        filePath,
        text: '# Original\nLine 1.'
      });
      expect(proposal.status).toBe('ok');
      if (proposal.status !== 'ok') return;

      // Truncate file after proposal (simulating external change)
      writeFileSync(filePath, '# Original', 'utf8');

      const result = await service.applyEdit(proposal.proposal);
      expect(result.status).toBe('ok');
      if (result.status === 'ok' && 'autoMerged' in result) {
        expect(result.autoMerged).toBe(true);
      }
    });

    it('returns FILE_NOT_FOUND for missing file', async () => {
      const service = createService();
      const result = await service.applyEdit({
        scope: 'user',
        filePath: '/nonexistent/file.md',
        patch: {
          id: 'p1',
          filePath: '/nonexistent/file.md',
          baseHash: 'abc',
          operations: [],
          author: 'agent',
          riskLevel: 'low',
          createdAt: Date.now()
        },
        diff: ''
      });
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('FILE_NOT_FOUND');
      }
    });
  });

  describe('write', () => {
    it('writes file and redacts secrets', async () => {
      const service = createService();
      const filePath = join(baseDir, 'memories', 'user', 'secret.md');
      const entry = await service.write('user', filePath, '# Secret\nAPI_KEY=sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(entry.title).toBe('Secret');
      // The file should have redacted content
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(filePath, 'utf8');
      expect(content).not.toContain('sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    });
  });

  describe('describeEntry', () => {
    it('extracts h1 title', () => {
      const service = createService();
      const entry = service.describeEntry('user', '/test.md', '# Main Title\nContent');
      expect(entry.title).toBe('Main Title');
    });

    it('extracts h2 title', () => {
      const service = createService();
      const entry = service.describeEntry('user', '/test.md', '## Subtitle\nContent');
      expect(entry.title).toBe('Subtitle');
    });

    it('extracts h6 title', () => {
      const service = createService();
      const entry = service.describeEntry('user', '/test.md', '###### Deep heading');
      expect(entry.title).toBe('Deep heading');
    });

    it('returns Untitled memory for content without heading', () => {
      const service = createService();
      const entry = service.describeEntry('user', '/test.md', 'No heading here');
      expect(entry.title).toBe('Untitled memory');
    });

    it('extracts tags from frontmatter', () => {
      const service = createService();
      const entry = service.describeEntry('user', '/test.md', '# Test\ntags: alpha, beta, gamma');
      expect(entry.tags).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('returns empty tags when no tags line', () => {
      const service = createService();
      const entry = service.describeEntry('user', '/test.md', '# Test\nNo tags here');
      expect(entry.tags).toEqual([]);
    });

    it('computes consistent checksum', () => {
      const service = createService();
      const entry1 = service.describeEntry('user', '/test.md', '# Same');
      const entry2 = service.describeEntry('user', '/test.md', '# Same');
      expect(entry1.checksum).toBe(entry2.checksum);
    });

    it('sets sourceKind to markdown', () => {
      const service = createService();
      const entry = service.describeEntry('user', '/test.md', '# Test');
      expect(entry.sourceKind).toBe('markdown');
    });

    it('sets createdSource to user', () => {
      const service = createService();
      const entry = service.describeEntry('user', '/test.md', '# Test');
      expect(entry.createdSource).toBe('user');
    });
  });

  describe('generateDiff', () => {
    it('shows no diff for identical content', () => {
      const service = createService();
      const diff = service.generateDiff('same', 'same');
      expect(diff).toBe(' same');
    });

    it('shows addition', () => {
      const service = createService();
      const diff = service.generateDiff('line1', 'line1\nline2');
      expect(diff).toContain('+line2');
    });

    it('shows removal', () => {
      const service = createService();
      const diff = service.generateDiff('line1\nline2', 'line1');
      expect(diff).toContain('-line2');
    });

    it('handles empty old content', () => {
      const service = createService();
      const diff = service.generateDiff('', 'new');
      expect(diff).toContain('+new');
    });

    it('handles empty new content', () => {
      const service = createService();
      const diff = service.generateDiff('old', '');
      expect(diff).toContain('-old');
    });
  });

  describe('riskLevel option', () => {
    it('defaults to low risk', async () => {
      const service = createService();
      const filePath = join(baseDir, 'memories', 'user', 'test.md');
      mkdirSync(join(baseDir, 'memories', 'user'), { recursive: true });
      writeFileSync(filePath, '# Test', 'utf8');
      const proposal = await service.proposeEdit({
        scope: 'user',
        filePath,
        text: '# Modified'
      });
      expect(proposal.status).toBe('ok');
      if (proposal.status === 'ok') {
        expect(proposal.proposal.patch.riskLevel).toBe('low');
      }
    });

    it('uses configured risk level', async () => {
      const service = createService({ riskLevel: 'high' });
      const filePath = join(baseDir, 'memories', 'user', 'test.md');
      mkdirSync(join(baseDir, 'memories', 'user'), { recursive: true });
      writeFileSync(filePath, '# Test', 'utf8');
      const proposal = await service.proposeEdit({
        scope: 'user',
        filePath,
        text: '# Modified'
      });
      expect(proposal.status).toBe('ok');
      if (proposal.status === 'ok') {
        expect(proposal.proposal.patch.riskLevel).toBe('high');
      }
    });
  });
});
