import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@agentdeck/workbench';

function mockPreloadApi(overrides: Partial<any> = {}) {
  const api = {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }),
    selectWorkspaceEntry: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    versions: { chrome: '130.0.0', electron: '42.3.0', node: '25.0.0' },
    getThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }),
    setThemeSettings: vi.fn().mockImplementation(async (s: unknown) => s),
    ...overrides
  };

  Object.defineProperty(globalThis, 'agentDeck', {
    configurable: true,
    value: api
  });
}

describe('App error handling', () => {
  beforeEach(() => {
    mockPreloadApi();
  });

  it('shows theme read error when getThemeSettings rejects', async () => {
    mockPreloadApi({ getThemeSettings: vi.fn().mockRejectedValue(new Error('No theme')) });

    render(<App />);

    expect(await screen.findByRole('status', { name: 'Theme settings' })).toHaveTextContent('Unable to read theme settings.');
  });

  it('shows theme write error when setThemeSettings rejects', async () => {
    const user = userEvent.setup();

    mockPreloadApi({
      setThemeSettings: vi.fn().mockRejectedValue(new Error('Disk full')),
      getThemeSettings: vi.fn().mockResolvedValue({ theme: 'light' })
    });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    expect(await screen.findByRole('status', { name: 'Theme settings' })).toHaveTextContent('Unable to save theme settings.');
  });

  it('shows workspace open error when selectWorkspaceEntry rejects', async () => {
    const user = userEvent.setup();

    mockPreloadApi({ selectWorkspaceEntry: vi.fn().mockRejectedValue(new Error('IPC fail')) });

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open workspace' }));

    expect(await screen.findByRole('status', { name: 'Workspace status' })).toHaveTextContent('Unable to open workspace picker.');
  });
});
