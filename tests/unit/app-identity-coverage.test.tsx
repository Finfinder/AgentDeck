import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@agentdeck/workbench';
import { DEFAULT_THEME_SETTINGS, type AgentDeckPreloadApi, type IdentitySession } from '@agentdeck/shared';

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

describe('App — identity error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
  });

  it('shows error message in identity dropdown when session has error', async () => {
    const errorSession: IdentitySession = {
      isLoggedIn: false,
      error: 'Token expired'
    };
    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue(errorSession)
    }));

    await act(async () => { render(<App />); });

    // Open identity menu from activity bar
    const identityButton = await screen.findByRole('button', { name: 'Not logged in' });
    await userEvent.click(identityButton);

    // Should show the error message
    expect(screen.getByText('Token expired')).toBeInTheDocument();
  });
});

describe('App — workspace error display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
  });

  it('shows workspace error message when workspace fails to open', async () => {
    const user = userEvent.setup();
    setAgentDeck(mockPreloadApi({
      selectWorkspaceEntry: vi.fn().mockResolvedValue({
        status: 'selected',
        kind: 'folder',
        path: '/bad-path',
        name: 'bad-path'
      }),
      openWorkspace: vi.fn().mockResolvedValue({
        status: 'error',
        code: 'FILE_NOT_FOUND',
        message: 'Workspace file not found'
      })
    }));

    await act(async () => { render(<App />); });

    await user.click(screen.getByRole('button', { name: 'Open folder' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Workspace file not found');
    });
  });
});

describe('App — device code flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
  });

  it('shows device code in identity dropdown when onDeviceCode fires', async () => {
    let deviceCodeHandler: ((data: { userCode: string; verificationUri: string; verificationUriComplete?: string }) => void) | null = null;
    const onDeviceCode = vi.fn().mockImplementation((cb: (data: { userCode: string; verificationUri: string; verificationUriComplete?: string }) => void) => {
      deviceCodeHandler = cb;
      return () => undefined;
    });

    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
      onDeviceCode
    }));

    await act(async () => { render(<App />); });

    // Open identity menu
    const identityButton = await screen.findByRole('button', { name: 'Not logged in' });
    await userEvent.click(identityButton);

    // Initially shows "Sign in with GitHub"
    expect(screen.getByRole('menuitem', { name: 'Sign in with GitHub' })).toBeInTheDocument();

    // Simulate device code event
    await act(async () => {
      deviceCodeHandler!({
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/device',
        verificationUriComplete: 'https://github.com/device?user_code=ABCD-1234'
      });
    });

    // Should now show device code UI
    expect(screen.getByText('ABCD-1234')).toBeInTheDocument();
    expect(screen.getByText('Device Authorization')).toBeInTheDocument();
  });

  it('shows copy button in device code dropdown', async () => {
    let deviceCodeHandler: ((data: { userCode: string; verificationUri: string; verificationUriComplete?: string }) => void) | null = null;
    const onDeviceCode = vi.fn().mockImplementation((cb: (data: { userCode: string; verificationUri: string; verificationUriComplete?: string }) => void) => {
      deviceCodeHandler = cb;
      return () => undefined;
    });

    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
      onDeviceCode
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    const identityButton = await screen.findByRole('button', { name: 'Not logged in' });
    await user.click(identityButton);

    await act(async () => {
      deviceCodeHandler!({
        userCode: 'COPY-1234',
        verificationUri: 'https://github.com/device'
      });
    });

    // Should show the copy button (contains "Copy code" text)
    const menuItems = screen.getAllByRole('menuitem');
    const copyButton = menuItems.find(el => el.textContent?.includes('Copy code'));
    expect(copyButton).toBeInTheDocument();
  });

  it('clears device code and closes menu when Cancel is clicked', async () => {
    let deviceCodeHandler: ((data: { userCode: string; verificationUri: string; verificationUriComplete?: string }) => void) | null = null;
    const onDeviceCode = vi.fn().mockImplementation((cb: (data: { userCode: string; verificationUri: string; verificationUriComplete?: string }) => void) => {
      deviceCodeHandler = cb;
      return () => undefined;
    });

    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
      onDeviceCode
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    const identityButton = await screen.findByRole('button', { name: 'Not logged in' });
    await user.click(identityButton);

    await act(async () => {
      deviceCodeHandler!({
        userCode: 'CANCEL-01',
        verificationUri: 'https://github.com/device'
      });
    });

    expect(screen.getByText('CANCEL-01')).toBeInTheDocument();

    const cancelButton = screen.getByRole('menuitem', { name: 'Cancel' });
    await user.click(cancelButton);

    // Device code should be cleared, menu closed
    expect(screen.queryByText('CANCEL-01')).not.toBeInTheDocument();
  });

  it('clears device code when user logs in via onIdentityChange', async () => {
    let deviceCodeHandler: ((data: { userCode: string; verificationUri: string }) => void) | null = null;
    let changeHandler: ((s: IdentitySession) => void) | null = null;

    const onDeviceCode = vi.fn().mockImplementation((cb: (data: { userCode: string; verificationUri: string }) => void) => {
      deviceCodeHandler = cb;
      return () => undefined;
    });
    const onIdentityChange = vi.fn().mockImplementation((cb: (s: IdentitySession) => void) => {
      changeHandler = cb;
      return () => undefined;
    });

    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
      onDeviceCode,
      onIdentityChange
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    const identityButton = await screen.findByRole('button', { name: 'Not logged in' });
    await user.click(identityButton);

    // Trigger device code
    await act(async () => {
      deviceCodeHandler!({ userCode: 'CLR-0001', verificationUri: 'https://github.com/device' });
    });
    expect(screen.getByText('CLR-0001')).toBeInTheDocument();

    // Simulate login via identity change
    await act(async () => {
      changeHandler!({
        isLoggedIn: true,
        provider: 'github',
        profile: { login: 'newuser', id: 1 }
      });
    });

    // Device code should be cleared
    expect(screen.queryByText('CLR-0001')).not.toBeInTheDocument();
  });
});

describe('App — identity menu without verificationUriComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
  });

  it('shows device code without verificationUriComplete', async () => {
    let deviceCodeHandler: ((data: { userCode: string; verificationUri: string; verificationUriComplete?: string }) => void) | null = null;
    const onDeviceCode = vi.fn().mockImplementation((cb: (data: { userCode: string; verificationUri: string; verificationUriComplete?: string }) => void) => {
      deviceCodeHandler = cb;
      return () => undefined;
    });

    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
      onDeviceCode
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    const identityButton = await screen.findByRole('button', { name: 'Not logged in' });
    await user.click(identityButton);

    await act(async () => {
      deviceCodeHandler!({
        userCode: 'NOCOMP-01',
        verificationUri: 'https://github.com/device'
        // No verificationUriComplete
      });
    });

    expect(screen.getByText('NOCOMP-01')).toBeInTheDocument();
    expect(screen.getByText('Device Authorization')).toBeInTheDocument();
  });
});

describe('App — startup error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
  });

  it('shows startup error message in status', async () => {
    setAgentDeck(mockPreloadApi({
      getStartupState: vi.fn().mockResolvedValue({
        status: 'error',
        message: 'Failed to initialize services'
      })
    }));

    await act(async () => { render(<App />); });

    expect(await screen.findByRole('alert', { name: 'Startup state' })).toHaveTextContent('Failed to initialize services');
  });
});

describe('App — services panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
  });

  it('renders startup services in Services panel', async () => {
    const user = userEvent.setup();
    setAgentDeck(mockPreloadApi({
      getStartupState: vi.fn().mockResolvedValue({
        status: 'ready',
        appVersion: '0.1.0',
        services: [
          { id: 'workspace-service', label: 'Workspace', status: 'ready' },
          { id: 'settings-service', label: 'Settings', status: 'ready' }
        ]
      })
    }));

    await act(async () => { render(<App />); });

    await user.click(screen.getByRole('tab', { name: 'Services' }));

    expect(screen.getByLabelText('Startup services')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
});

describe('App — identity status bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
  });

  it('shows logged-in identity button in status bar with avatar', async () => {
    const session: IdentitySession = {
      isLoggedIn: true,
      provider: 'github',
      profile: { login: 'testuser', id: 1, avatar_url: 'https://example.com/avatar.png' }
    };
    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue(session)
    }));

    await act(async () => { render(<App />); });

    // Both status bar and activity bar have buttons with the same name
    const buttons = await screen.findAllByRole('button', { name: 'Logged in as testuser' });
    expect(buttons.length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: 'testuser avatar' })).toBeInTheDocument();
  });

  it('shows logged-in identity button in status bar without avatar', async () => {
    const session: IdentitySession = {
      isLoggedIn: true,
      provider: 'github',
      profile: { login: 'noavatar', id: 2 }
    };
    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue(session)
    }));

    await act(async () => { render(<App />); });

    const buttons = await screen.findAllByRole('button', { name: 'Logged in as noavatar' });
    expect(buttons.length).toBeGreaterThan(0);
    expect(screen.getByText('noavatar')).toBeInTheDocument();
  });

  it('shows Sign in button in status bar when logged out', async () => {
    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false })
    }));

    await act(async () => { render(<App />); });

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
