import { vi } from 'vitest';
import type { AgentDeckPreloadApi, EventLogEntry } from '@agentdeck/shared';

const DEFAULT_EVENT_LOG_ENTRIES: EventLogEntry[] = [
  {
    id: 'evt-1',
    timestamp: 1000,
    level: 'info' as const,
    source: 'tool-router',
    message: 'Patch applied',
    diff: '--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n context line\n-removed line\n+added line\n another context',
    filePath: 'src/file.ts',
    patchId: 'patch-1'
  },
  {
    id: 'evt-2',
    timestamp: 2000,
    level: 'warn' as const,
    source: 'permission-broker',
    message: 'Approval required',
    diff: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new'
  },
  {
    id: 'evt-3',
    timestamp: 3000,
    level: 'error' as const,
    source: 'editor',
    message: 'File not found'
  }
];

export function createMockAgent(overrides: Partial<AgentDeckPreloadApi> = {}): AgentDeckPreloadApi {
  return {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }),
    versions: { chrome: 'dev', electron: 'dev', node: 'dev' },
    getThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }),
    setThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }),
    selectWorkspaceEntry: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    openWorkspace: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'test' }),
    listDirectory: vi.fn().mockResolvedValue({ path: '', entries: [] }),
    searchFiles: vi.fn().mockResolvedValue([]),
    getRecentWorkspaces: vi.fn().mockResolvedValue([]),
    onFsEvent: vi.fn().mockReturnValue(() => undefined),
    readFile: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'test' }),
    writeFile: vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'test' }),
    markBufferDirty: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'test' }),
    renameFile: vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'test' }),
    getEditorDiagnostics: vi.fn().mockResolvedValue([]),
    applyWorkspaceEdit: vi.fn().mockResolvedValue({ status: 'error', code: 'UNKNOWN', message: 'test' }),
    showDiff: vi.fn().mockResolvedValue({ status: 'error', code: 'UNKNOWN', message: 'test' }),
    showSaveDialog: vi.fn().mockResolvedValue(null),
    toggleDevTools: vi.fn().mockResolvedValue(undefined),
    getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    startOAuth: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    signOut: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    onIdentityChange: vi.fn().mockReturnValue(() => undefined),
    onDeviceCode: vi.fn().mockReturnValue(() => undefined),
    onIdentityWarning: vi.fn().mockReturnValue(() => undefined),
    getModelGatewayConfig: vi.fn().mockResolvedValue({ providers: [], activeProvider: 'ollama', activeModel: 'default' }),
    listChatTabs: vi.fn().mockResolvedValue([]),
    createChatTab: vi.fn().mockResolvedValue({ id: 'tab-1', title: 'Chat', messages: [], activeModel: 'default', activeProvider: 'ollama', isStreaming: false }),
    closeChatTab: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ status: 'ok' }),
    stopStreaming: vi.fn().mockResolvedValue(undefined),
    onChatStream: vi.fn().mockReturnValue(() => undefined),
    onChatTabsChange: vi.fn().mockReturnValue(() => undefined),
    getApiKey: vi.fn().mockResolvedValue(null),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    deleteApiKey: vi.fn().mockResolvedValue(undefined),
    testConnection: vi.fn().mockResolvedValue({ status: 'error', message: 'test' }),
    setProviderConfig: vi.fn().mockResolvedValue(undefined),
    getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: '', hasApiKey: false }),
    toolCall: vi.fn().mockResolvedValue({ status: 'ok', callId: 'dev', result: null }),
    onToolApprovalRequest: vi.fn().mockReturnValue(() => undefined),
    submitApproval: vi.fn().mockResolvedValue({ status: 'ok', callId: 'dev', result: null }),
    proposePatch: vi.fn().mockResolvedValue({ status: 'ok', patchId: 'dev-patch', appliedHash: 'dev-hash' }),
    applyPatch: vi.fn().mockResolvedValue({ status: 'ok', patchId: 'dev-patch', appliedHash: 'dev-hash' }),
    onConflictDetected: vi.fn().mockReturnValue(() => undefined),
    resolveConflict: vi.fn().mockResolvedValue(undefined),
    checkSensitivePath: vi.fn().mockResolvedValue({ filePath: '', isSensitive: false }),
    getFileHash: vi.fn().mockResolvedValue({ status: 'ok', hash: 'dev-hash' }),
    getEventLog: vi.fn().mockResolvedValue({ status: 'ok', entries: DEFAULT_EVENT_LOG_ENTRIES, total: 3 }),
    onEventLogUpdate: vi.fn().mockReturnValue(() => undefined),
    clearEventLog: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as AgentDeckPreloadApi;
}
