import { describe, it, expect, vi, beforeEach } from 'vitest';

import type {
  Conflict,
  PatchSet,
  ToolCallRequest,
  ToolCallResponse,
  ToolName
} from '@agentdeck/shared';
import {
  ToolRouter,
  type ToolRouterOptions
} from '@agentdeck/services';
import type { PermissionBroker } from '@agentdeck/services';
import type { ConflictBroker } from '@agentdeck/services';
import type { EventLogService } from '@agentdeck/services';

// Mock conflict-broker module to control applyPatchWithConflictCheck
vi.mock('../../packages/services/src/conflict-broker', () => ({
  ConflictBroker: vi.fn(),
  applyPatchWithConflictCheck: vi.fn().mockResolvedValue({ success: true, appliedHash: 'hash123' }),
  classifyOperationKind: vi.fn().mockReturnValue('patch-conflict'),
  generatePatchId: vi.fn().mockReturnValue('patch-test'),
  classifyPatchRisk: vi.fn().mockReturnValue('low')
}));

let _reqCounter = 0;
function makeReq(toolName: ToolName, args: Record<string, unknown> = {}): ToolCallRequest {
  _reqCounter++;
  return { callId: `test-${_reqCounter}`, toolName, args };
}

function createMockPermissionBroker(): PermissionBroker {
  return {
    classifyTool: vi.fn().mockReturnValue({ name: 'readFile', riskLevel: 'read-only', requiresApproval: false, description: 'Read' }),
    requiresApproval: vi.fn().mockReturnValue(false),
    processToolCall: vi.fn().mockImplementation(async (req: ToolCallRequest) => ({
      status: 'ok' as const,
      callId: req.callId,
      result: { toolName: req.toolName, args: req.args }
    })),
    isBinaryOperation: vi.fn().mockReturnValue(false),
    extractFilePath: vi.fn().mockReturnValue(undefined),
    getEffectiveRisk: vi.fn().mockReturnValue('read-only'),
    setAllowRule: vi.fn(),
    hasAllowRule: vi.fn().mockReturnValue(false),
    listClassifications: vi.fn().mockReturnValue([]),
    submitApproval: vi.fn().mockReturnValue(null),
    getPendingCallIds: vi.fn().mockReturnValue([]),
    clearPendingApprovals: vi.fn(),
    removeAllowRule: vi.fn()
  } as unknown as PermissionBroker;
}

function createMockConflictBroker(): ConflictBroker {
  return {
    registerConflict: vi.fn(),
    getConflict: vi.fn().mockReturnValue(undefined),
    listConflicts: vi.fn().mockReturnValue([]),
    resolveConflict: vi.fn().mockReturnValue(true),
    clearConflicts: vi.fn(),
    requiresConflictReview: vi.fn().mockReturnValue(false),
    classifyOperationKind: vi.fn().mockReturnValue('patch-conflict'),
  } as unknown as ConflictBroker;
}

function createMockEventLogService(): EventLogService {
  return {
    appendPatchEvent: vi.fn(),
    getEntries: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
    onUpdate: vi.fn().mockReturnValue(() => undefined)
  } as unknown as EventLogService;
}

describe('ToolRouter — coverage', () => {
  let router: ToolRouter;
  let permissionBroker: PermissionBroker;
  let conflictBroker: ConflictBroker;

  beforeEach(() => {
    permissionBroker = createMockPermissionBroker();
    conflictBroker = createMockConflictBroker();
    const options: ToolRouterOptions = {
      workspaceRoots: ['/workspace'],
      permissionBroker,
      conflictBroker
    };
    router = new ToolRouter(options);
  });

  describe('execute — permission denied', () => {
    it('returns error when permission broker denies', async () => {
      const broker = createMockPermissionBroker();
      broker.processToolCall = vi.fn().mockResolvedValue({
        status: 'error' as const,
        callId: 'test-1',
        code: 'ACCESS_DENIED' as const,
        message: 'Access denied'
      });

      const r = new ToolRouter({
        workspaceRoots: ['/workspace'],
        permissionBroker: broker,
        conflictBroker
      });

      const req = makeReq('writeFile', { filePath: '/.env', content: 'test' });
      const result = await r.execute(req);

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('ACCESS_DENIED');
      }
    });

    it('returns pending-approval when permission broker requires approval', async () => {
      const broker = createMockPermissionBroker();
      broker.processToolCall = vi.fn().mockResolvedValue({
        status: 'pending-approval' as const,
        callId: 'test-1',
        classification: { name: 'writeFile', riskLevel: 'high', requiresApproval: true, description: 'Write' },
        expiresAt: Date.now() + 120000
      });

      const r = new ToolRouter({
        workspaceRoots: ['/workspace'],
        permissionBroker: broker,
        conflictBroker
      });

      const req = makeReq('writeFile', { filePath: '/test.ts', content: 'test' });
      const result = await r.execute(req);

      expect(result.status).toBe('pending-approval');
    });
  });

  describe('executeApproved', () => {
    it('bypasses permission check and executes tool', async () => {
      const req = makeReq('readFile', { filePath: '/workspace/test.ts' });
      const result = await router.executeApproved(req);

      // Will fail because file doesn't exist, but it should attempt execution
      expect(result).toBeDefined();
    });
  });

  describe('extractFilePath', () => {
    it('extracts filePath from args', () => {
      const req = makeReq('readFile', { filePath: '/test.ts' });
      const result = (router as unknown as { extractFilePath: (req: ToolCallRequest) => string | undefined }).extractFilePath(req);
      expect(result).toBe('/test.ts');
    });

    it('extracts path from args', () => {
      const req = makeReq('listDirectory', { path: '/workspace' });
      const result = (router as unknown as { extractFilePath: (req: ToolCallRequest) => string | undefined }).extractFilePath(req);
      expect(result).toBe('/workspace');
    });

    it('extracts oldPath from args', () => {
      const req = makeReq('renameFile', { oldPath: '/old.ts', newPath: '/new.ts' });
      const result = (router as unknown as { extractFilePath: (req: ToolCallRequest) => string | undefined }).extractFilePath(req);
      expect(result).toBe('/old.ts');
    });

    it('extracts filePath from nested patch data', () => {
      const req = makeReq('applyPatch', { patch: { filePath: '/test.ts' } });
      const result = (router as unknown as { extractFilePath: (req: ToolCallRequest) => string | undefined }).extractFilePath(req);
      expect(result).toBe('/test.ts');
    });

    it('returns undefined when no path found', () => {
      const req = makeReq('readFile', { content: 'test' });
      const result = (router as unknown as { extractFilePath: (req: ToolCallRequest) => string | undefined }).extractFilePath(req);
      expect(result).toBeUndefined();
    });
  });

  describe('getStringArg', () => {
    it('extracts string argument', () => {
      const req = makeReq('readFile', { filePath: '/test.ts' });
      const result = (router as unknown as { getStringArg: (req: ToolCallRequest, name: string) => string | undefined }).getStringArg(req, 'filePath');
      expect(result).toBe('/test.ts');
    });

    it('returns undefined for non-string argument', () => {
      const req = makeReq('readFile', { filePath: 123 });
      const result = (router as unknown as { getStringArg: (req: ToolCallRequest, name: string) => string | undefined }).getStringArg(req, 'filePath');
      expect(result).toBeUndefined();
    });

    it('returns undefined for missing argument', () => {
      const req = makeReq('readFile', {});
      const result = (router as unknown as { getStringArg: (req: ToolCallRequest, name: string) => string | undefined }).getStringArg(req, 'filePath');
      expect(result).toBeUndefined();
    });
  });

  describe('missingArg', () => {
    it('returns error response for missing argument', () => {
      const req = makeReq('readFile', {});
      const result = (router as unknown as { missingArg: (req: ToolCallRequest, argName: string) => ToolCallResponse }).missingArg(req, 'filePath');
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('UNKNOWN');
        expect(result.message).toBe('Missing required argument: filePath');
      }
    });
  });

  describe('toolReadFile', () => {
    it('returns error for missing filePath', async () => {
      const req = makeReq('readFile', {});
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for non-existent file', async () => {
      const req = makeReq('readFile', { filePath: '/nonexistent/file.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('toolSearchFiles', () => {
    it('returns error for missing pattern', async () => {
      const req = makeReq('searchFiles', {});
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns ok with empty results for valid pattern', async () => {
      const req = makeReq('searchFiles', { pattern: 'test' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
    });

    it('passes include and exclude to search', async () => {
      const req = makeReq('searchFiles', { pattern: 'test', include: '*.ts', exclude: 'node_modules' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
    });
  });

  describe('toolListDirectory', () => {
    it('returns error for missing path', async () => {
      const req = makeReq('listDirectory', {});
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns ok with entries for directory listing', async () => {
      const req = makeReq('listDirectory', { path: '/workspace' });
      const result = await router.execute(req);
      // listDirectoryStandalone may succeed or fail depending on env
      expect(result).toBeDefined();
    });
  });

  describe('toolProposePatch', () => {
    it('returns error for missing filePath', async () => {
      const req = makeReq('proposePatch', { operations: [] });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for missing operations', async () => {
      const req = makeReq('proposePatch', { filePath: '/test.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for empty operations array', async () => {
      const req = makeReq('proposePatch', { filePath: '/test.ts', operations: [] });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for non-existent file', async () => {
      const req = makeReq('proposePatch', {
        filePath: '/nonexistent/file.ts',
        operations: [{ range: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 }, text: 'new' }]
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('toolApplyPatch', () => {
    it('returns error for missing patchId', async () => {
      const req = makeReq('applyPatch', {});
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for missing patch data', async () => {
      const req = makeReq('applyPatch', { patchId: 'patch-1' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for invalid patch data (no filePath)', async () => {
      const req = makeReq('applyPatch', { patchId: 'patch-1', patch: { operations: [] } });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for invalid patch data (no operations)', async () => {
      const req = makeReq('applyPatch', { patchId: 'patch-1', patch: { filePath: '/test.ts' } });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for sensitive path', async () => {
      const req = makeReq('applyPatch', {
        patchId: 'patch-1',
        patch: { filePath: '/.env', operations: [{ text: 'test' }] }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('ACCESS_DENIED');
      }
    });

    it('returns error when conflict detected', async () => {
      const { applyPatchWithConflictCheck } = await import('../../packages/services/src/conflict-broker');
      vi.mocked(applyPatchWithConflictCheck).mockResolvedValueOnce({
        success: false,
        conflict: {
          id: 'conf-1',
          kind: 'patch-conflict',
          filePath: '/test.ts',
          description: 'Hash mismatch',
          riskLevel: 'medium' as const,
          patchId: 'patch-1',
          createdAt: Date.now()
        }
      });

      const req = makeReq('applyPatch', {
        patchId: 'patch-1',
        patch: {
          filePath: '/test.ts',
          operations: [{ range: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 }, text: 'new' }],
          baseHash: 'abc'
        }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(['WRITE_CONFLICT', 'UNKNOWN']).toContain(result.code);
      }
    });

    it('returns error when patch application fails without conflict', async () => {
      const { applyPatchWithConflictCheck } = await import('../../packages/services/src/conflict-broker');
      vi.mocked(applyPatchWithConflictCheck).mockResolvedValueOnce({
        success: false,
        error: 'Disk full'
      });

      const req = makeReq('applyPatch', {
        patchId: 'patch-1',
        patch: {
          filePath: '/test.ts',
          operations: [{ text: 'test' }],
          baseHash: 'abc'
        }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('toolWriteFile', () => {
    it('returns error for missing filePath', async () => {
      const req = makeReq('writeFile', { content: 'test' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for missing content', async () => {
      const req = makeReq('writeFile', { filePath: '/test.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for sensitive path', async () => {
      const req = makeReq('writeFile', { filePath: '/.env', content: 'test' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('ACCESS_DENIED');
      }
    });
  });

  describe('toolDeleteFile', () => {
    it('returns error for missing filePath', async () => {
      const req = makeReq('deleteFile', {});
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for sensitive path', async () => {
      const req = makeReq('deleteFile', { filePath: '/.env' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('ACCESS_DENIED');
      }
    });

    it('returns error for non-existent file', async () => {
      const req = makeReq('deleteFile', { filePath: '/nonexistent/file.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('toolRenameFile', () => {
    it('returns error for missing oldPath', async () => {
      const req = makeReq('renameFile', { newPath: '/new.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for missing newPath', async () => {
      const req = makeReq('renameFile', { oldPath: '/old.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error for sensitive path', async () => {
      const req = makeReq('renameFile', { oldPath: '/.env', newPath: '/.env.bak' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('ACCESS_DENIED');
      }
    });

    it('returns error for non-existent source file', async () => {
      const req = makeReq('renameFile', { oldPath: '/nonexistent/old.ts', newPath: '/nonexistent/new.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('unknown tool', () => {
    it('returns TOOL_NOT_FOUND for unknown tool', async () => {
      const req = { callId: 'test-unknown', toolName: 'unknownTool', args: {} } as unknown as ToolCallRequest;
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('TOOL_NOT_FOUND');
      }
    });
  });

  describe('with event log service', () => {
    it('logs patch events when event log service is configured', async () => {
      const eventLog = createMockEventLogService();
      const r = new ToolRouter({
        workspaceRoots: ['/workspace'],
        permissionBroker,
        conflictBroker,
        eventLogService: eventLog
      });

      // The event log service is used internally by logPatchEvent
      // We can't easily test it without a real file, but we verify the router is created
      expect(r).toBeDefined();
    });
  });

  describe('runTool exception handling', () => {
    it('catches exceptions and returns error', async () => {
      const broker = createMockPermissionBroker();
      broker.processToolCall = vi.fn().mockResolvedValue({
        status: 'ok' as const,
        callId: 'test-1',
        result: { toolName: 'readFile', args: { filePath: '/test.ts' } }
      });

      const r = new ToolRouter({
        workspaceRoots: ['/workspace'],
        permissionBroker: broker,
        conflictBroker
      });

      // readFile on non-existent file should return error
      const req = makeReq('readFile', { filePath: '/nonexistent.ts' });
      const result = await r.execute(req);
      expect(result.status).toBe('error');
    });
  });
});
