import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PermissionBroker,
  checkSensitivePath,
  ToolRouter,
  ConflictBroker,
  readEditorFile,
  writeEditorFile,
  clearBuffers
} from '@agentdeck/services';

import type { ToolCallRequest } from '@agentdeck/shared';

/**
 * Integration tests for the full sensitive file approval flow:
 *
 * 1. Agent calls writeFile on a sensitive path (e.g. .env)
 * 2. ToolRouter detects sensitive path → returns pending-approval
 * 3. User approves → submitApproval returns original request
 * 4. ToolRouter.executeApproved() executes the tool
 * 5. File is written successfully
 *
 * Also tests denial path and direct IPC handler protection.
 */

let _callCounter = 0;
function makeRequest(toolName: ToolCallRequest['toolName'], args: Record<string, unknown> = {}): ToolCallRequest {
  _callCounter++;
  return { callId: `int-test-${_callCounter}`, toolName, args };
}

describe('Sensitive file approval flow — integration', () => {
  let tempDir: string;
  let envPath: string;
  let normalPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `agentdeck-sensitive-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    envPath = join(tempDir, '.env');
    normalPath = join(tempDir, 'config.ts');
    await writeFile(envPath, 'SECRET=value', 'utf8');
    await writeFile(normalPath, 'export const x = 1;', 'utf8');
    clearBuffers();
  });

  afterEach(async () => {
    clearBuffers();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('checkSensitivePath detection', () => {
    it('should detect .env as sensitive', () => {
      const result = checkSensitivePath(envPath);
      expect(result.isSensitive).toBe(true);
      expect(result.matchedPattern).toBeDefined();
    });

    it('should not detect normal source files as sensitive', () => {
      const result = checkSensitivePath(normalPath);
      expect(result.isSensitive).toBe(false);
    });
  });

  describe('ToolRouter.execute → pending-approval for sensitive writeFile', () => {
    it('should return pending-approval when writing to .env', async () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      const request = makeRequest('writeFile', {
        filePath: envPath,
        content: 'SECRET=new_value'
      });

      const response = await router.execute(request);

      expect(response.status).toBe('pending-approval');
      if (response.status === 'pending-approval') {
        expect(response.classification.name).toBe('writeFile');
        expect(response.expiresAt).toBeGreaterThan(Date.now());
      }
    });

    it('should return pending-approval when deleting sensitive file', async () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      const request = makeRequest('deleteFile', { filePath: envPath });
      const response = await router.execute(request);

      expect(response.status).toBe('pending-approval');
    });

    it('should return pending-approval when renaming sensitive file', async () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      const newPath = join(tempDir, '.env.backup');
      const request = makeRequest('renameFile', { oldPath: envPath, newPath });
      const response = await router.execute(request);

      expect(response.status).toBe('pending-approval');
    });

    it('should return ok for writeFile on non-sensitive path (with allow rule)', async () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      broker.setAllowRule('writeFile', true);
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      const request = makeRequest('writeFile', {
        filePath: normalPath,
        content: 'export const x = 2;'
      });

      const response = await router.execute(request);

      expect(response.status).toBe('ok');
    });
  });

  describe('Full approval → execute flow', () => {
    it('should deny writeFile on sensitive path even after approval (defense in depth)', async () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      const newContent = 'SECRET=approved_value';
      const request = makeRequest('writeFile', {
        filePath: envPath,
        content: newContent
      });

      // Step 1: Execute → pending-approval (PermissionBroker requires approval)
      const pendingResponse = await router.execute(request);
      expect(pendingResponse.status).toBe('pending-approval');

      // Step 2: User approves → submitApproval returns original request
      const decision = { callId: request.callId, approved: true };
      const originalRequest = broker.submitApproval(decision);
      expect(originalRequest).not.toBeNull();
      expect(originalRequest!.callId).toBe(request.callId);
      expect(originalRequest!.toolName).toBe('writeFile');

      // Step 3: Execute approved — but toolWriteFile has its own sensitive check (defense in depth)
      const approvedResponse = await router.executeApproved(originalRequest!);
      expect(approvedResponse.status).toBe('error');
      if (approvedResponse.status === 'error') {
        expect(approvedResponse.code).toBe('ACCESS_DENIED');
      }

      // Step 4: Verify file was NOT modified
      const diskContent = await readFile(envPath, 'utf8');
      expect(diskContent).toBe('SECRET=value');
    });

    it('should execute writeFile on non-sensitive path after approval', async () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      const newContent = 'export const z = 99;';
      const request = makeRequest('writeFile', {
        filePath: normalPath,
        content: newContent
      });

      // Step 1: Execute → pending-approval (writeFile requires approval by default)
      const pendingResponse = await router.execute(request);
      expect(pendingResponse.status).toBe('pending-approval');

      // Step 2: User approves
      const decision = { callId: request.callId, approved: true };
      const originalRequest = broker.submitApproval(decision);
      expect(originalRequest).not.toBeNull();

      // Step 3: Execute approved request
      const approvedResponse = await router.executeApproved(originalRequest!);
      expect(approvedResponse.status).toBe('ok');

      // Step 4: Verify file was written
      const diskContent = await readFile(normalPath, 'utf8');
      expect(diskContent).toBe(newContent);
    });

    it('should deny writeFile on sensitive path when rejected', async () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      const request = makeRequest('writeFile', {
        filePath: envPath,
        content: 'SECRET=rejected_value'
      });

      // Step 1: Execute → pending-approval
      const pendingResponse = await router.execute(request);
      expect(pendingResponse.status).toBe('pending-approval');

      // Step 2: User rejects
      const decision = { callId: request.callId, approved: false };
      const originalRequest = broker.submitApproval(decision);
      expect(originalRequest).not.toBeNull();

      // Step 3: File should NOT be modified
      const diskContent = await readFile(envPath, 'utf8');
      expect(diskContent).toBe('SECRET=value');
    });

    it('should deny deleteFile on sensitive path even after approval (defense in depth)', async () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      const request = makeRequest('deleteFile', { filePath: envPath });

      // Step 1: pending-approval (PermissionBroker requires approval)
      const pendingResponse = await router.execute(request);
      expect(pendingResponse.status).toBe('pending-approval');

      // Step 2: Approve
      const decision = { callId: request.callId, approved: true };
      const originalRequest = broker.submitApproval(decision);
      expect(originalRequest).not.toBeNull();

      // Step 3: Execute approved — but toolDeleteFile has its own sensitive check
      const approvedResponse = await router.executeApproved(originalRequest!);
      expect(approvedResponse.status).toBe('error');
      if (approvedResponse.status === 'error') {
        expect(approvedResponse.code).toBe('ACCESS_DENIED');
      }

      // Step 4: Verify file still exists (not deleted)
      const diskContent = await readFile(envPath, 'utf8');
      expect(diskContent).toBe('SECRET=value');
    });

    it('should return null from submitApproval for expired/unknown callId', () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });

      const result = broker.submitApproval({ callId: 'nonexistent', approved: true });
      expect(result).toBeNull();
    });

    it('should store pending request in PermissionBroker queue', async () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      const request = makeRequest('writeFile', {
        filePath: envPath,
        content: 'test'
      });

      await router.execute(request);

      // Pending approval should be in the queue
      const pendingIds = broker.getPendingCallIds();
      expect(pendingIds).toContain(request.callId);

      // After approval, it should be removed
      broker.submitApproval({ callId: request.callId, approved: true });
      expect(broker.getPendingCallIds()).not.toContain(request.callId);
    });
  });

  describe('Direct IPC handler protection (writeEditorFile)', () => {
    it('should write to non-sensitive files normally', async () => {
      clearBuffers();
      const result = await writeEditorFile(normalPath, 'export const y = 42;');
      expect(result.status).toBe('ok');

      const content = await readFile(normalPath, 'utf8');
      expect(content).toBe('export const y = 42;');
    });

    it('should allow reading sensitive files (read is not blocked)', async () => {
      clearBuffers();
      const result = await readEditorFile(envPath);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.content).toBe('SECRET=value');
      }
    });
  });

  describe('applyPatch sensitive-path guard (defense-in-depth)', () => {
    it('should return pending-approval for applyPatch on sensitive file (PermissionBroker blocks first)', async () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      // Simulate applyPatch with nested patch.filePath pointing to .env
      const request: ToolCallRequest = {
        callId: 'apply-patch-sensitive-1',
        toolName: 'applyPatch',
        args: {
          patchId: 'p-sensitive-1',
          patch: {
            filePath: envPath,
            baseHash: 'somehash',
            operations: [{ text: 'SECRET=new', filePath: envPath }],
            author: 'agent',
            riskLevel: 'medium'
          }
        }
      };

      // PermissionBroker detects sensitive path and returns pending-approval
      const response = await router.execute(request);
      expect(response.status).toBe('pending-approval');
    });

    it('should deny applyPatch on sensitive file after approval (tool-level defense-in-depth)', async () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      const request: ToolCallRequest = {
        callId: 'apply-patch-sensitive-2',
        toolName: 'applyPatch',
        args: {
          patchId: 'p-sensitive-2',
          patch: {
            filePath: envPath,
            baseHash: 'somehash',
            operations: [{ text: 'SECRET=new', filePath: envPath }],
            author: 'agent',
            riskLevel: 'medium'
          }
        }
      };

      // Step 1: execute() returns pending-approval (PermissionBroker blocks)
      const pendingResponse = await router.execute(request);
      expect(pendingResponse.status).toBe('pending-approval');

      // Step 2: User approves
      const decision = { callId: request.callId, approved: true };
      const originalRequest = broker.submitApproval(decision);
      expect(originalRequest).not.toBeNull();

      // Step 3: executeApproved() → toolApplyPatch detects sensitive path and denies
      const approvedResponse = await router.executeApproved(originalRequest!);
      expect(approvedResponse.status).toBe('error');
      if (approvedResponse.status === 'error') {
        expect(approvedResponse.code).toBe('ACCESS_DENIED');
        expect(approvedResponse.message).toContain('wrażliwej ścieżce');
      }

      // Step 4: Verify file was NOT modified
      const diskContent = await readFile(envPath, 'utf8');
      expect(diskContent).toBe('SECRET=value');
    });

    it('should deny applyPatch on .key file after approval (tool-level defense-in-depth)', async () => {
      const keyPath = join(tempDir, 'private.key');
      await writeFile(keyPath, '-----BEGIN PRIVATE KEY-----\nMIIE...', 'utf8');

      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      const request: ToolCallRequest = {
        callId: 'apply-patch-key-1',
        toolName: 'applyPatch',
        args: {
          patchId: 'p-key-1',
          patch: {
            filePath: keyPath,
            baseHash: 'somehash',
            operations: [{ text: 'modified', filePath: keyPath }],
            author: 'agent',
            riskLevel: 'medium'
          }
        }
      };

      // Step 1: pending-approval
      const pendingResponse = await router.execute(request);
      expect(pendingResponse.status).toBe('pending-approval');

      // Step 2: Approve
      const decision = { callId: request.callId, approved: true };
      const originalRequest = broker.submitApproval(decision);
      expect(originalRequest).not.toBeNull();

      // Step 3: executeApproved → denied
      const approvedResponse = await router.executeApproved(originalRequest!);
      expect(approvedResponse.status).toBe('error');
      if (approvedResponse.status === 'error') {
        expect(approvedResponse.code).toBe('ACCESS_DENIED');
      }

      // Step 4: Verify file was NOT modified
      const diskContent = await readFile(keyPath, 'utf8');
      expect(diskContent).toBe('-----BEGIN PRIVATE KEY-----\nMIIE...');
    });

    it('should allow applyPatch on non-sensitive file via ToolRouter (not blocked by sensitive-path guard)', async () => {
      const broker = new PermissionBroker({ approvalTimeoutMs: 30_000 });
      broker.setAllowRule('applyPatch', true);
      const conflictBroker = new ConflictBroker();
      const router = new ToolRouter({
        workspaceRoots: [tempDir],
        permissionBroker: broker,
        conflictBroker
      });

      // Compute the actual file hash so the patch can be applied
      const { computeFileHash } = await import('@agentdeck/services');
      const actualHash = await computeFileHash(normalPath);

      const request: ToolCallRequest = {
        callId: 'apply-patch-normal-1',
        toolName: 'applyPatch',
        args: {
          patchId: 'p-normal-1',
          patch: {
            filePath: normalPath,
            baseHash: actualHash ?? 'somehash',
            operations: [{ text: 'export const z = 99;', filePath: normalPath }],
            author: 'agent',
            riskLevel: 'low'
          }
        }
      };

      // Should not be rejected — may succeed or fail on hash, but NOT with ACCESS_DENIED
      const response = await router.execute(request);
      if (response.status === 'error') {
        expect(response.code).not.toBe('ACCESS_DENIED');
      }
    });
  });
});
