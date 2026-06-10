import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { EditorSurface } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi, EditorTab, FileWriteResult } from '@agentdeck/shared';
import type { EditorStore } from '@agentdeck/workbench';

/**
 * Integration tests for the write conflict flow.
 *
 * These tests verify the complete user journey through the close-tab flow:
 * 1. User has a dirty file open in the editor
 * 2. External process modifies the file on disk
 * 3. User closes the tab ? save dialog appears ? clicks Save
 * 4. writeFile returns WRITE_CONFLICT ? conflict dialog appears
 * 5. User chooses Overwrite / Reload / Cancel
 *
 * Note: The Ctrl+S keyboard shortcut path is not tested here because
 * jsdom doesn't properly support keyboard event dispatching on window.
 * The close-tab flow exercises the same doSave() ? conflict dialog path.
 */

function mockAgent(overrides: Partial<AgentDeckPreloadApi> = {}): AgentDeckPreloadApi {
  return {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }),
    selectWorkspaceEntry: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    getModelGatewayConfig: vi.fn().mockResolvedValue({ providers: [], activeProvider: 'ollama', activeModel: 'default' }),
    listChatTabs: vi.fn().mockResolvedValue([]),
    createChatTab: vi.fn().mockImplementation(async (title) => ({ id: `chat-tab-${Date.now()}`, title: title ?? 'New Chat', messages: [], activeModel: 'default', activeProvider: 'ollama', isStreaming: false })),
    closeChatTab: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ status: 'ok' }),
    stopStreaming: vi.fn().mockResolvedValue(undefined),
    onChatStream: vi.fn().mockReturnValue(() => undefined),
    onChatTabsChange: vi.fn().mockReturnValue(() => undefined),
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

function renderSurface(props: { agent?: AgentDeckPreloadApi; store?: EditorStore }) {
  const agent = props.agent ?? mockAgent();
  const store = props.store ?? mockStore();
  return render(<EditorSurface agent={agent} store={store} externalChanges={emptyChanges} onExternalChangeAck={ackFsEvent} onDiagnosticsChange={onDiagnosticsChange} theme="dark" />);
}

describe('Editor conflict flow � integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('close dirty tab ? Save ? conflict dialog appears with all options', async () => {
    const user = userEvent.setup();

    const writeFileMock = vi.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'WRITE_CONFLICT', message: 'File modified on disk' } satisfies FileWriteResult);

    const agent = mockAgent({ writeFile: writeFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: vi.fn()
    });

    renderSurface({ agent, store });

    // Close tab ? save dialog ? Save
    await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Conflict dialog should appear
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'File conflict' })).toBeDefined();
    });
    expect(screen.getByText(/has been modified on disk/)).toBeDefined();
    expect(screen.getByText('app.ts')).toBeDefined();

    // Verify all three action buttons
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reload from disk' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('conflict ? Overwrite forces write and closes dialog', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();

    const writeFileMock = vi.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'WRITE_CONFLICT', message: 'File modified on disk' } satisfies FileWriteResult)
      .mockResolvedValueOnce({ status: 'ok' } satisfies FileWriteResult);

    const agent = mockAgent({ writeFile: writeFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });

    renderSurface({ agent, store });

    // Close ? Save ? Conflict ? Overwrite
    await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'File conflict' })).toBeDefined();
    });

    await user.click(screen.getByRole('button', { name: 'Overwrite' }));

    // Dialog closes, writeFile called twice (save + overwrite), tab closes
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(writeFileMock).toHaveBeenCalledTimes(2);
    expect(closeTabMock).toHaveBeenCalledWith('tab-1');
  });

  it('conflict ? Reload from disk loads file and dismisses dialog', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();

    const writeFileMock = vi.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'WRITE_CONFLICT', message: 'File modified on disk' } satisfies FileWriteResult);

    const readFileMock = vi.fn().mockResolvedValue({ status: 'ok', content: 'disk content', encoding: 'utf8' });

    const agent = mockAgent({ writeFile: writeFileMock, readFile: readFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });

    renderSurface({ agent, store });

    // Close ? Save ? Conflict ? Reload
    await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'File conflict' })).toBeDefined();
    });

    await user.click(screen.getByRole('button', { name: 'Reload from disk' }));

    // Dialog closes, readFile called, tab stays open
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(readFileMock).toHaveBeenCalledWith('/src/app.ts');
    expect(closeTabMock).not.toHaveBeenCalled();
  });

  it('conflict ? Cancel dismisses dialog without saving or closing', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();

    const writeFileMock = vi.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'WRITE_CONFLICT', message: 'File modified on disk' } satisfies FileWriteResult);

    const agent = mockAgent({ writeFile: writeFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });

    renderSurface({ agent, store });

    // Close ? Save ? Conflict ? Cancel
    await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'File conflict' })).toBeDefined();
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Both dialogs closed, tab stays open
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(closeTabMock).not.toHaveBeenCalled();
  });

  it('conflict ? Overwrite during close flow closes the tab', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();

    const writeFileMock = vi.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'WRITE_CONFLICT', message: 'File modified on disk' } satisfies FileWriteResult)
      .mockResolvedValueOnce({ status: 'ok' } satisfies FileWriteResult);

    const agent = mockAgent({ writeFile: writeFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });

    renderSurface({ agent, store });

    // Close ? Save ? Conflict ? Overwrite ? tab closes
    await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'File conflict' })).toBeDefined();
    });

    await user.click(screen.getByRole('button', { name: 'Overwrite' }));

    await waitFor(() => {
      expect(closeTabMock).toHaveBeenCalledWith('tab-1');
    });
  });

  it('conflict ? Cancel during close flow keeps tab open', async () => {
    const user = userEvent.setup();
    const closeTabMock = vi.fn();

    const writeFileMock = vi.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'WRITE_CONFLICT', message: 'File modified on disk' } satisfies FileWriteResult);

    const agent = mockAgent({ writeFile: writeFileMock });
    const store = mockStore({
      tabs: [createTab({ isDirty: true })],
      activeTabId: 'tab-1',
      closeTab: closeTabMock
    });

    renderSurface({ agent, store });

    // Close ? Save ? Conflict ? Cancel ? tab stays open
    await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'File conflict' })).toBeDefined();
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(closeTabMock).not.toHaveBeenCalled();
  });
});

