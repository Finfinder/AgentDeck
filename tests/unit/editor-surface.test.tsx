import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { EditorSurface } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi } from '@agentdeck/shared';

function mockAgent(): AgentDeckPreloadApi {
  return {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }),
    selectWorkspaceEntry: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    versions: { chrome: '130.0.0', electron: '42.3.0', node: '25.0.0' },
    getThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }),
    setThemeSettings: vi.fn().mockImplementation(async (s: unknown) => s),
    openWorkspace: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'Test' }),
    listDirectory: vi.fn().mockResolvedValue({ path: '/', entries: [] }),
    searchFiles: vi.fn().mockResolvedValue([]),
    getRecentWorkspaces: vi.fn().mockResolvedValue([]),
    onFsEvent: vi.fn().mockReturnValue(() => undefined),
    readFile: vi.fn().mockResolvedValue({ status: 'ok', content: 'const x = 1;', encoding: 'utf8' }),
    writeFile: vi.fn().mockResolvedValue({ status: 'ok' }),
    getEditorDiagnostics: vi.fn().mockResolvedValue([])
  };
}

describe('EditorSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders welcome message when no tabs are open', () => {
    const agent = mockAgent();
    render(<EditorSurface agent={agent} />);
    expect(screen.getByText('Open a file from the Explorer to start editing.')).toBeDefined();
  });

  it('renders editor area', () => {
    const agent = mockAgent();
    const { container } = render(<EditorSurface agent={agent} />);
    expect(container.querySelector('.editor-area')).not.toBeNull();
  });

  it('renders tab list', () => {
    const agent = mockAgent();
    render(<EditorSurface agent={agent} />);
    expect(screen.getByRole('tablist', { name: 'Open editors' })).toBeDefined();
  });

  it('shows empty state message', () => {
    const agent = mockAgent();
    render(<EditorSurface agent={agent} />);
    expect(screen.getByText('No open editors')).toBeDefined();
  });
});
