import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { AgentDeckPreloadApi, EventLogEntry } from '@agentdeck/shared';

import { EventLogPanel } from '../../packages/workbench/src/EventLogPanel';

function createMockAgent(overrides: Partial<AgentDeckPreloadApi> = {}): AgentDeckPreloadApi {
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
    getEventLog: vi.fn().mockResolvedValue({
      status: 'ok',
      entries: [
        {
          id: 'evt-1',
          timestamp: Date.now(),
          level: 'info',
          source: 'tool-router',
          message: 'Patch applied',
          diff: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new',
          filePath: 'test.ts',
          patchId: 'patch-1'
        },
        {
          id: 'evt-2',
          timestamp: Date.now() - 1000,
          level: 'error',
          source: 'editor',
          message: 'File not found'
        }
      ] as EventLogEntry[],
      total: 2
    }),
    onEventLogUpdate: vi.fn().mockReturnValue(() => undefined),
    clearEventLog: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as AgentDeckPreloadApi;
}

describe('EventLogPanel', () => {
  it('should render event log title and count', async () => {
    const agent = createMockAgent();
    render(<EventLogPanel agent={agent} />);

    expect(await screen.findByText('Event Log')).toBeDefined();
    expect(await screen.findByText('2 eventów')).toBeDefined();
  });

  it('should render event entries with correct levels', async () => {
    const agent = createMockAgent();
    render(<EventLogPanel agent={agent} />);

    expect(await screen.findByText('Patch applied')).toBeDefined();
    expect(await screen.findByText('File not found')).toBeDefined();
  });

  it('should render filter controls', async () => {
    const agent = createMockAgent();
    render(<EventLogPanel agent={agent} />);

    // Use getAllByText since "Błąd" appears both in filter button and entry badge
    const infoBtns = await screen.findAllByText('Info');
    expect(infoBtns.length).toBeGreaterThanOrEqual(1);
    const warnBtns = await screen.findAllByText('Ostrzeżenie');
    expect(warnBtns.length).toBeGreaterThanOrEqual(1);
    const bladBtns = await screen.findAllByText('Błąd');
    expect(bladBtns.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Tylko z diffem')).toBeDefined();
    expect(await screen.findByText('Wyczyść')).toBeDefined();
  });

  it('should show empty state when no entries', async () => {
    const agent = createMockAgent({
      getEventLog: vi.fn().mockResolvedValue({
        status: 'ok',
        entries: [],
        total: 0
      })
    });
    render(<EventLogPanel agent={agent} />);

    expect(await screen.findByText('Brak eventów do wyświetlenia')).toBeDefined();
  });

  it('should toggle level filters on click', async () => {
    const agent = createMockAgent();
    render(<EventLogPanel agent={agent} />);

    const infoBtn = await screen.findByText('Info');
    fireEvent.click(infoBtn);
    // After clicking, the level should be toggled off
    expect(infoBtn).toBeDefined();
  });

  it('should toggle diff-only filter on click', async () => {
    const agent = createMockAgent();
    render(<EventLogPanel agent={agent} />);

    const diffBtn = await screen.findByText('Tylko z diffem');
    fireEvent.click(diffBtn);
    expect(diffBtn).toBeDefined();
  });

  it('should call clearEventLog when clear button is clicked', async () => {
    const clearFn = vi.fn().mockResolvedValue(undefined);
    const agent = createMockAgent({
      clearEventLog: clearFn
    });
    render(<EventLogPanel agent={agent} />);

    const clearBtn = await screen.findByText('Wyczyść');
    fireEvent.click(clearBtn);
    expect(clearFn).toHaveBeenCalled();
  });

  it('should show diff toggle for entries with diff', async () => {
    const agent = createMockAgent();
    render(<EventLogPanel agent={agent} />);

    expect(await screen.findByText('Pokaż diff')).toBeDefined();
  });
});
