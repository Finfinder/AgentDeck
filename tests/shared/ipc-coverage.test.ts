import { describe, expect, it } from 'vitest';
import type { PermissionDecision, PermissionGrant, PermissionGrantScope, PermissionRequest } from '@agentdeck/permission-broker';
import {
  isAgentRuntimeEventEntry,
  isAgentRuntimePermissionScope,
  isAgentRuntimeResumeOptions,
  isAgentRuntimeResult,
  isAgentRuntimeSessionState,
  isAgentRuntimeStartSubagentOptions,
  isAgentRuntimeStartWorkerOptions,
  isAgentRuntimeTaskState,
  isAgentRuntimeWorkerOutput,
  isAgentRuntimeWorkerState,
  isApprovalDecision,
  isChatMessage,
  isChatStreamEvent,
  isChatTabState,
  isCodeIndexStats,
  isConflict,
  isConflictResolution,
  isDiffInput,
  isDiffResult,
  isDirectoryListing,
  isEditorLanguage,
  isEditorTab,
  isEmbeddingMetadata,
  isEventLogResult,
  isFileHashResult,
  isFileOperationResult,
  isFileReadResult,
  isFileWriteResult,
  isFsChangeEvent,
  isIdentitySession,
  isIdentitySessionWarning,
  isIndexChunk,
  isMemoryApplyResult,
  isMemoryChangeProposal,
  isMemoryConflict,
  isMemoryConflictResolution,
  isMemoryEntry,
  isMemoryScope,
  isModelGatewayConfig,
  isModelInfo,
  isModelProviderConfig,
  isModelProviderId,
  isModelProviderState,
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
  isRetrievalQuery,
  isRetrievalResult,
  isSensitivePathCheckResult,
  isSendMessageResult,
  isStartupState,
  isString,
  isTestConnectionResult,
  isThemeSettings,
  isToolCall,
  isToolCallRequest,
  isToolCallResponse,
  isToolClassification,
  isToolName,
  isToolRiskLevel,
  isWorkspaceEditInput,
  isWorkspaceEditResult,
  isWorkspaceModel,
  isWorkspaceOpenRequest,
  isWorkspaceSelection
} from '../../packages/shared/src/ipc';

const permissionGrantScope = (overrides: Partial<PermissionGrantScope> = {}): PermissionGrantScope => ({
  toolName: 'readFile',
  action: 'read',
  workspaceGlob: '**/*.ts',
  host: 'example.com',
  command: 'npm test',
  mcpServerId: 'seq',
  ...overrides
});

const permissionGrant = (overrides: Partial<PermissionGrant> = {}): PermissionGrant => ({
  id: 'grant-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  actorKind: 'agent',
  action: 'read',
  scope: permissionGrantScope(),
  duration: 'once',
  requiresPrompt: false,
  grantedBy: 'user',
  createdAt: 1000,
  runtimeKind: 'parent',
  expiresAt: 2000,
  ...overrides
});

const invalidPermissionGrant = (overrides: Partial<Record<keyof PermissionGrant, unknown>>) => permissionGrant(overrides as Partial<PermissionGrant>);

const permissionRequest = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  id: 'request-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  workerId: 'worker-1',
  actorKind: 'agent',
  kind: 'read',
  toolName: 'readFile',
  target: '/src/app.ts',
  metadata: { reason: 'read source' },
  workspaceRoots: ['/workspace'],
  runtimeKind: 'parent',
  ...overrides
});

const invalidPermissionRequest = (overrides: Partial<Record<keyof PermissionRequest, unknown>>) => permissionRequest(overrides as Partial<PermissionRequest>);

const permissionDecision = (overrides: Partial<PermissionDecision> = {}): PermissionDecision => ({
  id: 'decision-1',
  requestId: 'request-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  workerId: 'worker-1',
  actorKind: 'agent',
  kind: 'read',
  toolName: 'readFile',
  target: '/src/app.ts',
  runtimeKind: 'parent',
  risk: 'low',
  decision: 'allow',
  reason: 'safe read',
  createdAt: 1000,
  ...overrides
});

const invalidPermissionDecision = (overrides: Partial<Record<keyof PermissionDecision, unknown>>) => permissionDecision(overrides as Partial<PermissionDecision>);

const permissionPrompt = () => ({
  decisionId: 'decision-1',
  requestId: 'request-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  workerId: 'worker-1',
  actorKind: 'agent',
  kind: 'write',
  toolName: 'writeFile',
  target: '/src/app.ts',
  runtimeKind: 'parent',
  risk: 'medium',
  reason: 'needs approval',
  metadata: { changedLines: [1, 2] },
  createdAt: 1000
});

const permissionAuditEntry = () => ({
  id: 'audit-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  workerId: 'worker-1',
  decisionId: 'decision-1',
  type: 'permission.decision',
  actorKind: 'agent',
  action: 'read',
  target: '/src/app.ts',
  toolName: 'readFile',
  runtimeKind: 'parent',
  risk: 'low',
  decision: 'allow',
  reason: 'safe',
  createdAt: 1000,
  outcome: 'success',
  durationMs: 12
});

const patchOperation = () => ({
  filePath: '/src/app.ts',
  range: {
    startLine: 1,
    startCol: 0,
    endLine: 2,
    endCol: 0
  },
  text: 'export const value = 1;',
  contextBefore: [''],
  contextAfter: ['console.log(value);']
});

const agentRuntimePermissionScope = () => ({
  sessionId: 'session-1',
  taskId: 'task-1',
  kind: 'parent',
  allowedTools: ['readFile']
});

const agentRuntimeWorkerOutput = () => ({
  summary: 'Done',
  references: ['/src/app.ts'],
  toolsUsed: ['readFile']
});

const agentRuntimeWorkerState = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'worker-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  status: 'idle',
  attempt: 1,
  maxRetries: 3,
  lastError: 'none',
  startedAt: 1000,
  stoppedAt: 2000,
  output: agentRuntimeWorkerOutput(),
  ...overrides
});

const agentRuntimeTaskState = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'task-1',
  sessionId: 'session-1',
  parentTaskId: 'parent-1',
  kind: 'chat',
  agentName: 'agent',
  modelId: 'model',
  prompt: 'prompt',
  status: 'completed',
  permissionScope: agentRuntimePermissionScope(),
  context: ['ctx'],
  toolsUsed: ['readFile'],
  result: agentRuntimeWorkerOutput(),
  error: 'done',
  createdAt: 1000,
  updatedAt: 2000,
  ...overrides
});

const agentRuntimeEventEntry = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'event-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  workerId: 'worker-1',
  type: 'task-completed',
  message: 'Completed',
  timestamp: 1000,
  ...overrides
});

const agentRuntimeSessionState = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'session-1',
  chatTabId: 'tab-1',
  modelId: 'model',
  agentName: 'agent',
  status: 'active',
  permissionScope: agentRuntimePermissionScope(),
  context: ['ctx'],
  eventLog: [agentRuntimeEventEntry()],
  workers: [agentRuntimeWorkerState()],
  tasks: [agentRuntimeTaskState()],
  resumeToken: 'token',
  ...overrides
});

const toolClassification = () => ({
  name: 'readFile',
  riskLevel: 'low',
  requiresApproval: false,
  description: 'Read a file'
});

const conflict = () => ({
  id: 'conflict-1',
  kind: 'patch-conflict',
  patchId: 'patch-1',
  filePath: '/src/app.ts',
  description: 'Patch conflicts with workspace',
  riskLevel: 'high',
  createdAt: 1000
});

describe('packages/shared ipc coverage type guards', () => {
  it('validates permission broker primitive kinds', () => {
    expect(isPermissionActionKind('read')).toBe(true);
    expect(isPermissionActionKind('write')).toBe(true);
    expect(isPermissionActionKind('delete')).toBe(true);
    expect(isPermissionActionKind('terminal')).toBe(true);
    expect(isPermissionActionKind('network')).toBe(true);
    expect(isPermissionActionKind('mcpTool')).toBe(true);
    expect(isPermissionActionKind('secretsAccess')).toBe(true);
    expect(isPermissionActionKind('workspaceEdit')).toBe(true);
    expect(isPermissionActionKind('invalid')).toBe(false);
    expect(isPermissionActionKind(123)).toBe(false);

    expect(isPermissionActorKind('agent')).toBe(true);
    expect(isPermissionActorKind('extension')).toBe(true);
    expect(isPermissionActorKind('mcp')).toBe(true);
    expect(isPermissionActorKind('user')).toBe(true);
    expect(isPermissionActorKind('invalid')).toBe(false);

    expect(isPermissionDecisionKind('allow')).toBe(true);
    expect(isPermissionDecisionKind('prompt')).toBe(true);
    expect(isPermissionDecisionKind('deny')).toBe(true);
    expect(isPermissionDecisionKind('invalid')).toBe(false);

    expect(isPermissionRiskLevel('safe')).toBe(true);
    expect(isPermissionRiskLevel('low')).toBe(true);
    expect(isPermissionRiskLevel('medium')).toBe(true);
    expect(isPermissionRiskLevel('high')).toBe(true);
    expect(isPermissionRiskLevel('critical')).toBe(true);
    expect(isPermissionRiskLevel('invalid')).toBe(false);

    expect(isPermissionGrantDuration('once')).toBe(true);
    expect(isPermissionGrantDuration('session')).toBe(true);
    expect(isPermissionGrantDuration('invalid')).toBe(false);

    expect(isPermissionRuntimeKind('parent')).toBe(true);
    expect(isPermissionRuntimeKind('subagent')).toBe(true);
    expect(isPermissionRuntimeKind('invalid')).toBe(false);
  });

  it('validates permission grant scopes, grants, requests and evaluations', () => {
    expect(isPermissionGrantScope(permissionGrantScope())).toBe(true);
    expect(isPermissionGrantScope({ action: 'read' })).toBe(true);
    expect(isPermissionGrantScope({ action: 'invalid' })).toBe(false);
    expect(isPermissionGrantScope('scope')).toBe(false);

    expect(isPermissionGrant(permissionGrant())).toBe(true);
    expect(isPermissionGrant(permissionGrant({ scope: { toolName: 'readFile' } }))).toBe(true);
    expect(isPermissionGrant(invalidPermissionGrant({ actorKind: 'invalid' }))).toBe(false);
    expect(isPermissionGrant(invalidPermissionGrant({ action: 'invalid' }))).toBe(false);
    expect(isPermissionGrant(invalidPermissionGrant({ duration: 'invalid' }))).toBe(false);
    expect(isPermissionGrant(invalidPermissionGrant({ runtimeKind: 'invalid' }))).toBe(false);
    expect(isPermissionGrant({})).toBe(false);

    expect(isPermissionRequest(permissionRequest())).toBe(true);
    expect(isPermissionRequest(permissionRequest({ metadata: {} }))).toBe(true);
    expect(isPermissionRequest(permissionRequest({ workspaceRoots: [] }))).toBe(true);
    expect(isPermissionRequest(invalidPermissionRequest({ metadata: 'bad' }))).toBe(false);
    expect(isPermissionRequest(invalidPermissionRequest({ workspaceRoots: ['ok', 1] }))).toBe(false);
    expect(isPermissionRequest({})).toBe(false);

    expect(isPermissionEvaluation({ decision: 'allow', risk: 'safe', reason: 'safe' })).toBe(true);
    expect(isPermissionEvaluation({ decision: 'deny', risk: 'critical', reason: 'blocked', grant: permissionGrant() })).toBe(true);
    expect(isPermissionEvaluation({ decision: 'invalid', risk: 'safe', reason: 'bad' })).toBe(false);
    expect(isPermissionEvaluation({ decision: 'allow', risk: 'invalid', reason: 'bad' })).toBe(false);
    expect(isPermissionEvaluation({ decision: 'allow', risk: 'safe', reason: 'bad', grant: {} })).toBe(false);
  });

  it('validates permission decisions, prompts, approvals, audit entries and broker state', () => {
    expect(isPermissionDecision(permissionDecision())).toBe(true);
    expect(isPermissionDecision(permissionDecision({ actorKind: 'user' }))).toBe(true);
    expect(isPermissionDecision(invalidPermissionDecision({ actorKind: 'invalid' }))).toBe(false);
    expect(isPermissionDecision({})).toBe(false);

    expect(isPermissionPrompt(permissionPrompt())).toBe(true);
    expect(isPermissionPrompt({ ...permissionPrompt(), metadata: {} })).toBe(true);
    expect(isPermissionPrompt({ ...permissionPrompt(), metadata: 'bad' })).toBe(false);
    expect(isPermissionPrompt({ ...permissionPrompt(), risk: 'invalid' })).toBe(false);
    expect(isPermissionPrompt({})).toBe(false);

    expect(isPermissionApprovalInput({ decisionId: 'decision-1', decision: 'allow', duration: 'once' })).toBe(true);
    expect(isPermissionApprovalInput({ decisionId: 'decision-1', decision: 'deny', duration: 'session', scope: permissionGrantScope() })).toBe(true);
    expect(isPermissionApprovalInput({ decisionId: 'decision-1', decision: 'allow', duration: 'invalid' })).toBe(false);
    expect(isPermissionApprovalInput({ decisionId: 'decision-1', decision: 'maybe', duration: 'once' })).toBe(false);
    expect(isPermissionApprovalInput({ decisionId: 'decision-1', decision: 'allow', duration: 'once', scope: { action: 'invalid' } })).toBe(false);
    expect(isPermissionApprovalInput({})).toBe(false);

    expect(isPermissionApprovalResult({ status: 'ok', decision: permissionDecision(), grant: permissionGrant() })).toBe(true);
    expect(isPermissionApprovalResult({ status: 'ok', decision: permissionDecision() })).toBe(true);
    expect(isPermissionApprovalResult({ status: 'error', code: 'DECISION_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isPermissionApprovalResult({ status: 'error', code: 'INVALID_SCOPE', message: 'bad scope' })).toBe(true);
    expect(isPermissionApprovalResult({ status: 'error', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    expect(isPermissionApprovalResult({ status: 'error', code: 'INVALID', message: 'bad' })).toBe(false);
    expect(isPermissionApprovalResult({ status: 'ok', decision: {} })).toBe(false);

    expect(isPermissionAuditEntry(permissionAuditEntry())).toBe(true);
    expect(isPermissionAuditEntry({ ...permissionAuditEntry(), outcome: 'error' })).toBe(true);
    expect(isPermissionAuditEntry({ ...permissionAuditEntry(), outcome: 'blocked' })).toBe(true);
    expect(isPermissionAuditEntry({ ...permissionAuditEntry(), outcome: 'invalid' })).toBe(false);
    expect(isPermissionAuditEntry({ ...permissionAuditEntry(), action: 'invalid' })).toBe(false);
    expect(isPermissionAuditEntry({})).toBe(false);

    expect(isPermissionBrokerState({ decisions: [], prompts: [], grants: [], audit: [] })).toBe(true);
    expect(isPermissionBrokerState({
      decisions: [permissionDecision()],
      prompts: [permissionPrompt()],
      grants: [permissionGrant()],
      audit: [permissionAuditEntry()]
    })).toBe(true);
    expect(isPermissionBrokerState({ decisions: [{}], prompts: [], grants: [], audit: [] })).toBe(false);
  });

  it('validates identity, string and editor guards', () => {
    expect(isString('value')).toBe(true);
    expect(isString(123)).toBe(false);

    expect(isIdentitySession({ isLoggedIn: false })).toBe(true);
    expect(isIdentitySession({ isLoggedIn: true, provider: 'github', profile: { login: 'user' } })).toBe(true);
    expect(isIdentitySession({ isLoggedIn: true, provider: 'github', profile: { login: 'user', id: 1, avatar_url: 'url', name: 'Name', email: null } })).toBe(true);
    expect(isIdentitySession({ isLoggedIn: true })).toBe(false);
    expect(isIdentitySession({ isLoggedIn: true, profile: {} })).toBe(false);
    expect(isIdentitySession({})).toBe(false);
    expect(isIdentitySession('session')).toBe(false);

    expect(isIdentitySessionWarning({ type: 'FALLBACK_FILE_STORE', reason: 'keytar unavailable', path: '/tmp' })).toBe(true);
    expect(isIdentitySessionWarning({ type: 'other', reason: 'x', path: '/tmp' })).toBe(false);
    expect(isIdentitySessionWarning({})).toBe(false);

    expect(isEditorLanguage('typescript')).toBe(true);
    expect(isEditorLanguage('javascript')).toBe(true);
    expect(isEditorLanguage('json')).toBe(true);
    expect(isEditorLanguage('yaml')).toBe(true);
    expect(isEditorLanguage('markdown')).toBe(true);
    expect(isEditorLanguage('powershell')).toBe(true);
    expect(isEditorLanguage('python')).toBe(true);
    expect(isEditorLanguage('cpp')).toBe(true);
    expect(isEditorLanguage('c')).toBe(true);
    expect(isEditorLanguage('csharp')).toBe(true);
    expect(isEditorLanguage('css')).toBe(true);
    expect(isEditorLanguage('scss')).toBe(true);
    expect(isEditorLanguage('less')).toBe(true);
    expect(isEditorLanguage('html')).toBe(true);
    expect(isEditorLanguage('dockerfile')).toBe(true);
    expect(isEditorLanguage('plaintext')).toBe(true);
    expect(isEditorLanguage('rust')).toBe(false);

    expect(isEditorTab({
      id: 'tab-1',
      filePath: '/src/app.ts',
      fileName: 'app.ts',
      language: 'typescript',
      isDirty: true,
      isPinned: false,
      revealLine: 1,
      revealCol: 2,
      revealPattern: 'app',
      revealNonce: 1
    })).toBe(true);
    expect(isEditorTab({
      id: 'tab-1',
      filePath: '/src/app.ts',
      fileName: 'app.ts',
      language: 'rust',
      isDirty: false,
      isPinned: false,
      revealLine: null,
      revealCol: null,
      revealPattern: null,
      revealNonce: 0
    })).toBe(false);
  });

  it('validates workspace, editor, file and diff guards', () => {
    expect(isThemeSettings({ theme: 'dark' })).toBe(true);
    expect(isThemeSettings({ theme: 'light' })).toBe(true);
    expect(isThemeSettings({ theme: 'blue' })).toBe(false);

    expect(isWorkspaceOpenRequest({ kind: 'folder' })).toBe(true);
    expect(isWorkspaceOpenRequest({ kind: 'workspace-file' })).toBe(true);
    expect(isWorkspaceOpenRequest({ kind: 'file' })).toBe(false);

    expect(isWorkspaceSelection({ status: 'cancelled' })).toBe(true);
    expect(isWorkspaceSelection({ status: 'selected', kind: 'folder', path: '/ws', name: 'ws' })).toBe(true);
    expect(isWorkspaceSelection({ status: 'selected', kind: 'workspace-file', path: '/ws/app.code-workspace', name: 'app' })).toBe(true);
    expect(isWorkspaceSelection({ status: 'selected', kind: 'folder', path: '/ws' })).toBe(false);

    expect(isStartupState({ status: 'ready', appVersion: '1.0.0', services: [{ id: 'workspace-service', label: 'Workspace', status: 'ready' }] })).toBe(true);
    expect(isStartupState({ status: 'ready', appVersion: '1.0.0', services: [{ id: 'invalid', label: 'Invalid', status: 'ready' }] })).toBe(false);
    expect(isStartupState({ status: 'error', appVersion: '1.0.0', code: 'INVALID_STARTUP_STATE', message: 'bad' })).toBe(true);
    expect(isStartupState({ status: 'error', appVersion: '1.0.0', code: 'INVALID', message: 'bad' })).toBe(false);

    expect(isWorkspaceModel({ status: 'ok', filePath: '/ws', kind: 'folder', folders: [{ path: '/ws', name: 'ws' }] })).toBe(true);
    expect(isWorkspaceModel({ status: 'ok', filePath: '/ws/app.code-workspace', kind: 'workspace-file', folders: [] })).toBe(true);
    expect(isWorkspaceModel({ status: 'error', code: 'EMPTY_WORKSPACE', message: 'empty' })).toBe(true);
    expect(isWorkspaceModel({ status: 'ok', filePath: '/ws', kind: 'folder', folders: [{ path: 1 }] })).toBe(false);

    expect(isDirectoryListing({ path: '/ws', entries: [{ name: 'src', path: '/ws/src', kind: 'directory', isSensitive: false }] })).toBe(true);
    expect(isDirectoryListing({ path: '/ws', entries: [{ name: 'src', path: '/ws/src', kind: 'file', isSensitive: true }] })).toBe(true);
    expect(isDirectoryListing({ path: '/ws', entries: [{ name: 'src', path: '/ws/src', kind: 'file', isSensitive: 'yes' }] })).toBe(false);

    expect(isFsChangeEvent({ kind: 'add', path: '/ws/a.ts' })).toBe(true);
    expect(isFsChangeEvent({ kind: 'change', path: '/ws/a.ts' })).toBe(true);
    expect(isFsChangeEvent({ kind: 'unlink', path: '/ws/a.ts' })).toBe(true);
    expect(isFsChangeEvent({ kind: 'addDir', path: '/ws/src' })).toBe(true);
    expect(isFsChangeEvent({ kind: 'unknown', path: '/ws/a.ts' })).toBe(false);

    expect(isFileReadResult({ status: 'ok', content: 'text', encoding: 'utf8' })).toBe(true);
    expect(isFileReadResult({ status: 'error', code: 'ENCODING_ERROR', message: 'bad encoding' })).toBe(true);
    expect(isFileReadResult({ status: 'error', code: 'UNKNOWN', message: 'bad' })).toBe(true);
    expect(isFileReadResult({ status: 'error', code: 'UNKNOWN' })).toBe(false);

    expect(isFileWriteResult({ status: 'ok' })).toBe(true);
    expect(isFileWriteResult({ status: 'error', code: 'WRITE_CONFLICT', message: 'conflict' })).toBe(true);
    expect(isFileWriteResult({ status: 'error', code: 'UNKNOWN', message: 'bad' })).toBe(true);
    expect(isFileWriteResult({ status: 'error', code: 'UNKNOWN' })).toBe(false);

    expect(isWorkspaceEditInput({ operations: [{ filePath: '/ws/a.ts', range: { startLine: 1, startCol: 0, endLine: 2, endCol: 0 }, text: 'x' }] })).toBe(true);
    expect(isWorkspaceEditInput({ operations: [{ filePath: '/ws/a.ts', text: 'x' }] })).toBe(true);
    expect(isWorkspaceEditInput({ operations: [{ filePath: '/ws/a.ts', range: { startLine: 1, startCol: 0, endLine: 'bad', endCol: 0 }, text: 'x' }] })).toBe(false);
    expect(isWorkspaceEditInput({ operations: 'bad' })).toBe(false);

    expect(isWorkspaceEditResult({ status: 'ok' })).toBe(true);
    expect(isWorkspaceEditResult({ status: 'error', code: 'WRITE_CONFLICT', message: 'conflict' })).toBe(true);
    expect(isWorkspaceEditResult({ status: 'error', code: 'UNKNOWN' })).toBe(false);

    expect(isDiffInput({ original: 'old', modified: 'new', filePath: '/ws/a.ts' })).toBe(true);
    expect(isDiffInput({ original: 'old', modified: 'new' })).toBe(true);
    expect(isDiffInput({ original: 'old' })).toBe(false);

    expect(isDiffResult({ status: 'ok', diff: 'diff' })).toBe(true);
    expect(isDiffResult({ status: 'error', code: 'UNKNOWN', message: 'bad' })).toBe(true);
    expect(isDiffResult({ status: 'ok', diff: 1 })).toBe(false);
  });

  it('validates model gateway, chat, event log and secure config guards', () => {
    const modelInfo = { id: 'gpt-test', name: 'GPT Test', provider: 'openai-compatible' as const, contextWindow: 8000, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false };
    const providerState = { id: 'openai-compatible' as const, label: 'OpenAI compatible', status: 'ready' as const, baseUrl: 'https://api.example.test', models: [modelInfo] };

    expect(isModelProviderId('openrouter')).toBe(true);
    expect(isModelProviderId('ollama')).toBe(true);
    expect(isModelProviderId('lmstudio')).toBe(true);
    expect(isModelProviderId('openai-compatible')).toBe(true);
    expect(isModelProviderId('unknown')).toBe(false);

    expect(isModelInfo(modelInfo)).toBe(true);
    expect(isModelInfo({ ...modelInfo, provider: 'unknown' })).toBe(false);
    expect(isModelInfo({ id: 'm', name: 'M', provider: 'ollama', contextWindow: 100, supportsTools: true, supportsStreaming: false, supportsEmbeddings: true })).toBe(true);

    expect(isModelProviderState(providerState)).toBe(true);
    expect(isModelProviderState({ ...providerState, status: 'checking' })).toBe(true);
    expect(isModelProviderState({ ...providerState, status: 'invalid' })).toBe(false);
    expect(isModelProviderState({ ...providerState, models: [{ ...modelInfo, supportsTools: 'yes' }] })).toBe(false);

    expect(isModelGatewayConfig({ providers: [providerState], activeProvider: 'ollama', activeModel: 'default' })).toBe(true);
    expect(isModelGatewayConfig({ providers: [], activeProvider: 'ollama', activeModel: 'default' })).toBe(true);
    expect(isModelGatewayConfig({ providers: [], activeProvider: 'unknown', activeModel: 'default' })).toBe(false);

    const toolCall = { id: 'call-1', type: 'function' as const, function: { name: 'readFile', arguments: '{"path":"/ws/a.ts"}' } };
    expect(isToolCall(toolCall)).toBe(true);
    expect(isToolCall({ id: 'call-1', type: 'unknown', function: toolCall.function })).toBe(false);
    expect(isToolCall({ id: 'call-1', type: 'function', function: { name: 'readFile', arguments: 1 } })).toBe(false);

    expect(isChatMessage({ role: 'user', content: 'hello', timestamp: 1 })).toBe(true);
    expect(isChatMessage({ role: 'assistant', content: 'hi', timestamp: 2, tool_calls: [toolCall], tool_call_id: 'call-1' })).toBe(true);
    expect(isChatMessage({ role: 'tool', content: 'ok', timestamp: 3, tool_call_id: 1 })).toBe(false);

    expect(isChatTabState({ id: 'tab-1', title: 'Chat', messages: [], activeModel: 'default', activeProvider: 'ollama', isStreaming: false })).toBe(true);
    expect(isChatTabState({ id: 'tab-1', title: 'Chat', messages: [{ role: 'user', content: 'hello', timestamp: 1 }], activeModel: 'default', activeProvider: 'ollama', isStreaming: true, runtimeSessionId: 's1', runtimeWorkerId: 'w1', error: 'bad' })).toBe(true);
    expect(isChatTabState({ id: 'tab-1', title: 'Chat', messages: [], activeModel: 'default', activeProvider: 'unknown', isStreaming: false })).toBe(false);

    expect(isChatStreamEvent({ type: 'chunk', content: 'hi' })).toBe(true);
    expect(isChatStreamEvent({ type: 'tool_use', toolCall })).toBe(true);
    expect(isChatStreamEvent({ type: 'done' })).toBe(true);
    expect(isChatStreamEvent({ type: 'error', message: 'bad' })).toBe(true);
    expect(isChatStreamEvent({ type: 'info', message: 'info' })).toBe(true);
    expect(isChatStreamEvent({ type: 'unknown' })).toBe(false);

    expect(isSendMessageResult({ status: 'ok' })).toBe(true);
    expect(isSendMessageResult({ status: 'error', code: 'NETWORK_ERROR', message: 'offline' })).toBe(true);
    expect(isSendMessageResult({ status: 'error', code: 'UNKNOWN', message: 'bad' })).toBe(true);
    expect(isSendMessageResult({ status: 'error', code: 'UNKNOWN' })).toBe(false);

    expect(isTestConnectionResult({ status: 'ok', models: [modelInfo] })).toBe(true);
    expect(isTestConnectionResult({ status: 'error', message: 'bad' })).toBe(true);
    expect(isTestConnectionResult({ status: 'error', message: 'bad', models: [] })).toBe(true);
    expect(isTestConnectionResult({ status: 'error' })).toBe(false);

    expect(isModelProviderConfig({ baseUrl: 'http://localhost:11434', hasApiKey: false })).toBe(true);
    expect(isModelProviderConfig({ baseUrl: 123, hasApiKey: false })).toBe(false);
  });

  it('validates memory, retrieval, index chunk and code stats guards', () => {
    const memoryEntry = {
      id: 'mem-1',
      scope: 'repo' as const,
      filePath: '/repo/test.md',
      title: 'Test',
      checksum: 'abc',
      sourceKind: 'markdown' as const,
      createdSource: 'agent' as const,
      createdAt: 1,
      updatedAt: 2,
      tags: ['test']
    };
    const patch = {
      id: 'patch-1',
      filePath: '/repo/test.md',
      baseHash: 'abc',
      operations: [patchOperation()],
      author: 'agent',
      riskLevel: 'low' as const,
      createdAt: 1
    };
    const indexChunk = {
      id: 'chunk-1',
      filePath: '/repo/test.ts',
      language: 'typescript',
      scope: 'repo' as const,
      startLine: 1,
      endLine: 10,
      startCol: 0,
      endCol: 100,
      text: 'export const x = 1;',
      checksum: 'abc',
      createdAt: 1,
      metadata: { symbol: 'x' }
    };

    expect(isMemoryScope('user')).toBe(true);
    expect(isMemoryScope('workspace')).toBe(true);
    expect(isMemoryScope('repo')).toBe(true);
    expect(isMemoryScope('unknown')).toBe(false);

    expect(isMemoryEntry(memoryEntry)).toBe(true);
    expect(isMemoryEntry({ ...memoryEntry, tags: undefined })).toBe(true);
    expect(isMemoryEntry({ ...memoryEntry, scope: 'unknown' })).toBe(false);
    expect(isMemoryEntry({ ...memoryEntry, tags: ['ok', 1] })).toBe(false);

    expect(isMemoryChangeProposal({ scope: 'repo', filePath: '/repo/test.md', patch })).toBe(true);
    expect(isMemoryChangeProposal({ scope: 'unknown', filePath: '/repo/test.md', patch })).toBe(false);

    expect(isMemoryApplyResult({ status: 'ok', entry: memoryEntry })).toBe(true);
    expect(isMemoryApplyResult({ status: 'ok', entry: memoryEntry, autoMerged: true })).toBe(true);
    expect(isMemoryApplyResult({ status: 'error', code: 'CONFLICT', message: 'conflict' })).toBe(true);
    expect(isMemoryApplyResult({ status: 'error', code: 'CONFLICT', message: 'conflict', conflict: { id: 'mem-conflict', kind: 'memory-conflict', proposalId: 'proposal-1', filePath: '/repo/test.md', description: 'bad', riskLevel: 'high', createdAt: 1 } })).toBe(true);
    expect(isMemoryApplyResult({ status: 'error', code: 'CONFLICT' })).toBe(true);
    expect(isMemoryApplyResult({ status: 'ok' })).toBe(false);

    expect(isMemoryConflict({ id: 'mem-conflict', kind: 'memory-high-risk', proposalId: 'proposal-1', filePath: '/repo/test.md', description: 'bad', riskLevel: 'critical', createdAt: 1 })).toBe(true);
    expect(isMemoryConflict({ id: 'mem-conflict', kind: 'memory-deleted', proposalId: 'proposal-1', filePath: '/repo/test.md', description: 'deleted', riskLevel: 'read-only', createdAt: 1 })).toBe(true);
    expect(isMemoryConflict({ id: 'mem-conflict', kind: 'memory-conflict' })).toBe(false);

    expect(isMemoryConflictResolution({ conflictId: 'mem-conflict', action: 'apply' })).toBe(true);
    expect(isMemoryConflictResolution({ conflictId: 'mem-conflict', action: 'skip' })).toBe(true);
    expect(isMemoryConflictResolution({ conflictId: 'mem-conflict', action: 'edit', text: 'new' })).toBe(true);
    expect(isMemoryConflictResolution({ conflictId: 'mem-conflict', action: 'edit' })).toBe(false);
    expect(isMemoryConflictResolution({ conflictId: 'mem-conflict', action: 'invalid' })).toBe(false);

    expect(isRetrievalQuery({ text: 'read file', scopes: ['repo'], languages: ['typescript'], folders: ['src'], since: 1, maxResults: 5, includeMemory: true, includeCode: false })).toBe(true);
    expect(isRetrievalQuery({ text: 'read file', scopes: ['unknown'] })).toBe(false);
    expect(isRetrievalQuery({ text: 'read file', languages: ['ts', 1] })).toBe(false);
    expect(isRetrievalQuery({ text: 'read file', since: '1' })).toBe(false);
    expect(isRetrievalQuery({ text: 'read file', maxResults: '5' })).toBe(false);
    expect(isRetrievalQuery({ text: 'read file', includeMemory: 'yes' })).toBe(false);

    expect(isRetrievalResult({ kind: 'memory', chunkId: 'chunk-1', filePath: '/repo/test.md', text: 'text', score: 0.5, metadata: {}, checksum: 'abc', createdAt: 1 })).toBe(true);
    expect(isRetrievalResult({ kind: 'code', chunkId: 'chunk-1', filePath: '/repo/test.ts', text: 'code', score: 0.7, metadata: { symbol: 'x' } })).toBe(true);
    expect(isRetrievalResult({ kind: 'unknown', chunkId: 'chunk-1', filePath: '/repo/test.ts', text: 'code', score: 0.7, metadata: {} })).toBe(false);
    expect(isRetrievalResult({ kind: 'code', chunkId: 'chunk-1', filePath: '/repo/test.ts', text: 'code', score: 0.7, metadata: 'bad' })).toBe(false);

    expect(isIndexChunk(indexChunk)).toBe(true);
    expect(isIndexChunk({ ...indexChunk, scope: undefined, metadata: undefined })).toBe(true);
    expect(isIndexChunk({ ...indexChunk, scope: 'unknown' })).toBe(false);
    expect(isIndexChunk({ ...indexChunk, metadata: 'bad' })).toBe(false);

    expect(isEmbeddingMetadata({ model: 'test', dimension: 8, indexVersion: 'phase9-v1', scope: 'repo', language: 'typescript', folder: '/repo', updatedAt: 1 })).toBe(true);
    expect(isEmbeddingMetadata({ model: 'test', dimension: 8, indexVersion: 'phase9-v1' })).toBe(true);
    expect(isEmbeddingMetadata({ model: 'test', dimension: 8, indexVersion: 'phase9-v1', scope: 'unknown' })).toBe(false);
    expect(isEmbeddingMetadata({ model: 'test', dimension: 8, indexVersion: 'phase9-v1', language: 1 })).toBe(false);

    expect(isCodeIndexStats({ chunks: 1, files: 1, languages: { typescript: 1 }, indexVersion: 'phase9-v1' })).toBe(true);
    expect(isCodeIndexStats({ chunks: 1, files: 1, languages: {}, indexVersion: 'phase9-v1' })).toBe(true);
    expect(isCodeIndexStats({ chunks: 1, files: 1, languages: { typescript: 1 }, indexVersion: 1 })).toBe(false);
  });

  it('validates event log result aliases', () => {
    expect(isEventLogResult({ status: 'ok', entries: [], total: 0 })).toBe(true);
    expect(isEventLogResult({ status: 'error', code: 'UNKNOWN', message: 'failed' })).toBe(true);
    expect(isEventLogResult({ status: 'error', code: 'UNKNOWN' })).toBe(false);
    expect(isEventLogResult({ status: 'ok', entries: 'bad', total: 0 })).toBe(false);
  });

  it('validates file operation, event log and model provider config guards', () => {
    expect(isFileOperationResult({ status: 'ok' })).toBe(true);
    expect(isFileOperationResult({ status: 'error', code: 'FILE_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isFileOperationResult({ status: 'error', code: 'ACCESS_DENIED', message: 'denied' })).toBe(true);
    expect(isFileOperationResult({ status: 'error', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    expect(isFileOperationResult({ status: 'error', code: 'WRITE_CONFLICT', message: 'conflict' })).toBe(false);
    expect(isFileOperationResult({})).toBe(false);

    expect(isEventLogResult({ status: 'ok', entries: [], total: 0 })).toBe(true);
    expect(isEventLogResult({ status: 'ok', entries: [{ id: '1', timestamp: 1, level: 'info', source: 'test', message: 'ok' }], total: 1 })).toBe(true);
    expect(isEventLogResult({ status: 'error', code: 'UNKNOWN', message: 'failed' })).toBe(true);
    expect(isEventLogResult({ status: 'ok', entries: 'bad', total: 0 })).toBe(false);
    expect(isEventLogResult({ status: 'error', code: 'UNKNOWN' })).toBe(false);
    expect(isEventLogResult({ status: 'unknown' })).toBe(false);

    expect(isModelProviderConfig({ baseUrl: 'http://localhost:11434', hasApiKey: false })).toBe(true);
    expect(isModelProviderConfig({ baseUrl: 'http://localhost:11434', hasApiKey: true })).toBe(true);
    expect(isModelProviderConfig({ baseUrl: 123, hasApiKey: false })).toBe(false);
    expect(isModelProviderConfig({})).toBe(false);
  });

  it('validates phase 7 tool, patch and conflict guards', () => {
    expect(isToolRiskLevel('read-only')).toBe(true);
    expect(isToolRiskLevel('low')).toBe(true);
    expect(isToolRiskLevel('medium')).toBe(true);
    expect(isToolRiskLevel('high')).toBe(true);
    expect(isToolRiskLevel('critical')).toBe(true);
    expect(isToolRiskLevel('invalid')).toBe(false);

    expect(isToolName('readFile')).toBe(true);
    expect(isToolName('searchFiles')).toBe(true);
    expect(isToolName('listDirectory')).toBe(true);
    expect(isToolName('proposePatch')).toBe(true);
    expect(isToolName('applyPatch')).toBe(true);
    expect(isToolName('deleteFile')).toBe(true);
    expect(isToolName('renameFile')).toBe(true);
    expect(isToolName('writeFile')).toBe(true);
    expect(isToolName('invalid')).toBe(false);

    expect(isToolClassification(toolClassification())).toBe(true);
    expect(isToolClassification({ ...toolClassification(), name: 'invalid' })).toBe(false);
    expect(isToolClassification({ ...toolClassification(), requiresApproval: 'yes' })).toBe(false);
    expect(isToolClassification({})).toBe(false);

    expect(isToolCallRequest({ callId: 'call-1', toolName: 'readFile', args: { path: '/src/app.ts' } })).toBe(true);
    expect(isToolCallRequest({ callId: 'call-1', toolName: 'readFile', args: {}, session: 'session-1' })).toBe(true);
    expect(isToolCallRequest({ callId: 'call-1', toolName: 'invalid', args: {} })).toBe(false);
    expect(isToolCallRequest({ callId: 'call-1', toolName: 'readFile', args: 'bad' })).toBe(false);

    expect(isToolCallResponse({ status: 'ok', callId: 'call-1', result: { ok: true } })).toBe(true);
    expect(isToolCallResponse({ status: 'pending-approval', callId: 'call-1', classification: toolClassification(), expiresAt: 2000 })).toBe(true);
    expect(isToolCallResponse({ status: 'error', callId: 'call-1', code: 'TOOL_NOT_FOUND', message: 'missing', conflict: conflict() })).toBe(true);
    expect(isToolCallResponse({ status: 'error', callId: 'call-1', code: 'ACCESS_DENIED', message: 'denied' })).toBe(true);
    expect(isToolCallResponse({ status: 'error', callId: 'call-1', code: 'TIMEOUT', message: 'timeout' })).toBe(true);
    expect(isToolCallResponse({ status: 'error', callId: 'call-1', code: 'WRITE_CONFLICT', message: 'conflict' })).toBe(true);
    expect(isToolCallResponse({ status: 'error', callId: 'call-1', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    expect(isToolCallResponse({ status: 'denied', callId: 'call-1', reason: 'user denied' })).toBe(true);
    expect(isToolCallResponse({ status: 'error', callId: 'call-1', code: 'INVALID', message: 'bad' })).toBe(false);
    expect(isToolCallResponse({ status: 'unknown' })).toBe(false);

    expect(isApprovalDecision({ callId: 'call-1', approved: true })).toBe(true);
    expect(isApprovalDecision({ callId: 'call-1', approved: false, remember: true })).toBe(true);
    expect(isApprovalDecision({ callId: 'call-1', approved: 'yes' })).toBe(false);
    expect(isApprovalDecision({})).toBe(false);

    expect(isPatchSet({
      id: 'patch-1',
      filePath: '/src/app.ts',
      baseHash: 'abc',
      operations: [patchOperation(), { filePath: '/src/app.ts', text: 'console.log(1);' }],
      author: 'agent',
      riskLevel: 'medium',
      createdAt: 1000
    })).toBe(true);
    expect(isPatchSet({ id: 'patch-1', filePath: '/src/app.ts', baseHash: 'abc', operations: [], author: 'agent', riskLevel: 'low', createdAt: 1000 })).toBe(true);
    expect(isPatchSet({ id: 'patch-1', filePath: '/src/app.ts', baseHash: 'abc', operations: [{ ...patchOperation(), range: {} }], author: 'agent', riskLevel: 'low', createdAt: 1000 })).toBe(false);
    expect(isPatchSet({ id: 'patch-1', filePath: '/src/app.ts', baseHash: 'abc', operations: [], author: 'agent', riskLevel: 'invalid', createdAt: 1000 })).toBe(false);
    expect(isPatchSet({})).toBe(false);

    expect(isPatchResult({ status: 'ok', patchId: 'patch-1', appliedHash: 'hash' })).toBe(true);
    expect(isPatchResult({ status: 'ok', patchId: 'patch-1', appliedHash: 'hash', autoMerged: true })).toBe(true);
    expect(isPatchResult({ status: 'error', code: 'CONFLICT', message: 'conflict' })).toBe(true);
    expect(isPatchResult({ status: 'error', code: 'FILE_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isPatchResult({ status: 'error', code: 'ACCESS_DENIED', message: 'denied' })).toBe(true);
    expect(isPatchResult({ status: 'error', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    expect(isPatchResult({ status: 'error', code: 'CONFLICT', message: 'conflict' })).toBe(true);
    expect(isPatchResult({ status: 'ok' })).toBe(false);

    expect(isConflict(conflict())).toBe(true);
    expect(isConflict({ ...conflict(), kind: 'delete' })).toBe(true);
    expect(isConflict({ ...conflict(), kind: 'rename' })).toBe(true);
    expect(isConflict({ ...conflict(), kind: 'binary' })).toBe(true);
    expect(isConflict({ ...conflict(), kind: 'multi-file' })).toBe(true);
    expect(isConflict({ ...conflict(), kind: 'high-risk' })).toBe(true);
    expect(isConflict({ ...conflict(), kind: 'invalid' })).toBe(false);
    expect(isConflict({})).toBe(false);

    expect(isConflictResolution({ conflictId: 'conflict-1', action: 'apply' })).toBe(true);
    expect(isConflictResolution({ conflictId: 'conflict-1', action: 'skip' })).toBe(true);
    expect(isConflictResolution({ conflictId: 'conflict-1', action: 'edit', operations: [patchOperation()] })).toBe(true);
    expect(isConflictResolution({ conflictId: 'conflict-1', action: 'edit', operations: [{ ...patchOperation(), range: {} }] })).toBe(false);
    expect(isConflictResolution({ conflictId: 'conflict-1', action: 'invalid' })).toBe(false);
    expect(isConflictResolution({ conflictId: 'conflict-1' })).toBe(false);

    expect(isFileHashResult({ status: 'ok', hash: 'abc' })).toBe(true);
    expect(isFileHashResult({ status: 'error', code: 'FILE_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isFileHashResult({ status: 'error', code: 'ACCESS_DENIED', message: 'denied' })).toBe(true);
    expect(isFileHashResult({ status: 'error', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    expect(isFileHashResult({ status: 'error', code: 'FILE_NOT_FOUND' })).toBe(false);
    expect(isFileHashResult({ status: 'unknown' })).toBe(false);

    expect(isSensitivePathCheckResult({ filePath: '/src/app.ts', isSensitive: false })).toBe(true);
    expect(isSensitivePathCheckResult({ filePath: '/secrets/key', isSensitive: true, matchedPattern: '**/secrets/**' })).toBe(true);
    expect(isSensitivePathCheckResult({ filePath: '/src/app.ts', isSensitive: 'yes' })).toBe(false);
    expect(isSensitivePathCheckResult({ isSensitive: false })).toBe(false);
  });

  it('validates agent runtime guards', () => {
    expect(isAgentRuntimeResult({ status: 'ok', value: 'done' })).toBe(true);
    let guardCalled = false;
    expect(isAgentRuntimeResult({ status: 'ok', value: 'done' }, (value): value is string => {
      guardCalled = true;
      return typeof value === 'string';
    })).toBe(true);
    expect(guardCalled).toBe(true);

    guardCalled = false;
    expect(isAgentRuntimeResult({ status: 'ok', value: 42 }, (value): value is string => {
      guardCalled = true;
      return typeof value === 'string';
    })).toBe(false);
    expect(guardCalled).toBe(true);

    expect(isAgentRuntimeResult({ status: 'error', code: 'SESSION_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'error', code: 'WORKER_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'error', code: 'INVALID_SCOPE', message: 'bad scope' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'error', code: 'TASK_NOT_FOUND', message: 'missing' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'error', code: 'ALREADY_RUNNING', message: 'running' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'error', code: 'UNKNOWN', message: 'unknown' })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'error', code: 'INVALID', message: 'bad' })).toBe(false);
    expect(isAgentRuntimeResult({ status: 'unknown' })).toBe(false);

    // Regression: malformed `ok` payloads without `value` must not pass the guard,
    // regardless of whether a `valueGuard` is supplied.
    expect(isAgentRuntimeResult({ status: 'ok' })).toBe(false);
    expect(isAgentRuntimeResult({ status: 'ok' }, (value): value is string => typeof value === 'string')).toBe(false);
    expect(isAgentRuntimeResult({ status: 'ok', value: null })).toBe(true);
    expect(isAgentRuntimeResult({ status: 'ok', value: undefined })).toBe(true);

    expect(isAgentRuntimePermissionScope(agentRuntimePermissionScope())).toBe(true);
    expect(isAgentRuntimePermissionScope({ ...agentRuntimePermissionScope(), kind: 'subagent' })).toBe(true);
    expect(isAgentRuntimePermissionScope({ ...agentRuntimePermissionScope(), kind: 'invalid' })).toBe(false);
    expect(isAgentRuntimePermissionScope({ ...agentRuntimePermissionScope(), allowedTools: ['readFile', 1] })).toBe(false);
    expect(isAgentRuntimePermissionScope({})).toBe(false);

    expect(isAgentRuntimeWorkerOutput(agentRuntimeWorkerOutput())).toBe(true);
    expect(isAgentRuntimeWorkerOutput({ summary: 'Done', references: [], toolsUsed: [] })).toBe(true);
    expect(isAgentRuntimeWorkerOutput({ summary: 'Done', references: [1], toolsUsed: [] })).toBe(false);
    expect(isAgentRuntimeWorkerOutput({ summary: 'Done', references: [], toolsUsed: [1] })).toBe(false);
    expect(isAgentRuntimeWorkerOutput({})).toBe(false);

    expect(isAgentRuntimeWorkerState(agentRuntimeWorkerState())).toBe(true);
    expect(isAgentRuntimeWorkerState({ id: 'worker-1', sessionId: 'session-1', taskId: 'task-1', status: 'running', attempt: 1, maxRetries: 3 })).toBe(true);
    expect(isAgentRuntimeWorkerState({ ...agentRuntimeWorkerState(), lastError: 1 })).toBe(false);
    expect(isAgentRuntimeWorkerState({ ...agentRuntimeWorkerState(), startedAt: 'bad' })).toBe(false);
    expect(isAgentRuntimeWorkerState({ ...agentRuntimeWorkerState(), stoppedAt: 'bad' })).toBe(false);
    expect(isAgentRuntimeWorkerState({ ...agentRuntimeWorkerState(), output: {} })).toBe(false);
    expect(isAgentRuntimeWorkerState({ id: 'worker-1', sessionId: 'session-1', taskId: 'task-1', status: 'invalid', attempt: 1, maxRetries: 3 })).toBe(false);

    expect(isAgentRuntimeTaskState(agentRuntimeTaskState())).toBe(true);
    expect(isAgentRuntimeTaskState({ ...agentRuntimeTaskState(), parentTaskId: undefined, result: undefined, error: undefined })).toBe(true);
    expect(isAgentRuntimeTaskState({ ...agentRuntimeTaskState(), parentTaskId: 1 })).toBe(false);
    expect(isAgentRuntimeTaskState({ ...agentRuntimeTaskState(), result: {} })).toBe(false);
    expect(isAgentRuntimeTaskState({ ...agentRuntimeTaskState(), error: 1 })).toBe(false);
    expect(isAgentRuntimeTaskState({ ...agentRuntimeTaskState(), status: 'invalid' })).toBe(false);

    expect(isAgentRuntimeEventEntry(agentRuntimeEventEntry())).toBe(true);
    expect(isAgentRuntimeEventEntry({ id: 'event-1', sessionId: 'session-1', type: 'session-created', message: 'Created', timestamp: 1000 })).toBe(true);
    expect(isAgentRuntimeEventEntry({ ...agentRuntimeEventEntry(), taskId: undefined, workerId: undefined })).toBe(true);
    expect(isAgentRuntimeEventEntry({ ...agentRuntimeEventEntry(), taskId: 1 })).toBe(false);
    expect(isAgentRuntimeEventEntry({ ...agentRuntimeEventEntry(), workerId: 1 })).toBe(false);
    expect(isAgentRuntimeEventEntry({ ...agentRuntimeEventEntry(), type: 'invalid' })).toBe(false);

    expect(isAgentRuntimeSessionState(agentRuntimeSessionState())).toBe(true);
    expect(isAgentRuntimeSessionState({ ...agentRuntimeSessionState(), resumeToken: undefined })).toBe(true);
    expect(isAgentRuntimeSessionState({ ...agentRuntimeSessionState(), tasks: [agentRuntimeTaskState({ status: 'invalid' })] })).toBe(false);
    expect(isAgentRuntimeSessionState({ ...agentRuntimeSessionState(), eventLog: [agentRuntimeEventEntry({ type: 'invalid' })] })).toBe(false);
    expect(isAgentRuntimeSessionState({ ...agentRuntimeSessionState(), resumeToken: 1 })).toBe(false);
    expect(isAgentRuntimeSessionState({ ...agentRuntimeSessionState(), status: 'invalid' })).toBe(false);

    expect(isAgentRuntimeStartWorkerOptions({ sessionId: 'session-1', taskId: 'task-1', prompt: 'prompt' })).toBe(true);
    expect(isAgentRuntimeStartWorkerOptions({ sessionId: 'session-1', taskId: 'task-1', prompt: 'prompt', context: [], allowedTools: [] })).toBe(true);
    expect(isAgentRuntimeStartWorkerOptions({ sessionId: 'session-1', taskId: 'task-1', prompt: 'prompt', context: [1] })).toBe(false);
    expect(isAgentRuntimeStartWorkerOptions({ sessionId: 'session-1', taskId: 'task-1', prompt: 'prompt', allowedTools: [1] })).toBe(false);
    expect(isAgentRuntimeStartWorkerOptions({ sessionId: 'session-1', taskId: 'task-1' })).toBe(false);

    expect(isAgentRuntimeStartSubagentOptions({ sessionId: 'session-1', name: 'sub', goal: 'goal', modelId: 'model' })).toBe(true);
    expect(isAgentRuntimeStartSubagentOptions({ sessionId: 'session-1', name: 'sub', goal: 'goal', modelId: 'model', parentTaskId: 'parent-1' })).toBe(true);
    expect(isAgentRuntimeStartSubagentOptions({ sessionId: 'session-1', name: 'sub', goal: 'goal', modelId: 'model', context: [1] })).toBe(false);
    expect(isAgentRuntimeStartSubagentOptions({ sessionId: 'session-1', name: 'sub', goal: 'goal', modelId: 'model', allowedTools: [1] })).toBe(false);
    expect(isAgentRuntimeStartSubagentOptions({ sessionId: 'session-1', name: 'sub', goal: 'goal', modelId: 'model', parentTaskId: 1 })).toBe(false);
    expect(isAgentRuntimeStartSubagentOptions({ sessionId: 'session-1', name: 'sub', goal: 'goal' })).toBe(false);

    expect(isAgentRuntimeResumeOptions({ sessionId: 'session-1', workerId: 'worker-1' })).toBe(true);
    expect(isAgentRuntimeResumeOptions({ sessionId: 'session-1' })).toBe(false);
    expect(isAgentRuntimeResumeOptions({ workerId: 'worker-1' })).toBe(false);
  });
});
