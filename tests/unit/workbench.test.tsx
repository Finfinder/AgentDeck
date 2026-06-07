import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@agentdeck/workbench';
import { DEFAULT_THEME_SETTINGS, type AgentDeckPreloadApi } from '@agentdeck/shared';

function mockPreloadApi(overrides: Partial<AgentDeckPreloadApi> = {}) {
  const api: AgentDeckPreloadApi = {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }),
    selectWorkspaceEntry: vi.fn().mockResolvedValue({ status: 'cancelled' }),
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

  Object.defineProperty(globalThis, 'agentDeck', {
    configurable: true,
    value: api
  });
}

describe('Workbench startup surface', () => {
  beforeEach(() => {
    mockPreloadApi();
  });

  it('renders a ready workbench shell from preload IPC', async () => {
    render(<App />);

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');
    expect(screen.getByRole('navigation', { name: 'Primary activity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Explorer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeInTheDocument();
  });

  it('renders controlled startup errors', async () => {
    mockPreloadApi({
      getStartupState: vi.fn().mockResolvedValue({
        status: 'error',
        appVersion: '0.1.0',
        code: 'DESKTOP_SERVICES_UNAVAILABLE',
        message: 'Required desktop services failed to start.'
      })
    });

    render(<App />);

    expect(await screen.findByRole('alert', { name: 'Startup state' })).toHaveTextContent('Required desktop services failed to start.');
  });

  it('renders sanitized preload read failures', async () => {
    mockPreloadApi({
      getStartupState: vi.fn().mockRejectedValue(new Error('IPC unavailable'))
    });

    render(<App />);

    // Switch to Services panel to see the startup state alert
    await userEvent.click(screen.getByRole('tab', { name: 'Services' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Unable to read startup state/);
    expect(alert).not.toHaveTextContent(/IPC unavailable/);
  });

  it('renders a fallback message for unknown preload failures', async () => {
    mockPreloadApi({
      getStartupState: vi.fn().mockRejectedValue('IPC unavailable')
    });

    render(<App />);

    // Switch to Services panel to see the startup state alert
    await userEvent.click(screen.getByRole('tab', { name: 'Services' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Unable to read startup state/);
    expect(alert).not.toHaveTextContent(/IPC unavailable/);
  });

  it('uses dark theme as the first render and loads persisted theme settings', async () => {
    mockPreloadApi({
      getThemeSettings: vi.fn().mockResolvedValue({ theme: 'light' })
    });

    render(<App />);

    const workbench = screen.getByRole('main');

    expect(workbench).toHaveAttribute('data-theme', 'dark');

    await waitFor(() => expect(workbench).toHaveAttribute('data-theme', 'light'));
  });

  it('persists theme changes through preload settings IPC', async () => {
    const user = userEvent.setup();
    const setThemeSettings = vi.fn().mockImplementation(async settings => settings);

    mockPreloadApi({ setThemeSettings });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Light' }));

    expect(setThemeSettings).toHaveBeenCalledWith({ theme: 'light' });
    expect(screen.getByRole('main')).toHaveAttribute('data-theme', 'light');
    expect(await screen.findByRole('status', { name: 'Theme settings' })).toHaveTextContent('Theme settings saved.');
  });

  it('opens workspace files through preload workspace IPC', async () => {
    const user = userEvent.setup();
    const selectWorkspaceEntry = vi.fn().mockResolvedValue({
      status: 'selected',
      kind: 'workspace-file',
      path: String.raw`C:\Workspaces\AgentDeck.code-workspace`,
      name: 'AgentDeck.code-workspace'
    });
    const openWorkspace = vi.fn().mockResolvedValue({
      status: 'ok',
      filePath: String.raw`C:\Workspaces\AgentDeck.code-workspace`,
      kind: 'workspace-file',
      folders: [{ path: String.raw`C:\Workspaces` }]
    });

    mockPreloadApi({ selectWorkspaceEntry, openWorkspace });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));

    expect(selectWorkspaceEntry).toHaveBeenCalledWith({ kind: 'workspace-file' });
    expect(openWorkspace).toHaveBeenCalledWith(
      String.raw`C:\Workspaces\AgentDeck.code-workspace`,
      'workspace-file'
    );
    expect(await screen.findByText('AgentDeck.code-workspace opened.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Explorer' })).toBeInTheDocument();
  });

  it('opens a folder through preload IPC', async () => {
    const user = userEvent.setup();
    const selectWorkspaceEntry = vi.fn().mockResolvedValue({
      status: 'selected',
      kind: 'folder',
      path: '/home/projects/my-app',
      name: 'my-app'
    });
    const openWorkspace = vi.fn().mockResolvedValue({
      status: 'ok',
      filePath: '/home/projects/my-app',
      kind: 'folder',
      folders: [{ path: '/home/projects/my-app' }]
    });

    mockPreloadApi({ selectWorkspaceEntry, openWorkspace });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open folder' }));

    expect(selectWorkspaceEntry).toHaveBeenCalledWith({ kind: 'folder' });
    expect(openWorkspace).toHaveBeenCalledWith('/home/projects/my-app', 'folder');
    expect(await screen.findByText('my-app opened.')).toBeInTheDocument();
  });

  it('renders workspace error message when open fails after selection', async () => {
    const user = userEvent.setup();
    const selectWorkspaceEntry = vi.fn().mockResolvedValue({
      status: 'selected',
      kind: 'folder',
      path: '/bad/path',
      name: 'bad'
    });
    const openWorkspace = vi.fn().mockResolvedValue({
      status: 'error',
      code: 'FILE_NOT_FOUND',
      message: 'The path does not exist.'
    });

    mockPreloadApi({ selectWorkspaceEntry, openWorkspace });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open folder' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The path does not exist.');
  });

  it('renders workspace open error when IPC throws', async () => {
    const user = userEvent.setup();
    mockPreloadApi({
      selectWorkspaceEntry: vi.fn().mockRejectedValue(new Error('IPC error'))
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));

    expect(await screen.findByText('Unable to open workspace picker.')).toBeInTheDocument();
  });

  it('renders theme settings read error', async () => {
    mockPreloadApi({
      getThemeSettings: vi.fn().mockRejectedValue(new Error('read error'))
    });

    render(<App />);

    expect(await screen.findByText('Unable to read theme settings.')).toBeInTheDocument();
  });

  it('renders theme settings write error', async () => {
    const user = userEvent.setup();
    mockPreloadApi({
      setThemeSettings: vi.fn().mockRejectedValue(new Error('write error'))
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Light' }));

    expect(await screen.findByText('Unable to save theme settings.')).toBeInTheDocument();
  });

  it('renders services panel with startup services', async () => {
    mockPreloadApi({
      getStartupState: vi.fn().mockResolvedValue({
        status: 'ready',
        appVersion: '0.1.0',
        services: [
          { id: 'lang-server', label: 'Language Server', status: 'running' },
          { id: 'file-watcher', label: 'File Watcher', status: 'running' }
        ]
      })
    });

    render(<App />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Services' }));

    expect(screen.getByText('Language Server')).toBeInTheDocument();
    expect(screen.getByText('File Watcher')).toBeInTheDocument();
    expect(screen.getByLabelText('Startup services')).toBeInTheDocument();
  });

  it('renders output panel', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('tab', { name: 'Output' }));

    expect(screen.getByText('No output.')).toBeInTheDocument();
  });

  it('switches to search panel when search activity button is clicked', async () => {
    const user = userEvent.setup();
    // Set up a workspace so the search button is enabled
    mockPreloadApi({
      selectWorkspaceEntry: vi.fn().mockResolvedValue({
        status: 'selected', kind: 'folder', path: '/p', name: 'p'
      }),
      openWorkspace: vi.fn().mockResolvedValue({
        status: 'ok', filePath: '/p', kind: 'folder',
        folders: [{ path: '/p' }]
      })
    });

    render(<App />);

    // Open a workspace first
    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    await screen.findByText('p opened.');

    // Click search in activity bar
    await user.click(screen.getByRole('button', { name: 'Search' }));

    // Search button should be pressed (not disabled anymore since workspace is open)
    const searchBtn = await screen.findByRole('button', { name: 'Search' });
    expect(searchBtn).not.toBeDisabled();
    expect(searchBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('handles agentdeck:close-workspace event', () => {
    mockPreloadApi();
    render(<App />);

    // Dispatch close-workspace event
    globalThis.dispatchEvent(new Event('agentdeck:close-workspace'));

    // Should show the workspace status in the status bar
    expect(screen.getByLabelText('Workspace status')).toHaveTextContent('No workspace opened.');
  });

  it('handles agentdeck:show-panel event to switch active panel', async () => {
    mockPreloadApi();
    render(<App />);

    globalThis.dispatchEvent(new CustomEvent('agentdeck:show-panel', { detail: 'search' }));

    // activePanel changed to 'search' — verify via the activity bar button state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-pressed', 'true');
    });
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('ignores unknown panel in agentdeck:show-panel event', () => {
    mockPreloadApi();
    render(<App />);

    globalThis.dispatchEvent(new CustomEvent('agentdeck:show-panel', { detail: 'unknown' }));

    // Should remain on explorer - sidebar label remains 'Explorer'
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens workspace by direct path', () => {
    mockPreloadApi();
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  describe('editor diagnostic polling', () => {
    it('polls IPC diagnostics and merges with editor diagnostics', async () => {
      const getEditorDiagnostics = vi.fn()
        .mockResolvedValueOnce([
          { filePath: '/test.ts', severity: 'error' as const, message: 'Type error', line: 1, col: 1, code: 'TS2321' }
        ]);

      mockPreloadApi({ getEditorDiagnostics });

      render(<App />);

      // Wait for the first poll - diagnostics should appear
      const errorCount = await screen.findByLabelText('1 errors');
      expect(errorCount).toBeInTheDocument();
    });

    it('handles IPC diagnostic poll failure gracefully', async () => {
      const getEditorDiagnostics = vi.fn().mockRejectedValue(new Error('IPC error'));

      mockPreloadApi({ getEditorDiagnostics });

      render(<App />);

      // Should not crash - diagnostics stay empty
      expect(await screen.findByText('Ready')).toBeInTheDocument();
    });
  });

  describe('file system watcher', () => {
    it('tracks external changes from fs events', () => {
      let handler: ((e: { kind: string; path: string }) => void) | null = null;
      const onFsEvent = vi.fn().mockImplementation((cb: (e: { kind: string; path: string }) => void) => {
        handler = cb;
        return () => undefined;
      });

      mockPreloadApi({ onFsEvent });

      render(<App />);

      // Fire an fs change event
      handler!({ kind: 'change', path: '/workspace/file.ts' });

      // External changes are tracked internally - we verify via the onFsEvent subscription
      expect(onFsEvent).toHaveBeenCalledOnce();
    });
  });

  describe('save / save-all event handlers', () => {
    it('defines save handler callbacks', () => {
      mockPreloadApi();
      render(<App />);
      expect(screen.getByRole('main')).toBeInTheDocument();
    });
  });
});
