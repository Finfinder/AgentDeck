import { describe, expect, it, beforeEach } from 'vitest';

import { EventLogService } from '../../packages/services/src/event-log-service';
import { ConflictBroker } from '../../packages/services/src/conflict-broker';
import { PermissionBroker } from '../../packages/services/src/permission-broker';
import { ToolRouter } from '../../packages/services/src/tool-router';

describe('ToolRouter + EventLog integration', () => {
  let eventLog: EventLogService;
  let conflictBroker: ConflictBroker;
  let permissionBroker: PermissionBroker;
  let router: ToolRouter;

  beforeEach(() => {
    eventLog = new EventLogService();
    conflictBroker = new ConflictBroker();
    permissionBroker = new PermissionBroker({});
    router = new ToolRouter({
      workspaceRoots: ['/workspace'],
      permissionBroker,
      conflictBroker,
      eventLogService: eventLog
    });
  });

  describe('logPatchEvent', () => {
    it('should log patch events when eventLogService is provided', () => {
      // Access private method for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (router as any).logPatchEvent({
        level: 'info',
        message: 'Patch patch-123 zaproponowany dla /workspace/test.ts',
        diff: '--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new',
        filePath: '/workspace/test.ts',
        patchId: 'patch-123'
      });

      const result = eventLog.query();
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.total).toBe(1);
        expect(result.entries[0]!.source).toBe('tool-router');
        expect(result.entries[0]!.patchId).toBe('patch-123');
        expect(result.entries[0]!.diff).toContain('--- a/test.ts');
      }
    });

    it('should not throw when eventLogService is null', () => {
      const routerNoLog = new ToolRouter({
        workspaceRoots: ['/workspace'],
        permissionBroker,
        conflictBroker
      });

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (routerNoLog as any).logPatchEvent({
          level: 'info',
          message: 'test',
          diff: '',
          filePath: 'test.ts',
          patchId: 'p1'
        });
      }).not.toThrow();
    });
  });
});
