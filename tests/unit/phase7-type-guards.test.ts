import { describe, it, expect } from 'vitest';

import {
  isToolRiskLevel,
  isToolName,
  isToolClassification,
  isToolCallRequest,
  isToolCallResponse,
  isApprovalDecision,
  isPatchSet,
  isPatchResult,
  isConflict,
  isConflictResolution,
  isFileHashResult,
  isSensitivePathCheckResult
} from '@agentdeck/shared';

describe('Phase 7 type guards', () => {
  describe('isToolRiskLevel', () => {
    it('should accept valid risk levels', () => {
      expect(isToolRiskLevel('read-only')).toBe(true);
      expect(isToolRiskLevel('low')).toBe(true);
      expect(isToolRiskLevel('medium')).toBe(true);
      expect(isToolRiskLevel('high')).toBe(true);
      expect(isToolRiskLevel('critical')).toBe(true);
    });

    it('should reject invalid risk levels', () => {
      expect(isToolRiskLevel('invalid')).toBe(false);
      expect(isToolRiskLevel('')).toBe(false);
      expect(isToolRiskLevel(123)).toBe(false);
      expect(isToolRiskLevel(null)).toBe(false);
    });
  });

  describe('isToolName', () => {
    it('should accept valid tool names', () => {
      expect(isToolName('readFile')).toBe(true);
      expect(isToolName('searchFiles')).toBe(true);
      expect(isToolName('listDirectory')).toBe(true);
      expect(isToolName('proposePatch')).toBe(true);
      expect(isToolName('applyPatch')).toBe(true);
      expect(isToolName('deleteFile')).toBe(true);
      expect(isToolName('renameFile')).toBe(true);
      expect(isToolName('writeFile')).toBe(true);
    });

    it('should reject invalid tool names', () => {
      expect(isToolName('exec')).toBe(false);
      expect(isToolName('')).toBe(false);
      expect(isToolName(123)).toBe(false);
    });
  });

  describe('isToolClassification', () => {
    it('should accept valid classification', () => {
      expect(isToolClassification({
        name: 'readFile',
        riskLevel: 'read-only',
        requiresApproval: false,
        description: 'Read file'
      })).toBe(true);
    });

    it('should reject invalid classification', () => {
      expect(isToolClassification(null)).toBe(false);
      expect(isToolClassification({})).toBe(false);
      expect(isToolClassification({
        name: 'invalid',
        riskLevel: 'read-only',
        requiresApproval: false,
        description: 'x'
      })).toBe(false);
      expect(isToolClassification({
        name: 'readFile',
        riskLevel: 'invalid',
        requiresApproval: false,
        description: 'x'
      })).toBe(false);
    });
  });

  describe('isToolCallRequest', () => {
    it('should accept valid request', () => {
      expect(isToolCallRequest({
        callId: 'c1',
        toolName: 'readFile',
        args: { filePath: '/test.ts' }
      })).toBe(true);
    });

    it('should reject invalid request', () => {
      expect(isToolCallRequest(null)).toBe(false);
      expect(isToolCallRequest({})).toBe(false);
      expect(isToolCallRequest({
        callId: 'c1',
        toolName: 'invalid',
        args: {}
      })).toBe(false);
      expect(isToolCallRequest({
        callId: 'c1',
        toolName: 'readFile',
        args: 'not-an-object'
      })).toBe(false);
    });
  });

  describe('isToolCallResponse', () => {
    it('should accept ok response', () => {
      expect(isToolCallResponse({
        status: 'ok',
        callId: 'c1',
        result: { content: 'hello' }
      })).toBe(true);
    });

    it('should accept pending-approval response', () => {
      expect(isToolCallResponse({
        status: 'pending-approval',
        callId: 'c1',
        classification: {
          name: 'applyPatch',
          riskLevel: 'medium',
          requiresApproval: true,
          description: 'Apply patch'
        },
        expiresAt: Date.now() + 120000
      })).toBe(true);
    });

    it('should accept error response', () => {
      expect(isToolCallResponse({
        status: 'error',
        callId: 'c1',
        code: 'UNKNOWN',
        message: 'Something went wrong'
      })).toBe(true);
    });

    it('should accept denied response', () => {
      expect(isToolCallResponse({
        status: 'denied',
        callId: 'c1',
        reason: 'User denied'
      })).toBe(true);
    });

    it('should reject invalid response', () => {
      expect(isToolCallResponse(null)).toBe(false);
      expect(isToolCallResponse({})).toBe(false);
      expect(isToolCallResponse({
        status: 'unknown',
        callId: 'c1'
      })).toBe(false);
    });
  });

  describe('isApprovalDecision', () => {
    it('should accept valid decision', () => {
      expect(isApprovalDecision({
        callId: 'c1',
        approved: true
      })).toBe(true);
    });

    it('should accept decision with remember flag', () => {
      expect(isApprovalDecision({
        callId: 'c1',
        approved: false,
        remember: true
      })).toBe(true);
    });

    it('should reject invalid decision', () => {
      expect(isApprovalDecision(null)).toBe(false);
      expect(isApprovalDecision({})).toBe(false);
      expect(isApprovalDecision({
        callId: 'c1',
        approved: 'yes'
      })).toBe(false);
    });
  });

  describe('isPatchSet', () => {
    it('should accept valid patch set', () => {
      expect(isPatchSet({
        id: 'p1',
        filePath: '/test.ts',
        baseHash: 'abc123',
        operations: [{ text: 'new content', filePath: '/test.ts' }],
        author: 'agent',
        riskLevel: 'low',
        createdAt: Date.now()
      })).toBe(true);
    });

    it('should accept patch with range operations', () => {
      expect(isPatchSet({
        id: 'p1',
        filePath: '/test.ts',
        baseHash: 'abc123',
        operations: [{
          text: 'x',
          filePath: '/test.ts',
          range: { startLine: 1, startCol: 1, endLine: 1, endCol: 5 }
        }],
        author: 'agent',
        riskLevel: 'low',
        createdAt: Date.now()
      })).toBe(true);
    });

    it('should reject invalid patch set', () => {
      expect(isPatchSet(null)).toBe(false);
      expect(isPatchSet({})).toBe(false);
      expect(isPatchSet({
        id: 'p1',
        filePath: '/test.ts',
        baseHash: 'abc',
        operations: [],
        author: 'agent',
        riskLevel: 'invalid',
        createdAt: Date.now()
      })).toBe(false);
    });
  });

  describe('isPatchResult', () => {
    it('should accept ok result', () => {
      expect(isPatchResult({
        status: 'ok',
        patchId: 'p1',
        appliedHash: 'hash123'
      })).toBe(true);
    });

    it('should accept error result', () => {
      expect(isPatchResult({
        status: 'error',
        code: 'CONFLICT',
        message: 'File modified'
      })).toBe(true);
    });

    it('should reject invalid result', () => {
      expect(isPatchResult(null)).toBe(false);
      expect(isPatchResult({})).toBe(false);
    });
  });

  describe('isConflict', () => {
    it('should accept valid conflict', () => {
      expect(isConflict({
        id: 'c1',
        kind: 'patch-conflict',
        patchId: 'p1',
        filePath: '/test.ts',
        description: 'File modified',
        riskLevel: 'medium',
        createdAt: Date.now()
      })).toBe(true);
    });

    it('should accept all conflict kinds', () => {
      const kinds = ['patch-conflict', 'delete', 'rename', 'binary', 'multi-file', 'high-risk'] as const;
      for (const kind of kinds) {
        expect(isConflict({
          id: 'c1',
          kind,
          patchId: 'p1',
          filePath: '/test.ts',
          description: 'test',
          riskLevel: 'low',
          createdAt: 1
        })).toBe(true);
      }
    });

    it('should reject invalid conflict', () => {
      expect(isConflict(null)).toBe(false);
      expect(isConflict({})).toBe(false);
      expect(isConflict({
        id: 'c1',
        kind: 'unknown',
        patchId: 'p1',
        filePath: '/test.ts',
        description: 'test',
        riskLevel: 'low',
        createdAt: 1
      })).toBe(false);
    });
  });

  describe('isConflictResolution', () => {
    it('should accept apply resolution', () => {
      expect(isConflictResolution({
        conflictId: 'c1',
        action: 'apply'
      })).toBe(true);
    });

    it('should accept skip resolution', () => {
      expect(isConflictResolution({
        conflictId: 'c1',
        action: 'skip'
      })).toBe(true);
    });

    it('should accept edit resolution', () => {
      expect(isConflictResolution({
        conflictId: 'c1',
        action: 'edit',
        operations: [{ text: 'x', filePath: '/test.ts' }]
      })).toBe(true);
    });

    it('should reject invalid resolution', () => {
      expect(isConflictResolution(null)).toBe(false);
      expect(isConflictResolution({})).toBe(false);
      expect(isConflictResolution({
        conflictId: 'c1',
        action: 'unknown'
      })).toBe(false);
    });
  });

  describe('isFileHashResult', () => {
    it('should accept ok result', () => {
      expect(isFileHashResult({
        status: 'ok',
        hash: 'abc123'
      })).toBe(true);
    });

    it('should accept error result', () => {
      expect(isFileHashResult({
        status: 'error',
        code: 'FILE_NOT_FOUND',
        message: 'File not found'
      })).toBe(true);
    });

    it('should reject invalid result', () => {
      expect(isFileHashResult(null)).toBe(false);
      expect(isFileHashResult({})).toBe(false);
    });
  });

  describe('isSensitivePathCheckResult', () => {
    it('should accept valid result', () => {
      expect(isSensitivePathCheckResult({
        filePath: '/.env',
        isSensitive: true
      })).toBe(true);
    });

    it('should accept non-sensitive result', () => {
      expect(isSensitivePathCheckResult({
        filePath: '/src/index.ts',
        isSensitive: false
      })).toBe(true);
    });

    it('should reject invalid result', () => {
      expect(isSensitivePathCheckResult(null)).toBe(false);
      expect(isSensitivePathCheckResult({})).toBe(false);
      expect(isSensitivePathCheckResult({
        filePath: 123,
        isSensitive: true
      })).toBe(false);
    });
  });
});
