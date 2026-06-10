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
  chatSetActiveProvider: 'agentdeck:v1:chat:set-active-provider'
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
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    Array.isArray(value.messages) &&
    value.messages.every(isChatMessage) &&
    typeof value.activeModel === 'string' &&
    isModelProviderId(value.activeProvider) &&
    typeof value.isStreaming === 'boolean'
  );
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
  if (value.status === 'ok') return Array.isArray(value.models);
  return value.status === 'error' && typeof value.message === 'string';
}