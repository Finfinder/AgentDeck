import { vi } from 'vitest';

import type {
  AgentDeckPreloadApi,
  ChatTabState,
  ModelGatewayConfig,
  SendMessageResult,
  ThemeSettings
} from '@agentdeck/shared';

/**
 * Creates a minimal mock AgentDeckPreloadApi for tests.
 * Includes all required fields for the current API surface.
 */
export function createMockPreloadApi(overrides: Partial<AgentDeckPreloadApi> = {}): AgentDeckPreloadApi {
  const mockApi = {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }) as unknown as AgentDeckPreloadApi['getStartupState'],
    getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }) as unknown as AgentDeckPreloadApi['getIdentitySession'],
    startOAuth: vi.fn().mockResolvedValue({ isLoggedIn: false }) as unknown as AgentDeckPreloadApi['startOAuth'],
    signOut: vi.fn().mockResolvedValue({ isLoggedIn: false }) as unknown as AgentDeckPreloadApi['signOut'],
    onIdentityChange: vi.fn().mockReturnValue(() => undefined) as unknown as AgentDeckPreloadApi['onIdentityChange'],
    onDeviceCode: vi.fn().mockReturnValue(() => undefined) as unknown as AgentDeckPreloadApi['onDeviceCode'],
    onIdentityWarning: vi.fn().mockReturnValue(() => undefined) as unknown as AgentDeckPreloadApi['onIdentityWarning'],
    getThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }) as unknown as AgentDeckPreloadApi['getThemeSettings'],
    setThemeSettings: vi.fn().mockImplementation(async (s: ThemeSettings) => s) as unknown as AgentDeckPreloadApi['setThemeSettings'],
    selectWorkspaceEntry: vi.fn().mockResolvedValue({ status: 'cancelled' }) as unknown as AgentDeckPreloadApi['selectWorkspaceEntry'],
    openWorkspace: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'Test mode' }) as unknown as AgentDeckPreloadApi['openWorkspace'],
    listDirectory: vi.fn().mockResolvedValue({ path: '', entries: [] }) as unknown as AgentDeckPreloadApi['listDirectory'],
    searchFiles: vi.fn().mockResolvedValue([]) as unknown as AgentDeckPreloadApi['searchFiles'],
    getRecentWorkspaces: vi.fn().mockResolvedValue([]) as unknown as AgentDeckPreloadApi['getRecentWorkspaces'],
    onFsEvent: vi.fn().mockReturnValue(() => undefined) as unknown as AgentDeckPreloadApi['onFsEvent'],
    readFile: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'Test mode' }) as unknown as AgentDeckPreloadApi['readFile'],
    writeFile: vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'Test mode' }) as unknown as AgentDeckPreloadApi['writeFile'],
    markBufferDirty: vi.fn().mockResolvedValue(undefined) as unknown as AgentDeckPreloadApi['markBufferDirty'],
    deleteFile: vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'Test mode' }) as unknown as AgentDeckPreloadApi['deleteFile'],
    renameFile: vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'Test mode' }) as unknown as AgentDeckPreloadApi['renameFile'],
    getEditorDiagnostics: vi.fn().mockResolvedValue([]) as unknown as AgentDeckPreloadApi['getEditorDiagnostics'],
    applyWorkspaceEdit: vi.fn().mockResolvedValue({ status: 'error', code: 'UNKNOWN', message: 'Test mode' }) as unknown as AgentDeckPreloadApi['applyWorkspaceEdit'],
    showDiff: vi.fn().mockResolvedValue({ status: 'error', code: 'UNKNOWN', message: 'Test mode' }) as unknown as AgentDeckPreloadApi['showDiff'],
    showSaveDialog: vi.fn().mockResolvedValue(null) as unknown as AgentDeckPreloadApi['showSaveDialog'],
    toggleDevTools: vi.fn().mockResolvedValue(undefined) as unknown as AgentDeckPreloadApi['toggleDevTools'],
    // Model Gateway
    getModelGatewayConfig: vi.fn().mockResolvedValue({
      providers: [],
      activeProvider: 'ollama',
      activeModel: 'default'
    } as ModelGatewayConfig) as unknown as AgentDeckPreloadApi['getModelGatewayConfig'],
    listChatTabs: vi.fn().mockResolvedValue([]) as unknown as AgentDeckPreloadApi['listChatTabs'],
    createChatTab: vi.fn().mockImplementation(async (title?: string): Promise<ChatTabState> => ({
      id: `chat-tab-${Date.now()}`,
      title: title ?? 'New Chat',
      messages: [],
      activeModel: 'default',
      activeProvider: 'ollama' as const,
      isStreaming: false
    })) as unknown as AgentDeckPreloadApi['createChatTab'],
    closeChatTab: vi.fn().mockResolvedValue(undefined) as unknown as AgentDeckPreloadApi['closeChatTab'],
    sendMessage: vi.fn().mockResolvedValue({ status: 'ok' } as SendMessageResult) as unknown as AgentDeckPreloadApi['sendMessage'],
    stopStreaming: vi.fn().mockResolvedValue(undefined) as unknown as AgentDeckPreloadApi['stopStreaming'],
    onChatStream: vi.fn().mockReturnValue(() => undefined) as unknown as AgentDeckPreloadApi['onChatStream'],
    onChatTabsChange: vi.fn().mockReturnValue(() => undefined) as unknown as AgentDeckPreloadApi['onChatTabsChange'],
    // Model Gateway secure config
    getApiKey: vi.fn().mockResolvedValue(null) as unknown as AgentDeckPreloadApi['getApiKey'],
    setApiKey: vi.fn().mockResolvedValue(undefined) as unknown as AgentDeckPreloadApi['setApiKey'],
    deleteApiKey: vi.fn().mockResolvedValue(undefined) as unknown as AgentDeckPreloadApi['deleteApiKey'],
    testConnection: vi.fn().mockResolvedValue({ status: 'error', message: 'Test mode' }) as unknown as AgentDeckPreloadApi['testConnection'],
    setProviderConfig: vi.fn().mockResolvedValue(undefined) as unknown as AgentDeckPreloadApi['setProviderConfig'],
    getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: '', hasApiKey: false }) as unknown as AgentDeckPreloadApi['getProviderConfig'],
    // Event Log
    getEventLog: vi.fn().mockResolvedValue({ status: 'ok', entries: [], total: 0 }) as unknown as AgentDeckPreloadApi['getEventLog'],
    onEventLogUpdate: vi.fn().mockReturnValue(() => undefined) as unknown as AgentDeckPreloadApi['onEventLogUpdate'],
    clearEventLog: vi.fn().mockResolvedValue(undefined) as unknown as AgentDeckPreloadApi['clearEventLog'],
    versions: { chrome: 'test', electron: 'test', node: 'test' },
    ...overrides
  } as AgentDeckPreloadApi;

  return mockApi;
}
