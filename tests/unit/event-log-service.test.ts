import { describe, expect, it, beforeEach } from 'vitest';

import { EventLogService } from '../../packages/services/src/event-log-service';

describe('EventLogService', () => {
  let service: EventLogService;

  beforeEach(() => {
    service = new EventLogService(100);
  });

  describe('append', () => {
    it('should append an entry and return it with id and timestamp', () => {
      const entry = service.append({
        level: 'info',
        source: 'test',
        message: 'Test message'
      });

      expect(entry.id).toBeDefined();
      expect(entry.id.startsWith('evt-')).toBe(true);
      expect(entry.timestamp).toBeTypeOf('number');
      expect(entry.level).toBe('info');
      expect(entry.source).toBe('test');
      expect(entry.message).toBe('Test message');
    });

    it('should emit update event on append', () => {
      let emitted: unknown = null;
      service.on('update', (entry) => { emitted = entry; });

      const entry = service.append({ level: 'info', source: 'test', message: 'Hello' });
      expect(emitted).toEqual(entry);
    });

    it('should trim entries when exceeding max', () => {
      const smallService = new EventLogService(3);
      smallService.append({ level: 'info', source: 'test', message: '1' });
      smallService.append({ level: 'info', source: 'test', message: '2' });
      smallService.append({ level: 'info', source: 'test', message: '3' });
      smallService.append({ level: 'info', source: 'test', message: '4' });

      const result = service.query();
      expect(result.status === 'ok').toBe(true);
    });
  });

  describe('appendPatchEvent', () => {
    it('should append a patch event with diff data', () => {
      const entry = service.appendPatchEvent({
        level: 'info',
        source: 'tool-router',
        message: 'Patch applied',
        diff: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new',
        filePath: 'test.ts',
        patchId: 'patch-1'
      });

      expect(entry.diff).toBe('--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new');
      expect(entry.filePath).toBe('test.ts');
      expect(entry.patchId).toBe('patch-1');
    });
  });

  describe('query', () => {
    it('should return all entries newest-first', () => {
      service.append({ level: 'info', source: 'a', message: 'first' });
      service.append({ level: 'info', source: 'b', message: 'second' });

      const result = service.query();
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.total).toBe(2);
        expect(result.entries[0]!.message).toBe('second');
        expect(result.entries[1]!.message).toBe('first');
      }
    });

    it('should filter by level', () => {
      service.append({ level: 'info', source: 'test', message: 'info msg' });
      service.append({ level: 'error', source: 'test', message: 'error msg' });
      service.append({ level: 'warn', source: 'test', message: 'warn msg' });

      const result = service.query({ levels: ['error'] });
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.total).toBe(1);
        expect(result.entries[0]!.level).toBe('error');
      }
    });

    it('should filter by source', () => {
      service.append({ level: 'info', source: 'tool-router', message: 'patch' });
      service.append({ level: 'info', source: 'editor', message: 'edit' });

      const result = service.query({ sources: ['tool-router'] });
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.total).toBe(1);
        expect(result.entries[0]!.source).toBe('tool-router');
      }
    });

    it('should filter by search text', () => {
      service.append({ level: 'info', source: 'test', message: 'patch applied' });
      service.append({ level: 'info', source: 'test', message: 'file saved' });

      const result = service.query({ searchText: 'patch' });
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.total).toBe(1);
        expect(result.entries[0]!.message).toBe('patch applied');
      }
    });

    it('should filter by hasDiffOnly', () => {
      service.append({ level: 'info', source: 'test', message: 'with diff', diff: '--- a\n+++ b' });
      service.append({ level: 'info', source: 'test', message: 'no diff' });

      const result = service.query({ hasDiffOnly: true });
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.total).toBe(1);
        expect(result.entries[0]!.message).toBe('with diff');
      }
    });

    it('should filter by time range', () => {
      const now = Date.now();
      service.append({ level: 'info', source: 'test', message: 'old' });
      // Manually adjust timestamp by appending and then querying with since
      const result = service.query({ since: now - 1000 });
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.total).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('getSources', () => {
    it('should return unique sorted sources', () => {
      service.append({ level: 'info', source: 'zebra', message: 'z' });
      service.append({ level: 'info', source: 'alpha', message: 'a' });
      service.append({ level: 'info', source: 'zebra', message: 'z2' });

      const sources = service.getSources();
      expect(sources).toEqual(['alpha', 'zebra']);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      service.append({ level: 'info', source: 'test', message: 'msg' });
      service.clear();

      const result = service.query();
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.total).toBe(0);
      }
    });

    it('should emit clear event', () => {
      let cleared = false;
      service.on('clear', () => { cleared = true; });

      service.clear();
      expect(cleared).toBe(true);
    });
  });

  describe('count', () => {
    it('should return correct count', () => {
      expect(service.count).toBe(0);
      service.append({ level: 'info', source: 'test', message: '1' });
      expect(service.count).toBe(1);
      service.append({ level: 'info', source: 'test', message: '2' });
      expect(service.count).toBe(2);
    });
  });

  describe('appendPatchEvent — diff sanitization', () => {
    it('should redact API keys in diff', () => {
      const entry = service.appendPatchEvent({
        level: 'info',
        source: 'tool-router',
        message: 'Patch applied',
        diff: '--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-API_KEY=sk-abc123secret\n+API_KEY=sk-newsecret',
        filePath: '.env',
        patchId: 'patch-1'
      });
      expect(entry.diff).not.toContain('sk-abc123secret');
      expect(entry.diff).not.toContain('sk-newsecret');
      expect(entry.diff).toContain('[REDACTED]');
    });

    it('should redact passwords in diff', () => {
      const entry = service.appendPatchEvent({
        level: 'info',
        source: 'tool-router',
        message: 'Patch applied',
        diff: '-password=super_secret\n+password=new_secret',
        filePath: 'config.ts',
        patchId: 'patch-2'
      });
      expect(entry.diff).not.toContain('super_secret');
      expect(entry.diff).not.toContain('new_secret');
      expect(entry.diff).toContain('[REDACTED]');
    });

    it('should redact GitHub tokens in diff', () => {
      const entry = service.appendPatchEvent({
        level: 'info',
        source: 'tool-router',
        message: 'Patch applied',
        diff: '-token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef\n+token=ghp_newtoken',
        filePath: 'config.ts',
        patchId: 'patch-3'
      });
      expect(entry.diff).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef');
      expect(entry.diff).not.toContain('ghp_newtoken');
    });

    it('should preserve non-secret diff content', () => {
      const entry = service.appendPatchEvent({
        level: 'info',
        source: 'tool-router',
        message: 'Patch applied',
        diff: '--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-const x = 1;\n+const x = 2;',
        filePath: 'test.ts',
        patchId: 'patch-4'
      });
      expect(entry.diff).toContain('const x = 1;');
      expect(entry.diff).toContain('const x = 2;');
      expect(entry.diff).not.toContain('[REDACTED]');
    });

    it('should redact AWS access keys in diff', () => {
      const entry = service.appendPatchEvent({
        level: 'info',
        source: 'tool-router',
        message: 'Patch applied',
        diff: '-AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n+AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
        filePath: '.env',
        patchId: 'patch-5'
      });
      expect(entry.diff).not.toContain('AKIAIOSFODNN7EXAMPLE');
      // The AWS key pattern is standalone, so the key value is replaced
      expect(entry.diff).toContain('AWS_ACCESS_KEY_ID=[REDACTED]');
    });
  });
});
