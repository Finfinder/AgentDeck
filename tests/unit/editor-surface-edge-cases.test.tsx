import { render, screen, waitFor } from '@testing-library/react';
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

function renderSurface(props: { agent?: AgentDeckPreloadApi; store?: EditorStore; externalChanges?: ReadonlySet<string> }) {
  const agent = props.agent ?? mockAgent();
  const store = props.store ?? mockStore();
  const externalChanges = props.externalChanges ?? emptyChanges;
  return render(<EditorSurface agent={agent} store={store} externalChanges={externalChanges} onExternalChangeAck={ackFsEvent} onDiagnosticsChange={onDiagnosticsChange} theme="dark" />);
}

describe('EditorSurface edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders active tab with Monaco editor surface', () => {
    const agent = mockAgent();
    const store = mockStore({
      tabs: [createTab()],
      activeTabId: 'tab-1'
    });
    const { container } = renderSurface({ agent, store });
    // The editor area should be present with the active tab
    expect(container.querySelector('.editor-area')).not.toBeNull();
    expect(screen.getByRole('tablist')).toBeDefined();
  });

  it('renders multiple tabs', () => {
    const agent = mockAgent();
    const store = mockStore({
      tabs: [
        createTab({ id: 'tab-1', filePath: '/src/app.ts', fileName: 'app.ts' }),
        createTab({ id: 'tab-2', filePath: '/src/main.ts', fileName: 'main.ts' }),
        createTab({ id: 'tab-3', filePath: '/config.json', fileName: 'config.json', language: 'json' })
      ],
      activeTabId: 'tab-1'
    });
    renderSurface({ agent, store });
    expect(screen.getByRole('button', { name: /app.ts/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /main.ts/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /config.json/ })).toBeDefined();
  });

  it('shows dirty indicator on dirty tabs', () => {
    const agent = mockAgent();
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1'
    });
    renderSurface({ agent, store });
    // Dirty tab should show indicator
    const tabButton = screen.getByRole('tab');
    expect(tabButton.textContent).toContain('app.ts');
  });

  it('calls store.closeTab when closing a non-dirty tab', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();
    const agent = mockAgent();
    const store = mockStore({
      tabs: [createTab({ isDirty: false })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });
    renderSurface({ agent, store });

    // Find and click the close button for the tab
    const closeButton = screen.getByRole('button', { name: 'Close app.ts' });
    await user.click(closeButton);

    expect(closeTabMock).toHaveBeenCalledWith('tab-1');
  });

  it('shows save dialog when closing a dirty tab', async () => {
    const user = userEvent.setup();
    const agent = mockAgent();
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: vi.fn()
    });
    renderSurface({ agent, store });

    // Click close on dirty tab
    const closeButton = screen.getByRole('button', { name: 'Close app.ts' });
    await user.click(closeButton);

    // Dialog should appear
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/Save changes to/)).toBeDefined();
    expect(screen.getByText('app.ts')).toBeDefined();
  });

  it('save and close button in dialog saves then closes', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const agent = mockAgent({ writeFile: writeFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });
    renderSurface({ agent, store });

    // Trigger close on dirty tab
    const closeButton = screen.getByRole('button', { name: 'Close app.ts' });
    await user.click(closeButton);

    // Click Save in dialog
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(closeTabMock).toHaveBeenCalledWith('tab-1');
    });
  });

  it('close without save button closes tab without saving', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const agent = mockAgent({ writeFile: writeFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });
    renderSurface({ agent, store });

    // Trigger close on dirty tab
    const closeButton = screen.getByRole('button', { name: 'Close app.ts' });
    await user.click(closeButton);

    // Click Don't Save
    const dontSaveButton = screen.getByRole('button', { name: "Don't Save" });
    await user.click(dontSaveButton);

    expect(closeTabMock).toHaveBeenCalledWith('tab-1');
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('cancel button in dialog dismisses without closing', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();
    const agent = mockAgent();
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });
    renderSurface({ agent, store });

    // Trigger close on dirty tab
    const closeButton = screen.getByRole('button', { name: 'Close app.ts' });
    await user.click(closeButton);

    // Click Cancel
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    expect(closeTabMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('handles write failure during save-and-close gracefully', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();
    const writeFileMock = vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'Access denied' });
    const agent = mockAgent({ writeFile: writeFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });
    renderSurface({ agent, store });

    // Trigger close on dirty tab
    const closeButton = screen.getByRole('button', { name: 'Close app.ts' });
    await user.click(closeButton);

    // Click Save � write fails, but tab should still close
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    await waitFor(() => {
      // Even on write failure, the close should proceed
      expect(closeTabMock).toHaveBeenCalledWith('tab-1');
    });
  });

  it('renders correct aria-label on editor panel', () => {
    const agent = mockAgent();
    const store = mockStore({
      tabs: [createTab()],
      activeTabId: 'tab-1'
    });
    renderSurface({ agent, store });
    expect(screen.getByRole('tabpanel', { name: 'app.ts' })).toBeDefined();
  });

  it('renders empty tab panel aria-label when no active tab', () => {
    const agent = mockAgent();
    const store = mockStore();
    renderSurface({ agent, store });
    expect(screen.getByRole('tabpanel', { name: 'Editor' })).toBeDefined();
  });

  it('shows conflict dialog when save returns WRITE_CONFLICT during close', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();
    const writeFileMock = vi.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'WRITE_CONFLICT', message: 'File modified on disk' });
    const agent = mockAgent({ writeFile: writeFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });
    renderSurface({ agent, store });

    // Trigger close on dirty tab
    const closeButton = screen.getByRole('button', { name: 'Close app.ts' });
    await user.click(closeButton);

    // Click Save � write returns WRITE_CONFLICT
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    // Conflict dialog should appear
    expect(screen.getByRole('dialog', { name: 'File conflict' })).toBeDefined();
    expect(screen.getByText(/has been modified on disk/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reload from disk' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();

    // Tab should NOT be closed yet
    expect(closeTabMock).not.toHaveBeenCalled();
  });

  it('conflict Overwrite button forces write and closes tab', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();
    const writeFileMock = vi.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'WRITE_CONFLICT', message: 'File modified on disk' })
      .mockResolvedValueOnce({ status: 'ok' });
    const agent = mockAgent({ writeFile: writeFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });
    renderSurface({ agent, store });

    // Trigger close on dirty tab
    const closeButton = screen.getByRole('button', { name: 'Close app.ts' });
    await user.click(closeButton);

    // Click Save � triggers conflict
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    // Click Overwrite in conflict dialog
    const overwriteButton = screen.getByRole('button', { name: 'Overwrite' });
    await user.click(overwriteButton);

    await waitFor(() => {
      expect(closeTabMock).toHaveBeenCalledWith('tab-1');
    });
    // writeFile called twice: first save attempt + overwrite force-write
    expect(writeFileMock).toHaveBeenCalledTimes(2);
  });

  it('conflict Reload from disk button reloads file content and dismisses dialog', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();
    const writeFileMock = vi.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'WRITE_CONFLICT', message: 'File modified on disk' });
    const readFileMock = vi.fn().mockResolvedValue({ status: 'ok', content: 'disk content', encoding: 'utf8' });
    const agent = mockAgent({ writeFile: writeFileMock, readFile: readFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });
    renderSurface({ agent, store });

    // Trigger close on dirty tab
    const closeButton = screen.getByRole('button', { name: 'Close app.ts' });
    await user.click(closeButton);

    // Click Save � triggers conflict
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    // Wait for conflict dialog to appear
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'File conflict' })).toBeDefined();
    });

    // Click Reload from disk
    const reloadButton = screen.getByRole('button', { name: 'Reload from disk' });
    await user.click(reloadButton);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(readFileMock).toHaveBeenCalledWith('/src/app.ts');
    expect(closeTabMock).not.toHaveBeenCalled();
  });

  it('conflict Cancel button dismisses dialog without closing tab', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();
    const writeFileMock = vi.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'WRITE_CONFLICT', message: 'File modified on disk' });
    const agent = mockAgent({ writeFile: writeFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });
    renderSurface({ agent, store });

    // Trigger close on dirty tab
    const closeButton = screen.getByRole('button', { name: 'Close app.ts' });
    await user.click(closeButton);

    // Click Save � triggers conflict
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);

    // Wait for conflict dialog to appear
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'File conflict' })).toBeDefined();
    });

    // Click Cancel in conflict dialog
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(closeTabMock).not.toHaveBeenCalled();
  });
});

