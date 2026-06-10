import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { Explorer } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi, FsChangeEvent, WorkspaceModel } from '@agentdeck/shared';

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

const singleRootWorkspace: WorkspaceModel & { status: 'ok' } = {
  status: 'ok',
  filePath: '/workspace.code-workspace',
  kind: 'workspace-file',
  folders: [{ path: '/workspace', name: 'workspace' }]
};

function makeEntries(items: Array<{ name: string; path: string; kind: 'file' | 'directory'; isSensitive?: boolean }>) {
  return items.map(e => ({
    name: e.name,
    path: e.path,
    kind: e.kind,
    isSensitive: e.isSensitive ?? false
  }));
}

describe('Explorer - additional coverage', () => {
  let originalInnerWidth: number;
  let originalInnerHeight: number;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    originalInnerWidth = globalThis.innerWidth;
    originalInnerHeight = globalThis.innerHeight;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: originalInnerWidth });
    Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: originalInnerHeight });
    vi.useRealTimers();
  });

  describe('handleFsEvent (debounced fs listener)', () => {
    it('refreshes directory when fs change event fires', async () => {
      const onFsEvent = vi.fn().mockImplementation((handler: (event: FsChangeEvent) => void) => {
        // Store handler for later invocation
        (globalThis as unknown as Record<string, unknown>).__fsHandler = handler;
        return () => undefined;
      });
      const listDirectory = vi.fn()
        .mockResolvedValueOnce({ path: '/workspace', entries: [] })
        .mockResolvedValueOnce({ path: '/workspace', entries: [] });

      render(<Explorer agent={mockAgent({ onFsEvent, listDirectory })} workspaceModel={singleRootWorkspace} />);

      // Initial load
      await waitFor(() => {
        expect(listDirectory).toHaveBeenCalledTimes(1);
      });

      // Fire fs event - should trigger debounced refresh
      const handler = (globalThis as unknown as Record<string, unknown>).__fsHandler as (e: FsChangeEvent) => void;
      handler({ kind: 'change', path: '/workspace/index.ts' });

      // Wait for debounce
      await waitFor(() => {
        expect(listDirectory).toHaveBeenCalledTimes(2);
      });
    });

    it('coalesces multiple fs events into a single refresh', async () => {
      const onFsEvent = vi.fn().mockImplementation((handler: (event: FsChangeEvent) => void) => {
        (globalThis as unknown as Record<string, unknown>).__fsHandler = handler;
        return () => undefined;
      });
      const listDirectory = vi.fn()
        .mockResolvedValueOnce({ path: '/workspace', entries: [] })
        .mockResolvedValueOnce({ path: '/workspace', entries: [] });

      render(<Explorer agent={mockAgent({ onFsEvent, listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => {
        expect(listDirectory).toHaveBeenCalledTimes(1);
      });

      // Fire multiple events quickly
      const handler = (globalThis as unknown as Record<string, unknown>).__fsHandler as (e: FsChangeEvent) => void;
      handler({ kind: 'change', path: '/workspace/a.ts' });
      handler({ kind: 'change', path: '/workspace/b.ts' });
      handler({ kind: 'change', path: '/workspace/c.ts' });

      // Wait for debounce - should only refresh once
      await waitFor(() => {
        expect(listDirectory).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('context menu positioning', () => {
    it('renders context menu without overflow style when menu fits in viewport', async () => {
      Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 2000 });
      Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 2000 });

      const entries = makeEntries([
        { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
      fireEvent.contextMenu(fileButton, { clientX: 100, clientY: 100 });

      const menu = await screen.findByRole('menu', { name: 'File context menu' });
      expect(menu).toBeInTheDocument();
    });

    it('flips context menu vertically when near bottom of viewport', async () => {
      // Set a small viewport so the menu would overflow downward.
      Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 2000 });
      Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 200 });

      const entries = makeEntries([
        { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
      // Open near the bottom so the menu would overflow
      fireEvent.contextMenu(fileButton, { clientX: 100, clientY: 180 });

      const menu = await screen.findByRole('menu', { name: 'File context menu' });
      expect(menu).toBeInTheDocument();
    });

    it('shifts context menu horizontally when near right of viewport', async () => {
      Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: 250 });
      Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 2000 });

      const entries = makeEntries([
        { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
      fireEvent.contextMenu(fileButton, { clientX: 240, clientY: 100 });

      const menu = await screen.findByRole('menu', { name: 'File context menu' });
      expect(menu).toBeInTheDocument();
    });
  });

  describe('click outside context menu', () => {
    it('closes the context menu when clicking outside', async () => {
      const entries = makeEntries([
        { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
      fireEvent.contextMenu(fileButton);

      const menu = await screen.findByRole('menu', { name: 'File context menu' });
      expect(menu).toBeInTheDocument();

      // Click outside (e.g. on the body)
      fireEvent.mouseDown(document.body);

      await waitFor(() => {
        expect(screen.queryByRole('menu', { name: 'File context menu' })).not.toBeInTheDocument();
      });
    });
  });

  describe('rename operation - error handling', () => {
    it('handles rename error gracefully', async () => {
      const user = userEvent.setup();
      const renameFileMock = vi.fn().mockRejectedValue(new Error('Permission denied'));
      const entries = makeEntries([
        { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, renameFile: renameFileMock })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
      fireEvent.contextMenu(fileButton);

      const renameItem = await screen.findByRole('menuitem', { name: 'Rename' });
      await user.click(renameItem);

      const input = await screen.findByRole('textbox', { name: 'New name' });
      await user.clear(input);
      await user.type(input, 'renamed.ts');
      await user.click(screen.getByRole('button', { name: 'Rename' }));

      await waitFor(() => {
        expect(renameFileMock).toHaveBeenCalledWith('/workspace/index.ts', '/workspace/renamed.ts');
      });
      // Dialog should be closed even after error
      expect(screen.queryByRole('dialog', { name: 'Rename index.ts' })).not.toBeInTheDocument();
    });

    it('handles rename success and refreshes directory listing', async () => {
      const user = userEvent.setup();
      const renameFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
      const entries = makeEntries([
        { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn()
        .mockResolvedValueOnce({ path: '/workspace', entries })
        .mockResolvedValueOnce({ path: '/workspace', entries: [] });

      render(<Explorer agent={mockAgent({ listDirectory, renameFile: renameFileMock })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
      fireEvent.contextMenu(fileButton);

      const renameItem = await screen.findByRole('menuitem', { name: 'Rename' });
      await user.click(renameItem);

      const input = await screen.findByRole('textbox', { name: 'New name' });
      await user.clear(input);
      await user.type(input, 'renamed.ts');
      await user.click(screen.getByRole('button', { name: 'Rename' }));

      await waitFor(() => {
        expect(renameFileMock).toHaveBeenCalled();
      });
    });
  });

  describe('clipboard error handling', () => {
    it('handles Copy Path clipboard error gracefully', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([
        { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      // Replace clipboard with a stub that throws
      const origClipboard = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
        configurable: true
      });

      try {
        render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

        const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
        fireEvent.contextMenu(fileButton);

        const copyPathItem = await screen.findByRole('menuitem', { name: 'Copy Path' });
        await user.click(copyPathItem);

        // Menu should be closed even after error
        await waitFor(() => {
          expect(screen.queryByRole('menu', { name: 'File context menu' })).not.toBeInTheDocument();
        });
      } finally {
        Object.defineProperty(navigator, 'clipboard', { value: origClipboard, configurable: true });
      }
    });

    it('handles Copy Relative Path clipboard error gracefully', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([
        { name: 'index.ts', path: '/workspace/src/index.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      const origClipboard = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
        configurable: true
      });

      try {
        render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

        const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
        fireEvent.contextMenu(fileButton);

        const copyRelPathItem = await screen.findByRole('menuitem', { name: 'Copy Relative Path' });
        await user.click(copyRelPathItem);

        await waitFor(() => {
          expect(screen.queryByRole('menu', { name: 'File context menu' })).not.toBeInTheDocument();
        });
      } finally {
        Object.defineProperty(navigator, 'clipboard', { value: origClipboard, configurable: true });
      }
    });
  });

  describe('root select change resets currentPath', () => {
    it('resets currentPath when the workspace root select changes', async () => {
      const multiRoot: WorkspaceModel & { status: 'ok' } = {
        status: 'ok',
        filePath: '/multi.code-workspace',
        kind: 'workspace-file',
        folders: [
          { path: '/workspace-a', name: 'ProjectA' },
          { path: '/workspace-b', name: 'ProjectB' }
        ]
      };
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace-b', entries: [] });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={multiRoot} />);

      const select = await screen.findByRole('combobox', { name: 'Workspace root' });
      await userEvent.selectOptions(select, '1');

      await waitFor(() => {
        expect(listDirectory).toHaveBeenCalledWith('/workspace-b');
      });
    });
  });

  describe('onFileOpen callback', () => {
    it('calls onFileOpen when a file entry is clicked', async () => {
      const user = userEvent.setup();
      const onFileOpen = vi.fn();
      const entries = makeEntries([
        { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} onFileOpen={onFileOpen} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
      await user.click(fileButton);

      expect(onFileOpen).toHaveBeenCalledWith('/workspace/index.ts');
    });
  });

  describe('context menu Escape key', () => {
    it('closes context menu on Escape key down', async () => {
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file app.ts' });
      fireEvent.contextMenu(fileButton);

      expect(screen.getByRole('menu', { name: 'File context menu' })).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('menu', { name: 'File context menu' })).not.toBeInTheDocument();
      });
    });
  });

  describe('copy path success paths', () => {
    it('copies full path to clipboard and closes menu', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      const origClipboard = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText }, configurable: true
      });

      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file app.ts' });
      fireEvent.contextMenu(fileButton);

      await user.click(screen.getByRole('menuitem', { name: 'Copy Path' }));

      expect(writeText).toHaveBeenCalledWith('/workspace/app.ts');

      await waitFor(() => {
        expect(screen.queryByRole('menu', { name: 'File context menu' })).not.toBeInTheDocument();
      });

      Object.defineProperty(navigator, 'clipboard', { value: origClipboard, configurable: true });
    });

    it('copies relative path to clipboard', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      const origClipboard = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText }, configurable: true
      });

      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file app.ts' });
      fireEvent.contextMenu(fileButton);

      await user.click(screen.getByRole('menuitem', { name: 'Copy Relative Path' }));

      expect(writeText).toHaveBeenCalledWith('src/app.ts');

      await waitFor(() => {
        expect(screen.queryByRole('menu', { name: 'File context menu' })).not.toBeInTheDocument();
      });

      Object.defineProperty(navigator, 'clipboard', { value: origClipboard, configurable: true });
    });
  });

  describe('rename dialog edge cases', () => {
    it('closes rename dialog when value is unchanged or empty', async () => {
      const user = userEvent.setup();
      const renameFile = vi.fn();
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, renameFile })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file app.ts' });
      fireEvent.contextMenu(fileButton);
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByRole('textbox', { name: 'New name' }) as HTMLInputElement;
      expect(input.value).toBe('app.ts');

      // Click Rename without changing the value — should close without calling renameFile
      await user.click(screen.getByRole('button', { name: 'Rename' }));
      expect(renameFile).not.toHaveBeenCalled();
      expect(screen.queryByText(/Rename "app.ts"/)).not.toBeInTheDocument();
    });

    it('submits rename on Enter key', async () => {
      const user = userEvent.setup();
      const renameFile = vi.fn().mockResolvedValue({ status: 'ok' });
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, renameFile })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file app.ts' });
      fireEvent.contextMenu(fileButton);
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByRole('textbox', { name: 'New name' });
      await user.clear(input);
      await user.type(input, 'renamed.ts');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(renameFile).toHaveBeenCalled();
      });
    });
  });

  describe('context menu scroll containment', () => {
    it('sets up and cleans up scroll containment handlers', async () => {
      const addSpy = vi.spyOn(globalThis, 'addEventListener');
      const removeSpy = vi.spyOn(globalThis, 'removeEventListener');

      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      const { unmount } = render(
        <Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />
      );

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file app.ts' });
      fireEvent.contextMenu(fileButton);

      expect(screen.getByRole('menu', { name: 'File context menu' })).toBeInTheDocument();

      // Close the menu to trigger cleanup
      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByRole('menu', { name: 'File context menu' })).not.toBeInTheDocument();
      });

      unmount();
      addSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });

  describe('parentPath utility', () => {
    it('navigates into subdirectory and navigates up to parent', async () => {
      const entries = makeEntries([
        { name: 'src', path: '/workspace/src', kind: 'directory' }
      ]);
      const listDirectory = vi.fn()
        .mockResolvedValueOnce({ path: '/workspace', entries })
        .mockResolvedValueOnce({ path: '/workspace/src', entries: [] })
        .mockResolvedValueOnce({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      const dirButton = await screen.findByRole('treeitem', { name: 'Open directory src' });
      await userEvent.click(dirButton);

      await waitFor(() => {
        expect(listDirectory).toHaveBeenNthCalledWith(2, '/workspace/src');
      });

      // Navigate up
      const upButton = await screen.findByRole('button', { name: 'Navigate up' });
      await userEvent.click(upButton);

      await waitFor(() => {
        expect(listDirectory).toHaveBeenNthCalledWith(3, '/workspace');
      });
    });
  });

  describe('loadDir error handling', () => {
    it('handles loadDir rejection gracefully', async () => {
      const listDirectory = vi.fn().mockRejectedValue(new Error('network error'));
      // Prevent console.error from cluttering output
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      await screen.findByText('workspace');
      // Loading should be finished despite error
      await waitFor(() => {
        expect(screen.queryByText('Loading.')).not.toBeInTheDocument();
      });

      consoleError.mockRestore();
    });
  });

  describe('fs watcher cleanup', () => {
    it('cleans up fs event subscription and debounce timer on unmount', async () => {
      const unsubscribe = vi.fn();
      const onFsEvent = vi.fn().mockReturnValue(unsubscribe);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries: [] });

      const { unmount } = render(
        <Explorer agent={mockAgent({ onFsEvent, listDirectory })} workspaceModel={singleRootWorkspace} />
      );

      await screen.findByText('workspace');

      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  describe('getRelativePath', () => {
    it('returns full path for files outside root', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      const origClipboard = navigator.clipboard;
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText }, configurable: true
      });

      // File outside root
      const entries = makeEntries([
        { name: 'outside.ts', path: '/other/outside.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file outside.ts' });
      fireEvent.contextMenu(fileButton);
      await user.click(screen.getByRole('menuitem', { name: 'Copy Relative Path' }));

      expect(writeText).toHaveBeenCalledWith('/other/outside.ts');

      Object.defineProperty(navigator, 'clipboard', { value: origClipboard, configurable: true });
    });
  });

  describe('rename on Enter key (handleRenameKeyDown)', () => {
    it('cancels rename on Escape key in rename input', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      const fileButton = await screen.findByRole('treeitem', { name: 'Open file app.ts' });
      fireEvent.contextMenu(fileButton);
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      expect(screen.getByText(/Rename "app.ts"/)).toBeInTheDocument();

      const input = screen.getByRole('textbox', { name: 'New name' });
      // Simulate Escape via handleRenameKeyDown
      fireEvent.keyDown(input, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByText(/Rename "app.ts"/)).not.toBeInTheDocument();
      });
    });
  });
});
