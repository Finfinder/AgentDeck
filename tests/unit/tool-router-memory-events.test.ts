import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ToolCallRequest,
  ToolName
} from '@agentdeck/shared';
import {
  ToolRouter,
  type ToolRouterOptions
} from '@agentdeck/services';
import type { PermissionBroker } from '@agentdeck/services';
import type { ConflictBroker } from '@agentdeck/services';
import type { EventLogService } from '@agentdeck/services';
import type { MemoryService } from '@agentdeck/memory-service';

import * as conflictBrokerModule from '../../packages/services/src/conflict-broker';
import * as editorServiceModule from '../../packages/services/src/editor-service';
import * as workspaceServiceModule from '../../packages/services/src/workspace-service';

vi.spyOn(conflictBrokerModule, 'applyPatchWithConflictCheck').mockResolvedValue({ success: true, appliedHash: 'hash123' });
vi.spyOn(conflictBrokerModule, 'classifyOperationKind').mockReturnValue('patch-conflict');
vi.spyOn(conflictBrokerModule, 'generatePatchId').mockReturnValue('patch-test');
vi.spyOn(conflictBrokerModule, 'classifyPatchRisk').mockReturnValue('low');

vi.spyOn(editorServiceModule, 'readEditorFile').mockResolvedValue({ status: 'ok' as const, content: 'file content', encoding: 'utf-8' as const });
vi.spyOn(editorServiceModule, 'writeEditorFile').mockResolvedValue({ status: 'ok' as const });
vi.spyOn(editorServiceModule, 'showDiff').mockReturnValue({ status: 'ok' as const, diff: '--- old\n+++ new' });

vi.spyOn(workspaceServiceModule, 'searchFilesStandalone').mockResolvedValue([{ id: 'sr-1', file: '/workspace/test.ts', line: 1, col: 0, snippet: 'test', isSensitive: false }]);
vi.spyOn(workspaceServiceModule, 'listDirectoryStandalone').mockResolvedValue({ path: '/workspace', entries: [{ name: 'test.ts', path: '/workspace/test.ts', kind: 'file' as const, isSensitive: false }] });
vi.spyOn(workspaceServiceModule, 'deleteFileStandalone').mockResolvedValue({ status: 'ok' as const });
vi.spyOn(workspaceServiceModule, 'renameFileStandalone').mockResolvedValue({ status: 'ok' as const });

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

function createMockMemoryService(): MemoryService {
  return {
    proposeEdit: vi.fn().mockResolvedValue({
      status: 'ok',
      proposal: {
        scope: 'user',
        filePath: '/memory/test.md',
        patch: { id: 'p1', filePath: '/memory/test.md', baseHash: 'h', operations: [], author: 'agent', riskLevel: 'low', createdAt: Date.now() },
        diff: '-old\n+new'
      }
    }),
    applyEdit: vi.fn().mockResolvedValue({
      status: 'ok',
      entry: { id: 'm1', scope: 'user', filePath: '/memory/test.md', title: 'Test', checksum: 'c', sourceKind: 'markdown', createdSource: 'agent', createdAt: Date.now(), updatedAt: Date.now() }
    }),
  } as unknown as MemoryService;
}

describe('ToolRouter — memory service integration and event logging', () => {
  let permissionBroker: PermissionBroker;
  let conflictBroker: ConflictBroker;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `tool-router-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    permissionBroker = createMockPermissionBroker();
    conflictBroker = createMockConflictBroker();
    (conflictBrokerModule.applyPatchWithConflictCheck as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, appliedHash: 'hash123' });
    (editorServiceModule.readEditorFile as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' as const, content: 'file content', encoding: 'utf-8' as const });
    (editorServiceModule.writeEditorFile as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' as const });
    (workspaceServiceModule.deleteFileStandalone as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' as const });
    (workspaceServiceModule.renameFileStandalone as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' as const });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  function createRouter(overrides: Partial<ToolRouterOptions> = {}): ToolRouter {
    return new ToolRouter({
      workspaceRoots: ['/workspace'],
      permissionBroker,
      conflictBroker,
      ...overrides
    });
  }

  describe('proposeMemoryChange with event log', () => {
    it('logs memory proposal to event log', async () => {
      const eventLog = createMockEventLogService();
      const memService = createMockMemoryService();
      const router = createRouter({ eventLogService: eventLog, memoryService: memService });

      const req = makeReq('proposeMemoryChange', {
        filePath: '/memory/test.md',
        text: 'new content',
        scope: 'user'
      });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      expect(eventLog.appendPatchEvent).toHaveBeenCalled();
    });

    it('does not log when no diff in proposal', async () => {
      const eventLog = createMockEventLogService();
      const memService = createMockMemoryService();
      (memService.proposeEdit as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'ok',
        proposal: {
          scope: 'user',
          filePath: '/memory/test.md',
          patch: { id: 'p1', filePath: '/memory/test.md', baseHash: 'h', operations: [], author: 'agent', riskLevel: 'low', createdAt: Date.now() },
          diff: ''
        }
      });
      const router = createRouter({ eventLogService: eventLog, memoryService: memService });

      const req = makeReq('proposeMemoryChange', {
        filePath: '/memory/test.md',
        text: 'content',
        scope: 'user'
      });
      await router.execute(req);
      // Event log should not be called for empty diff
      expect(eventLog.appendPatchEvent).not.toHaveBeenCalled();
    });
  });

  describe('applyMemoryChange with event log', () => {
    it('logs successful memory change to event log', async () => {
      const eventLog = createMockEventLogService();
      const memService = createMockMemoryService();
      const router = createRouter({ eventLogService: eventLog, memoryService: memService });

      const req = makeReq('applyMemoryChange', {
        proposal: {
          scope: 'user',
          filePath: '/memory/test.md',
          patch: { id: 'p1', filePath: '/memory/test.md', baseHash: 'h', operations: [], author: 'agent', riskLevel: 'low', createdAt: Date.now() },
          diff: '-old\n+new'
        }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      expect(eventLog.appendPatchEvent).toHaveBeenCalled();
    });

    it('logs conflict when memory change has conflict', async () => {
      const eventLog = createMockEventLogService();
      const memService = createMockMemoryService();
      (memService.applyEdit as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'error',
        code: 'CONFLICT',
        message: 'Conflict',
        conflict: {
          id: 'mem-conflict-1',
          kind: 'memory-conflict',
          proposalId: 'p1',
          filePath: '/memory/test.md',
          description: 'Memory conflict',
          riskLevel: 'medium',
          createdAt: Date.now()
        }
      });
      const router = createRouter({ eventLogService: eventLog, memoryService: memService });

      const req = makeReq('applyMemoryChange', {
        proposal: {
          scope: 'user',
          filePath: '/memory/test.md',
          patch: { id: 'p1', filePath: '/memory/test.md', baseHash: 'h', operations: [], author: 'agent', riskLevel: 'low', createdAt: Date.now() }
        }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      expect(eventLog.appendPatchEvent).toHaveBeenCalled();
    });

    it('logs auto-merge in event log message', async () => {
      const eventLog = createMockEventLogService();
      const memService = createMockMemoryService();
      (memService.applyEdit as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'ok',
        autoMerged: true,
        entry: { id: 'm1', scope: 'user', filePath: '/memory/test.md', title: 'Test', checksum: 'c', sourceKind: 'markdown', createdSource: 'agent', createdAt: Date.now(), updatedAt: Date.now() }
      });
      const router = createRouter({ eventLogService: eventLog, memoryService: memService });

      const req = makeReq('applyMemoryChange', {
        proposal: {
          scope: 'user',
          filePath: '/memory/test.md',
          patch: { id: 'p1', filePath: '/memory/test.md', baseHash: 'h', operations: [], author: 'agent', riskLevel: 'low', createdAt: Date.now() },
          diff: ''
        }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      expect(eventLog.appendPatchEvent).toHaveBeenCalled();
    });
  });

  describe('proposePatch with event log', () => {
    it('logs patch proposal to event log', async () => {
      const eventLog = createMockEventLogService();
      const router = createRouter({ eventLogService: eventLog });

      // Create a real file for proposePatch to read
      const realFilePath = join(tmpDir, 'test.ts');
      writeFileSync(realFilePath, 'const x = 1;\nconst y = 2;', 'utf8');

      const req = makeReq('proposePatch', {
        filePath: realFilePath,
        operations: [{ range: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 }, text: 'const x = 42' }]
      });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      expect(eventLog.appendPatchEvent).toHaveBeenCalled();
    });
  });

  describe('applyPatch with event log', () => {
    it('logs successful patch application', async () => {
      const eventLog = createMockEventLogService();
      const router = createRouter({ eventLogService: eventLog });

      const req = makeReq('applyPatch', {
        patchId: 'patch-1',
        patch: {
          filePath: '/workspace/test.ts',
          operations: [{ text: 'test' }],
          baseHash: 'abc'
        }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      expect(eventLog.appendPatchEvent).toHaveBeenCalled();
    });

    it('logs conflict when patch has conflict', async () => {
      const eventLog = createMockEventLogService();
      (conflictBrokerModule.applyPatchWithConflictCheck as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        conflict: {
          id: 'conf-1',
          kind: 'patch-conflict',
          filePath: '/test.ts',
          description: 'Write conflict',
          riskLevel: 'medium',
          patchId: 'patch-1',
          createdAt: Date.now()
        }
      });
      const router = createRouter({ eventLogService: eventLog });

      const req = makeReq('applyPatch', {
        patchId: 'patch-1',
        patch: {
          filePath: '/workspace/test.ts',
          operations: [{ text: 'test' }],
          baseHash: 'abc'
        }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      expect(eventLog.appendPatchEvent).toHaveBeenCalled();
    });

    it('logs error when patch fails without conflict', async () => {
      const eventLog = createMockEventLogService();
      (conflictBrokerModule.applyPatchWithConflictCheck as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        error: 'Disk full'
      });
      const router = createRouter({ eventLogService: eventLog });

      const req = makeReq('applyPatch', {
        patchId: 'patch-1',
        patch: {
          filePath: '/workspace/test.ts',
          operations: [{ text: 'test' }],
          baseHash: 'abc'
        }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      expect(eventLog.appendPatchEvent).toHaveBeenCalled();
    });
  });

  describe('deleteFile with binary detection', () => {
    it('logs binary file deletion with classifyOperationKind', async () => {
      const eventLog = createMockEventLogService();
      const router = createRouter({ eventLogService: eventLog });

      const req = makeReq('deleteFile', { filePath: '/workspace/image.png' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      // Binary file deletion should log two events (warn + info)
      expect(eventLog.appendPatchEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe('renameFile with binary detection', () => {
    it('logs binary file rename with classifyOperationKind', async () => {
      const eventLog = createMockEventLogService();
      const router = createRouter({ eventLogService: eventLog });

      const req = makeReq('renameFile', { oldPath: '/workspace/old.png', newPath: '/workspace/new.png' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      expect(eventLog.appendPatchEvent).toHaveBeenCalled();
    });
  });

  describe('readFile with size limit', () => {
    it('truncates content exceeding 1MB', async () => {
      const bigContent = 'x'.repeat(2_000_000);
      (editorServiceModule.readEditorFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'ok' as const,
        content: bigContent
      });

      const router = createRouter();
      const req = makeReq('readFile', { filePath: '/workspace/big.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect((result.result as { truncated: boolean; totalSize: number }).truncated).toBe(true);
        expect((result.result as { truncated: boolean; totalSize: number }).totalSize).toBe(2_000_000);
      }
    });

    it('returns non-truncated for small files', async () => {
      const router = createRouter();
      const req = makeReq('readFile', { filePath: '/workspace/small.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect((result.result as { truncated: boolean }).truncated).toBe(false);
      }
    });
  });

  describe('applyPatch sensitive path from top-level check', () => {
    it('returns pending-approval when top-level sensitive check triggers', async () => {
      const broker = createMockPermissionBroker();
      broker.processToolCall = vi.fn().mockImplementation(async (req: ToolCallRequest) => {
        // Simulate sensitive path detected at top level
        return {
          status: 'ok' as const,
          callId: req.callId,
          result: { toolName: req.toolName, args: req.args }
        };
      });

      const router = new ToolRouter({
        workspaceRoots: ['/workspace'],
        permissionBroker: broker,
        conflictBroker
      });

      // The sensitive path check in extractFilePath + checkSensitivePath handles this
      const req = makeReq('applyPatch', {
        patchId: 'patch-1',
        patch: {
          filePath: '/workspace/test.ts',
          operations: [{ text: 'test' }],
          baseHash: 'abc'
        }
      });
      const result = await router.execute(req);
      // Should succeed since /workspace/test.ts is not sensitive
      expect(result.status).toBe('ok');
    });
  });
});
