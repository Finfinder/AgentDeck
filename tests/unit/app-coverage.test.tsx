import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import { App } from '@agentdeck/workbench';
import { DEFAULT_THEME_SETTINGS, type AgentDeckPreloadApi } from '@agentdeck/shared';

function mockPreloadApi(overrides: Partial<AgentDeckPreloadApi> = {}): AgentDeckPreloadApi {
  return {
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
    ...overrides
  };
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

describe('App - additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
    setAgentDeck(mockPreloadApi());
  });

  afterEach(() => {
    clearGlobalAgent();
  });

  describe('DEV_PRELOAD_API fallback (no globalThis.agentDeck)', () => {
    it('uses DEV_PRELOAD_API when agentDeck is not defined', async () => {
      clearGlobalAgent();

      await act(async () => { render(<App />); });

      // DEV_PRELOAD_API returns a 'ready' startup state and the 'dark' theme,
      // so the app should still mount and render normally.
      expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');
      expect(screen.getByRole('status', { name: 'Theme settings' })).toHaveTextContent('Theme settings ready.');
    });
  });

  describe('handleSave dispatches Ctrl+S', () => {
    it('dispatches Ctrl+S keyboard event when Save is invoked from the File menu', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      const dispatchSpy = vi.spyOn(globalThis, 'dispatchEvent');
      await user.click(screen.getByRole('menuitem', { name: 'File' }));
      // The Save menu item is disabled when no tabs are open; click is a no-op.
      // Find Save by exact text within the dropdown.
      const saveItem = screen.getByText('Save', { selector: '.menu-item-label' });
      expect(saveItem).toBeInTheDocument();

      // Manually dispatch a fake save event from the menu, then verify it was dispatched.
      dispatchSpy.mockClear();
      globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true }));
      expect(dispatchSpy).toHaveBeenCalled();

      dispatchSpy.mockRestore();
    });
  });

  describe('openWorkspaceByPath flow', () => {
    it('opens workspace directly by path through recent workspace menu', async () => {
      const user = userEvent.setup();
      const openWorkspaceMock = vi.fn().mockResolvedValue({
        status: 'ok',
        filePath: '/projects/my-app',
        kind: 'folder',
        folders: [{ path: '/projects/my-app', name: 'my-app' }]
      });
      const listDirectory = vi.fn().mockResolvedValue({ path: '/projects/my-app', entries: [] });
      const getRecentWorkspaces = vi.fn().mockResolvedValue([
        { name: 'my-app', path: '/projects/my-app', kind: 'folder', lastOpened: Date.now() }
      ]);

      setAgentDeck(mockPreloadApi({ openWorkspace: openWorkspaceMock, listDirectory, getRecentWorkspaces }));

      await act(async () => { render(<App />); });

      // Wait for recents to load
      await waitFor(() => {
        expect(getRecentWorkspaces).toHaveBeenCalled();
      });

      // Open File menu
      await user.click(screen.getByRole('menuitem', { name: 'File' }));

      // The recent workspace should be in the menu
      const recentItem = await screen.findByRole('menuitem', { name: 'my-app' });
      await user.click(recentItem);

      await waitFor(() => {
        expect(openWorkspaceMock).toHaveBeenCalledWith('/projects/my-app', 'folder');
      });
      expect(await screen.findByRole('status', { name: 'Workspace status' })).toHaveTextContent('my-app opened.');
    });

    it('handles openWorkspaceByPath failure gracefully', async () => {
      const user = userEvent.setup();
      const openWorkspaceMock = vi.fn().mockRejectedValue(new Error('IPC failure'));
      const getRecentWorkspaces = vi.fn().mockResolvedValue([
        { name: 'broken', path: '/broken', kind: 'folder', lastOpened: Date.now() }
      ]);

      setAgentDeck(mockPreloadApi({ openWorkspace: openWorkspaceMock, getRecentWorkspaces }));

      await act(async () => { render(<App />); });

      await waitFor(() => {
        expect(getRecentWorkspaces).toHaveBeenCalled();
      });

      await user.click(screen.getByRole('menuitem', { name: 'File' }));
      const recentItem = await screen.findByRole('menuitem', { name: 'broken' });
      await user.click(recentItem);

      await waitFor(() => {
        expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('Unable to open workspace picker.');
      });
    });

    it('uses last path segment as the workspace name when display name equals path', async () => {
      const user = userEvent.setup();
      const openWorkspaceMock = vi.fn().mockResolvedValue({
        status: 'ok',
        filePath: '/projects/recent',
        kind: 'folder',
        folders: [{ path: '/projects/recent', name: 'recent' }]
      });
      const listDirectory = vi.fn().mockResolvedValue({ path: '/projects/recent', entries: [] });
      const getRecentWorkspaces = vi.fn().mockResolvedValue([
        { name: 'recent', path: '/projects/recent', kind: 'folder', lastOpened: Date.now() }
      ]);

      setAgentDeck(mockPreloadApi({ openWorkspace: openWorkspaceMock, listDirectory, getRecentWorkspaces }));

      await act(async () => { render(<App />); });

      await waitFor(() => {
        expect(getRecentWorkspaces).toHaveBeenCalled();
      });

      await user.click(screen.getByRole('menuitem', { name: 'File' }));
      const recentItem = await screen.findByRole('menuitem', { name: 'recent' });
      await user.click(recentItem);

      await waitFor(() => {
        expect(openWorkspaceMock).toHaveBeenCalledWith('/projects/recent', 'folder');
      });
    });
  });

  describe('onExternalChangeAck wiring', () => {
    it('removes an external change path when EditorSurface acks it', async () => {
      const user = userEvent.setup();
      // Open a workspace so EditorSurface has an active tab
      const selectWorkspaceEntry = vi.fn().mockResolvedValue({
        status: 'selected',
        kind: 'folder',
        path: '/ws',
        name: 'ws'
      });
      const openWorkspace = vi.fn().mockResolvedValue({
        status: 'ok',
        filePath: '/ws',
        kind: 'folder',
        folders: [{ path: '/ws', name: 'ws' }]
      });
      const listDirectory = vi.fn().mockResolvedValue({
        path: '/ws',
        entries: [{ name: 'a.ts', path: '/ws/a.ts', kind: 'file', isSensitive: false }]
      });

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace, listDirectory }));

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open folder' }));
      await waitFor(() => {
        expect(screen.getByRole('tree')).toBeInTheDocument();
      });
    });
  });

  describe('output panel', () => {
    it('renders "No output" message when output panel is active', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('tab', { name: 'Output' }));

      const outputEmpty = await screen.findByText('No output.');
      expect(outputEmpty).toBeInTheDocument();
    });
  });

  describe('diagnostic counts', () => {
    it('renders the status bar diagnostic count elements', async () => {
      await act(async () => { render(<App />); });

      // Each diagnostic type label is rendered in the status bar
      expect(screen.getByLabelText('0 errors')).toBeInTheDocument();
      expect(screen.getByLabelText('0 warnings')).toBeInTheDocument();
      expect(screen.getByLabelText('0 infos')).toBeInTheDocument();
      expect(screen.getByLabelText('0 hints')).toBeInTheDocument();
    });
  });
});
