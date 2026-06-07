import { act, render, screen } from '@testing-library/react';
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

describe('Identity UI — logged out state', () => {
  beforeEach(() => {
    setAgentDeck(mockPreloadApi());
  });

  it('shows Sign in button when not logged in', async () => {
    await act(async () => { render(<App />); });

    // Status bar shows Sign in button
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    // Activity bar also shows identity button
    expect(screen.getByRole('button', { name: 'Not logged in' })).toBeInTheDocument();
  });

  it('calls startOAuth when Sign in is clicked', async () => {
    const user = userEvent.setup();
    const startOAuth = vi.fn().mockResolvedValue({ isLoggedIn: false });
    setAgentDeck(mockPreloadApi({ startOAuth }));

    await act(async () => { render(<App />); });

    // Open identity menu from activity bar
    await user.click(screen.getByRole('button', { name: 'Not logged in' }));
    // Click Sign in with GitHub in dropdown
    await user.click(screen.getByRole('menuitem', { name: 'Sign in with GitHub' }));

    expect(startOAuth).toHaveBeenCalledOnce();
  });

  it('fetches initial session on mount via getIdentitySession', async () => {
    const getIdentitySession = vi.fn().mockResolvedValue({ isLoggedIn: false });
    setAgentDeck(mockPreloadApi({ getIdentitySession }));

    await act(async () => { render(<App />); });

    expect(getIdentitySession).toHaveBeenCalledOnce();
  });
});

describe('Identity UI — logged in state', () => {
  const loggedInSession: IdentitySession = {
    isLoggedIn: true,
    provider: 'github',
    profile: { login: 'octocat', id: 42, avatar_url: 'https://avatars.githubusercontent.com/u/42', name: 'The Octocat', email: 'octocat@github.com' }
  };

  beforeEach(() => {
    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue(loggedInSession)
    }));
  });

  it('shows avatar, login and Sign out when logged in', async () => {
    await act(async () => { render(<App />); });

    const avatar = await screen.findByRole('img', { name: 'octocat avatar' });
    expect(avatar).toBeInTheDocument();
    expect(screen.getByText('octocat')).toBeInTheDocument();
    // Open identity menu to access Sign out (status bar button)
    const loggedInButtons = screen.getAllByRole('button', { name: 'Logged in as octocat' });
    await userEvent.click(loggedInButtons[0]!);
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('calls signOut when Sign out is clicked', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn().mockResolvedValue({ isLoggedIn: false });
    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue(loggedInSession),
      signOut
    }));

    await act(async () => { render(<App />); });

    // Open identity menu (status bar button)
    const loggedInButtons = screen.getAllByRole('button', { name: 'Logged in as octocat' });
    await user.click(loggedInButtons[0]!);
    // Click Sign out in dropdown
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledOnce();
  });

  it('shows login without avatar when avatar_url is missing', async () => {
    const sessionNoAvatar: IdentitySession = {
      isLoggedIn: true,
      provider: 'github',
      profile: { login: 'nouser', id: 7 }
    };
    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue(sessionNoAvatar)
    }));

    await act(async () => { render(<App />); });

    expect(await screen.findByText('nouser')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('Identity UI — onIdentityChange subscription', () => {
  it('updates UI when onIdentityChange fires after login', async () => {
    let changeHandler: ((s: IdentitySession) => void) | null = null;
    const onIdentityChange = vi.fn().mockImplementation((cb: (s: IdentitySession) => void) => {
      changeHandler = cb;
      return () => undefined;
    });

    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
      onIdentityChange
    }));

    await act(async () => { render(<App />); });

    // Initially logged out
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();

    // Simulate identity change event (login)
    const loggedInSession: IdentitySession = {
      isLoggedIn: true,
      provider: 'github',
      profile: { login: 'newuser', id: 99, avatar_url: 'https://example.com/a.png' }
    };

    await act(async () => { changeHandler!(loggedInSession); });

    expect(screen.getByText('newuser')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Logged in as newuser' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('updates UI when onIdentityChange fires after logout', async () => {
    let changeHandler: ((s: IdentitySession) => void) | null = null;
    const onIdentityChange = vi.fn().mockImplementation((cb: (s: IdentitySession) => void) => {
      changeHandler = cb;
      return () => undefined;
    });

    const loggedInSession: IdentitySession = {
      isLoggedIn: true,
      provider: 'github',
      profile: { login: 'octocat', id: 42 }
    };

    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue(loggedInSession),
      onIdentityChange
    }));

    await act(async () => { render(<App />); });

    // Initially logged in
    expect(await screen.findByText('octocat')).toBeInTheDocument();

    // Simulate identity change event (logout)
    await act(async () => { changeHandler!({ isLoggedIn: false }); });

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('octocat')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not logged in' })).toBeInTheDocument();
  });
});

describe('Identity UI — graceful handling', () => {
  it('does not crash when getIdentitySession rejects', async () => {
    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockRejectedValue(new Error('IPC failure'))
    }));

    await act(async () => { render(<App />); });

    // Should still render and show Sign in (default state)
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('does not crash when onIdentityChange is not provided (optional)', async () => {
    // Mock without onIdentityChange — simulates older preload
    const api = mockPreloadApi();
    // @ts-expect-error — intentionally omitting optional method for resilience test
    delete api.onIdentityChange;
    setAgentDeck(api);

    await act(async () => { render(<App />); });

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('ignores invalid session from onIdentityChange', async () => {
    let changeHandler: ((s: IdentitySession) => void) | null = null;
    const onIdentityChange = vi.fn().mockImplementation((cb: (s: IdentitySession) => void) => {
      changeHandler = cb;
      return () => undefined;
    });

    setAgentDeck(mockPreloadApi({
      getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
      onIdentityChange
    }));

    await act(async () => { render(<App />); });

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();

    // Send invalid session (missing profile.login when isLoggedIn=true)
    await act(async () => {
      changeHandler!({ isLoggedIn: true });
    });

    // Should still show Sign in because invalid session is rejected by isIdentitySession guard
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
