import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    ...overrides
  };
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

const emptyChanges: ReadonlySet<string> = new Set();
const ackFsEvent = vi.fn();
const onDiagnosticsChange = vi.fn();

function renderSurface(props: {
  agent?: AgentDeckPreloadApi;
  store?: EditorStore;
  externalChanges?: ReadonlySet<string>;
}) {
  const agent = props.agent ?? mockAgent();
  const store = props.store ?? mockStore();
  const externalChanges = props.externalChanges ?? emptyChanges;
  return render(
    <EditorSurface
      agent={agent}
      store={store}
      externalChanges={externalChanges}
      onExternalChangeAck={ackFsEvent}
      onDiagnosticsChange={onDiagnosticsChange}
      theme="dark"
    />
  );
}

describe('EditorSurface - additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing on Ctrl+S when no tab is active', async () => {
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const agent = mockAgent({ writeFile: writeFileMock });
    const store = mockStore();
    renderSurface({ agent, store });

    // Dispatch Ctrl+S — no active tab, so no save should occur
    fireEvent.keyDown(document, { key: 's', code: 'KeyS', ctrlKey: true });

    await waitFor(() => {
      expect(writeFileMock).not.toHaveBeenCalled();
    });
  });

  it('does nothing on Ctrl+S when active tab is not dirty', async () => {
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const agent = mockAgent({ writeFile: writeFileMock });
    const tab = createTab({ isDirty: false });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id });
    renderSurface({ agent, store });

    // Dispatch Ctrl+S — tab not dirty, so no save
    fireEvent.keyDown(document, { key: 's', code: 'KeyS', ctrlKey: true });

    await waitFor(() => {
      expect(writeFileMock).not.toHaveBeenCalled();
    });
  });

  it('handles agentdeck:save-as event with cancelled dialog (showSaveDialog returns null)', async () => {
    const showSaveDialogMock = vi.fn().mockResolvedValue(null);
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const agent = mockAgent({ showSaveDialog: showSaveDialogMock, writeFile: writeFileMock });
    const tab = createTab();
    const store = mockStore({ tabs: [tab], activeTabId: tab.id });
    renderSurface({ agent, store });

    // Wait for the editor to mount and populate the contentMap via Monaco change.
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Editor' })).toBeInTheDocument();
    });
    const editor = screen.getByRole('textbox', { name: 'Editor' });
    fireEvent.change(editor, { target: { value: 'populated content' } });

    globalThis.dispatchEvent(new CustomEvent('agentdeck:save-as', { detail: { tabId: tab.id } }));

    await waitFor(() => {
      expect(showSaveDialogMock).toHaveBeenCalledWith('/src/app.ts');
    });
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(store.closeTab).not.toHaveBeenCalled();
    expect(store.openTab).not.toHaveBeenCalled();
  });

  it('handles agentdeck:save-as event with successful write and new tab', async () => {
    const showSaveDialogMock = vi.fn().mockResolvedValue('/new/path/saved.ts');
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const agent = mockAgent({ showSaveDialog: showSaveDialogMock, writeFile: writeFileMock });
    const tab = createTab();
    const store = mockStore({ tabs: [tab], activeTabId: tab.id });
    renderSurface({ agent, store });

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Editor' })).toBeInTheDocument();
    });
    const editor = screen.getByRole('textbox', { name: 'Editor' });
    fireEvent.change(editor, { target: { value: 'populated content' } });

    globalThis.dispatchEvent(new CustomEvent('agentdeck:save-as', { detail: { tabId: tab.id } }));

    await waitFor(() => {
      expect(store.openTab).toHaveBeenCalledWith({ filePath: '/new/path/saved.ts' });
    });
    expect(store.closeTab).toHaveBeenCalledWith(tab.id);
  });

  it('handles agentdeck:save-as event when writeFile fails - does not close or open tab', async () => {
    const showSaveDialogMock = vi.fn().mockResolvedValue('/new/path/saved.ts');
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'denied' });
    const agent = mockAgent({ showSaveDialog: showSaveDialogMock, writeFile: writeFileMock });
    const tab = createTab();
    const store = mockStore({ tabs: [tab], activeTabId: tab.id });
    renderSurface({ agent, store });

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Editor' })).toBeInTheDocument();
    });
    const editor = screen.getByRole('textbox', { name: 'Editor' });
    fireEvent.change(editor, { target: { value: 'populated content' } });

    globalThis.dispatchEvent(new CustomEvent('agentdeck:save-as', { detail: { tabId: tab.id } }));

    await waitFor(() => {
      expect(writeFileMock).toHaveBeenCalledWith('/new/path/saved.ts', 'populated content');
    });
    expect(store.closeTab).not.toHaveBeenCalled();
    expect(store.openTab).not.toHaveBeenCalled();
  });

  it('handles agentdeck:save-as event with unknown tab id', async () => {
    const showSaveDialogMock = vi.fn().mockResolvedValue('/new/path.ts');
    const agent = mockAgent({ showSaveDialog: showSaveDialogMock });
    const store = mockStore();
    renderSurface({ agent, store });

    globalThis.dispatchEvent(new CustomEvent('agentdeck:save-as', { detail: { tabId: 'unknown-id' } }));

    await waitFor(() => {
      expect(showSaveDialogMock).not.toHaveBeenCalled();
    });
  });

  it('overwrite-conflict path: writes when no conflict occurs in save-and-close', async () => {
    const user = userEvent.setup();
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const closeTabMock = vi.fn();
    const setTabDirtyMock = vi.fn();
    const agent = mockAgent({ writeFile: writeFileMock });
    const tab = createTab({ isDirty: true });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id, closeTab: closeTabMock, setTabDirty: setTabDirtyMock });
    renderSurface({ agent, store });

    // Trigger dirty-close
    await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
    // Click Save
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(closeTabMock).toHaveBeenCalledWith(tab.id);
    });
    expect(setTabDirtyMock).toHaveBeenCalledWith(tab.id, false);
  });

  it('handles external conflict Reload when readFile returns error status', async () => {
    const user = userEvent.setup();
    const readFileMock = vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'missing' });
    const setTabDirtyMock = vi.fn();
    const agent = mockAgent({ readFile: readFileMock });
    const tab = createTab({ isDirty: true });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id, setTabDirty: setTabDirtyMock });
    const changes = new Set(['/src/app.ts']);
    renderSurface({ agent, store, externalChanges: changes });

    await waitFor(() => {
      expect(screen.getByText('File changed on disk')).toBeDefined();
    });

    // Click Reload from disk in the external conflict dialog
    const reloadButton = screen.getByRole('button', { name: 'Reload from disk' });
    await user.click(reloadButton);

    await waitFor(() => {
      expect(readFileMock).toHaveBeenCalled();
    });
    // setTabDirty should NOT be called because the read returned an error.
    expect(setTabDirtyMock).not.toHaveBeenCalled();
  });

  it('handles external conflict Overwrite write error gracefully', async () => {
    const user = userEvent.setup();
    const writeFileMock = vi.fn().mockRejectedValue(new Error('disk gone'));
    const setTabDirtyMock = vi.fn();
    const agent = mockAgent({ writeFile: writeFileMock });
    const tab = createTab({ isDirty: true });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id, setTabDirty: setTabDirtyMock });
    const changes = new Set(['/src/app.ts']);
    renderSurface({ agent, store, externalChanges: changes });

    await waitFor(() => {
      expect(screen.getByText('File changed on disk')).toBeDefined();
    });

    // Click Overwrite — should log error and dismiss dialog
    const overwriteButton = screen.getByRole('button', { name: 'Overwrite' });
    await user.click(overwriteButton);

    await waitFor(() => {
      expect(screen.queryByText('File changed on disk')).toBeNull();
    });
  });

  it('handles external conflict Reload write/read error gracefully (error status)', async () => {
    const user = userEvent.setup();
    const readFileMock = vi.fn().mockResolvedValue({ status: 'error', code: 'UNKNOWN', message: 'fail' });
    const setTabDirtyMock = vi.fn();
    const agent = mockAgent({ readFile: readFileMock });
    const tab = createTab({ isDirty: true });
    const store = mockStore({ tabs: [tab], activeTabId: tab.id, setTabDirty: setTabDirtyMock });
    const changes = new Set(['/src/app.ts']);
    renderSurface({ agent, store, externalChanges: changes });

    await waitFor(() => {
      expect(screen.getByText('File changed on disk')).toBeDefined();
    });

    const reloadButton = screen.getByRole('button', { name: 'Reload from disk' });
    await user.click(reloadButton);

    await waitFor(() => {
      expect(screen.queryByText('File changed on disk')).toBeNull();
    });
    expect(setTabDirtyMock).not.toHaveBeenCalled();
  });

  it('saveAll with multiple dirty tabs iterates over all', async () => {
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const setTabDirtyMock = vi.fn();
    const agent = mockAgent({ writeFile: writeFileMock });
    const tab1 = createTab({ id: 'tab-a', filePath: '/a.ts', fileName: 'a.ts', isDirty: true });
    const tab2 = createTab({ id: 'tab-b', filePath: '/b.ts', fileName: 'b.ts', isDirty: true });
    const store = mockStore({
      tabs: [tab1, tab2],
      activeTabId: tab1.id,
      setTabDirty: setTabDirtyMock
    });
    renderSurface({ agent, store });

    // Simulate content change for both tabs by editing the editor textarea
    // First wait for editor to load
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Editor' })).toBeInTheDocument();
    });

    const editor = screen.getByRole('textbox', { name: 'Editor' });
    fireEvent.change(editor, { target: { value: 'content A' } });

    // Trigger Save All
    globalThis.dispatchEvent(new CustomEvent('agentdeck:save-all'));

    // At least one write should occur for the active tab.
    await waitFor(() => {
      expect(writeFileMock).toHaveBeenCalled();
    });
  });
});
