import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi } from '@agentdeck/shared';

function mockPreloadApi(overrides: Partial<AgentDeckPreloadApi> = {}) {
  const api: AgentDeckPreloadApi = {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }),
    versions: { chrome: '130.0.0', electron: '42.3.0', node: '25.0.0' },
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

  it('renders a ready startup state from preload IPC', async () => {
    render(<App />);

    expect(await screen.findByRole('status')).toHaveTextContent('Ready');
    expect(screen.getByRole('heading', { name: 'Workbench' })).toBeInTheDocument();
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

    expect(await screen.findByRole('alert')).toHaveTextContent('Required desktop services failed to start.');
  });

  it('renders sanitized preload read failures', async () => {
    mockPreloadApi({
      getStartupState: vi.fn().mockRejectedValue(new Error('IPC unavailable'))
    });

    render(<App />);

    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent(/^Unable to read startup state\.$/);
    expect(alert).not.toHaveTextContent(/IPC unavailable/);
  });

  it('renders a fallback message for unknown preload failures', async () => {
    mockPreloadApi({
      getStartupState: vi.fn().mockRejectedValue('IPC unavailable')
    });

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to read startup state.');
  });
});