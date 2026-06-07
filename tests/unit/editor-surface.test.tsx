import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { EditorSurface } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi, EditorTab } from '@agentdeck/shared';
import type { EditorStore } from '@agentdeck/workbench';

function mockAgent(overrides: Partial<AgentDeckPreloadApi> = {}): AgentDeckPreloadApi {
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

function mockStore(overrides: Partial<EditorStore> = {}): EditorStore {
  return {
    tabs: [],
    activeTabId: null,
    openTab: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    setTabDirty: vi.fn(),
    setTabPinned: vi.fn(),
    getTabByPath: vi.fn().mockReturnValue(undefined),
    ...overrides
  };
}

function mockExternalChanges(): ReadonlySet<string> {
  return new Set();
}

const mockOnExternalChangeAck = vi.fn();
const mockOnDiagnosticsChange = vi.fn();

function renderSurface(props: {
  agent?: AgentDeckPreloadApi;
  store?: EditorStore;
  externalChanges?: ReadonlySet<string>;
} = {}) {
  const agent = props.agent ?? mockAgent();
  const store = props.store ?? mockStore();
  const changes = props.externalChanges ?? mockExternalChanges();
  return render(
    <EditorSurface
      agent={agent}
      store={store}
      externalChanges={changes}
      onExternalChangeAck={mockOnExternalChangeAck}
      onDiagnosticsChange={mockOnDiagnosticsChange}
      theme="dark"
    />
  );
}

function createTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 'tab-1',
    filePath: '/src/app.ts',
    fileName: 'app.ts',
    language: 'typescript',
    isDirty: false,
    isPinned: false,
    revealLine: null,
    revealCol: null,
    revealPattern: null,
    revealNonce: 0,
    ...overrides
  };
}

describe('EditorSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders welcome message when no tabs are open', () => {
    renderSurface();
    expect(screen.getByText('Open a file from the Explorer to start editing.')).toBeDefined();
  });

  it('renders editor area', () => {
    const { container } = renderSurface();
    expect(container.querySelector('.editor-area')).not.toBeNull();
  });

  it('renders tab list', () => {
    renderSurface();
    expect(screen.getByRole('tablist', { name: 'Open editors' })).toBeDefined();
  });

  it('shows empty state message', () => {
    renderSurface();
    expect(screen.getByText('No open editors')).toBeDefined();
  });

  // External file change tests

  it('reloads content from disk when non-dirty file changes externally', async () => {
    const readFileMock = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', content: 'const x = 1;', encoding: 'utf8' })
      .mockResolvedValueOnce({ status: 'ok', content: 'const x = 2; // external', encoding: 'utf8' });
    const agent = mockAgent({ readFile: readFileMock });
    const tab = createTab();
    const store = mockStore({ tabs: [tab], activeTabId: tab.id });
    const changes = new Set(['/src/app.ts']);

    renderSurface({ agent, store, externalChanges: changes });

    await waitFor(() => {
      expect(mockOnExternalChangeAck).toHaveBeenCalledWith('/src/app.ts');
    });
    expect(readFileMock).toHaveBeenCalledTimes(2); // initial load + external reload
  });

  it('shows conflict dialog when dirty file changes externally', async () => {
    const tab = createTab({ isDirty: true });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id });
    const changes = new Set(['/src/app.ts']);

    renderSurface({ store, externalChanges: changes });

    await waitFor(() => {
      expect(screen.getByText('File changed on disk')).toBeDefined();
    });
    expect(screen.getByText('app.ts')).toBeDefined();
  });

  it('does not show conflict dialog when file is not in externalChanges', () => {
    const tab = createTab({ isDirty: true });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id });

    renderSurface({ store });

    expect(screen.queryByText('File changed on disk')).toBeNull();
  });

  it('external conflict Reload from disk calls readFile and clears dialog', async () => {
    const readFileMock = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', content: 'const x = 1;', encoding: 'utf8' })
      .mockResolvedValueOnce({ status: 'ok', content: 'const x = 2; // reloaded', encoding: 'utf8' });
    const setTabDirtyMock = vi.fn();
    const agent = mockAgent({ readFile: readFileMock });
    const tab = createTab({ isDirty: true });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id, setTabDirty: setTabDirtyMock });
    const changes = new Set(['/src/app.ts']);

    renderSurface({ agent, store, externalChanges: changes });

    await waitFor(() => {
      expect(screen.getByText('File changed on disk')).toBeDefined();
    });

    const reloadButton = screen.getByRole('button', { name: /reload from disk/i });
    await userEvent.click(reloadButton);

    await waitFor(() => {
      expect(screen.queryByText('File changed on disk')).toBeNull();
    });
    expect(setTabDirtyMock).toHaveBeenCalledWith(tab.id, false);
  });

  it('external conflict Cancel clears dialog without action', async () => {
    const tab = createTab({ isDirty: true });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id });
    const changes = new Set(['/src/app.ts']);

    renderSurface({ store, externalChanges: changes });

    await waitFor(() => {
      expect(screen.getByText('File changed on disk')).toBeDefined();
    });

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await userEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.queryByText('File changed on disk')).toBeNull();
    });
  });

  // External conflict overwrite/reload tests
  it('external conflict Overwrite writes content and clears dialog', async () => {
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const setTabDirtyMock = vi.fn();
    const agent = mockAgent({ writeFile: writeFileMock });
    const tab = createTab({ isDirty: true });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id, setTabDirty: setTabDirtyMock });
    const changes = new Set(['/src/app.ts']);

    renderSurface({ agent, store, externalChanges: changes });

    await waitFor(() => {
      expect(screen.getByText('File changed on disk')).toBeDefined();
    });

    const overwriteButton = screen.getByRole('button', { name: /overwrite/i });
    await userEvent.click(overwriteButton);

    await waitFor(() => {
      expect(screen.queryByText('File changed on disk')).toBeNull();
    });
    expect(writeFileMock).toHaveBeenCalled();
    expect(setTabDirtyMock).toHaveBeenCalledWith(tab.id, false);
  });

  it('external conflict Reload loads file and clears dialog', async () => {
    const readFileMock = vi.fn().mockResolvedValue({ status: 'ok', content: 'reloaded content', encoding: 'utf8' });
    const setTabDirtyMock = vi.fn();
    const agent = mockAgent({ readFile: readFileMock });
    const tab = createTab({ isDirty: true });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id, setTabDirty: setTabDirtyMock });
    const changes = new Set(['/src/app.ts']);

    renderSurface({ agent, store, externalChanges: changes });

    await waitFor(() => {
      expect(screen.getByText('File changed on disk')).toBeDefined();
    });

    const reloadButton = screen.getByRole('button', { name: /reload from disk/i });
    await userEvent.click(reloadButton);

    await waitFor(() => {
      expect(screen.queryByText('File changed on disk')).toBeNull();
    });
    expect(readFileMock).toHaveBeenCalled();
    expect(setTabDirtyMock).toHaveBeenCalledWith(tab.id, false);
  });

  // Save All event tests
  it('handles agentdeck:save-all event with no dirty tabs', async () => {
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const agent = mockAgent({ writeFile: writeFileMock });
    const tab = createTab({ isDirty: false });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id });

    renderSurface({ agent, store });

    // Dispatch save-all event
    globalThis.dispatchEvent(new CustomEvent('agentdeck:save-all'));

    // No dirty tabs, so writeFile should not be called
    await waitFor(() => {
      expect(writeFileMock).not.toHaveBeenCalled();
    });
  });

  it('handles agentdeck:save-all event with dirty tabs', async () => {
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const setTabDirtyMock = vi.fn();
    const agent = mockAgent({ writeFile: writeFileMock });
    const tab = createTab({ isDirty: true });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id, setTabDirty: setTabDirtyMock });

    renderSurface({ agent, store });

    // Wait for editor to load
    await waitFor(() => {
      expect(screen.queryByText('Loading app.ts')).toBeNull();
    });

    // Simulate content change in editor to populate contentMap
    const editor = screen.getByRole('textbox', { name: 'Editor' });
    await fireEvent.change(editor, { target: { value: 'modified content' } });

    // Dispatch save-all event
    globalThis.dispatchEvent(new CustomEvent('agentdeck:save-all'));

    // Dirty tab should be saved with modified content
    await waitFor(() => {
      expect(writeFileMock).toHaveBeenCalledWith('/src/app.ts', 'modified content');
    });
    expect(setTabDirtyMock).toHaveBeenCalledWith(tab.id, false);
  });
});

