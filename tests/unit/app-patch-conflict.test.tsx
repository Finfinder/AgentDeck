import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import { App } from '@agentdeck/workbench';
import { DEFAULT_THEME_SETTINGS, type AgentDeckPreloadApi, type Conflict } from '@agentdeck/shared';

const SAMPLE_CONFLICT: Conflict = {
  id: 'conflict-test-1',
  kind: 'patch-conflict',
  patchId: 'patch-abc',
  filePath: '/workspace/src/app.ts',
  description: 'Plik /workspace/src/app.ts został zmodyfikowany na dysku od momentu utworzenia patcha (hash mismatch).',
  riskLevel: 'medium',
  createdAt: Date.now()
};

interface MockApiWithHandlers extends AgentDeckPreloadApi {
  _conflictHandlers: Array<(c: Conflict) => void>;
}

function mockPreloadApi(overrides: Partial<AgentDeckPreloadApi> = {}): MockApiWithHandlers {
  const conflictHandlers: Array<(c: Conflict) => void> = [];

  const api = {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }),
    selectWorkspaceEntry: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    getModelGatewayConfig: vi.fn().mockResolvedValue({ providers: [], activeProvider: 'ollama', activeModel: 'default' }),
    listChatTabs: vi.fn().mockResolvedValue([]),
    createChatTab: vi.fn().mockImplementation(async (title) => ({ id: `chat-tab-${Date.now()}`, title: title ?? 'New Chat', messages: [], activeModel: 'default', activeProvider: 'ollama', isStreaming: false })),
    closeChatTab: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ status: 'ok' }),
    stopStreaming: vi.fn().mockResolvedValue(undefined),
    onChatStream: vi.fn().mockReturnValue(() => undefined),
    onChatTabsChange: vi.fn().mockReturnValue(() => undefined),
    versions: { chrome: '130.0.0', electron: '42.3.0', node: '25.0.0' },
    getThemeSettings: vi.fn().mockResolvedValue(DEFAULT_THEME_SETTINGS),
    setThemeSettings: vi.fn().mockImplementation(async (s: unknown) => s),
    openWorkspace: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'Test' }),
    listDirectory: vi.fn().mockResolvedValue({ path: '/', entries: [] }),
    searchFiles: vi.fn().mockResolvedValue([]),
    getRecentWorkspaces: vi.fn().mockResolvedValue([]),
    onFsEvent: vi.fn().mockReturnValue(() => undefined),
    readFile: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'Test' }),
    writeFile: vi.fn().mockResolvedValue({ status: 'ok' }),
    markBufferDirty: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue({ status: 'ok' }),
    renameFile: vi.fn().mockResolvedValue({ status: 'ok' }),
    getEditorDiagnostics: vi.fn().mockResolvedValue([]),
    applyWorkspaceEdit: vi.fn().mockResolvedValue({ status: 'ok' }),
    showDiff: vi.fn().mockResolvedValue({ status: 'ok', diff: '' }),
    showSaveDialog: vi.fn().mockResolvedValue(null),
    toggleDevTools: vi.fn().mockResolvedValue(undefined),
    getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    startOAuth: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    signOut: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    onIdentityChange: vi.fn().mockReturnValue(() => undefined),
    onDeviceCode: vi.fn().mockReturnValue(() => undefined),
    onIdentityWarning: vi.fn().mockReturnValue(() => undefined),
    toolCall: vi.fn().mockResolvedValue({ status: 'ok', callId: 'dev', result: null }),
    onToolApprovalRequest: vi.fn().mockReturnValue(() => undefined),
    submitApproval: vi.fn().mockResolvedValue({ status: 'ok', callId: 'dev', result: null }),
    proposePatch: vi.fn().mockResolvedValue({ status: 'ok', patchId: 'dev-patch', appliedHash: 'dev-hash' }),
    applyPatch: vi.fn().mockResolvedValue({ status: 'ok', patchId: 'dev-patch', appliedHash: 'dev-hash' }),
    onConflictDetected: vi.fn().mockImplementation((handler: (c: Conflict) => void) => {
      conflictHandlers.push(handler);
      return () => {
        const idx = conflictHandlers.indexOf(handler);
        if (idx >= 0) conflictHandlers.splice(idx, 1);
      };
    }),
    resolveConflict: vi.fn().mockResolvedValue({ status: 'ok' }),
    checkSensitivePath: vi.fn().mockResolvedValue({ filePath: '', isSensitive: false }),
    getFileHash: vi.fn().mockResolvedValue({ status: 'ok', hash: 'dev-hash' }),
    _conflictHandlers: conflictHandlers,
    ...overrides
  };

  return api as MockApiWithHandlers;
}

function setAgentDeck(api: AgentDeckPreloadApi) {
  Object.defineProperty(globalThis, 'agentDeck', {
    configurable: true,
    value: api
  });
}

function clearGlobalAgent() {
  Object.defineProperty(globalThis, 'agentDeck', {
    configurable: true,
    value: undefined
  });
}

describe('App — PatchConflictDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
    setAgentDeck(mockPreloadApi());
  });

  afterEach(() => {
    clearGlobalAgent();
  });

  it('should not show conflict dialog initially', async () => {
    await act(async () => { render(<App />); });

    await waitFor(() => {
      expect(screen.getByLabelText('0 errors')).toBeInTheDocument();
    });

    expect(screen.queryByRole('alertdialog', { name: 'Patch conflict' })).not.toBeInTheDocument();
  });

  it('should render conflict dialog when onConflictDetected fires', async () => {
    const api = mockPreloadApi();
    setAgentDeck(api);

    await act(async () => { render(<App />); });

    await waitFor(() => {
      expect(screen.getByLabelText('0 errors')).toBeInTheDocument();
    });

    // Simulate conflict detected event from main process
    expect(api._conflictHandlers).toHaveLength(1);

    await act(async () => {
      api._conflictHandlers[0]!(SAMPLE_CONFLICT);
    });

    // Dialog should appear
    await waitFor(() => {
      expect(screen.getByRole('alertdialog', { name: 'Patch conflict' })).toBeInTheDocument();
    });

    // Should show file path
    expect(screen.getByText('/workspace/src/app.ts')).toBeInTheDocument();

    // Should show description
    expect(screen.getByText(/zmodyfikowany na dysku/)).toBeInTheDocument();

    // Should show all three action buttons
    expect(screen.getByRole('button', { name: 'Pomiń' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edytuj' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nadpisz' })).toBeInTheDocument();
  });

  it('should dismiss dialog and call resolveConflict on Nadpisz', async () => {
    const user = userEvent.setup();
    const api = mockPreloadApi();
    setAgentDeck(api);

    await act(async () => { render(<App />); });

    await waitFor(() => {
      expect(screen.getByLabelText('0 errors')).toBeInTheDocument();
    });

    await act(async () => {
      api._conflictHandlers[0]!(SAMPLE_CONFLICT);
    });

    await waitFor(() => {
      expect(screen.getByRole('alertdialog', { name: 'Patch conflict' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Nadpisz' }));

    // Dialog should disappear
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Patch conflict' })).not.toBeInTheDocument();
    });

    // resolveConflict should be called with apply action
    expect(api.resolveConflict).toHaveBeenCalledWith({
      conflictId: SAMPLE_CONFLICT.id,
      action: 'apply'
    });
  });

  it('should dismiss dialog and call resolveConflict on Pomiń', async () => {
    const user = userEvent.setup();
    const api = mockPreloadApi();
    setAgentDeck(api);

    await act(async () => { render(<App />); });

    await waitFor(() => {
      expect(screen.getByLabelText('0 errors')).toBeInTheDocument();
    });

    await act(async () => {
      api._conflictHandlers[0]!(SAMPLE_CONFLICT);
    });

    await waitFor(() => {
      expect(screen.getByRole('alertdialog', { name: 'Patch conflict' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Pomiń' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Patch conflict' })).not.toBeInTheDocument();
    });

    expect(api.resolveConflict).toHaveBeenCalledWith({
      conflictId: SAMPLE_CONFLICT.id,
      action: 'skip'
    });
  });

  it('should dismiss dialog and call resolveConflict on Edytuj', async () => {
    const user = userEvent.setup();
    const api = mockPreloadApi();
    setAgentDeck(api);

    await act(async () => { render(<App />); });

    await waitFor(() => {
      expect(screen.getByLabelText('0 errors')).toBeInTheDocument();
    });

    await act(async () => {
      api._conflictHandlers[0]!(SAMPLE_CONFLICT);
    });

    await waitFor(() => {
      expect(screen.getByRole('alertdialog', { name: 'Patch conflict' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Edytuj' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Patch conflict' })).not.toBeInTheDocument();
    });

    expect(api.resolveConflict).toHaveBeenCalledWith({
      conflictId: SAMPLE_CONFLICT.id,
      action: 'edit',
      operations: []
    });
  });

  it('should show diff preview with file path', async () => {
    const api = mockPreloadApi();
    setAgentDeck(api);

    await act(async () => { render(<App />); });

    await waitFor(() => {
      expect(screen.getByLabelText('0 errors')).toBeInTheDocument();
    });

    await act(async () => {
      api._conflictHandlers[0]!(SAMPLE_CONFLICT);
    });

    await waitFor(() => {
      expect(screen.getByRole('alertdialog', { name: 'Patch conflict' })).toBeInTheDocument();
    });

    // Diff preview should be visible
    const diffBlock = screen.getByLabelText('Diff preview');
    expect(diffBlock).toBeInTheDocument();
    expect(diffBlock.textContent).toContain('a/');
    expect(diffBlock.textContent).toContain('b/');
    expect(diffBlock.textContent).toContain('patch:');
  });
});
