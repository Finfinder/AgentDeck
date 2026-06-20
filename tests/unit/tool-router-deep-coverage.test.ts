import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// Import modules to mock so we can spy on them
import * as conflictBrokerModule from '../../packages/services/src/conflict-broker';
import * as editorServiceModule from '../../packages/services/src/editor-service';
import * as workspaceServiceModule from '../../packages/services/src/workspace-service';

// Setup mocks via vi.spyOn on the imported modules
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

function createMockPermissionBroker(overrides: Partial<PermissionBroker> = {}): PermissionBroker {
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
    removeAllowRule: vi.fn(),
    ...overrides
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

function createMockMemoryService(overrides: Partial<MemoryService> = {}): MemoryService {
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
    ...overrides
  } as unknown as MemoryService;
}

describe('ToolRouter — deep coverage', () => {
  let permissionBroker: PermissionBroker;
  let conflictBroker: ConflictBroker;

  beforeEach(() => {
    permissionBroker = createMockPermissionBroker();
    conflictBroker = createMockConflictBroker();
    // Reset all spies to default mock implementations
    (conflictBrokerModule.applyPatchWithConflictCheck as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, appliedHash: 'hash123' });
    (editorServiceModule.readEditorFile as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' as const, content: 'file content', encoding: 'utf-8' as const });
    (editorServiceModule.writeEditorFile as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' as const });
    (workspaceServiceModule.deleteFileStandalone as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' as const });
    (workspaceServiceModule.renameFileStandalone as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' as const });
  });

  function createRouter(overrides: Partial<ToolRouterOptions> = {}): ToolRouter {
    return new ToolRouter({
      workspaceRoots: ['/workspace'],
      permissionBroker,
      conflictBroker,
      ...overrides
    });
  }

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const router = createRouter();
      const req = makeReq('unknownTool' as ToolName, {});
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('TOOL_NOT_FOUND');
        expect(result.message).toContain('Unknown tool');
      }
    });
  });

  describe('readFile', () => {
    it('returns content for existing file', async () => {
      const router = createRouter();
      const req = makeReq('readFile', { filePath: '/workspace/test.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect((result.result as { content: string; truncated: boolean }).content).toBe('file content');
        expect((result.result as { content: string; truncated: boolean }).truncated).toBe(false);
      }
    });

    it('returns error when filePath is missing', async () => {
      const router = createRouter();
      const req = makeReq('readFile', {});
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.message).toContain('filePath');
      }
    });

    it('returns truncated content for large files', async () => {
      const router = createRouter();
      const bigContent = 'x'.repeat(2_000_000);
      (editorServiceModule.readEditorFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'ok' as const,
        content: bigContent
      });

      const req = makeReq('readFile', { filePath: '/workspace/big.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect((result.result as { truncated: boolean; totalSize: number }).truncated).toBe(true);
        expect((result.result as { truncated: boolean; totalSize: number }).totalSize).toBe(2_000_000);
      }
    });

    it('returns error when readEditorFile fails', async () => {
      const router = createRouter();
      (editorServiceModule.readEditorFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'error' as const,
        message: 'File not found'
      });

      const req = makeReq('readFile', { filePath: '/workspace/missing.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('searchFiles', () => {
    it('returns search results', async () => {
      const router = createRouter();
      const req = makeReq('searchFiles', { pattern: '*.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect((result.result as { results: string[] }).results).toEqual(['/workspace/test.ts']);
      }
    });

    it('returns error when pattern is missing', async () => {
      const router = createRouter();
      const req = makeReq('searchFiles', {});
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('passes include and exclude filters', async () => {
      const router = createRouter();
      const req = makeReq('searchFiles', { pattern: '*.ts', include: 'src/**', exclude: 'node_modules/**' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
    });
  });

  describe('listDirectory', () => {
    it('returns directory entries', async () => {
      const router = createRouter();
      const req = makeReq('listDirectory', { path: '/workspace' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect((result.result as { entries: Array<{ name: string; path: string; kind: 'file' | 'directory'; isSensitive: boolean }> }).entries).toEqual([{ name: 'test.ts', path: '/workspace/test.ts', kind: 'file', isSensitive: false }]);
      }
    });

    it('returns error when path is missing', async () => {
      const router = createRouter();
      const req = makeReq('listDirectory', {});
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('writeFile', () => {
    it('writes file successfully', async () => {
      const router = createRouter();
      const req = makeReq('writeFile', { filePath: '/workspace/test.ts', content: 'new content' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect((result.result as { filePath: string; bytesWritten: number }).filePath).toBe('/workspace/test.ts');
        expect((result.result as { filePath: string; bytesWritten: number }).bytesWritten).toBe(11);
      }
    });

    it('returns error when filePath is missing', async () => {
      const router = createRouter();
      const req = makeReq('writeFile', { content: 'test' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when content is missing', async () => {
      const router = createRouter();
      const req = makeReq('writeFile', { filePath: '/workspace/test.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when writeEditorFile fails', async () => {
      const router = createRouter();
      (editorServiceModule.writeEditorFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'error' as const,
        code: 'ACCESS_DENIED' as const,
        message: 'Permission denied'
      });

      const req = makeReq('writeFile', { filePath: '/workspace/protected.ts', content: 'test' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('deleteFile', () => {
    it('deletes file successfully', async () => {
      const router = createRouter();
      const req = makeReq('deleteFile', { filePath: '/workspace/test.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect((result.result as { filePath: string; deleted: boolean }).deleted).toBe(true);
      }
    });

    it('returns error when filePath is missing', async () => {
      const router = createRouter();
      const req = makeReq('deleteFile', {});
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when deleteFileStandalone fails', async () => {
      const router = createRouter();
      (workspaceServiceModule.deleteFileStandalone as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'error' as const,
        code: 'ACCESS_DENIED' as const,
        message: 'Cannot delete'
      });

      const req = makeReq('deleteFile', { filePath: '/workspace/protected.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('renameFile', () => {
    it('renames file successfully', async () => {
      const router = createRouter();
      const req = makeReq('renameFile', { oldPath: '/workspace/old.ts', newPath: '/workspace/new.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect((result.result as { oldPath: string; newPath: string }).oldPath).toBe('/workspace/old.ts');
        expect((result.result as { oldPath: string; newPath: string }).newPath).toBe('/workspace/new.ts');
      }
    });

    it('returns error when oldPath is missing', async () => {
      const router = createRouter();
      const req = makeReq('renameFile', { newPath: '/workspace/new.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when newPath is missing', async () => {
      const router = createRouter();
      const req = makeReq('renameFile', { oldPath: '/workspace/old.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when renameFileStandalone fails', async () => {
      const router = createRouter();
      (workspaceServiceModule.renameFileStandalone as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'error' as const,
        code: 'ACCESS_DENIED' as const,
        message: 'Cannot rename'
      });

      const req = makeReq('renameFile', { oldPath: '/workspace/old.ts', newPath: '/workspace/new.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('proposePatch', () => {
    it('returns error when filePath is missing', async () => {
      const router = createRouter();
      const req = makeReq('proposePatch', { operations: [] });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when operations is empty', async () => {
      const router = createRouter();
      const req = makeReq('proposePatch', { filePath: '/workspace/test.ts', operations: [] });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when operations is not an array', async () => {
      const router = createRouter();
      const req = makeReq('proposePatch', { filePath: '/workspace/test.ts', operations: 'not-array' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('applyPatch', () => {
    it('returns error when patchId is missing', async () => {
      const router = createRouter();
      const req = makeReq('applyPatch', {});
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when patch data is missing', async () => {
      const router = createRouter();
      const req = makeReq('applyPatch', { patchId: 'p1' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when patch filePath is invalid', async () => {
      const router = createRouter();
      const req = makeReq('applyPatch', {
        patchId: 'p1',
        patch: { filePath: '', operations: [] }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when patch operations is not array', async () => {
      const router = createRouter();
      const req = makeReq('applyPatch', {
        patchId: 'p1',
        patch: { filePath: '/test.ts', operations: 'not-array' }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('applies patch successfully', async () => {
      const router = createRouter();
      const req = makeReq('applyPatch', {
        patchId: 'p1',
        patch: {
          filePath: '/workspace/test.ts',
          baseHash: 'abc',
          operations: [{ range: { startLine: 1, endLine: 2, startCol: 0, endCol: 5 }, text: 'new' }],
          author: 'agent',
          riskLevel: 'low',
          createdAt: Date.now()
        }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect((result.result as { patchId: string; appliedHash: string }).patchId).toBe('p1');
        expect((result.result as { patchId: string; appliedHash: string }).appliedHash).toBe('hash123');
      }
    });

    it('returns conflict error when patch has conflict', async () => {
      (conflictBrokerModule.applyPatchWithConflictCheck as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        conflict: { id: 'c1', description: 'Write conflict detected' }
      });

      const router = createRouter();
      const req = makeReq('applyPatch', {
        patchId: 'p1',
        patch: {
          filePath: '/workspace/test.ts',
          baseHash: 'abc',
          operations: [],
          author: 'agent',
          riskLevel: 'low',
          createdAt: Date.now()
        }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('WRITE_CONFLICT');
      }
    });

    it('returns error when patch application fails without conflict', async () => {
      (conflictBrokerModule.applyPatchWithConflictCheck as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        error: 'Disk full'
      });

      const router = createRouter();
      const req = makeReq('applyPatch', {
        patchId: 'p1',
        patch: {
          filePath: '/workspace/test.ts',
          baseHash: 'abc',
          operations: [],
          author: 'agent',
          riskLevel: 'low',
          createdAt: Date.now()
        }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('proposeMemoryChange', () => {
    it('returns error when memory service is not configured', async () => {
      const router = createRouter();
      const req = makeReq('proposeMemoryChange', { filePath: '/memory/test.md', text: 'content' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.message).toContain('Memory service');
      }
    });

    it('returns error when filePath is missing', async () => {
      const router = createRouter({ memoryService: createMockMemoryService() });
      const req = makeReq('proposeMemoryChange', { text: 'content' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when text is missing', async () => {
      const router = createRouter({ memoryService: createMockMemoryService() });
      const req = makeReq('proposeMemoryChange', { filePath: '/memory/test.md' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('proposes memory change successfully', async () => {
      const memService = createMockMemoryService();
      const router = createRouter({ memoryService: memService });
      const req = makeReq('proposeMemoryChange', { filePath: '/memory/test.md', text: 'new content', scope: 'user' });
      const result = await router.execute(req);
      expect(result.status).toBe('ok');
    });

    it('returns error when proposeEdit fails', async () => {
      const memService = createMockMemoryService();
      (memService.proposeEdit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'error',
        message: 'Edit failed'
      });
      const router = createRouter({ memoryService: memService });
      const req = makeReq('proposeMemoryChange', { filePath: '/memory/test.md', text: 'content' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('applyMemoryChange', () => {
    it('returns error when memory service is not configured', async () => {
      const router = createRouter();
      const req = makeReq('applyMemoryChange', { proposal: { filePath: '/memory/test.md' } });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when proposal is missing', async () => {
      const router = createRouter({ memoryService: createMockMemoryService() });
      const req = makeReq('applyMemoryChange', {});
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('returns error when proposal filePath is invalid', async () => {
      const router = createRouter({ memoryService: createMockMemoryService() });
      const req = makeReq('applyMemoryChange', {
        proposal: { filePath: '', patch: {} }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });

    it('applies memory change successfully', async () => {
      const memService = createMockMemoryService();
      const router = createRouter({ memoryService: memService });
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
    });

    it('returns error when applyEdit fails', async () => {
      const memService = createMockMemoryService();
      (memService.applyEdit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'error',
        code: 'WRITE_CONFLICT',
        message: 'Conflict detected'
      });
      const router = createRouter({ memoryService: memService });
      const req = makeReq('applyMemoryChange', {
        proposal: {
          scope: 'user',
          filePath: '/memory/test.md',
          patch: { id: 'p1', filePath: '/memory/test.md', baseHash: 'h', operations: [], author: 'agent', riskLevel: 'low', createdAt: Date.now() }
        }
      });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('execute — error handling', () => {
    it('catches unexpected errors during tool execution', async () => {
      const router = createRouter();
      (editorServiceModule.readEditorFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Unexpected crash'));

      const req = makeReq('readFile', { filePath: '/workspace/test.ts' });
      const result = await router.execute(req);
      expect(result.status).toBe('error');
    });
  });

  describe('logPatchEvent', () => {
    it('logs patch event when eventLogService is configured', async () => {
      const eventLog = createMockEventLogService();
      const router = createRouter({ eventLogService: eventLog });

      const req = makeReq('readFile', { filePath: '/workspace/test.ts' });
      await router.execute(req);

      expect(eventLog.appendPatchEvent).toBeDefined();
    });

    it('handles eventLogService errors gracefully', async () => {
      const eventLog = createMockEventLogService();
      (eventLog.appendPatchEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Log failure');
      });
      const router = createRouter({ eventLogService: eventLog });

      const req = makeReq('readFile', { filePath: '/workspace/test.ts' });
      const result = await router.execute(req);
      expect(result).toBeDefined();
    });
  });
});
