import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@agentdeck/workbench';

// Updated to avoid explicit any type, using unknown for overrides
function mockPreloadApi(overrides: Partial<Record<string, unknown>> = {}) {
  const api = {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }),
    selectWorkspaceEntry: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    versions: { chrome: '130.0.0', electron: '42.3.0', node: '25.0.0' },
    getThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }),
    setThemeSettings: vi.fn().mockImplementation(async (s: unknown) => s),
    onFsEvent: vi.fn().mockReturnValue(() => undefined),
    readFile: vi.fn().mockResolvedValue({ status: 'ok', content: '', encoding: 'utf8' }),
    writeFile: vi.fn().mockResolvedValue({ status: 'ok' }),
    markBufferDirty: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue({ status: 'ok' }),
    renameFile: vi.fn().mockResolvedValue({ status: 'ok' }),
    getEditorDiagnostics: vi.fn().mockResolvedValue([]),
    applyWorkspaceEdit: vi.fn().mockResolvedValue({ status: 'ok' }),
    showDiff: vi.fn().mockResolvedValue({ status: 'ok', diff: '' }),
    showSaveDialog: vi.fn().mockResolvedValue(null),
    toggleDevTools: vi.fn().mockResolvedValue(undefined),
    openWorkspace: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'Test' }),
    listDirectory: vi.fn().mockResolvedValue({ path: '/', entries: [] }),
    searchFiles: vi.fn().mockResolvedValue([]),
    getRecentWorkspaces: vi.fn().mockResolvedValue([]),
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

