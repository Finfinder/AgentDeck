import { describe, expect, it } from 'vitest';
import {
  isAgentRuntimeEventEntry,
  isAgentRuntimePermissionScope,
  isAgentRuntimeResult,
  isAgentRuntimeResumeOptions,
  isAgentRuntimeSessionState,
  isAgentRuntimeStartSubagentOptions,
  isAgentRuntimeStartWorkerOptions,
  isAgentRuntimeTaskState,
  isAgentRuntimeWorkerOutput,
  isAgentRuntimeWorkerState,
  isApprovalDecision,
  isConflict,
  isConflictResolution,
  isEditorLanguage,
  isEditorTab,
  isEventLogResult,
  isFileHashResult,
  isFileOperationResult,
  isIdentitySession,
  isIdentitySessionWarning,
  isModelProviderConfig,
  isPatchResult,
  isPatchSet,
  isPermissionActionKind,
  isPermissionActorKind,
  isPermissionApprovalInput,
  isPermissionApprovalResult,
  isPermissionAuditEntry,
  isPermissionBrokerState,
  isPermissionDecision,
  isPermissionDecisionKind,
  isPermissionEvaluation,
  isPermissionGrant,
  isPermissionGrantDuration,
  isPermissionGrantScope,
  isPermissionPrompt,
  isPermissionRequest,
  isPermissionRiskLevel,
  isPermissionRuntimeKind,
  isSensitivePathCheckResult,
  isString,
  isToolCallRequest,
  isToolCallResponse,
  isToolClassification,
  isToolName,
  isToolRiskLevel
} from '../../packages/shared/src/ipc';

describe('ipc type guards — exhaustive coverage', () => {
  // Permission primitive kinds
  it('isPermissionActionKind — all valid values', () => {
    const valid = ['read', 'write', 'delete', 'terminal', 'network', 'mcpTool', 'secretsAccess', 'workspaceEdit'];
    for (const v of valid) expect(isPermissionActionKind(v)).toBe(true);
    expect(isPermissionActionKind('invalid')).toBe(false);
    expect(isPermissionActionKind(123)).toBe(false);
    expect(isPermissionActionKind(null)).toBe(false);
    expect(isPermissionActionKind(undefined)).toBe(false);
  });

  it('isPermissionActorKind — all valid values', () => {
    const valid = ['agent', 'extension', 'mcp', 'user'];
    for (const v of valid) expect(isPermissionActorKind(v)).toBe(true);
    expect(isPermissionActorKind('invalid')).toBe(false);
  });

  it('isPermissionDecisionKind — all valid values', () => {
    const valid = ['allow', 'prompt', 'deny'];
    for (const v of valid) expect(isPermissionDecisionKind(v)).toBe(true);
    expect(isPermissionDecisionKind('invalid')).toBe(false);
  });

  it('isPermissionRiskLevel — all valid values', () => {
    const valid = ['safe', 'low', 'medium', 'high', 'critical'];
    for (const v of valid) expect(isPermissionRiskLevel(v)).toBe(true);
    expect(isPermissionRiskLevel('invalid')).toBe(false);
  });

  it('isPermissionGrantDuration — all valid values', () => {
    const valid = ['once', 'session'];
    for (const v of valid) expect(isPermissionGrantDuration(v)).toBe(true);
    expect(isPermissionGrantDuration('invalid')).toBe(false);
  });

  it('isPermissionRuntimeKind — all valid values', () => {
    const valid = ['parent', 'subagent'];
    for (const v of valid) expect(isPermissionRuntimeKind(v)).toBe(true);
    expect(isPermissionRuntimeKind('invalid')).toBe(false);
  });

  // Complex permission types
  it('isPermissionGrantScope — valid and invalid', () => {
    expect(isPermissionGrantScope({ action: 'read' })).toBe(true);
    expect(isPermissionGrantScope({ action: 'invalid' })).toBe(false);
    expect(isPermissionGrantScope({})).toBe(true);
    expect(isPermissionGrantScope('scope')).toBe(false);
  });

  it('isPermissionGrant — valid and invalid', () => {
    const valid = {
      id: 'g1', sessionId: 's1', taskId: 't1', actorKind: 'agent',
      action: 'read', scope: {}, duration: 'once', requiresPrompt: false,
      grantedBy: 'user', createdAt: 1000, runtimeKind: 'parent', expiresAt: 2000
    };
    expect(isPermissionGrant(valid)).toBe(true);
    expect(isPermissionGrant({ ...valid, actorKind: 'invalid' })).toBe(false);
    expect(isPermissionGrant({ ...valid, action: 'invalid' })).toBe(false);
    expect(isPermissionGrant({ ...valid, duration: 'invalid' })).toBe(false);
    expect(isPermissionGrant({ ...valid, runtimeKind: 'invalid' })).toBe(false);
    expect(isPermissionGrant({ ...valid, taskId: undefined })).toBe(true);
    expect(isPermissionGrant({ ...valid, expiresAt: undefined })).toBe(true);
    expect(isPermissionGrant({})).toBe(false);
  });

  it('isPermissionRequest — valid and invalid', () => {
    const valid = {
      id: 'r1', sessionId: 's1', taskId: 't1', workerId: 'w1',
      actorKind: 'agent', kind: 'read', toolName: 'readFile', target: '/test.ts',
      metadata: {}, workspaceRoots: ['/ws'], runtimeKind: 'parent'
    };
    expect(isPermissionRequest(valid)).toBe(true);
    expect(isPermissionRequest({ ...valid, metadata: 'bad' })).toBe(false);
    expect(isPermissionRequest({ ...valid, workspaceRoots: ['ok', 1] })).toBe(false);
    expect(isPermissionRequest({ ...valid, workerId: undefined })).toBe(true);
    expect(isPermissionRequest({ ...valid, toolName: undefined })).toBe(true);
    expect(isPermissionRequest({})).toBe(false);
  });

  it('isPermissionEvaluation — valid and invalid', () => {
    expect(isPermissionEvaluation({ decision: 'allow', risk: 'safe', reason: 'ok' })).toBe(true);
    expect(isPermissionEvaluation({ decision: 'deny', risk: 'critical', reason: 'blocked', grant: { id: 'g1', sessionId: 's1', actorKind: 'agent', action: 'read', scope: {}, duration: 'once', requiresPrompt: false, grantedBy: 'user', createdAt: 1000 } })).toBe(true);
    expect(isPermissionEvaluation({ decision: 'invalid', risk: 'safe', reason: 'bad' })).toBe(false);
    expect(isPermissionEvaluation({ decision: 'allow', risk: 'invalid', reason: 'bad' })).toBe(false);
    expect(isPermissionEvaluation({ decision: 'allow', risk: 'safe', reason: 'bad', grant: {} })).toBe(false);
  });

  it('isPermissionDecision — valid and invalid', () => {
    const valid = {
      id: 'd1', requestId: 'r1', sessionId: 's1', taskId: 't1', workerId: 'w1',
      actorKind: 'agent', kind: 'read', target: '/test.ts', risk: 'low',
      decision: 'allow', reason: 'safe', createdAt: 1000
    };
    expect(isPermissionDecision(valid)).toBe(true);
    expect(isPermissionDecision({ ...valid, actorKind: 'invalid' })).toBe(false);
    expect(isPermissionDecision({ ...valid, kind: 'invalid' })).toBe(false);
    expect(isPermissionDecision({ ...valid, risk: 'invalid' })).toBe(false);
    expect(isPermissionDecision({ ...valid, decision: 'invalid' })).toBe(false);
    expect(isPermissionDecision({ ...valid, workerId: undefined })).toBe(true);
    expect(isPermissionDecision({})).toBe(false);
  });

  it('isPermissionPrompt — valid and invalid', () => {
    const valid = {
      decisionId: 'd1', requestId: 'r1', sessionId: 's1', taskId: 't1',
      workerId: 'w1', actorKind: 'agent', kind: 'write', toolName: 'writeFile',
      target: '/test.ts', runtimeKind: 'parent', risk: 'medium', reason: 'needs approval',
      metadata: {}, createdAt: 1000
    };
    expect(isPermissionPrompt(valid)).toBe(true);
    expect(isPermissionPrompt({ ...valid, metadata: 'bad' })).toBe(false);
    expect(isPermissionPrompt({ ...valid, risk: 'invalid' })).toBe(false);
    expect(isPermissionPrompt({})).toBe(false);
  });

  it('isPermissionApprovalInput — valid and invalid', () => {
    expect(isPermissionApprovalInput({ decisionId: 'd1', decision: 'allow', duration: 'once' })).toBe(true);
    expect(isPermissionApprovalInput({ decisionId: 'd1', decision: 'deny', duration: 'session', scope: {} })).toBe(true);
    expect(isPermissionApprovalInput({ decisionId: 'd1', decision: 'allow', duration: 'invalid' })).toBe(false);
    expect(isPermissionApprovalInput({ decisionId: 'd1', decision: 'maybe', duration: 'once' })).toBe(false);
    expect(isPermissionApprovalInput({})).toBe(false);
  });

  it('isPermissionApprovalResult — valid and invalid', () => {
    expect(isPermissionApprovalResult({ status: 'ok', decision: { id: 'd1', requestId: 'r1', sessionId: 's1', taskId: 't1', actorKind: 'agent', kind: 'read', target: '/t', risk: 'low', decision: 'allow', reason: 'ok', createdAt: 1000 } })).toBe(true);
    expect(isPermissionApprovalResult({ status: 'error', code: 'DECISION_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isPermissionApprovalResult({ status: 'error', code: 'INVALID_SCOPE', message: 'bad' })).toBe(true);
    expect(isPermissionApprovalResult({ status: 'error', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    expect(isPermissionApprovalResult({ status: 'error', code: 'INVALID', message: 'bad' })).toBe(false);
    expect(isPermissionApprovalResult({ status: 'ok', decision: {} })).toBe(false);
  });

  it('isPermissionAuditEntry — valid and invalid', () => {
    const valid = {
      id: 'a1', sessionId: 's1', taskId: 't1', workerId: 'w1', decisionId: 'd1',
      type: 'permission.decision', actorKind: 'agent', action: 'read', target: '/t',
      toolName: 'readFile', runtimeKind: 'parent', risk: 'low', decision: 'allow',
      reason: 'safe', createdAt: 1000, outcome: 'success', durationMs: 12
    };
    expect(isPermissionAuditEntry(valid)).toBe(true);
    expect(isPermissionAuditEntry({ ...valid, outcome: 'error' })).toBe(true);
    expect(isPermissionAuditEntry({ ...valid, outcome: 'blocked' })).toBe(true);
    expect(isPermissionAuditEntry({ ...valid, outcome: 'invalid' })).toBe(false);
    expect(isPermissionAuditEntry({ ...valid, action: 'invalid' })).toBe(false);
    expect(isPermissionAuditEntry({})).toBe(false);
  });

  it('isPermissionBrokerState — valid and invalid', () => {
    expect(isPermissionBrokerState({ decisions: [], prompts: [], grants: [], audit: [] })).toBe(true);
    expect(isPermissionBrokerState({ decisions: [{}], prompts: [], grants: [], audit: [] })).toBe(false);
  });

  // Identity guards
  it('isIdentitySession — valid and invalid', () => {
    expect(isIdentitySession({ isLoggedIn: false })).toBe(true);
    expect(isIdentitySession({ isLoggedIn: true, provider: 'github', profile: { login: 'user' } })).toBe(true);
    expect(isIdentitySession({ isLoggedIn: true, provider: 'github', profile: { login: 'user', id: 1, avatar_url: 'url', name: 'Name', email: null } })).toBe(true);
    expect(isIdentitySession({ isLoggedIn: true })).toBe(false);
    expect(isIdentitySession({ isLoggedIn: true, profile: {} })).toBe(false);
    expect(isIdentitySession('session')).toBe(false);
  });

  it('isIdentitySessionWarning — valid and invalid', () => {
    expect(isIdentitySessionWarning({ type: 'FALLBACK_FILE_STORE', reason: 'keytar unavailable', path: '/tmp' })).toBe(true);
    expect(isIdentitySessionWarning({ type: 'other', reason: 'x', path: '/tmp' })).toBe(false);
    expect(isIdentitySessionWarning({})).toBe(false);
  });

  // Editor guards
  it('isEditorLanguage — all valid values', () => {
    const valid = ['typescript', 'javascript', 'json', 'yaml', 'markdown', 'powershell', 'python', 'cpp', 'c', 'csharp', 'css', 'scss', 'less', 'html', 'dockerfile', 'plaintext'];
    for (const v of valid) expect(isEditorLanguage(v)).toBe(true);
    expect(isEditorLanguage('rust')).toBe(false);
  });

  it('isEditorTab — valid and invalid', () => {
    expect(isEditorTab({
      id: 'tab-1', filePath: '/src/app.ts', fileName: 'app.ts', language: 'typescript',
      isDirty: true, isPinned: false, revealLine: 1, revealCol: 2, revealPattern: 'app', revealNonce: 1
    })).toBe(true);
    expect(isEditorTab({
      id: 'tab-1', filePath: '/src/app.ts', fileName: 'app.ts', language: 'rust',
      isDirty: false, isPinned: false, revealLine: null, revealCol: null, revealPattern: null, revealNonce: 0
    })).toBe(false);
  });

  // File operation guards
  it('isFileOperationResult — valid and invalid', () => {
    expect(isFileOperationResult({ status: 'ok' })).toBe(true);
    expect(isFileOperationResult({ status: 'error', code: 'FILE_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isFileOperationResult({ status: 'error', code: 'ACCESS_DENIED', message: 'denied' })).toBe(true);
    expect(isFileOperationResult({ status: 'error', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    expect(isFileOperationResult({ status: 'error', code: 'WRITE_CONFLICT', message: 'conflict' })).toBe(false);
    expect(isFileOperationResult({})).toBe(false);
  });

  it('isEventLogResult — valid and invalid', () => {
    expect(isEventLogResult({ status: 'ok', entries: [], total: 0 })).toBe(true);
    expect(isEventLogResult({ status: 'error', code: 'UNKNOWN', message: 'failed' })).toBe(true);
    expect(isEventLogResult({ status: 'ok', entries: 'bad', total: 0 })).toBe(false);
    expect(isEventLogResult({ status: 'error', code: 'UNKNOWN' })).toBe(false);
  });

  it('isModelProviderConfig — valid and invalid', () => {
    expect(isModelProviderConfig({ baseUrl: 'http://localhost:11434', hasApiKey: false })).toBe(true);
    expect(isModelProviderConfig({ baseUrl: 123, hasApiKey: false })).toBe(false);
    expect(isModelProviderConfig({})).toBe(false);
  });

  // Tool guards
  it('isToolRiskLevel — all valid values', () => {
    const valid = ['read-only', 'low', 'medium', 'high', 'critical'];
    for (const v of valid) expect(isToolRiskLevel(v)).toBe(true);
    expect(isToolRiskLevel('invalid')).toBe(false);
  });

  it('isToolName — all valid values', () => {
    const valid = ['readFile', 'searchFiles', 'listDirectory', 'proposePatch', 'applyPatch', 'deleteFile', 'renameFile', 'writeFile'];
    for (const v of valid) expect(isToolName(v)).toBe(true);
    expect(isToolName('invalid')).toBe(false);
  });

  it('isToolClassification — valid and invalid', () => {
    expect(isToolClassification({ name: 'readFile', riskLevel: 'low', requiresApproval: false, description: 'Read' })).toBe(true);
    expect(isToolClassification({ name: 'invalid', riskLevel: 'low', requiresApproval: false, description: 'Read' })).toBe(false);
    expect(isToolClassification({ name: 'readFile', riskLevel: 'low', requiresApproval: 'yes', description: 'Read' })).toBe(false);
    expect(isToolClassification({})).toBe(false);
  });

  it('isToolCallRequest — valid and invalid', () => {
    expect(isToolCallRequest({ callId: 'c1', toolName: 'readFile', args: { path: '/t' } })).toBe(true);
    expect(isToolCallRequest({ callId: 'c1', toolName: 'invalid', args: {} })).toBe(false);
    expect(isToolCallRequest({ callId: 'c1', toolName: 'readFile', args: 'bad' })).toBe(false);
  });

  it('isToolCallResponse — all valid status codes', () => {
    expect(isToolCallResponse({ status: 'ok', callId: 'c1', result: {} })).toBe(true);
    expect(isToolCallResponse({ status: 'pending-approval', callId: 'c1', classification: { name: 'readFile', riskLevel: 'low', requiresApproval: true, description: 'Read' }, expiresAt: 2000 })).toBe(true);
    expect(isToolCallResponse({ status: 'error', callId: 'c1', code: 'TOOL_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isToolCallResponse({ status: 'error', callId: 'c1', code: 'ACCESS_DENIED', message: 'denied' })).toBe(true);
    expect(isToolCallResponse({ status: 'error', callId: 'c1', code: 'TIMEOUT', message: 'timeout' })).toBe(true);
    expect(isToolCallResponse({ status: 'error', callId: 'c1', code: 'WRITE_CONFLICT', message: 'conflict' })).toBe(true);
    expect(isToolCallResponse({ status: 'error', callId: 'c1', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    expect(isToolCallResponse({ status: 'denied', callId: 'c1', reason: 'user denied' })).toBe(true);
    expect(isToolCallResponse({ status: 'error', callId: 'c1', code: 'INVALID', message: 'bad' })).toBe(false);
    expect(isToolCallResponse({ status: 'unknown' })).toBe(false);
  });

  it('isApprovalDecision — valid and invalid', () => {
    expect(isApprovalDecision({ callId: 'c1', approved: true })).toBe(true);
    expect(isApprovalDecision({ callId: 'c1', approved: false, remember: true })).toBe(true);
    expect(isApprovalDecision({ callId: 'c1', approved: 'yes' })).toBe(false);
    expect(isApprovalDecision({})).toBe(false);
  });

  // Patch guards
  it('isPatchSet — valid and invalid', () => {
    expect(isPatchSet({
      id: 'p1', filePath: '/t.ts', baseHash: 'abc',
      operations: [{ filePath: '/t.ts', text: 'new' }],
      author: 'agent', riskLevel: 'low', createdAt: 1000
    })).toBe(true);
    expect(isPatchSet({
      id: 'p1', filePath: '/t.ts', baseHash: 'abc',
      operations: [{ filePath: '/t.ts', text: 'new', range: {} }],
      author: 'agent', riskLevel: 'low', createdAt: 1000
    })).toBe(false);
    expect(isPatchSet({
      id: 'p1', filePath: '/t.ts', baseHash: 'abc',
      operations: [],
      author: 'agent', riskLevel: 'invalid', createdAt: 1000
    })).toBe(false);
    expect(isPatchSet({})).toBe(false);
  });

  it('isPatchResult — valid and invalid', () => {
    expect(isPatchResult({ status: 'ok', patchId: 'p1', appliedHash: 'hash' })).toBe(true);
    expect(isPatchResult({ status: 'ok', patchId: 'p1', appliedHash: 'hash', autoMerged: true })).toBe(true);
    expect(isPatchResult({ status: 'error', code: 'CONFLICT', message: 'conflict' })).toBe(true);
    expect(isPatchResult({ status: 'error', code: 'FILE_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isPatchResult({ status: 'error', code: 'ACCESS_DENIED', message: 'denied' })).toBe(true);
    expect(isPatchResult({ status: 'error', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    expect(isPatchResult({ status: 'ok' })).toBe(false);
  });

  it('isConflict — all valid kinds', () => {
    expect(isConflict({ id: 'c1', kind: 'patch-conflict', patchId: 'p1', filePath: '/t.ts', description: 'conflict', riskLevel: 'high', createdAt: 1000 })).toBe(true);
    expect(isConflict({ id: 'c1', kind: 'delete', patchId: 'p1', filePath: '/t.ts', description: 'conflict', riskLevel: 'high', createdAt: 1000 })).toBe(true);
    expect(isConflict({ id: 'c1', kind: 'rename', patchId: 'p1', filePath: '/t.ts', description: 'conflict', riskLevel: 'high', createdAt: 1000 })).toBe(true);
    expect(isConflict({ id: 'c1', kind: 'binary', patchId: 'p1', filePath: '/t.ts', description: 'conflict', riskLevel: 'high', createdAt: 1000 })).toBe(true);
    expect(isConflict({ id: 'c1', kind: 'multi-file', patchId: 'p1', filePath: '/t.ts', description: 'conflict', riskLevel: 'high', createdAt: 1000 })).toBe(true);
    expect(isConflict({ id: 'c1', kind: 'high-risk', patchId: 'p1', filePath: '/t.ts', description: 'conflict', riskLevel: 'high', createdAt: 1000 })).toBe(true);
    expect(isConflict({ id: 'c1', kind: 'invalid', patchId: 'p1', filePath: '/t.ts', description: 'conflict', riskLevel: 'high', createdAt: 1000 })).toBe(false);
    expect(isConflict({})).toBe(false);
  });

  it('isConflictResolution — valid and invalid', () => {
    expect(isConflictResolution({ conflictId: 'c1', action: 'apply' })).toBe(true);
    expect(isConflictResolution({ conflictId: 'c1', action: 'skip' })).toBe(true);
    expect(isConflictResolution({ conflictId: 'c1', action: 'edit', operations: [{ filePath: '/t.ts', text: 'new' }] })).toBe(true);
    expect(isConflictResolution({ conflictId: 'c1', action: 'edit', operations: [{ filePath: '/t.ts', text: 'new', range: {} }] })).toBe(false);
    expect(isConflictResolution({ conflictId: 'c1', action: 'invalid' })).toBe(false);
    expect(isConflictResolution({ conflictId: 'c1' })).toBe(false);
  });

  it('isFileHashResult — valid and invalid', () => {
    expect(isFileHashResult({ status: 'ok', hash: 'abc' })).toBe(true);
    expect(isFileHashResult({ status: 'error', code: 'FILE_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isFileHashResult({ status: 'error', code: 'ACCESS_DENIED', message: 'denied' })).toBe(true);
    expect(isFileHashResult({ status: 'error', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    expect(isFileHashResult({ status: 'error', code: 'FILE_NOT_FOUND' })).toBe(false);
    expect(isFileHashResult({ status: 'unknown' })).toBe(false);
  });

  it('isSensitivePathCheckResult — valid and invalid', () => {
    expect(isSensitivePathCheckResult({ filePath: '/t.ts', isSensitive: false })).toBe(true);
    expect(isSensitivePathCheckResult({ filePath: '/secrets/key', isSensitive: true, matchedPattern: '**/secrets/**' })).toBe(true);
    expect(isSensitivePathCheckResult({ filePath: '/t.ts', isSensitive: 'yes' })).toBe(false);
    expect(isSensitivePathCheckResult({ isSensitive: false })).toBe(false);
  });

  // Agent runtime guards
  it('isAgentRuntimeResult — ok and error', () => {
    expect(isAgentRuntimeResult({ status: 'ok', value: 'done' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'ok', value: null })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'ok', value: undefined })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'ok' })).toBe(false);
    expect(isAgentRuntimeResult({ status: 'error', code: 'SESSION_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'error', code: 'WORKER_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'error', code: 'INVALID_SCOPE', message: 'bad' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'error', code: 'TASK_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'error', code: 'ALREADY_RUNNING', message: 'running' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'error', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'error', code: 'INVALID', message: 'bad' })).toBe(false);
    expect(isAgentRuntimeResult({ status: 'unknown' })).toBe(false);

    // valueGuard
    let called = false;
    expect(isAgentRuntimeResult({ status: 'ok', value: 'str' }, (v): v is string => { called = true; return typeof v === 'string'; })).toBe(true);
    expect(called).toBe(true);

    called = false;
    expect(isAgentRuntimeResult({ status: 'ok', value: 42 }, (v): v is string => { called = true; return typeof v === 'string'; })).toBe(false);
    expect(called).toBe(true);

    // valueGuard on malformed ok (no value)
    expect(isAgentRuntimeResult({ status: 'ok' }, (v): v is string => typeof v === 'string')).toBe(false);
  });

  it('isAgentRuntimePermissionScope — valid and invalid', () => {
    expect(isAgentRuntimePermissionScope({ sessionId: 's1', taskId: 't1', kind: 'parent', allowedTools: ['readFile'] })).toBe(true);
    expect(isAgentRuntimePermissionScope({ sessionId: 's1', taskId: 't1', kind: 'subagent', allowedTools: [] })).toBe(true);
    expect(isAgentRuntimePermissionScope({ sessionId: 's1', taskId: 't1', kind: 'invalid', allowedTools: [] })).toBe(false);
    expect(isAgentRuntimePermissionScope({ sessionId: 's1', taskId: 't1', kind: 'parent', allowedTools: ['readFile', 1] })).toBe(false);
    expect(isAgentRuntimePermissionScope({})).toBe(false);
  });

  it('isAgentRuntimeWorkerOutput — valid and invalid', () => {
    expect(isAgentRuntimeWorkerOutput({ summary: 'Done', references: [], toolsUsed: [] })).toBe(true);
    expect(isAgentRuntimeWorkerOutput({ summary: 'Done', references: [1], toolsUsed: [] })).toBe(false);
    expect(isAgentRuntimeWorkerOutput({ summary: 'Done', references: [], toolsUsed: [1] })).toBe(false);
    expect(isAgentRuntimeWorkerOutput({})).toBe(false);
  });

  it('isAgentRuntimeWorkerState — valid and invalid', () => {
    expect(isAgentRuntimeWorkerState({ id: 'w1', sessionId: 's1', taskId: 't1', status: 'idle', attempt: 1, maxRetries: 3 })).toBe(true);
    expect(isAgentRuntimeWorkerState({ id: 'w1', sessionId: 's1', taskId: 't1', status: 'running', attempt: 1, maxRetries: 3, lastError: 'err', startedAt: 1000, stoppedAt: 2000, output: { summary: 'Done', references: [], toolsUsed: [] } })).toBe(true);
    expect(isAgentRuntimeWorkerState({ id: 'w1', sessionId: 's1', taskId: 't1', status: 'invalid', attempt: 1, maxRetries: 3 })).toBe(false);
    expect(isAgentRuntimeWorkerState({ id: 'w1', sessionId: 's1', taskId: 't1', status: 'idle', attempt: 1, maxRetries: 3, lastError: 1 })).toBe(false);
    expect(isAgentRuntimeWorkerState({ id: 'w1', sessionId: 's1', taskId: 't1', status: 'idle', attempt: 1, maxRetries: 3, startedAt: 'bad' })).toBe(false);
    expect(isAgentRuntimeWorkerState({ id: 'w1', sessionId: 's1', taskId: 't1', status: 'idle', attempt: 1, maxRetries: 3, output: {} })).toBe(false);
  });

  it('isAgentRuntimeTaskState — valid and invalid', () => {
    expect(isAgentRuntimeTaskState({ id: 't1', sessionId: 's1', kind: 'chat', agentName: 'agent', modelId: 'model', prompt: 'prompt', status: 'completed', permissionScope: { sessionId: 's1', taskId: 't1', kind: 'parent', allowedTools: [] }, context: [], toolsUsed: [], createdAt: 1000, updatedAt: 2000 })).toBe(true);
    expect(isAgentRuntimeTaskState({ id: 't1', sessionId: 's1', kind: 'chat', agentName: 'agent', modelId: 'model', prompt: 'prompt', status: 'completed', permissionScope: { sessionId: 's1', taskId: 't1', kind: 'parent', allowedTools: [] }, context: [], toolsUsed: [], createdAt: 1000, updatedAt: 2000, parentTaskId: undefined, result: undefined, error: undefined })).toBe(true);
    expect(isAgentRuntimeTaskState({ id: 't1', sessionId: 's1', kind: 'chat', agentName: 'agent', modelId: 'model', prompt: 'prompt', status: 'completed', permissionScope: { sessionId: 's1', taskId: 't1', kind: 'parent', allowedTools: [] }, context: [], toolsUsed: [], createdAt: 1000, updatedAt: 2000, parentTaskId: 1 })).toBe(false);
    expect(isAgentRuntimeTaskState({ id: 't1', sessionId: 's1', kind: 'chat', agentName: 'agent', modelId: 'model', prompt: 'prompt', status: 'invalid', permissionScope: { sessionId: 's1', taskId: 't1', kind: 'parent', allowedTools: [] }, context: [], toolsUsed: [], createdAt: 1000, updatedAt: 2000 })).toBe(false);
  });

  it('isAgentRuntimeEventEntry — valid and invalid', () => {
    expect(isAgentRuntimeEventEntry({ id: 'e1', sessionId: 's1', type: 'session-created', message: 'Created', timestamp: 1000 })).toBe(true);
    expect(isAgentRuntimeEventEntry({ id: 'e1', sessionId: 's1', type: 'session-created', message: 'Created', timestamp: 1000, taskId: undefined, workerId: undefined })).toBe(true);
    expect(isAgentRuntimeEventEntry({ id: 'e1', sessionId: 's1', type: 'session-created', message: 'Created', timestamp: 1000, taskId: 1 })).toBe(false);
    expect(isAgentRuntimeEventEntry({ id: 'e1', sessionId: 's1', type: 'session-created', message: 'Created', timestamp: 1000, workerId: 1 })).toBe(false);
    expect(isAgentRuntimeEventEntry({ id: 'e1', sessionId: 's1', type: 'invalid', message: 'Created', timestamp: 1000 })).toBe(false);
  });

  it('isAgentRuntimeSessionState — valid and invalid', () => {
    expect(isAgentRuntimeSessionState({ id: 's1', chatTabId: 'tab-1', modelId: 'model', agentName: 'agent', status: 'active', permissionScope: { sessionId: 's1', taskId: 't1', kind: 'parent', allowedTools: [] }, context: [], eventLog: [], workers: [], tasks: [] })).toBe(true);
    expect(isAgentRuntimeSessionState({ id: 's1', chatTabId: 'tab-1', modelId: 'model', agentName: 'agent', status: 'active', permissionScope: { sessionId: 's1', taskId: 't1', kind: 'parent', allowedTools: [] }, context: [], eventLog: [], workers: [], tasks: [], resumeToken: undefined })).toBe(true);
    expect(isAgentRuntimeSessionState({ id: 's1', chatTabId: 'tab-1', modelId: 'model', agentName: 'agent', status: 'active', permissionScope: { sessionId: 's1', taskId: 't1', kind: 'parent', allowedTools: [] }, context: [], eventLog: [], workers: [], tasks: [], resumeToken: 1 })).toBe(false);
    expect(isAgentRuntimeSessionState({ id: 's1', chatTabId: 'tab-1', modelId: 'model', agentName: 'agent', status: 'invalid', permissionScope: { sessionId: 's1', taskId: 't1', kind: 'parent', allowedTools: [] }, context: [], eventLog: [], workers: [], tasks: [] })).toBe(false);
  });

  it('isAgentRuntimeStartWorkerOptions — valid and invalid', () => {
    expect(isAgentRuntimeStartWorkerOptions({ sessionId: 's1', taskId: 't1', prompt: 'prompt' })).toBe(true);
    expect(isAgentRuntimeStartWorkerOptions({ sessionId: 's1', taskId: 't1', prompt: 'prompt', context: [], allowedTools: [] })).toBe(true);
    expect(isAgentRuntimeStartWorkerOptions({ sessionId: 's1', taskId: 't1', prompt: 'prompt', context: [1] })).toBe(false);
    expect(isAgentRuntimeStartWorkerOptions({ sessionId: 's1', taskId: 't1', prompt: 'prompt', allowedTools: [1] })).toBe(false);
    expect(isAgentRuntimeStartWorkerOptions({ sessionId: 's1', taskId: 't1' })).toBe(false);
  });

  it('isAgentRuntimeStartSubagentOptions — valid and invalid', () => {
    expect(isAgentRuntimeStartSubagentOptions({ sessionId: 's1', name: 'sub', goal: 'goal', modelId: 'model' })).toBe(true);
    expect(isAgentRuntimeStartSubagentOptions({ sessionId: 's1', name: 'sub', goal: 'goal', modelId: 'model', parentTaskId: 'p1' })).toBe(true);
    expect(isAgentRuntimeStartSubagentOptions({ sessionId: 's1', name: 'sub', goal: 'goal', modelId: 'model', context: [1] })).toBe(false);
    expect(isAgentRuntimeStartSubagentOptions({ sessionId: 's1', name: 'sub', goal: 'goal', modelId: 'model', allowedTools: [1] })).toBe(false);
    expect(isAgentRuntimeStartSubagentOptions({ sessionId: 's1', name: 'sub', goal: 'goal', modelId: 'model', parentTaskId: 1 })).toBe(false);
    expect(isAgentRuntimeStartSubagentOptions({ sessionId: 's1', name: 'sub', goal: 'goal' })).toBe(false);
  });

  it('isAgentRuntimeResumeOptions — valid and invalid', () => {
    expect(isAgentRuntimeResumeOptions({ sessionId: 's1', workerId: 'w1' })).toBe(true);
    expect(isAgentRuntimeResumeOptions({ sessionId: 's1' })).toBe(false);
    expect(isAgentRuntimeResumeOptions({ workerId: 'w1' })).toBe(false);
  });

  it('isString — valid and invalid', () => {
    expect(isString('value')).toBe(true);
    expect(isString('')).toBe(true);
    expect(isString(123)).toBe(false);
    expect(isString(null)).toBe(false);
    expect(isString(undefined)).toBe(false);
  });
});
