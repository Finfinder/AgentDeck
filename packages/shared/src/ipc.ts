import type {
  PermissionActionKind,
  PermissionActorKind,
  PermissionApprovalInput,
  PermissionApprovalResult,
  PermissionAuditEntry,
  PermissionBrokerState,
  PermissionDecision,
  PermissionDecisionKind,
  PermissionEvaluation,
  PermissionGrant,
  PermissionGrantDuration,
  PermissionGrantScope,
  PermissionPrompt,
  PermissionRequest,
  PermissionRiskLevel,
  PermissionRuntimeKind
} from '@agentdeck/permission-broker';

export const IPC_CHANNELS = {
  getStartupState: 'agentdeck:v1:startup:get-state',
  getThemeSettings: 'agentdeck:v1:settings:get-theme',
  setThemeSettings: 'agentdeck:v1:settings:set-theme',
  selectWorkspaceEntry: 'agentdeck:v1:workspace:select-entry',
  openWorkspace: 'agentdeck:v1:workspace:open',
  listDirectory: 'agentdeck:v1:workspace:list-directory',
  searchFiles: 'agentdeck:v1:workspace:search-files',
  getRecentWorkspaces: 'agentdeck:v1:workspace:get-recent',
  fsEvent: 'agentdeck:v1:workspace:fs-event',
  readFile: 'agentdeck:v1:editor:read-file',
  writeFile: 'agentdeck:v1:editor:write-file',
  markBufferDirty: 'agentdeck:v1:editor:mark-buffer-dirty',
  deleteFile: 'agentdeck:v1:workspace:delete-file',
  renameFile: 'agentdeck:v1:workspace:rename-file',
  getEditorDiagnostics: 'agentdeck:v1:editor:get-diagnostics',
  applyWorkspaceEdit: 'agentdeck:v1:editor:apply-workspace-edit',
  showDiff: 'agentdeck:v1:editor:show-diff',
  showSaveDialog: 'agentdeck:v1:dialog:show-save',
  toggleDevTools: 'agentdeck:v1:devtools:toggle',
  identityGetSession: 'agentdeck:v1:identity:get-session',
  identityStartOAuth: 'agentdeck:v1:identity:start-oauth',
  identitySignOut: 'agentdeck:v1:identity:sign-out',
  identityChanged: 'agentdeck:v1:identity:changed',
  identityDeviceCode: 'agentdeck:v1:identity:device-code',
  identityWarning: 'agentdeck:v1:identity:warning',
  // Model Gateway
  getModelGatewayConfig: 'agentdeck:v1:model-gateway:get-config',
  listChatTabs: 'agentdeck:v1:chat:list-tabs',
  createChatTab: 'agentdeck:v1:chat:create-tab',
  closeChatTab: 'agentdeck:v1:chat:close-tab',
  sendMessage: 'agentdeck:v1:chat:send-message',
  stopStreaming: 'agentdeck:v1:chat:stop-streaming',
  chatStreamEvent: 'agentdeck:v1:chat:stream-event',
  chatTabsChanged: 'agentdeck:v1:chat:tabs-changed',
  // Model Gateway secure config
  modelGatewayGetApiKey: 'agentdeck:v1:model-gateway:get-api-key',
  modelGatewaySetApiKey: 'agentdeck:v1:model-gateway:set-api-key',
  modelGatewayDeleteApiKey: 'agentdeck:v1:model-gateway:delete-api-key',
  modelGatewayTestConnection: 'agentdeck:v1:model-gateway:test-connection',
  modelGatewaySetProviderConfig: 'agentdeck:v1:model-gateway:set-provider-config',
  modelGatewayGetProviderConfig: 'agentdeck:v1:model-gateway:get-provider-config',
  // Tab model/provider selection
  chatSetActiveModel: 'agentdeck:v1:chat:set-active-model',
  chatSetActiveProvider: 'agentdeck:v1:chat:set-active-provider',
  // Agent Runtime
  agentRuntimeListSessions: 'agentdeck:v1:agent-runtime:list-sessions',
  agentRuntimeGetSession: 'agentdeck:v1:agent-runtime:get-session',
  agentRuntimeListWorkers: 'agentdeck:v1:agent-runtime:list-workers',
  agentRuntimeGetWorker: 'agentdeck:v1:agent-runtime:get-worker',
  agentRuntimeListTasks: 'agentdeck:v1:agent-runtime:list-tasks',
  agentRuntimeGetTask: 'agentdeck:v1:agent-runtime:get-task',
  agentRuntimeStartWorker: 'agentdeck:v1:agent-runtime:start-worker',
  agentRuntimeStartSubagent: 'agentdeck:v1:agent-runtime:start-subagent',
  agentRuntimeResumeWorker: 'agentdeck:v1:agent-runtime:resume-worker',
  agentRuntimeStopWorker: 'agentdeck:v1:agent-runtime:stop-worker',
  agentRuntimeStopSession: 'agentdeck:v1:agent-runtime:stop-session',
  agentRuntimeSessionChanged: 'agentdeck:v1:agent-runtime:session-changed',
  agentRuntimeTaskChanged: 'agentdeck:v1:agent-runtime:task-changed',
  agentRuntimeWorkerChanged: 'agentdeck:v1:agent-runtime:worker-changed',
  agentRuntimeSessionCrashed: 'agentdeck:v1:agent-runtime:session-crashed',
  // Permission Broker
  permissionBrokerGetState: 'agentdeck:v1:permission-broker:get-state',
  permissionBrokerApproveDecision: 'agentdeck:v1:permission-broker:approve-decision',
  permissionBrokerDecisionChanged: 'agentdeck:v1:permission-broker:decision-changed'
} as const satisfies Record<string, string>;

export type ThemePreference = 'dark' | 'light';

export type ThemeSettings = Readonly<{
  theme: ThemePreference;
}>;

export const DEFAULT_THEME_SETTINGS = {
  theme: 'dark'
} as const satisfies ThemeSettings;

export type WorkspaceOpenKind = 'folder' | 'workspace-file';

export type WorkspaceOpenRequest = Readonly<{
  kind: WorkspaceOpenKind;
}>;

export type WorkspaceSelection =
  | Readonly<{
      status: 'selected';
      kind: WorkspaceOpenKind;
      path: string;
      name: string;
    }>
  | Readonly<{
      status: 'cancelled';
    }>;

export type StartupServiceDescriptor = Readonly<{
  id: 'workspace-service' | 'agent-runtime' | 'settings-service';
  label: string;
  status: 'ready';
}>;

export type WorkspaceFolder = Readonly<{
  path: string;
  name?: string;
}>;

export type WorkspaceParseErrorCode = 'INVALID_JSONC' | 'FILE_NOT_FOUND' | 'EMPTY_WORKSPACE';

export type WorkspaceModel =
  | Readonly<{
      status: 'ok';
      filePath: string;
      kind: WorkspaceOpenKind;
      folders: readonly WorkspaceFolder[];
    }>
  | Readonly<{
      status: 'error';
      code: WorkspaceParseErrorCode;
      message: string;
    }>;

export type FileEntryKind = 'file' | 'directory';

export type FileEntry = Readonly<{
  name: string;
  path: string;
  kind: FileEntryKind;
  isSensitive: boolean;
}>;

export type DirectoryListing = Readonly<{
  path: string;
  entries: readonly FileEntry[];
}>;

export type SearchQuery = Readonly<{
  pattern: string;
  include?: string | undefined;
  exclude?: string | undefined;
  workspaceRoots: readonly string[];
}>;

export type SearchResult = Readonly<{
  id: string;
  file: string;
  line: number;
  col: number;
  snippet: string;
  isSensitive: boolean;
}>;

export type RecentWorkspace = Readonly<{
  path: string;
  name: string;
  kind: WorkspaceOpenKind;
  lastOpened: number;
}>;

export type FsChangeEventKind = 'add' | 'change' | 'unlink' | 'addDir';

export type FsChangeEvent = Readonly<{
  kind: FsChangeEventKind;
  path: string;
}>;

export type StartupState =
  | Readonly<{
      status: 'ready';
      appVersion: string;
      services: readonly StartupServiceDescriptor[];
    }>
  | Readonly<{
      status: 'error';
      appVersion: string;
      code: 'DESKTOP_SERVICES_UNAVAILABLE' | 'INVALID_STARTUP_STATE';
      message: string;
    }>;

// ?? Editor types ????????????????????????????????????????????????????????????

export type EditorLanguage =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'yaml'
  | 'markdown'
  | 'powershell'
  | 'python'
  | 'cpp'
  | 'c'
  | 'csharp'
  | 'css'
  | 'scss'
  | 'less'
  | 'html'
  | 'dockerfile'
  | 'plaintext';

export type EditorTab = Readonly<{
  id: string;
  filePath: string;
  fileName: string;
  language: EditorLanguage;
  isDirty: boolean;
  isPinned: boolean;
  revealLine: number | null;
  revealCol: number | null;
  revealPattern: string | null;
  revealNonce: number;
}>;

export type EditorTabInput = Readonly<{
  filePath: string;
  line?: number;
  col?: number;
  pattern?: string;
  revealNonce?: number;
}>;

export type FileReadResult =
  | Readonly<{
      status: 'ok';
      content: string;
      encoding: string;
    }>
  | Readonly<{
      status: 'error';
      code: 'FILE_NOT_FOUND' | 'ACCESS_DENIED' | 'ENCODING_ERROR' | 'UNKNOWN';
      message: string;
    }>;

export type FileWriteResult =
  | Readonly<{
      status: 'ok';
    }>
  | Readonly<{
      status: 'error';
      code: 'WRITE_CONFLICT' | 'ACCESS_DENIED' | 'UNKNOWN';
      message: string;
    }>;

export type FileOperationResult =
  | Readonly<{
      status: 'ok';
    }>
  | Readonly<{
      status: 'error';
      code: 'FILE_NOT_FOUND' | 'ACCESS_DENIED' | 'UNKNOWN';
      message: string;
    }>;

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export type EditorDiagnostic = Readonly<{
  filePath: string;
  message: string;
  severity: DiagnosticSeverity;
  line: number;
  col: number;
  source: string;
}>;

export type EditorSplitDirection = 'horizontal' | 'vertical';
// ?? WorkspaceEdit types ??
export type WorkspaceEditOperation = Readonly<{
  filePath: string;
  range?: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
  text: string;
}>;

export type WorkspaceEditInput = Readonly<{
  operations: readonly WorkspaceEditOperation[];
}>;

export type WorkspaceEditResult =
  | Readonly<{ status: 'ok' }>
  | Readonly<{ status: 'error'; code: 'FILE_NOT_FOUND' | 'ACCESS_DENIED' | 'WRITE_CONFLICT' | 'UNKNOWN'; message: string }>;

// ?? Diff types ??
export type DiffInput = Readonly<{
  original: string;
  modified: string;
  filePath?: string;
}>;

export type DiffResult =
  | Readonly<{ status: 'ok'; diff: string }>
  | Readonly<{ status: 'error'; code: 'UNKNOWN'; message: string }>;

export type IdentitySession = Readonly<{
  isLoggedIn: boolean;
  provider?: 'github';
  profile?: Readonly<{
    login: string;
    id?: number;
    avatar_url?: string;
    name?: string;
    email?: string | null;
  }>;
  error?: string;
}>;
export type IdentitySessionWarning = Readonly<{
  type: 'FALLBACK_FILE_STORE';
  reason: string;
  path: string;
}>;

export type AgentDeckPreloadApi = Readonly<{
  getStartupState: () => Promise<StartupState>;
  getIdentitySession: () => Promise<IdentitySession>;
  startOAuth: (opts?: unknown) => Promise<IdentitySession>;
  signOut: () => Promise<IdentitySession>;
  onIdentityChange?: (handler: (session: IdentitySession) => void) => (() => void) | undefined;
  onDeviceCode?: (handler: (data: { userCode: string; verificationUri: string; verificationUriComplete?: string }) => void) => (() => void) | undefined;
  onIdentityWarning?: (handler: (warning: IdentitySessionWarning) => void) => (() => void) | undefined;
  getThemeSettings: () => Promise<ThemeSettings>;
  setThemeSettings: (settings: ThemeSettings) => Promise<ThemeSettings>;
  selectWorkspaceEntry: (request: WorkspaceOpenRequest) => Promise<WorkspaceSelection>;
  openWorkspace: (path: string, kind: WorkspaceOpenKind) => Promise<WorkspaceModel>;
  listDirectory: (path: string) => Promise<DirectoryListing>;
  searchFiles: (query: SearchQuery) => Promise<readonly SearchResult[]>;
  getRecentWorkspaces: () => Promise<readonly RecentWorkspace[]>;
  onFsEvent: (handler: (event: FsChangeEvent) => void) => () => void;
  readFile: (filePath: string) => Promise<FileReadResult>;
  writeFile: (filePath: string, content: string) => Promise<FileWriteResult>;
  markBufferDirty: (filePath: string) => Promise<void>;
  deleteFile: (filePath: string) => Promise<FileOperationResult>;
  renameFile: (oldPath: string, newPath: string) => Promise<FileOperationResult>;
  getEditorDiagnostics: (filePath: string) => Promise<readonly EditorDiagnostic[]>;
  applyWorkspaceEdit: (edit: WorkspaceEditInput) => Promise<WorkspaceEditResult>;
  showDiff: (input: DiffInput) => Promise<DiffResult>;
  showSaveDialog: (defaultPath?: string) => Promise<string | null>;
  toggleDevTools: () => Promise<void>;
  // Model Gateway
  getModelGatewayConfig: () => Promise<ModelGatewayConfig>;
  listChatTabs: () => Promise<readonly ChatTabState[]>;
  createChatTab: (title?: string) => Promise<ChatTabState>;
  closeChatTab: (tabId: string) => Promise<void>;
  sendMessage: (tabId: string, message: string) => Promise<SendMessageResult>;
  stopStreaming: (tabId: string) => Promise<void>;
  onChatStream: (handler: (tabId: string, event: ChatStreamEvent) => void) => () => void;
  onChatTabsChange: (handler: (tabs: readonly ChatTabState[]) => void) => () => void;
  onAgentRuntimeSessionChanged?: (handler: (session: AgentRuntimeSessionState) => void) => (() => void) | undefined;
  onAgentRuntimeTaskChanged?: (handler: (task: AgentRuntimeTaskState) => void) => (() => void) | undefined;
  onAgentRuntimeWorkerChanged?: (handler: (worker: AgentRuntimeWorkerState) => void) => (() => void) | undefined;
  onAgentRuntimeSessionCrashed?: (handler: (session: AgentRuntimeSessionState, error: { message: string }) => void) => (() => void) | undefined;
  listAgentRuntimeSessions?: () => Promise<readonly AgentRuntimeSessionState[]>;
  getAgentRuntimeSession?: (sessionId: string) => Promise<AgentRuntimeSessionState | undefined>;
  listAgentRuntimeWorkers?: (sessionId?: string) => Promise<readonly AgentRuntimeWorkerState[]>;
  getAgentRuntimeWorker?: (workerId: string) => Promise<AgentRuntimeWorkerState | undefined>;
  listAgentRuntimeTasks?: (sessionId?: string) => Promise<readonly AgentRuntimeTaskState[]>;
  getAgentRuntimeTask?: (taskId: string) => Promise<AgentRuntimeTaskState | undefined>;
  startAgentRuntimeWorker?: (options: AgentRuntimeStartWorkerOptions) => Promise<AgentRuntimeResult<AgentRuntimeWorkerState>>;
  startAgentRuntimeSubagent?: (options: AgentRuntimeStartSubagentOptions) => Promise<AgentRuntimeResult<AgentRuntimeTaskState>>;
  resumeAgentRuntimeWorker?: (options: AgentRuntimeResumeOptions) => Promise<AgentRuntimeResult<AgentRuntimeWorkerState>>;
  stopAgentRuntimeWorker?: (workerId: string) => Promise<AgentRuntimeResult<AgentRuntimeWorkerState>>;
  stopAgentRuntimeSession?: (sessionId: string) => Promise<AgentRuntimeResult<readonly AgentRuntimeWorkerState[]>>;
  // Permission Broker
  getPermissionBrokerState?: () => Promise<PermissionBrokerState>;
  approvePermissionDecision?: (input: PermissionApprovalInput) => Promise<PermissionApprovalResult>;
  onPermissionDecision?: (handler: (decision: PermissionDecision) => void) => (() => void) | undefined;
  // Model Gateway secure config
  getApiKey?: (providerId: string) => Promise<string | null>;
  setApiKey?: (providerId: string, apiKey: string) => Promise<void>;
  deleteApiKey?: (providerId: string) => Promise<void>;
  testConnection?: (providerId: string, baseUrl: string) => Promise<{ status: 'ok' | 'error'; message?: string; models?: readonly ModelInfo[] }>;
  setProviderConfig?: (providerId: string, baseUrl: string) => Promise<void>;
  getProviderConfig?: (providerId: string) => Promise<ModelProviderConfig>;
  setActiveModel?: (tabId: string, modelId: string) => Promise<void>;
  setActiveProvider?: (tabId: string, providerId: string) => Promise<void>;
  versions: Readonly<{
    chrome: string;
    electron: string;
    node: string;
  }>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const PERMISSION_ACTION_KINDS = new Set<string>(['read', 'write', 'delete', 'terminal', 'network', 'mcpTool', 'secretsAccess', 'workspaceEdit']);
const PERMISSION_ACTOR_KINDS = new Set<string>(['agent', 'extension', 'mcp', 'user']);
const PERMISSION_DECISION_KINDS = new Set<string>(['allow', 'prompt', 'deny']);
const PERMISSION_RISK_LEVELS = new Set<string>(['safe', 'low', 'medium', 'high', 'critical']);
const PERMISSION_GRANT_DURATIONS = new Set<string>(['once', 'session']);
const PERMISSION_RUNTIME_KINDS = new Set<string>(['parent', 'subagent']);
const PERMISSION_APPROVAL_DECISIONS = new Set<string>(['allow', 'deny']);
const PERMISSION_APPROVAL_CODES = new Set<string>(['DECISION_NOT_FOUND', 'INVALID_SCOPE', 'UNKNOWN']);
const PERMISSION_AUDIT_TYPES = new Set<string>(['permission.request', 'permission.decision', 'permission.after-tool']);
const PERMISSION_AUDIT_OUTCOMES = new Set<string>(['success', 'error', 'blocked']);

function isPermissionString(value: unknown, allowed: ReadonlySet<string>): value is string {
  return typeof value === 'string' && allowed.has(value);
}

export function isPermissionActionKind(value: unknown): value is PermissionActionKind {
  return isPermissionString(value, PERMISSION_ACTION_KINDS);
}

export function isPermissionActorKind(value: unknown): value is PermissionActorKind {
  return isPermissionString(value, PERMISSION_ACTOR_KINDS);
}

export function isPermissionDecisionKind(value: unknown): value is PermissionDecisionKind {
  return isPermissionString(value, PERMISSION_DECISION_KINDS);
}

export function isPermissionRiskLevel(value: unknown): value is PermissionRiskLevel {
  return isPermissionString(value, PERMISSION_RISK_LEVELS);
}

export function isPermissionGrantDuration(value: unknown): value is PermissionGrantDuration {
  return isPermissionString(value, PERMISSION_GRANT_DURATIONS);
}

export function isPermissionRuntimeKind(value: unknown): value is PermissionRuntimeKind {
  return isPermissionString(value, PERMISSION_RUNTIME_KINDS);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === 'number';
}

function isOptionalRuntimeKind(value: unknown): value is PermissionRuntimeKind | undefined {
  return value === undefined || isPermissionRuntimeKind(value);
}

function isOptionalStringArray(value: unknown): value is readonly string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every(item => typeof item === 'string'));
}

function isMetadata(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function isPermissionGrantScope(value: unknown): value is PermissionGrantScope {
  if (!isRecord(value)) return false;
  return (
    isOptionalString(value.toolName) &&
    (value.action === undefined || isPermissionActionKind(value.action)) &&
    isOptionalString(value.workspaceGlob) &&
    isOptionalString(value.host) &&
    isOptionalString(value.command) &&
    isOptionalString(value.mcpServerId)
  );
}

export function isPermissionGrant(value: unknown): value is PermissionGrant {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string' &&
    isOptionalString(value.taskId) &&
    isPermissionActorKind(value.actorKind) &&
    isPermissionActionKind(value.action) &&
    isPermissionGrantScope(value.scope) &&
    isPermissionGrantDuration(value.duration) &&
    typeof value.requiresPrompt === 'boolean' &&
    value.grantedBy === 'user' &&
    typeof value.createdAt === 'number' &&
    isOptionalRuntimeKind(value.runtimeKind) &&
    isOptionalNumber(value.expiresAt)
  );
}

export function isPermissionRequest(value: unknown): value is PermissionRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.taskId === 'string' &&
    isOptionalString(value.workerId) &&
    isPermissionActorKind(value.actorKind) &&
    isPermissionActionKind(value.kind) &&
    isOptionalString(value.toolName) &&
    typeof value.target === 'string' &&
    isMetadata(value.metadata) &&
    isOptionalStringArray(value.workspaceRoots) &&
    isOptionalRuntimeKind(value.runtimeKind)
  );
}

export function isPermissionEvaluation(value: unknown): value is PermissionEvaluation {
  if (!isRecord(value)) return false;
  return (
    isPermissionDecisionKind(value.decision) &&
    isPermissionRiskLevel(value.risk) &&
    typeof value.reason === 'string' &&
    (value.grant === undefined || isPermissionGrant(value.grant)) &&
    isOptionalString(value.decisionId)
  );
}

export function isPermissionDecision(value: unknown): value is PermissionDecision {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.requestId === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.taskId === 'string' &&
    isOptionalString(value.workerId) &&
    isPermissionActorKind(value.actorKind) &&
    isPermissionActionKind(value.kind) &&
    isOptionalString(value.toolName) &&
    typeof value.target === 'string' &&
    isOptionalRuntimeKind(value.runtimeKind) &&
    isPermissionRiskLevel(value.risk) &&
    isPermissionDecisionKind(value.decision) &&
    typeof value.reason === 'string' &&
    typeof value.createdAt === 'number'
  );
}

export function isPermissionPrompt(value: unknown): value is PermissionPrompt {
  if (!isRecord(value)) return false;
  return (
    typeof value.decisionId === 'string' &&
    typeof value.requestId === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.taskId === 'string' &&
    isOptionalString(value.workerId) &&
    isPermissionActorKind(value.actorKind) &&
    isPermissionActionKind(value.kind) &&
    isOptionalString(value.toolName) &&
    typeof value.target === 'string' &&
    isOptionalRuntimeKind(value.runtimeKind) &&
    isPermissionRiskLevel(value.risk) &&
    typeof value.reason === 'string' &&
    isMetadata(value.metadata) &&
    typeof value.createdAt === 'number'
  );
}

export function isPermissionApprovalInput(value: unknown): value is PermissionApprovalInput {
  if (!isRecord(value)) return false;
  return (
    typeof value.decisionId === 'string' &&
    isPermissionString(value.decision, PERMISSION_APPROVAL_DECISIONS) &&
    isPermissionGrantDuration(value.duration) &&
    (value.scope === undefined || isPermissionGrantScope(value.scope))
  );
}

export function isPermissionApprovalResult(value: unknown): value is PermissionApprovalResult {
  if (!isRecord(value)) return false;
  if (value.status === 'ok') {
    return isPermissionDecision(value.decision) && (value.grant === undefined || isPermissionGrant(value.grant));
  }
  return (
    value.status === 'error' &&
    isPermissionString(value.code, PERMISSION_APPROVAL_CODES) &&
    typeof value.message === 'string'
  );
}

export function isPermissionAuditEntry(value: unknown): value is PermissionAuditEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string' &&
    isOptionalString(value.taskId) &&
    isOptionalString(value.workerId) &&
    typeof value.decisionId === 'string' &&
    isPermissionString(value.type, PERMISSION_AUDIT_TYPES) &&
    isPermissionActorKind(value.actorKind) &&
    isPermissionActionKind(value.action) &&
    typeof value.target === 'string' &&
    isOptionalString(value.toolName) &&
    isOptionalRuntimeKind(value.runtimeKind) &&
    isPermissionRiskLevel(value.risk) &&
    isPermissionDecisionKind(value.decision) &&
    typeof value.reason === 'string' &&
    typeof value.createdAt === 'number' &&
    (value.outcome === undefined || isPermissionString(value.outcome, PERMISSION_AUDIT_OUTCOMES)) &&
    isOptionalNumber(value.durationMs)
  );
}

export function isPermissionBrokerState(value: unknown): value is PermissionBrokerState {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.decisions) &&
    value.decisions.every(isPermissionDecision) &&
    Array.isArray(value.prompts) &&
    value.prompts.every(isPermissionPrompt) &&
    Array.isArray(value.grants) &&
    value.grants.every(isPermissionGrant) &&
    Array.isArray(value.audit) &&
    value.audit.every(isPermissionAuditEntry)
  );
}

function isStartupServiceDescriptor(value: unknown): value is StartupServiceDescriptor {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.id === 'workspace-service' || value.id === 'agent-runtime' || value.id === 'settings-service') &&
    typeof value.label === 'string' &&
    value.status === 'ready'
  );
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isThemeSettings(value: unknown): value is ThemeSettings {
  return isRecord(value) && (value.theme === 'dark' || value.theme === 'light');
}

export function isIdentitySession(value: unknown): value is IdentitySession {
  if (!isRecord(value)) return false;
  if (typeof value.isLoggedIn !== 'boolean') return false;
  if (value.isLoggedIn) {
    const p = value.profile;
    if (!isRecord(p) || typeof p.login !== 'string') return false;
  }
  return true;
}

export function isIdentitySessionWarning(value: unknown): value is IdentitySessionWarning {
  if (!isRecord(value)) return false;
  return value.type === 'FALLBACK_FILE_STORE' && typeof value.reason === 'string' && typeof value.path === 'string';
}

export function isWorkspaceOpenRequest(value: unknown): value is WorkspaceOpenRequest {
  return isRecord(value) && (value.kind === 'folder' || value.kind === 'workspace-file');
}

export function isWorkspaceSelection(value: unknown): value is WorkspaceSelection {
  if (!isRecord(value)) {
    return false;
  }

  if (value.status === 'cancelled') {
    return true;
  }

  return (
    value.status === 'selected' &&
    (value.kind === 'folder' || value.kind === 'workspace-file') &&
    typeof value.path === 'string' &&
    typeof value.name === 'string'
  );
}

export function isStartupState(value: unknown): value is StartupState {
  if (!isRecord(value) || typeof value.appVersion !== 'string') {
    return false;
  }

  if (value.status === 'error') {
    return (
      (value.code === 'DESKTOP_SERVICES_UNAVAILABLE' || value.code === 'INVALID_STARTUP_STATE') &&
      typeof value.message === 'string'
    );
  }

  if (value.status !== 'ready' || !Array.isArray(value.services)) {
    return false;
  }

  return value.services.every(isStartupServiceDescriptor);
}

function isWorkspaceFolder(value: unknown): value is WorkspaceFolder {
  return isRecord(value) && typeof value.path === 'string' && (value.name === undefined || typeof value.name === 'string');
}

export function isWorkspaceModel(value: unknown): value is WorkspaceModel {
  if (!isRecord(value)) return false;

  if (value.status === 'error') {
    return (
      (value.code === 'INVALID_JSONC' || value.code === 'FILE_NOT_FOUND' || value.code === 'EMPTY_WORKSPACE') &&
      typeof value.message === 'string'
    );
  }

  return (
    value.status === 'ok' &&
    typeof value.filePath === 'string' &&
    (value.kind === 'folder' || value.kind === 'workspace-file') &&
    Array.isArray(value.folders) &&
    value.folders.every(isWorkspaceFolder)
  );
}

function isFileEntry(value: unknown): value is FileEntry {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    (value.kind === 'file' || value.kind === 'directory') &&
    typeof value.isSensitive === 'boolean'
  );
}

export function isDirectoryListing(value: unknown): value is DirectoryListing {
  return isRecord(value) && typeof value.path === 'string' && Array.isArray(value.entries) && value.entries.every(isFileEntry);
}

export function isFsChangeEvent(value: unknown): value is FsChangeEvent {
  return (
    isRecord(value) &&
    (value.kind === 'add' || value.kind === 'change' || value.kind === 'unlink' || value.kind === 'addDir') &&
    typeof value.path === 'string'
  );
}

const EDITOR_LANGUAGES = new Set<string>([
  'typescript',
  'javascript',
  'json',
  'yaml',
  'markdown',
  'powershell',
  'python',
  'cpp',
  'c',
  'csharp',
  'css',
  'scss',
  'less',
  'html',
  'dockerfile',
  'plaintext'
]);

export function isEditorLanguage(value: unknown): value is EditorLanguage {
  return typeof value === 'string' && EDITOR_LANGUAGES.has(value);
}

export function isEditorTab(value: unknown): value is EditorTab {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.filePath === 'string' &&
    typeof value.fileName === 'string' &&
    isEditorLanguage(value.language) &&
    typeof value.isDirty === 'boolean' &&
    typeof value.isPinned === 'boolean'
  );
}

export function isFileReadResult(value: unknown): value is FileReadResult {
  if (!isRecord(value)) return false;
  if (value.status === 'ok') {
    return typeof value.content === 'string' && typeof value.encoding === 'string';
  }
  return (
    value.status === 'error' &&
    (value.code === 'FILE_NOT_FOUND' || value.code === 'ACCESS_DENIED' || value.code === 'ENCODING_ERROR' || value.code === 'UNKNOWN') &&
    typeof value.message === 'string'
  );
}

export function isFileWriteResult(value: unknown): value is FileWriteResult {
  if (!isRecord(value)) return false;
  if (value.status === 'ok') return true;
  return (
    value.status === 'error' &&
    (value.code === 'WRITE_CONFLICT' || value.code === 'ACCESS_DENIED' || value.code === 'UNKNOWN') &&
    typeof value.message === 'string'
  );
}

// Helper for error result validation with specific allowed codes
function isErrorResult(value: unknown, allowedCodes: readonly string[]): value is { status: 'error'; code: string; message: string } {
  if (!isRecord(value)) return false;
  return (
    value.status === 'error' &&
    typeof value.code === 'string' &&
    allowedCodes.includes(value.code) &&
    typeof value.message === 'string'
  );
}

export function isFileOperationResult(value: unknown): value is FileOperationResult {
  if (!isRecord(value)) return false;
  if (value.status === 'ok') return true;
  return isErrorResult(value, ['FILE_NOT_FOUND', 'ACCESS_DENIED', 'UNKNOWN']);
}

// ?? WorkspaceEdit guards ??
function isWorkspaceEditRange(value: unknown): value is { startLine: number; startCol: number; endLine: number; endCol: number } {
  if (!isRecord(value)) return false;
  return (
    typeof value.startLine === 'number' &&
    typeof value.startCol === 'number' &&
    typeof value.endLine === 'number' &&
    typeof value.endCol === 'number'
  );
}

function isWorkspaceEditOperation(value: unknown): value is WorkspaceEditOperation {
  if (!isRecord(value)) return false;
  return (
    typeof value.filePath === 'string' &&
    typeof value.text === 'string' &&
    (value.range === undefined || isWorkspaceEditRange(value.range))
  );
}

export function isWorkspaceEditInput(value: unknown): value is WorkspaceEditInput {
  if (!isRecord(value)) return false;
  return Array.isArray(value.operations) && value.operations.every(isWorkspaceEditOperation);
}

export function isWorkspaceEditResult(value: unknown): value is WorkspaceEditResult {
  if (!isRecord(value)) return false;
  if (value.status === 'ok') return true;
  return isErrorResult(value, ['FILE_NOT_FOUND', 'ACCESS_DENIED', 'WRITE_CONFLICT', 'UNKNOWN']);
}

export function isDiffInput(value: unknown): value is DiffInput {
  if (!isRecord(value)) return false;
  return typeof value.original === 'string' && typeof value.modified === 'string';
}

export function isDiffResult(value: unknown): value is DiffResult {
  if (!isRecord(value)) return false;
  if (value.status === 'ok') return typeof value.diff === 'string';
  return value.status === 'error' && value.code === 'UNKNOWN' && typeof value.message === 'string';
}

// ?? Model Gateway types ???????????????????????????????????????????????????

export type ModelProviderId = 'openrouter' | 'ollama' | 'lmstudio' | 'openai-compatible';

export type ModelInfo = Readonly<{
  id: string;
  name: string;
  provider: ModelProviderId;
  contextWindow: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsEmbeddings: boolean;
}>;

export type ModelProviderStatus = 'idle' | 'checking' | 'ready' | 'error';

export type ModelProviderState = Readonly<{
  id: ModelProviderId;
  label: string;
  status: ModelProviderStatus;
  baseUrl: string;
  models: readonly ModelInfo[];
  error?: string;
}>;

export type ModelGatewayConfig = Readonly<{
  providers: readonly ModelProviderState[];
  activeProvider: ModelProviderId;
  activeModel: string;
}>;

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export type ToolCall = Readonly<{
  id: string;
  type: 'function';
  function: Readonly<{
    name: string;
    arguments: string;
  }>;
}>;

export type ChatMessage = Readonly<{
  role: ChatRole;
  content: string;
  timestamp: number;
  tool_calls?: readonly ToolCall[];
  tool_call_id?: string;
}>;

export type ChatTabState = Readonly<{
  id: string;
  title: string;
  messages: readonly ChatMessage[];
  activeModel: string;
  activeProvider: ModelProviderId;
  isStreaming: boolean;
  runtimeSessionId?: string;
  runtimeWorkerId?: string;
  error?: string;
}>;

export type ChatStreamEvent =
  | Readonly<{ type: 'chunk'; content: string }>
  | Readonly<{ type: 'tool_use'; toolCall: ToolCall }>
  | Readonly<{ type: 'done' }>
  | Readonly<{ type: 'error'; message: string }>
  | Readonly<{ type: 'info'; message: string }>;

export type SendMessageResult =
  | Readonly<{ status: 'ok' }>
  | Readonly<{ status: 'error'; code: 'PROVIDER_ERROR' | 'MODEL_ERROR' | 'NETWORK_ERROR' | 'UNKNOWN'; message: string }>;

export type ModelProviderConfig = Readonly<{
  baseUrl: string;
  hasApiKey: boolean;
}>;

export type TestConnectionResult =
  | Readonly<{ status: 'ok'; models: readonly ModelInfo[] }>
  | Readonly<{ status: 'error'; message: string }>;

export type AgentRuntimeResult<T> =
  | Readonly<{ status: 'ok'; value: T }>
  | Readonly<{
      status: 'error';
      code: 'SESSION_NOT_FOUND' | 'WORKER_NOT_FOUND' | 'INVALID_SCOPE' | 'TASK_NOT_FOUND' | 'ALREADY_RUNNING' | 'UNKNOWN';
      message: string;
    }>;

export type AgentRuntimePermissionScope = Readonly<{
  sessionId: string;
  taskId: string;
  kind: 'parent' | 'subagent';
  allowedTools: readonly string[];
}>;

export type AgentRuntimeWorkerInput = Readonly<{
  sessionId: string;
  taskId: string;
  agentName: string;
  modelId: string;
  prompt: string;
  contextSnapshot: readonly string[];
  permissionScope: AgentRuntimePermissionScope;
}>;

export type AgentRuntimeWorkerOutput = Readonly<{
  summary: string;
  references: readonly string[];
  toolsUsed: readonly string[];
}>;

export type AgentRuntimeWorkerDefinition = Readonly<{
  id: string;
  run(
    input: AgentRuntimeWorkerInput,
    signal: AbortSignal
  ): Promise<AgentRuntimeWorkerOutput>;
}>;

export type AgentRuntimeSessionState = Readonly<{
  id: string;
  chatTabId: string;
  modelId: string;
  agentName: string;
  status: 'active' | 'crashed' | 'stopped';
  permissionScope: AgentRuntimePermissionScope;
  context: readonly string[];
  eventLog: readonly AgentRuntimeEventEntry[];
  workers: readonly AgentRuntimeWorkerState[];
  tasks: readonly AgentRuntimeTaskState[];
  resumeToken?: string;
}>;

export type AgentRuntimeWorkerState = Readonly<{
  id: string;
  sessionId: string;
  taskId: string;
  status: 'idle' | 'running' | 'stopping' | 'stopped' | 'crashed';
  attempt: number;
  maxRetries: number;
  lastError?: string;
  startedAt?: number;
  stoppedAt?: number;
  output?: AgentRuntimeWorkerOutput;
}>;

export type AgentRuntimeTaskState = Readonly<{
  id: string;
  sessionId: string;
  parentTaskId?: string;
  kind: 'chat' | 'subagent';
  agentName: string;
  modelId: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  permissionScope: AgentRuntimePermissionScope;
  context: readonly string[];
  toolsUsed: readonly string[];
  result?: AgentRuntimeWorkerOutput;
  error?: string;
  createdAt: number;
  updatedAt: number;
}>;

export type AgentRuntimeEventEntry = Readonly<{
  id: string;
  sessionId: string;
  taskId?: string;
  workerId?: string;
  type: 'session-created' | 'session-stopped' | 'worker-started' | 'worker-stopped' | 'worker-crashed' | 'worker-resumed' | 'task-created' | 'task-updated' | 'task-completed' | 'task-failed' | 'task-cancelled';
  message: string;
  timestamp: number;
}>;

export type AgentRuntimeStartSessionOptions = Readonly<{
  chatTabId: string;
  modelId: string;
  agentName: string;
  context?: readonly string[];
  allowedTools?: readonly string[];
}>;

export type AgentRuntimeStartWorkerOptions = Readonly<{
  sessionId: string;
  taskId: string;
  prompt: string;
  context?: readonly string[];
  allowedTools?: readonly string[];
}>;

export type AgentRuntimeStartSubagentOptions = Readonly<{
  sessionId: string;
  name: string;
  goal: string;
  modelId: string;
  context?: readonly string[];
  allowedTools?: readonly string[];
  parentTaskId?: string;
}>;

export type AgentRuntimeResumeOptions = Readonly<{
  sessionId: string;
  workerId: string;
}>;

export type PermissionAction = PermissionActionKind;
export type PermissionActionKindAlias = PermissionActionKind;

export type PermissionActor = PermissionActorKind;
export type PermissionActorKindAlias = PermissionActorKind;

export type PermissionRuntime = PermissionRuntimeKind;
export type PermissionRuntimeKindAlias = PermissionRuntimeKind;

export type PermissionRisk = PermissionRiskLevel;
export type PermissionRiskLevelAlias = PermissionRiskLevel;

export type PermissionDecisionType = PermissionDecision;
export type PermissionDecisionKindAlias = PermissionDecisionKind;

export type PermissionPromptState = PermissionPrompt;
export type PermissionApproval = PermissionApprovalInput;
export type PermissionApprovalOutcome = PermissionApprovalResult;
export type PermissionGrantState = PermissionGrant;
export type PermissionGrantDurationValue = PermissionGrantDuration;
export type PermissionGrantScopeValue = PermissionGrantScope;
export type PermissionRequestState = PermissionRequest;
export type PermissionBrokerSnapshot = PermissionBrokerState;
export type PermissionAuditEntryAlias = PermissionAuditEntry;
export type PermissionEvaluationAlias = PermissionEvaluation;

// ?? Model Gateway guards ??????????????????????????????????????????????????

const MODEL_PROVIDER_IDS = new Set<string>(['openrouter', 'ollama', 'lmstudio', 'openai-compatible']);
const MODEL_PROVIDER_STATUSES = new Set<string>(['idle', 'checking', 'ready', 'error']);
const CHAT_ROLES = new Set<string>(['user', 'assistant', 'system', 'tool']);


export function isModelProviderId(value: unknown): value is ModelProviderId {
  return typeof value === 'string' && MODEL_PROVIDER_IDS.has(value);
}

export function isModelInfo(value: unknown): value is ModelInfo {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isModelProviderId(value.provider) &&
    typeof value.contextWindow === 'number' &&
    typeof value.supportsTools === 'boolean' &&
    typeof value.supportsStreaming === 'boolean' &&
    typeof value.supportsEmbeddings === 'boolean'
  );
}

export function isModelProviderState(value: unknown): value is ModelProviderState {
  if (!isRecord(value)) return false;
  return (
    isModelProviderId(value.id) &&
    typeof value.label === 'string' &&
    typeof value.status === 'string' && MODEL_PROVIDER_STATUSES.has(value.status) &&
    typeof value.baseUrl === 'string' &&
    Array.isArray(value.models) &&
    value.models.every(isModelInfo)
  );
}

export function isModelGatewayConfig(value: unknown): value is ModelGatewayConfig {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.providers) &&
    value.providers.every(isModelProviderState) &&
    isModelProviderId(value.activeProvider) &&
    typeof value.activeModel === 'string'
  );
}

export function isToolCall(value: unknown): value is ToolCall {
  if (!isRecord(value)) return false;
  if (value.type !== 'function') return false;
  if (!isRecord(value.function)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.function.name === 'string' &&
    typeof value.function.arguments === 'string'
  );
}

export function isChatMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value)) return false;
  if (typeof value.role !== 'string' || !CHAT_ROLES.has(value.role)) return false;
  if (typeof value.content !== 'string') return false;
  if (typeof value.timestamp !== 'number') return false;
  if (value.tool_calls !== undefined) {
    if (!Array.isArray(value.tool_calls) || !value.tool_calls.every(isToolCall)) return false;
  }
  if (value.tool_call_id !== undefined && typeof value.tool_call_id !== 'string') return false;
  return true;
}

export function isChatTabState(value: unknown): value is ChatTabState {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    !Array.isArray(value.messages) ||
    !value.messages.every(isChatMessage) ||
    typeof value.activeModel !== 'string' ||
    !isModelProviderId(value.activeProvider) ||
    typeof value.isStreaming !== 'boolean'
  ) {
    return false;
  }
  if (value.runtimeSessionId !== undefined && typeof value.runtimeSessionId !== 'string') return false;
  if (value.runtimeWorkerId !== undefined && typeof value.runtimeWorkerId !== 'string') return false;
  if (value.error !== undefined && typeof value.error !== 'string') return false;
  return true;
}

export function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'chunk') return typeof value.content === 'string';
  if (value.type === 'tool_use') return isToolCall(value.toolCall);
  if (value.type === 'done') return true;
  if (value.type === 'error') return typeof value.message === 'string';
  if (value.type === 'info') return typeof value.message === 'string';
  return false;
}

const SEND_MESSAGE_ERROR_CODES = new Set<string>(['PROVIDER_ERROR', 'MODEL_ERROR', 'NETWORK_ERROR', 'UNKNOWN']);

export function isSendMessageResult(value: unknown): value is SendMessageResult {
  if (!isRecord(value)) return false;
  if (value.status === 'ok') return true;
  return (
    value.status === 'error' &&
    typeof value.code === 'string' && SEND_MESSAGE_ERROR_CODES.has(value.code) &&
    typeof value.message === 'string'
  );
}

export function isModelProviderConfig(value: unknown): value is ModelProviderConfig {
  if (!isRecord(value)) return false;
  return typeof value.baseUrl === 'string' && typeof value.hasApiKey === 'boolean';
}

export function isTestConnectionResult(value: unknown): value is TestConnectionResult {
  if (!isRecord(value)) return false;
  if (value.status === 'ok') {
    return Array.isArray(value.models) && value.models.every(isModelInfo);
  }
  return value.status === 'error' && typeof value.message === 'string';
}

const AGENT_RUNTIME_PERMISSION_KINDS = new Set<string>(['parent', 'subagent']);
const AGENT_RUNTIME_WORKER_STATUSES = new Set<string>(['idle', 'running', 'stopping', 'stopped', 'crashed']);
const AGENT_RUNTIME_TASK_STATUSES = new Set<string>(['pending', 'running', 'completed', 'cancelled', 'failed']);
const AGENT_RUNTIME_EVENT_TYPES = new Set<string>(['session-created', 'session-stopped', 'worker-started', 'worker-stopped', 'worker-crashed', 'worker-resumed', 'task-created', 'task-updated', 'task-completed', 'task-failed', 'task-cancelled']);
const AGENT_RUNTIME_SESSION_STATUSES = new Set<string>(['active', 'crashed', 'stopped']);

export function isAgentRuntimeResult<T>(value: unknown, valueGuard?: (value: unknown) => value is T): value is AgentRuntimeResult<T> {
  if (!isRecord(value)) return false;
  if (value.status === 'ok') {
    return valueGuard === undefined || valueGuard(value.value);
  }
  return (
    value.status === 'error' &&
    typeof value.code === 'string' &&
    ['SESSION_NOT_FOUND', 'WORKER_NOT_FOUND', 'INVALID_SCOPE', 'TASK_NOT_FOUND', 'ALREADY_RUNNING', 'UNKNOWN'].includes(value.code) &&
    typeof value.message === 'string'
  );
}

export function isAgentRuntimePermissionScope(value: unknown): value is AgentRuntimePermissionScope {
  if (!isRecord(value)) return false;
  return (
    typeof value.sessionId === 'string' &&
    typeof value.taskId === 'string' &&
    typeof value.kind === 'string' && AGENT_RUNTIME_PERMISSION_KINDS.has(value.kind) &&
    Array.isArray(value.allowedTools) &&
    value.allowedTools.every(tool => typeof tool === 'string')
  );
}

export function isAgentRuntimeWorkerOutput(value: unknown): value is AgentRuntimeWorkerOutput {
  if (!isRecord(value)) return false;
  return (
    typeof value.summary === 'string' &&
    Array.isArray(value.references) &&
    value.references.every(reference => typeof reference === 'string') &&
    Array.isArray(value.toolsUsed) &&
    value.toolsUsed.every(tool => typeof tool === 'string')
  );
}

export function isAgentRuntimeWorkerState(value: unknown): value is AgentRuntimeWorkerState {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.sessionId !== 'string' ||
    typeof value.taskId !== 'string' ||
    typeof value.status !== 'string' || !AGENT_RUNTIME_WORKER_STATUSES.has(value.status) ||
    typeof value.attempt !== 'number' ||
    typeof value.maxRetries !== 'number'
  ) {
    return false;
  }
  if (value.lastError !== undefined && typeof value.lastError !== 'string') return false;
  if (value.startedAt !== undefined && typeof value.startedAt !== 'number') return false;
  if (value.stoppedAt !== undefined && typeof value.stoppedAt !== 'number') return false;
  if (value.output !== undefined && !isAgentRuntimeWorkerOutput(value.output)) return false;
  return true;
}

export function isAgentRuntimeTaskState(value: unknown): value is AgentRuntimeTaskState {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.sessionId !== 'string' ||
    typeof value.agentName !== 'string' ||
    typeof value.modelId !== 'string' ||
    typeof value.prompt !== 'string' ||
    typeof value.status !== 'string' || !AGENT_RUNTIME_TASK_STATUSES.has(value.status) ||
    !isAgentRuntimePermissionScope(value.permissionScope) ||
    !Array.isArray(value.context) ||
    !value.context.every(item => typeof item === 'string') ||
    !Array.isArray(value.toolsUsed) ||
    !value.toolsUsed.every(item => typeof item === 'string') ||
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number'
  ) {
    return false;
  }
  if (value.parentTaskId !== undefined && typeof value.parentTaskId !== 'string') return false;
  if (value.result !== undefined && !isAgentRuntimeWorkerOutput(value.result)) return false;
  if (value.error !== undefined && typeof value.error !== 'string') return false;
  return true;
}

export function isAgentRuntimeEventEntry(value: unknown): value is AgentRuntimeEventEntry {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.sessionId !== 'string' ||
    typeof value.type !== 'string' || !AGENT_RUNTIME_EVENT_TYPES.has(value.type) ||
    typeof value.message !== 'string' ||
    typeof value.timestamp !== 'number'
  ) {
    return false;
  }
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return false;
  if (value.workerId !== undefined && typeof value.workerId !== 'string') return false;
  return true;
}

export function isAgentRuntimeSessionState(value: unknown): value is AgentRuntimeSessionState {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.chatTabId !== 'string' ||
    typeof value.modelId !== 'string' ||
    typeof value.agentName !== 'string' ||
    typeof value.status !== 'string' || !AGENT_RUNTIME_SESSION_STATUSES.has(value.status) ||
    !isAgentRuntimePermissionScope(value.permissionScope) ||
    !Array.isArray(value.context) ||
    !value.context.every(item => typeof item === 'string') ||
    !Array.isArray(value.eventLog) ||
    !value.eventLog.every(isAgentRuntimeEventEntry) ||
    !Array.isArray(value.workers) ||
    !value.workers.every(isAgentRuntimeWorkerState) ||
    !Array.isArray(value.tasks) ||
    !value.tasks.every(isAgentRuntimeTaskState)
  ) {
    return false;
  }
  if (value.resumeToken !== undefined && typeof value.resumeToken !== 'string') return false;
  return true;
}

export function isAgentRuntimeStartWorkerOptions(value: unknown): value is AgentRuntimeStartWorkerOptions {
  if (!isRecord(value)) return false;
  if (
    typeof value.sessionId !== 'string' ||
    typeof value.taskId !== 'string' ||
    typeof value.prompt !== 'string'
  ) {
    return false;
  }
  if (value.context !== undefined && (!Array.isArray(value.context) || !value.context.every(item => typeof item === 'string'))) return false;
  if (value.allowedTools !== undefined && (!Array.isArray(value.allowedTools) || !value.allowedTools.every(item => typeof item === 'string'))) return false;
  return true;
}

export function isAgentRuntimeStartSubagentOptions(value: unknown): value is AgentRuntimeStartSubagentOptions {
  if (!isRecord(value)) return false;
  if (
    typeof value.sessionId !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.goal !== 'string' ||
    typeof value.modelId !== 'string'
  ) {
    return false;
  }
  if (value.context !== undefined && (!Array.isArray(value.context) || !value.context.every(item => typeof item === 'string'))) return false;
  if (value.allowedTools !== undefined && (!Array.isArray(value.allowedTools) || !value.allowedTools.every(item => typeof item === 'string'))) return false;
  if (value.parentTaskId !== undefined && typeof value.parentTaskId !== 'string') return false;
  return true;
}

export function isAgentRuntimeResumeOptions(value: unknown): value is AgentRuntimeResumeOptions {
  return isRecord(value) && typeof value.sessionId === 'string' && typeof value.workerId === 'string';
}