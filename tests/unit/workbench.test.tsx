import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@agentdeck/workbench';
import { DEFAULT_THEME_SETTINGS } from '@agentdeck/services';
// Note: tests construct a mock preload API with extended members (theme APIs).
// Avoid importing the strict `AgentDeckPreloadApi` type here to keep mocks flexible.

function mockPreloadApi(overrides: Record<string, any> = {}) {
  const api: any = {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }),
    selectWorkspaceEntry: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    versions: { chrome: '130.0.0', electron: '42.3.0', node: '25.0.0' },
    getThemeSettings: vi.fn().mockResolvedValue(DEFAULT_THEME_SETTINGS),
    setThemeSettings: vi.fn().mockImplementation(async (s: unknown) => s),
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

  const alert = await screen.findByRole('alert', { name: 'Startup state' });

    expect(alert).toHaveTextContent(/^Unable to read startup state\.$/);
    expect(alert).not.toHaveTextContent(/IPC unavailable/);
  });

  it('renders a fallback message for unknown preload failures', async () => {
    mockPreloadApi({
      getStartupState: vi.fn().mockRejectedValue('IPC unavailable')
    });

    render(<App />);

    expect(await screen.findByRole('alert', { name: 'Startup state' })).toHaveTextContent('Unable to read startup state.');
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

    mockPreloadApi({ selectWorkspaceEntry });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));

    expect(selectWorkspaceEntry).toHaveBeenCalledWith({ kind: 'workspace-file' });
    expect(await screen.findByRole('heading', { name: 'AgentDeck.code-workspace' })).toBeInTheDocument();
    expect(screen.getByText('AgentDeck.code-workspace selected.')).toBeInTheDocument();
  });
});