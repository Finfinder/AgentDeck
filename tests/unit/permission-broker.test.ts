import { describe, it, expect, beforeEach } from 'vitest';

import {
  PermissionBroker,
  checkSensitivePath,
  escalateRisk,
  isHighRisk
} from '@agentdeck/services';

import type { ToolCallRequest, ToolName } from '@agentdeck/shared';

let _reqCounter = 0;
function makeReq(toolName: ToolName, args: Record<string, unknown> = {}): ToolCallRequest {
  _reqCounter++;
  return { callId: `test-${_reqCounter}`, toolName, args };
}

describe('PermissionBroker', () => {
  let broker: PermissionBroker;

  beforeEach(() => {
    broker = new PermissionBroker({ approvalTimeoutMs: 5000 });
  });

  describe('classifyTool', () => {
    it('should classify readFile as read-only', () => {
      const c = broker.classifyTool('readFile');
      expect(c.riskLevel).toBe('read-only');
      expect(c.requiresApproval).toBe(false);
    });

    it('should classify applyPatch as medium risk requiring approval', () => {
      const c = broker.classifyTool('applyPatch');
      expect(c.riskLevel).toBe('medium');
      expect(c.requiresApproval).toBe(true);
    });

    it('should classify deleteFile as critical risk', () => {
      const c = broker.classifyTool('deleteFile');
      expect(c.riskLevel).toBe('critical');
      expect(c.requiresApproval).toBe(true);
    });

    it('should classify writeFile as high risk', () => {
      const c = broker.classifyTool('writeFile');
      expect(c.riskLevel).toBe('high');
      expect(c.requiresApproval).toBe(true);
    });

    it('should classify renameFile as high risk', () => {
      const c = broker.classifyTool('renameFile');
      expect(c.riskLevel).toBe('high');
      expect(c.requiresApproval).toBe(true);
    });

    it('should classify searchFiles as read-only', () => {
      const c = broker.classifyTool('searchFiles');
      expect(c.riskLevel).toBe('read-only');
      expect(c.requiresApproval).toBe(false);
    });

    it('should classify listDirectory as read-only', () => {
      const c = broker.classifyTool('listDirectory');
      expect(c.riskLevel).toBe('read-only');
      expect(c.requiresApproval).toBe(false);
    });

    it('should classify proposePatch as low risk', () => {
      const c = broker.classifyTool('proposePatch');
      expect(c.riskLevel).toBe('low');
      expect(c.requiresApproval).toBe(false);
    });
  });

  describe('listClassifications', () => {
    it('should return all 8 tool classifications', () => {
      const list = broker.listClassifications();
      expect(list).toHaveLength(8);
    });
  });

  describe('requiresApproval', () => {
    it('should not require approval for read-only tools', () => {
      const req = makeReq('readFile', { filePath: '/test.ts' });
      expect(broker.requiresApproval(req)).toBe(false);
    });

    it('should require approval for mutating tools', () => {
      const req = makeReq('applyPatch');
      expect(broker.requiresApproval(req)).toBe(true);
    });

    it('should not require approval when allow rule is set', () => {
      broker.setAllowRule('applyPatch', true);
      const req = makeReq('applyPatch');
      expect(broker.requiresApproval(req)).toBe(false);
    });

    it('should require approval for sensitive paths even with allow rule', () => {
      broker.setAllowRule('applyPatch', true);
      const req = makeReq('applyPatch');
      const sensitive = { filePath: '/.env', isSensitive: true };
      expect(broker.requiresApproval(req, sensitive)).toBe(true);
    });

    it('should always require approval for deleteFile', () => {
      const req = makeReq('deleteFile', { filePath: '/test.ts' });
      expect(broker.requiresApproval(req)).toBe(true);
    });
  });

  describe('allow rules', () => {
    it('should set and check allow rule', () => {
      expect(broker.hasAllowRule('writeFile')).toBe(false);
      broker.setAllowRule('writeFile', true);
      expect(broker.hasAllowRule('writeFile')).toBe(true);
    });

    it('should remove allow rule', () => {
      broker.setAllowRule('writeFile', true);
      broker.removeAllowRule('writeFile');
      expect(broker.hasAllowRule('writeFile')).toBe(false);
    });
  });

  describe('processToolCall', () => {
    it('should return ok for read-only tools', async () => {
      const req = makeReq('readFile', { filePath: '/test.ts' });
      const result = await broker.processToolCall(req);
      expect(result.status).toBe('ok');
    });

    it('should return pending-approval for mutating tools', async () => {
      const req = makeReq('applyPatch');
      const result = await broker.processToolCall(req);
      expect(result.status).toBe('pending-approval');
      if (result.status === 'pending-approval') {
        expect(result.classification.name).toBe('applyPatch');
        expect(result.expiresAt).toBeGreaterThan(Date.now());
      }
    });

    it('should return error for unknown tool', async () => {
      const invalidReq = { callId: '3', toolName: 'unknownTool', args: {} } as unknown as ToolCallRequest;
      const result = await broker.processToolCall(invalidReq);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('TOOL_NOT_FOUND');
      }
    });
  });

  describe('submitApproval', () => {
    it('should return false for unknown callId', () => {
      const result = broker.submitApproval({ callId: 'nonexistent', approved: true });
      expect(result).toBe(false);
    });
  });

  describe('getPendingCallIds', () => {
    it('should return empty array initially', () => {
      expect(broker.getPendingCallIds()).toEqual([]);
    });
  });

  describe('clearPendingApprovals', () => {
    it('should clear all pending approvals', () => {
      broker.clearPendingApprovals();
      expect(broker.getPendingCallIds()).toEqual([]);
    });
  });
});

describe('checkSensitivePath', () => {
  it('should detect .env files', () => {
    const result = checkSensitivePath('/project/.env');
    expect(result.isSensitive).toBe(true);
  });

  it('should detect .env.local files', () => {
    const result = checkSensitivePath('/project/.env.local');
    expect(result.isSensitive).toBe(true);
  });

  it('should detect private key files', () => {
    const result = checkSensitivePath('/home/user/.ssh/id_rsa');
    expect(result.isSensitive).toBe(true);
  });

  it('should detect .pem files', () => {
    const result = checkSensitivePath('/certs/cert.pem');
    expect(result.isSensitive).toBe(true);
  });

  it('should detect secrets directory', () => {
    const result = checkSensitivePath('/app/secrets/database.json');
    expect(result.isSensitive).toBe(true);
  });

  it('should detect credentials files', () => {
    const result = checkSensitivePath('/config/credentials.json');
    expect(result.isSensitive).toBe(true);
  });

  it('should not flag normal source files', () => {
    const result = checkSensitivePath('/src/index.ts');
    expect(result.isSensitive).toBe(false);
  });

  it('should not flag normal config files', () => {
    const result = checkSensitivePath('/project/package.json');
    expect(result.isSensitive).toBe(false);
  });

  it('should handle Windows paths', () => {
    const result = checkSensitivePath('C:\\project\\.env');
    expect(result.isSensitive).toBe(true);
  });

  it('should include matched pattern in result', () => {
    const result = checkSensitivePath('/project/.env');
    expect(result.matchedPattern).toBeDefined();
  });
});

describe('escalateRisk', () => {
  it('should not escalate for non-sensitive paths', () => {
    expect(escalateRisk('low', false)).toBe('low');
    expect(escalateRisk('medium', false)).toBe('medium');
    expect(escalateRisk('read-only', false)).toBe('read-only');
  });

  it('should escalate for sensitive paths', () => {
    expect(escalateRisk('read-only', true)).toBe('low');
    expect(escalateRisk('low', true)).toBe('medium');
    expect(escalateRisk('medium', true)).toBe('high');
    expect(escalateRisk('high', true)).toBe('critical');
    expect(escalateRisk('critical', true)).toBe('critical');
  });
});

describe('isHighRisk', () => {
  it('should return true for high and critical', () => {
    expect(isHighRisk('high')).toBe(true);
    expect(isHighRisk('critical')).toBe(true);
  });

  it('should return false for low, medium, and read-only', () => {
    expect(isHighRisk('read-only')).toBe(false);
    expect(isHighRisk('low')).toBe(false);
    expect(isHighRisk('medium')).toBe(false);
  });
});
