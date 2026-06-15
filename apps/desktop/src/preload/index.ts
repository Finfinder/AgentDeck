import { contextBridge, ipcRenderer } from 'electron';

import {
  DEFAULT_THEME_SETTINGS,
  IPC_CHANNELS,
  isAgentRuntimeResult,
  isAgentRuntimeSessionState,

  isAgentRuntimeTaskState,
  isAgentRuntimeWorkerState,
  isChatStreamEvent,
  isChatTabState,
  isDirectoryListing,
  isDiffResult,
  isFileOperationResult,
  isFileReadResult,
  isFileWriteResult,
  isFsChangeEvent,
  isIdentitySession,
  isIdentitySessionWarning,
  isModelGatewayConfig,
  isPermissionApprovalResult,
  isPermissionBrokerState,
  isPermissionDecision,
  isModelProviderConfig,
  isSendMessageResult,
  isTestConnectionResult,
  isStartupState,
  isThemeSettings,
  isWorkspaceEditResult,
  isWorkspaceModel,
  isWorkspaceSelection,
  type AgentDeckPreloadApi,
  type PermissionApprovalInput,
  type PermissionDecision,
  type AgentRuntimeStartSubagentOptions,
  type AgentRuntimeTaskState,
  type AgentRuntimeWorkerState,
  type ChatStreamEvent,
  type ChatTabState,
  type DiffInput,
  type EditorDiagnostic,
  type FsChangeEvent,
  type IdentitySession,
  type IdentitySessionWarning,

  type StartupState,
  type WorkspaceEditInput,

} from '@agentdeck/shared';

const invalidStartupState: StartupState = {
  status: 'error',
  appVersion: '0.1.0',
  code: 'INVALID_STARTUP_STATE',
  message: 'The main process returned an invalid startup state.'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const api: AgentDeckPreloadApi = {
  getStartupState: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.getStartupState);
    return isStartupState(value) ? value : invalidStartupState;
  },
  getThemeSettings: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.getThemeSettings);
    return isThemeSettings(value) ? value : DEFAULT_THEME_SETTINGS;
  },
  getIdentitySession: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.identityGetSession);
    // Validate shape before returning to renderer
    return isIdentitySession(value) ? value : { isLoggedIn: false };
  },
  startOAuth: async (opts?: unknown) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.identityStartOAuth, opts);
    return isIdentitySession(value) ? value : { isLoggedIn: false };
  },
  signOut: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.identitySignOut);
    return isIdentitySession(value) ? value : { isLoggedIn: false };
  },
  setThemeSettings: async settings => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.setThemeSettings, settings);
    return isThemeSettings(value) ? value : DEFAULT_THEME_SETTINGS;
  },
  selectWorkspaceEntry: async request => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.selectWorkspaceEntry, request);
    return isWorkspaceSelection(value) ? value : { status: 'cancelled' };
  },
  openWorkspace: async (path, kind) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.openWorkspace, path, kind);
    if (!isWorkspaceModel(value)) {
      return { status: 'error', code: 'INVALID_JSONC', message: 'Unexpected response from main process.' };
    }
    return value;
  },
  listDirectory: async path => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.listDirectory, path);
    return isDirectoryListing(value) ? value : { path, entries: [] };
  },
  searchFiles: async query => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.searchFiles, query);
    return Array.isArray(value) ? value : [];
  },
  getRecentWorkspaces: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.getRecentWorkspaces);
    return Array.isArray(value) ? value : [];
  },
  onFsEvent: (handler: (event: FsChangeEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isFsChangeEvent(value)) handler(value);
    };
    ipcRenderer.on(IPC_CHANNELS.fsEvent, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.fsEvent, listener); };
  },
  onIdentityChange: (handler: (session: IdentitySession) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isIdentitySession(value)) handler(value);
    };
    ipcRenderer.on(IPC_CHANNELS.identityChanged, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.identityChanged, listener); };
  },
  onDeviceCode: (handler: (data: { userCode: string; verificationUri: string; verificationUriComplete?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
      if (data && typeof data === 'object' && 'userCode' in data && 'verificationUri' in data) {
        handler(data as { userCode: string; verificationUri: string; verificationUriComplete?: string });
      }
    };
    ipcRenderer.on(IPC_CHANNELS.identityDeviceCode, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.identityDeviceCode, listener); };
  },
  onIdentityWarning: (handler: (warning: IdentitySessionWarning) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isIdentitySessionWarning(value)) handler(value);
    };
    ipcRenderer.on(IPC_CHANNELS.identityWarning, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.identityWarning, listener); };
  },
  readFile: async (filePath: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.readFile, filePath);
    return isFileReadResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  writeFile: async (filePath: string, content: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.writeFile, filePath, content);
    return isFileWriteResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  markBufferDirty: async (filePath: string) => {
    await ipcRenderer.invoke(IPC_CHANNELS.markBufferDirty, filePath);
  },
  deleteFile: async (filePath: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.deleteFile, filePath);
    return isFileOperationResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  renameFile: async (oldPath: string, newPath: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.renameFile, oldPath, newPath);
    return isFileOperationResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  getEditorDiagnostics: async (filePath: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.getEditorDiagnostics, filePath);
    return Array.isArray(value) ? value as EditorDiagnostic[] : [];
  },
  applyWorkspaceEdit: async (edit: WorkspaceEditInput) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.applyWorkspaceEdit, edit);
    return isWorkspaceEditResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  showDiff: async (input: DiffInput) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.showDiff, input);
    return isDiffResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  showSaveDialog: async (defaultPath?: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.showSaveDialog, defaultPath);
    return typeof value === 'string' ? value : null;
  },
  toggleDevTools: async () => {
    await ipcRenderer.invoke(IPC_CHANNELS.toggleDevTools);
  },
  // Model Gateway
  getModelGatewayConfig: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.getModelGatewayConfig);
    return isModelGatewayConfig(value) ? value : { providers: [], activeProvider: 'ollama', activeModel: 'default' };
  },
  listChatTabs: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.listChatTabs);
    return Array.isArray(value) ? value.filter(isChatTabState) : [];
  },
  createChatTab: async (title?: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.createChatTab, title);
    return isChatTabState(value) ? value : { id: 'error', title: 'Error', messages: [], activeModel: 'default', activeProvider: 'ollama', isStreaming: false, error: 'Failed to create chat tab.' };
  },
  closeChatTab: async (tabId: string) => {
    await ipcRenderer.invoke(IPC_CHANNELS.closeChatTab, tabId);
  },
  sendMessage: async (tabId: string, message: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.sendMessage, tabId, message);
    return isSendMessageResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  stopStreaming: async (tabId: string) => {
    await ipcRenderer.invoke(IPC_CHANNELS.stopStreaming, tabId);
  },
  onChatStream: (handler: (tabId: string, event: ChatStreamEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, tabId: unknown, streamEvent: unknown) => {
      if (typeof tabId === 'string' && isChatStreamEvent(streamEvent)) {
        handler(tabId, streamEvent);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.chatStreamEvent, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.chatStreamEvent, listener); };
  },
  onChatTabsChange: (handler: (tabs: readonly ChatTabState[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (Array.isArray(value)) {
        handler(value.filter(isChatTabState));
      }
    };
    ipcRenderer.on(IPC_CHANNELS.chatTabsChanged, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.chatTabsChanged, listener); };
  },
  onAgentRuntimeSessionChanged: handler => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isAgentRuntimeSessionState(value)) handler(value);
    };
    ipcRenderer.on(IPC_CHANNELS.agentRuntimeSessionChanged, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.agentRuntimeSessionChanged, listener); };
  },
  onAgentRuntimeTaskChanged: handler => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isAgentRuntimeTaskState(value)) handler(value);
    };
    ipcRenderer.on(IPC_CHANNELS.agentRuntimeTaskChanged, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.agentRuntimeTaskChanged, listener); };
  },
  onAgentRuntimeWorkerChanged: handler => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isAgentRuntimeWorkerState(value)) handler(value);
    };
    ipcRenderer.on(IPC_CHANNELS.agentRuntimeWorkerChanged, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.agentRuntimeWorkerChanged, listener); };
  },
  onAgentRuntimeSessionCrashed: handler => {
    const listener = (_event: Electron.IpcRendererEvent, session: unknown, error: unknown) => {
      if (isAgentRuntimeSessionState(session) && isRecord(error)) {
        handler(session, { message: typeof error.message === 'string' ? error.message : 'Runtime session crashed.' });
      }
    };
    ipcRenderer.on(IPC_CHANNELS.agentRuntimeSessionCrashed, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.agentRuntimeSessionCrashed, listener); };
  },
  listAgentRuntimeSessions: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeListSessions);
    return Array.isArray(value) ? value.filter(isAgentRuntimeSessionState) : [];
  },
  getAgentRuntimeSession: async sessionId => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeGetSession, sessionId);
    return isAgentRuntimeSessionState(value) ? value : undefined;
  },
  listAgentRuntimeWorkers: async sessionId => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeListWorkers, sessionId);
    return Array.isArray(value) ? value.filter(isAgentRuntimeWorkerState) : [];
  },
  getAgentRuntimeWorker: async workerId => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeGetWorker, workerId);
    return isAgentRuntimeWorkerState(value) ? value : undefined;
  },
  listAgentRuntimeTasks: async sessionId => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeListTasks, sessionId);
    return Array.isArray(value) ? value.filter(isAgentRuntimeTaskState) : [];
  },
  getAgentRuntimeTask: async taskId => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeGetTask, taskId);
    return isAgentRuntimeTaskState(value) ? value : undefined;
  },
  startAgentRuntimeWorker: async options => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeStartWorker, options);
    return isAgentRuntimeResult<AgentRuntimeWorkerState>(value)
      ? value
      : { status: 'error' as const, code: 'UNKNOWN' as const, message: 'Unexpected response from main process.' };
  },
  startAgentRuntimeSubagent: async (options: AgentRuntimeStartSubagentOptions) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeStartSubagent, options);
    return isAgentRuntimeResult<AgentRuntimeTaskState>(value)
      ? value
      : { status: 'error' as const, code: 'UNKNOWN' as const, message: 'Unexpected response from main process.' };
  },
  resumeAgentRuntimeWorker: async options => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeResumeWorker, options);
    return isAgentRuntimeResult<AgentRuntimeWorkerState>(value)
      ? value
      : { status: 'error' as const, code: 'UNKNOWN' as const, message: 'Unexpected response from main process.' };
  },
  stopAgentRuntimeWorker: async workerId => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeStopWorker, workerId);
    return isAgentRuntimeResult<AgentRuntimeWorkerState>(value)
      ? value
      : { status: 'error' as const, code: 'UNKNOWN' as const, message: 'Unexpected response from main process.' };
  },
  stopAgentRuntimeSession: async sessionId => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeStopSession, sessionId);
    return isAgentRuntimeResult<readonly AgentRuntimeWorkerState[]>(value)
      ? value
      : { status: 'error' as const, code: 'UNKNOWN' as const, message: 'Unexpected response from main process.' };
  },
  // Model Gateway secure config
  getApiKey: async (providerId: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.modelGatewayGetApiKey, providerId);
    return typeof value === 'string' ? value : null;
  },
  setApiKey: async (providerId: string, apiKey: string) => {
    await ipcRenderer.invoke(IPC_CHANNELS.modelGatewaySetApiKey, providerId, apiKey);
  },
  deleteApiKey: async (providerId: string) => {
    await ipcRenderer.invoke(IPC_CHANNELS.modelGatewayDeleteApiKey, providerId);
  },
  testConnection: async (providerId: string, baseUrl: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.modelGatewayTestConnection, providerId, baseUrl);
    if (isTestConnectionResult(value)) {
      return value;
    }
    return { status: 'error' as const, message: 'Unexpected response from main process.' };
  },
  setProviderConfig: async (providerId: string, baseUrl: string) => {
    await ipcRenderer.invoke(IPC_CHANNELS.modelGatewaySetProviderConfig, providerId, baseUrl);
  },
  getProviderConfig: async (providerId: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.modelGatewayGetProviderConfig, providerId);
    return isModelProviderConfig(value) ? value : { baseUrl: '', hasApiKey: false };
  },
  setActiveModel: async (tabId: string, modelId: string) => {
    await ipcRenderer.invoke(IPC_CHANNELS.chatSetActiveModel, tabId, modelId);
  },
  setActiveProvider: async (tabId: string, providerId: string) => {
    await ipcRenderer.invoke(IPC_CHANNELS.chatSetActiveProvider, tabId, providerId);
  },
  // Permission Broker
  getPermissionBrokerState: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.permissionBrokerGetState);
    return isPermissionBrokerState(value) ? value : { decisions: [], prompts: [], grants: [], audit: [] };
  },
  approvePermissionDecision: async (input: PermissionApprovalInput) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.permissionBrokerApproveDecision, input);
    return isPermissionApprovalResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Invalid approval result from main process.' };
  },
  onPermissionDecision: (handler: (decision: PermissionDecision) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isPermissionDecision(value)) {
        handler(value);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.permissionBrokerDecisionChanged, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.permissionBrokerDecisionChanged, listener); };
  },
  versions: {
    chrome: process.versions.chrome ?? 'unknown',
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node
  }
};

contextBridge.exposeInMainWorld('agentDeck', api);
