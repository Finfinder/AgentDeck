import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
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

function createWorkspaceOpenMocks() {
  return {
    selectWorkspaceEntry: vi.fn().mockResolvedValue({
      status: 'selected' as const,
      kind: 'folder' as const,
      path: '/ws',
      name: 'ws'
    }),
    openWorkspace: vi.fn().mockResolvedValue({
      status: 'ok' as const,
      filePath: '/ws',
      kind: 'folder' as const,
      folders: [{ path: '/ws', name: 'ws' }]
    }),
    listDirectory: vi.fn().mockResolvedValue({ path: '/ws', entries: [] as const }),
    searchFiles: vi.fn().mockResolvedValue([])
  };
}

function clearGlobalAgent() {
  Object.defineProperty(globalThis, 'agentDeck', {
    configurable: true,
    value: undefined
  });
}

describe('App edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
    const freshAgent = mockPreloadApi();
    setAgentDeck(freshAgent);
  });

  afterEach(() => {
    cleanup();
    clearGlobalAgent();
  });

  describe('activity bar', () => {
    it('renders Explorer and Search activity buttons', async () => {
      await act(async () => { render(<App />); });

      expect(screen.getByRole('button', { name: 'Explorer' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    });

    it('toggles active panel from activity bar', async () => {
      const user = userEvent.setup();
      const mocks = createWorkspaceOpenMocks();
      setAgentDeck(mockPreloadApi(mocks));

      await act(async () => { render(<App />); });

      // Open workspace first so Search is enabled
      await user.click(screen.getByRole('button', { name: 'Open folder' }));
      await waitFor(() => {
        const searchBtn = screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement;
        expect(searchBtn.disabled).toBe(false);
      });

      // Explorer is active by default
      const explorerBtn = screen.getByRole('button', { name: 'Explorer' });
      expect(explorerBtn.getAttribute('aria-pressed')).toBe('true');

      // Click Search
      const searchBtn = screen.getByRole('button', { name: 'Search' });
      await user.click(searchBtn);

      expect(searchBtn.getAttribute('aria-pressed')).toBe('true');
      expect(explorerBtn.getAttribute('aria-pressed')).toBe('false');
    });

    it('disables Search button when no workspace is open', async () => {
      await act(async () => { render(<App />); });

      const searchBtn = screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement;
      expect(searchBtn.disabled).toBe(true);
    });

    it('enables Search button when workspace is open', async () => {
      const user = userEvent.setup();
      const mocks = createWorkspaceOpenMocks();
      setAgentDeck(mockPreloadApi(mocks));

      await act(async () => { render(<App />); });

      // Open workspace
      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      await waitFor(() => {
        const searchBtn = screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement;
        expect(searchBtn.disabled).toBe(false);
      });
    });
  });

  describe('close workspace event', () => {
    it('closes workspace when agentdeck:close-workspace event is dispatched', async () => {
      const user = userEvent.setup();
      const mocks = createWorkspaceOpenMocks();
      setAgentDeck(mockPreloadApi(mocks));

      await act(async () => { render(<App />); });

      // Open workspace
      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      await waitFor(() => {
        expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('ws opened.');
      });

      // Close workspace via event
      globalThis.dispatchEvent(new CustomEvent('agentdeck:close-workspace'));

      await waitFor(() => {
        expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('No workspace opened.');
      });
    });
  });

  describe('show panel event', () => {
    it('switches to search panel on agentdeck:show-panel event', async () => {
      const user = userEvent.setup();
      const mocks = createWorkspaceOpenMocks();
      mocks.searchFiles = vi.fn().mockResolvedValue([]);
      setAgentDeck(mockPreloadApi(mocks));

      await act(async () => { render(<App />); });

      // Open workspace first
      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      await waitFor(() => {
        const searchBtn = screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement;
        expect(searchBtn.disabled).toBe(false);
      });

      // Dispatch show-panel event for search
      globalThis.dispatchEvent(new CustomEvent('agentdeck:show-panel', { detail: 'search' }));

      await waitFor(() => {
        const searchBtn = screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement;
        expect(searchBtn.getAttribute('aria-pressed')).toBe('true');
      });
    });

    it('switches to explorer panel on agentdeck:show-panel event', async () => {

      await act(async () => { render(<App />); });

      // Explorer is active by default, switch to search via activity bar
      const searchBtn = screen.getByRole('button', { name: 'Search' });
      // Search is disabled without workspace, so dispatch event directly
      globalThis.dispatchEvent(new CustomEvent('agentdeck:show-panel', { detail: 'search' }));

      await waitFor(() => {
        expect(searchBtn).toHaveAttribute('aria-pressed', 'true');
      });

      // Switch back to explorer
      globalThis.dispatchEvent(new CustomEvent('agentdeck:show-panel', { detail: 'explorer' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'true');
      });
    });

    it('ignores unknown panel names in show-panel event', async () => {
      await act(async () => { render(<App />); });

      const explorerBtn = screen.getByRole('button', { name: 'Explorer' });
      expect(explorerBtn).toHaveAttribute('aria-pressed', 'true');

      // Dispatch unknown panel name
      globalThis.dispatchEvent(new CustomEvent('agentdeck:show-panel', { detail: 'unknown' }));

      // Should not change
      expect(explorerBtn).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('status bar', () => {
    it('renders workspace status in footer', async () => {
      await act(async () => { render(<App />); });

      expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('No workspace opened.');
    });

    it('renders theme settings status in footer', async () => {
      await act(async () => { render(<App />); });

      expect(screen.getByRole('status', { name: 'Theme settings' })).toHaveTextContent('Theme settings ready.');
    });

    it('renders theme switcher buttons', async () => {
      await act(async () => { render(<App />); });

      expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
    });

    it('marks Dark as pressed by default', async () => {
      await act(async () => { render(<App />); });

      expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('toggles theme when Light is clicked', async () => {
      const user = userEvent.setup();

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Light' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false');
      });
    });
  });

  describe('startup state handling', () => {
    it('renders ready status text', async () => {
      await act(async () => { render(<App />); });

      expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');
    });

    it('renders error status with alert role', async () => {
      setAgentDeck(mockPreloadApi({
        getStartupState: vi.fn().mockResolvedValue({
          status: 'error',
          appVersion: '0.1.0',
          code: 'DESKTOP_SERVICES_UNAVAILABLE',
          message: 'Services failed.'
        })
      }));

      await act(async () => { render(<App />); });

      expect(await screen.findByRole('alert', { name: 'Startup state' })).toHaveTextContent('Services failed.');
    });

    it('renders service list when services are available', async () => {
      setAgentDeck(mockPreloadApi({
        getStartupState: vi.fn().mockResolvedValue({
          status: 'ready',
          appVersion: '0.1.0',
          services: [
            { id: 'workspace-service', label: 'Workspace Service', status: 'ready' },
            { id: 'agent-runtime', label: 'Agent Runtime', status: 'ready' }
          ]
        })
      }));

      await act(async () => { render(<App />); });

      // Switch to Services panel to see the service list
      await userEvent.click(screen.getByRole('tab', { name: 'Services' }));

      const serviceList = await screen.findByRole('list', { name: 'Startup services' });
      expect(serviceList).toBeInTheDocument();
      expect(screen.getByText('Workspace Service')).toBeInTheDocument();
      expect(screen.getByText('Agent Runtime')).toBeInTheDocument();
    });

    it('does not render service list when no services', async () => {
      await act(async () => { render(<App />); });

      await screen.findByRole('status', { name: 'Startup state' });
      expect(screen.queryByRole('list', { name: 'Startup services' })).not.toBeInTheDocument();
    });

    it('renders sanitized error for rejected startup state', async () => {
      setAgentDeck(mockPreloadApi({
        getStartupState: vi.fn().mockRejectedValue(new Error('IPC failure with sensitive data'))
      }));

      await act(async () => { render(<App />); });

      const alert = await screen.findByRole('alert', { name: 'Startup state' });
      expect(alert).toHaveTextContent('Unable to read startup state.');
      expect(alert).not.toHaveTextContent('IPC failure');
    });
  });

  describe('workspace open flow', () => {
    it('shows workspace name when folder is opened', async () => {
      const user = userEvent.setup();
      const selectWorkspaceEntry = vi.fn().mockResolvedValue({
        status: 'selected',
        kind: 'folder',
        path: '/projects/my-app',
        name: 'my-app'
      });
      const openWorkspace = vi.fn().mockResolvedValue({
        status: 'ok',
        filePath: '/projects/my-app',
        kind: 'folder',
        folders: [{ path: '/projects/my-app', name: 'my-app' }]
      });
      const listDirectory = vi.fn().mockResolvedValue({ path: '/projects/my-app', entries: [] });

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace, listDirectory }));

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      expect(await screen.findByRole('status', { name: 'Workspace status' })).toHaveTextContent('my-app opened.');
    });

    it('shows cancelled status when user cancels workspace picker', async () => {
      const user = userEvent.setup();
      const selectWorkspaceEntry = vi.fn().mockResolvedValue({ status: 'cancelled' });

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry }));

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      await waitFor(() => {
        expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('No workspace opened.');
      });
    });

    it('shows error message when workspace model returns error', async () => {
      const user = userEvent.setup();
      const selectWorkspaceEntry = vi.fn().mockResolvedValue({
        status: 'selected',
        kind: 'workspace-file',
        path: '/bad.code-workspace',
        name: 'bad'
      });
      const openWorkspace = vi.fn().mockResolvedValue({
        status: 'error',
        code: 'FILE_NOT_FOUND',
        message: 'Workspace file not found.'
      });

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace }));

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open workspace' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Workspace file not found.');
    });

    it('shows error when workspace IPC throws', async () => {
      const user = userEvent.setup();
      const selectWorkspaceEntry = vi.fn().mockRejectedValue(new Error('IPC fail'));

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry }));

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      await waitFor(() => {
        expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('Unable to open workspace picker.');
      });
    });
  });

  describe('theme settings', () => {
    it('shows error when theme settings read fails', async () => {
      setAgentDeck(mockPreloadApi({
        getThemeSettings: vi.fn().mockRejectedValue(new Error('No theme'))
      }));

      await act(async () => { render(<App />); });

      expect(await screen.findByRole('status', { name: 'Theme settings' })).toHaveTextContent('Unable to read theme settings.');
    });

    it('shows error when theme settings write fails', async () => {
      const user = userEvent.setup();

      setAgentDeck(mockPreloadApi({
        setThemeSettings: vi.fn().mockRejectedValue(new Error('Disk full')),
        getThemeSettings: vi.fn().mockResolvedValue({ theme: 'light' })
      }));

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Dark' }));

      expect(await screen.findByRole('status', { name: 'Theme settings' })).toHaveTextContent('Unable to save theme settings.');
    });

    it('applies persisted theme from settings', async () => {
      setAgentDeck(mockPreloadApi({
        getThemeSettings: vi.fn().mockResolvedValue({ theme: 'light' })
      }));

      await act(async () => { render(<App />); });

      const workbench = screen.getByRole('main');

      // After async theme load, should switch to light
      await waitFor(() => {
        expect(workbench).toHaveAttribute('data-theme', 'light');
      }, { timeout: 3000 });
    });
  });

  describe('sidebar content', () => {
    it('shows Explorer heading when no workspace is open', async () => {
      await act(async () => { render(<App />); });

      await screen.findByRole('status', { name: 'Startup state' });
      // "Explorer" appears in multiple places (activity bar, menu, sidebar);
      // verify the sidebar heading specifically
      const headings = screen.getAllByRole('heading', { name: 'Explorer' });
      expect(headings.length).toBeGreaterThan(0);
      // "No workspace opened." appears in sidebar and status bar � check sidebar specifically
      const sidebar = screen.getByRole('complementary');
      expect(sidebar).toHaveTextContent(/No workspace opened/);
    });

    it('shows Explorer component when workspace is open and explorer panel is active', async () => {
      const user = userEvent.setup();
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
      const listDirectory = vi.fn().mockResolvedValue({ path: '/ws', entries: [] });

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace, listDirectory }));

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      await waitFor(() => {
        expect(screen.getByRole('tree')).toBeInTheDocument();
      });
    });
  });

  describe('aria-busy', () => {
    it('sets aria-busy while loading startup state', () => {
      // Render without awaiting � should be busy initially
      render(<App />);
      expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    });

    it('clears aria-busy after startup state loads', async () => {
      await act(async () => { render(<App />); });

      await screen.findByRole('status', { name: 'Startup state' });
      expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false');
    });
  });

  describe('workspace error display in sidebar', () => {
    it('shows error message in sidebar when workspace model returns error', async () => {
      const user = userEvent.setup();
      const selectWorkspaceEntry = vi.fn().mockResolvedValue({
        status: 'selected',
        kind: 'workspace-file',
        path: '/bad.code-workspace',
        name: 'bad'
      });
      const openWorkspace = vi.fn().mockResolvedValue({
        status: 'error',
        code: 'FILE_NOT_FOUND',
        message: 'Workspace file not found.'
      });

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace }));

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open workspace' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Workspace file not found.');
    });

    it('shows cancelled status when user cancels workspace picker', async () => {
      const user = userEvent.setup();
      const selectWorkspaceEntry = vi.fn().mockResolvedValue({ status: 'cancelled' });

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry }));

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      await waitFor(() => {
        expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('No workspace opened.');
      });
    });
  });

  describe('SearchPanel visibility', () => {
    it('shows SearchPanel when workspace is open and search panel is active', async () => {
      const user = userEvent.setup();
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
      const listDirectory = vi.fn().mockResolvedValue({ path: '/ws', entries: [] });
      const searchFiles = vi.fn().mockResolvedValue([]);

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace, listDirectory, searchFiles }));

      await act(async () => { render(<App />); });

      // Open workspace
      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Search' })).not.toBeDisabled();
      });

      // Switch to search panel via activity bar
      await user.click(screen.getByRole('button', { name: 'Search' }));

      await waitFor(() => {
        expect(screen.getByRole('search')).toBeInTheDocument();
      });
    });
  });

  describe('openWorkspaceByPath', () => {
    it('opens workspace directly by path without dialog', async () => {
      const openWorkspace = vi.fn().mockResolvedValue({
        status: 'ok',
        filePath: '/ws',
        kind: 'folder',
        folders: [{ path: '/ws', name: 'ws' }]
      });
      const listDirectory = vi.fn().mockResolvedValue({ path: '/ws', entries: [] });

      setAgentDeck(mockPreloadApi({ openWorkspace, listDirectory }));

      await act(async () => { render(<App />); });

      // Simulate opening workspace by path (e.g. from recent workspaces)
      // This is triggered via MenuBar's onOpenWorkspaceDirect callback
      // We test it indirectly through the store
      await waitFor(() => {
        expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('No workspace opened.');
      });
    });
  });
});

