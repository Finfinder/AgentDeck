import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@agentdeck/workbench';
import { DEFAULT_THEME_SETTINGS, type AgentDeckPreloadApi } from '@agentdeck/shared';

function mockPreloadApi(overrides: Partial<AgentDeckPreloadApi> = {}): AgentDeckPreloadApi {
  return {
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
    ...overrides
  };
}

function setAgentDeck(api: AgentDeckPreloadApi) {
  Object.defineProperty(globalThis, 'agentDeck', {
    configurable: true,
    value: api
  });
}

describe('App workspace open (folder)', () => {
  beforeEach(() => {
    setAgentDeck(mockPreloadApi());
  });

  it('opens a folder through preload workspace IPC', async () => {
    const user = userEvent.setup();
    const selectWorkspaceEntry = vi.fn().mockResolvedValue({
      status: 'selected',
      kind: 'folder',
      path: String.raw`C:\Projects\MyApp`,
      name: 'MyApp'
    });
    const openWorkspace = vi.fn().mockResolvedValue({
      status: 'ok',
      filePath: String.raw`C:\Projects\MyApp`,
      kind: 'folder',
      folders: [{ path: String.raw`C:\Projects\MyApp`, name: 'MyApp' }]
    });

    setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace }));
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open folder' }));

    expect(selectWorkspaceEntry).toHaveBeenCalledWith({ kind: 'folder' });
    expect(openWorkspace).toHaveBeenCalledWith(
      String.raw`C:\Projects\MyApp`,
      'folder'
    );
    expect(await screen.findByText('MyApp opened.')).toBeInTheDocument();
  });

  it('shows cancelled status when user cancels workspace picker', async () => {
    const user = userEvent.setup();
    const selectWorkspaceEntry = vi.fn().mockResolvedValue({ status: 'cancelled' });

    setAgentDeck(mockPreloadApi({ selectWorkspaceEntry }));
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('No workspace opened.');
    });
  });

  it('shows error message when workspace model returns error', async () => {
    const user = userEvent.setup();
    const selectWorkspaceEntry = vi.fn().mockResolvedValue({
      status: 'selected',
      kind: 'workspace-file',
      path: '/broken.code-workspace',
      name: 'broken'
    });
    const openWorkspace = vi.fn().mockResolvedValue({
      status: 'error',
      code: 'INVALID_JSONC',
      message: 'Invalid JSON in workspace file.'
    });

    setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace }));
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('Invalid JSON in workspace file.');
    });
  });

  it('shows error when workspace IPC throws', async () => {
    const user = userEvent.setup();
    const selectWorkspaceEntry = vi.fn().mockRejectedValue(new Error('IPC failure'));

    setAgentDeck(mockPreloadApi({ selectWorkspaceEntry }));
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('Unable to open workspace picker.');
    });
  });
});

describe('App theme settings', () => {
  beforeEach(() => {
    setAgentDeck(mockPreloadApi());
  });

  it('shows error status when theme settings read fails', async () => {
    setAgentDeck(mockPreloadApi({
      getThemeSettings: vi.fn().mockRejectedValue(new Error('fail'))
    }));
    render(<App />);

    expect(await screen.findByRole('status', { name: 'Theme settings' })).toHaveTextContent('Unable to read theme settings.');
  });

  it('shows error status when theme settings write fails', async () => {
    const user = userEvent.setup();
    setAgentDeck(mockPreloadApi({
      setThemeSettings: vi.fn().mockRejectedValue(new Error('save failed'))
    }));
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Light' }));

    expect(await screen.findByRole('status', { name: 'Theme settings' })).toHaveTextContent('Unable to save theme settings.');
  });
});

describe('App panel switching', () => {
  beforeEach(() => {
    setAgentDeck(mockPreloadApi());
  });

  it('disables search button when no workspace is open', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });

  it('enables search button when workspace is open', async () => {
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

    setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace }));
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open folder' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
    });
  });

  it('switches to search panel when search button is clicked', async () => {
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
    const searchFiles = vi.fn().mockResolvedValue([]);

    setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace, searchFiles }));
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    await waitFor(() => screen.getByRole('button', { name: 'Search' }));

    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('search')).toBeInTheDocument();
  });
});

describe('App startup services', () => {
  beforeEach(() => {
    setAgentDeck(mockPreloadApi());
  });

  it('renders startup service list when services are available', async () => {
    setAgentDeck(mockPreloadApi({
      getStartupState: vi.fn().mockResolvedValue({
        status: 'ready',
        appVersion: '0.1.0',
        services: [
          { id: 'workspace-service', label: 'Workspace Service', status: 'ready' },
          { id: 'settings-service', label: 'Settings Service', status: 'ready' },
          { id: 'agent-runtime', label: 'Agent Runtime', status: 'ready' }
        ]
      })
    }));
    render(<App />);

    const serviceList = await screen.findByRole('list', { name: 'Startup services' });
    expect(serviceList).toBeInTheDocument();
    expect(screen.getByText('Workspace Service')).toBeInTheDocument();
    expect(screen.getByText('Settings Service')).toBeInTheDocument();
    expect(screen.getByText('Agent Runtime')).toBeInTheDocument();
  });

  it('does not render service list when no services', async () => {
    render(<App />);

    await screen.findByRole('status', { name: 'Startup state' });
    expect(screen.queryByRole('list', { name: 'Startup services' })).not.toBeInTheDocument();
  });

  it('renders app version from startup state', async () => {
    setAgentDeck(mockPreloadApi({
      getStartupState: vi.fn().mockResolvedValue({
        status: 'ready',
        appVersion: '1.2.3',
        services: []
      })
    }));
    render(<App />);

    expect(await screen.findByText('v1.2.3')).toBeInTheDocument();
  });
});

describe('App workspace error display in sidebar', () => {
  beforeEach(() => {
    setAgentDeck(mockPreloadApi());
  });

  it('shows workspace error message in sidebar when model has error', async () => {
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
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Workspace file not found.');
  });

  it('shows "No workspace opened" when no workspace and no selection', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('No workspace opened.');
    });
  });
});
