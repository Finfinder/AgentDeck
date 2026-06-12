import { describe, it, expect, beforeEach } from 'vitest';

import {
  PermissionBroker,
  checkSensitivePath,
  escalateRisk,
  isHighRisk,
  isBinaryFile
} from '@agentdeck/services';

import type { ToolCallRequest, ToolName } from '@agentdeck/shared';

let _reqCounter = 0;
function makeReq(toolName: ToolName, args: Record<string, unknown> = {}): ToolCallRequest {
  _reqCounter++;
  return { callId: `test-${_reqCounter}`, toolName, args };
}

describe('PermissionBroker — coverage', () => {
  let broker: PermissionBroker;

  beforeEach(() => {
    broker = new PermissionBroker({ approvalTimeoutMs: 5000 });
  });

  describe('isBinaryOperation', () => {
    it('should detect binary file extensions', () => {
      const req = makeReq('readFile', { filePath: '/image.png' });
      expect(broker.isBinaryOperation(req)).toBe(true);
    });

    it('should detect .exe files as binary', () => {
      const req = makeReq('readFile', { filePath: '/app.exe' });
      expect(broker.isBinaryOperation(req)).toBe(true);
    });

    it('should detect .dll files as binary', () => {
      const req = makeReq('readFile', { filePath: '/lib.dll' });
      expect(broker.isBinaryOperation(req)).toBe(true);
    });

    it('should not flag text files as binary', () => {
      const req = makeReq('readFile', { filePath: '/src/index.ts' });
      expect(broker.isBinaryOperation(req)).toBe(false);
    });

    it('should return false when no file path', () => {
      const req = makeReq('listDirectory', { path: '/workspace' });
      expect(broker.isBinaryOperation(req)).toBe(false);
    });

    it('should require approval for binary operations even with allow rule', () => {
      broker.setAllowRule('writeFile', true);
      const req = makeReq('writeFile', { filePath: '/image.png' });
      expect(broker.requiresApproval(req)).toBe(true);
    });
  });

  describe('extractFilePath', () => {
    it('should extract filePath from args', () => {
      const req = makeReq('readFile', { filePath: '/test.ts' });
      expect(broker.extractFilePath(req)).toBe('/test.ts');
    });

    it('should extract path from args', () => {
      const req = makeReq('listDirectory', { path: '/workspace' });
      expect(broker.extractFilePath(req)).toBe('/workspace');
    });

    it('should extract oldPath from args', () => {
      const req = makeReq('renameFile', { oldPath: '/old.ts', newPath: '/new.ts' });
      expect(broker.extractFilePath(req)).toBe('/old.ts');
    });

    it('should extract sourcePath from args', () => {
      const req = makeReq('readFile', { sourcePath: '/source.ts' });
      expect(broker.extractFilePath(req)).toBe('/source.ts');
    });

    it('should return undefined when no path found', () => {
      const req = makeReq('readFile', { content: 'test' });
      expect(broker.extractFilePath(req)).toBeUndefined();
    });

    it('should return undefined for empty string path', () => {
      const req = makeReq('readFile', { filePath: '' });
      expect(broker.extractFilePath(req)).toBeUndefined();
    });

    it('should return undefined when args is undefined', () => {
      const req = { callId: '1', toolName: 'readFile' } as ToolCallRequest;
      expect(broker.extractFilePath(req)).toBeUndefined();
    });
  });

  describe('getEffectiveRisk', () => {
    it('should escalate risk for binary operations', () => {
      const req = makeReq('readFile', { filePath: '/image.png' });
      expect(broker.getEffectiveRisk(req)).toBe('critical');
    });

    it('should escalate risk for sensitive paths', () => {
      const req = makeReq('readFile', { filePath: '/.env' });
      const sensitive = checkSensitivePath('/.env');
      expect(broker.getEffectiveRisk(req, sensitive)).toBe('low'); // read-only → low escalation
    });

    it('should return base risk for normal operations', () => {
      const req = makeReq('readFile', { filePath: '/test.ts' });
      expect(broker.getEffectiveRisk(req)).toBe('read-only');
    });

    it('should return critical for unknown tool', () => {
      const invalidReq = { callId: '1', toolName: 'unknownTool', args: {} } as unknown as ToolCallRequest;
      expect(broker.getEffectiveRisk(invalidReq)).toBe('critical');
    });

    it('should escalate writeFile on sensitive path to critical', () => {
      const req = makeReq('writeFile', { filePath: '/.env' });
      const sensitive = checkSensitivePath('/.env');
      expect(broker.getEffectiveRisk(req, sensitive)).toBe('critical'); // high → critical
    });
  });

  describe('requiresApproval with binary files', () => {
    it('should require approval for writeFile on binary', () => {
      const req = makeReq('writeFile', { filePath: '/image.png' });
      expect(broker.requiresApproval(req)).toBe(true);
    });

    it('should require approval for deleteFile on binary', () => {
      const req = makeReq('deleteFile', { filePath: '/app.exe' });
      expect(broker.requiresApproval(req)).toBe(true);
    });

    it('should require approval for renameFile on binary', () => {
      const req = makeReq('renameFile', { oldPath: '/old.dll', newPath: '/new.dll' });
      expect(broker.requiresApproval(req)).toBe(true);
    });
  });

  describe('processToolCall with allow rules', () => {
    it('should return ok for allowed tool', async () => {
      broker.setAllowRule('writeFile', true);
      const req = makeReq('writeFile', { filePath: '/test.ts', content: 'test' });
      const result = await broker.processToolCall(req);
      expect(result.status).toBe('ok');
    });

    it('should return pending-approval for allowed tool on sensitive path', async () => {
      broker.setAllowRule('writeFile', true);
      const req = makeReq('writeFile', { filePath: '/.env', content: 'test' });
      const sensitive = checkSensitivePath('/.env');
      const result = await broker.processToolCall(req, sensitive);
      expect(result.status).toBe('pending-approval');
    });

    it('should return pending-approval for allowed tool on binary file', async () => {
      broker.setAllowRule('writeFile', true);
      const req = makeReq('writeFile', { filePath: '/image.png', content: 'test' });
      const result = await broker.processToolCall(req);
      expect(result.status).toBe('pending-approval');
    });
  });

  describe('processToolCall with read-only tools', () => {
    it('should return ok for searchFiles', async () => {
      const req = makeReq('searchFiles', { pattern: 'test' });
      const result = await broker.processToolCall(req);
      expect(result.status).toBe('ok');
    });

    it('should return ok for listDirectory', async () => {
      const req = makeReq('listDirectory', { path: '/workspace' });
      const result = await broker.processToolCall(req);
      expect(result.status).toBe('ok');
    });

    it('should return ok for readFile', async () => {
      const req = makeReq('readFile', { filePath: '/test.ts' });
      const result = await broker.processToolCall(req);
      expect(result.status).toBe('ok');
    });
  });

  describe('processToolCall with proposePatch', () => {
    it('should return ok for proposePatch (low risk, no approval)', async () => {
      const req = makeReq('proposePatch', { filePath: '/test.ts', operations: [] });
      const result = await broker.processToolCall(req);
      expect(result.status).toBe('ok');
    });
  });

  describe('submitApproval with remember', () => {
    it('should resolve with remember flag', async () => {
      const req = makeReq('writeFile', { filePath: '/test.ts', content: 'test' });
      await broker.processToolCall(req);

      const result = broker.submitApproval({ callId: req.callId, approved: true, remember: true });
      expect(result).not.toBeNull();
      expect(result!.callId).toBe(req.callId);
    });

    it('should resolve with approved false', async () => {
      const req = makeReq('writeFile', { filePath: '/test.ts', content: 'test' });
      await broker.processToolCall(req);

      const result = broker.submitApproval({ callId: req.callId, approved: false });
      expect(result).not.toBeNull();
    });
  });

  describe('waitForApproval', () => {
    it('should return null for unknown callId', async () => {
      const result = await broker.waitForApproval('nonexistent');
      expect(result).toBeNull();
    });

    it('should resolve when approval is submitted', async () => {
      const req = makeReq('writeFile', { filePath: '/test.ts', content: 'test' });
      await broker.processToolCall(req);

      // Submit approval after a short delay
      setTimeout(() => {
        broker.submitApproval({ callId: req.callId, approved: true });
      }, 10);

      const result = await broker.waitForApproval(req.callId);
      expect(result).not.toBeNull();
      expect(result!.decision.approved).toBe(true);
      expect(result!.request.callId).toBe(req.callId);
    });

    it('should return null for already-resolved approval', async () => {
      const req = makeReq('writeFile', { filePath: '/test.ts', content: 'test' });
      await broker.processToolCall(req);

      // Submit approval
      broker.submitApproval({ callId: req.callId, approved: true });

      // Wait a tick for promise to resolve
      await new Promise(r => setTimeout(r, 10));

      // waitForApproval should return null because the entry was already deleted by submitApproval
      const result = await broker.waitForApproval(req.callId);
      expect(result).toBeNull();
    });
  });

  describe('getPendingCallIds with multiple approvals', () => {
    it('should return all pending call IDs', async () => {
      const req1 = makeReq('writeFile', { filePath: '/a.ts', content: 'a' });
      const req2 = makeReq('deleteFile', { filePath: '/b.ts' });

      await broker.processToolCall(req1);
      await broker.processToolCall(req2);

      const pending = broker.getPendingCallIds();
      expect(pending).toHaveLength(2);
      expect(pending).toContain(req1.callId);
      expect(pending).toContain(req2.callId);
    });
  });

  describe('clearPendingApprovals with items', () => {
    it('should clear all pending approvals after adding some', async () => {
      const req = makeReq('writeFile', { filePath: '/test.ts', content: 'test' });
      await broker.processToolCall(req);

      expect(broker.getPendingCallIds()).toHaveLength(1);

      broker.clearPendingApprovals();
      expect(broker.getPendingCallIds()).toHaveLength(0);
    });
  });

  describe('checkSensitivePath — additional patterns', () => {
    it('should detect .key files', () => {
      const result = checkSensitivePath('/certs/key.key');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect .crt files', () => {
      const result = checkSensitivePath('/certs/cert.crt');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect .p12 files', () => {
      const result = checkSensitivePath('/certs/cert.p12');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect .jks files', () => {
      const result = checkSensitivePath('/keystore/keystore');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect .npmrc files', () => {
      const result = checkSensitivePath('/project/.npmrc');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect .yarnrc files', () => {
      const result = checkSensitivePath('/project/.yarnrc');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect .ssh directory', () => {
      const result = checkSensitivePath('/home/user/.ssh/config');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect .aws directory', () => {
      const result = checkSensitivePath('/home/user/.aws/credentials');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect .azure directory', () => {
      const result = checkSensitivePath('/home/user/.azure/profile');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect id_ed25519', () => {
      const result = checkSensitivePath('/home/user/.ssh/id_ed25519');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect .gnupg directory', () => {
      const result = checkSensitivePath('/home/user/.gnupg/pubring.kbx');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect .password-store directory', () => {
      const result = checkSensitivePath('/home/user/.password-store/gpg-id');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect .pfx files', () => {
      const result = checkSensitivePath('/certs/cert.pfx');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect .storage_state.json files', () => {
      const result = checkSensitivePath('/config/.storage_state.json');
      expect(result.isSensitive).toBe(true);
    });

    it('should detect credential files', () => {
      const result = checkSensitivePath('/config/credential.json');
      expect(result.isSensitive).toBe(true);
    });
  });

  describe('isBinaryFile', () => {
    it('should detect binary extensions', () => {
      expect(isBinaryFile('/image.png')).toBe(true);
      expect(isBinaryFile('/app.exe')).toBe(true);
      expect(isBinaryFile('/lib.dll')).toBe(true);
      expect(isBinaryFile('/data.zip')).toBe(true);
      expect(isBinaryFile('/model.pth')).toBe(true);
    });

    it('should not flag text extensions', () => {
      expect(isBinaryFile('/src/index.ts')).toBe(false);
      expect(isBinaryFile('/src/app.js')).toBe(false);
      expect(isBinaryFile('/README.md')).toBe(false);
    });
  });
});
