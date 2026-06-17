import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { Explorer } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi, FsChangeEvent, WorkspaceModel } from '@agentdeck/shared';

function mockAgent(overrides: Record<string, unknown> = {}): AgentDeckPreloadApi {
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
  } as AgentDeckPreloadApi;
}

// Mock clipboard API
const mockWriteText = vi.fn().mockResolvedValue(undefined);
const originalClipboard = navigator.clipboard;
Object.defineProperty(navigator, 'clipboard', {
  value: { ...originalClipboard, writeText: mockWriteText },
  configurable: true,
  writable: true
});

const singleRootWorkspace: WorkspaceModel & { status: 'ok' } = {
  status: 'ok',
  filePath: '/workspace.code-workspace',
  kind: 'workspace-file',
  folders: [{ path: '/workspace', name: 'workspace' }]
};

const multiRootWorkspace: WorkspaceModel & { status: 'ok' } = {
  status: 'ok',
  filePath: '/multi.code-workspace',
  kind: 'workspace-file',
  folders: [
    { path: '/workspace-a', name: 'ProjectA' },
    { path: '/workspace-b', name: 'ProjectB' }
  ]
};

function makeEntries(items: Array<{ name: string; path: string; kind: 'file' | 'directory'; isSensitive?: boolean }>) {
  return items.map(e => ({
    name: e.name,
    path: e.path,
    kind: e.kind as 'file' | 'directory',
    isSensitive: e.isSensitive ?? false
  }));
}

describe('Explorer — deep coverage', () => {
  let originalInnerWidth: number;
  let originalInnerHeight: number;
  let originalConfirm: typeof globalThis.confirm;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    originalInnerWidth = globalThis.innerWidth;
    originalInnerHeight = globalThis.innerHeight;
    originalConfirm = globalThis.confirm;
    mockWriteText.mockClear();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'innerWidth', { configurable: true, value: originalInnerWidth });
    Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: originalInnerHeight });
    globalThis.confirm = originalConfirm;
    vi.useRealTimers();
  });

  describe('navigate up', () => {
    it('navigates up when breadcrumb up button is clicked', async () => {
      const entries = makeEntries([{ name: 'src', path: '/workspace/src', kind: 'directory' }]);
      const listDirectory = vi.fn()
        .mockResolvedValueOnce({ path: '/workspace', entries })
        .mockResolvedValueOnce({ path: '/workspace/src', entries: [] })
        .mockResolvedValueOnce({ path: '/workspace', entries: [] });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });

      fireEvent.click(screen.getByText('src'));
      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(2); });

      const upButton = screen.getByRole('button', { name: 'Navigate up' });
      fireEvent.click(upButton);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(3); });
    });

    it('hides up button when at root path', async () => {
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries: [] });
      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      expect(screen.queryByRole('button', { name: 'Navigate up' })).toBeNull();
    });
  });

  describe('multi-root workspace', () => {
    it('renders root selector for multi-root workspace', async () => {
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace-a', entries: [] });
      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={multiRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });

      const rootSelect = screen.getByLabelText('Workspace root');
      expect(rootSelect).toBeInTheDocument();
      expect(screen.getAllByText('ProjectA').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('ProjectB').length).toBeGreaterThanOrEqual(1);
    });

    it('switches root when select changes', async () => {
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace-a', entries: [] });
      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={multiRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });

      const rootSelect = screen.getByLabelText('Workspace root');
      fireEvent.change(rootSelect, { target: { value: '1' } });

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledWith('/workspace-b'); });
    });

    it('shows root name in breadcrumb when at root', async () => {
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace-a', entries: [] });
      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={multiRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      expect(screen.getAllByText('ProjectA').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('file click', () => {
    it('calls onFileOpen when file is clicked', async () => {
      const user = userEvent.setup();
      const onFileOpen = vi.fn();
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} onFileOpen={onFileOpen} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      await user.click(screen.getByText('app.ts'));
      expect(onFileOpen).toHaveBeenCalledWith('/workspace/src/app.ts');
    });
  });

  describe('directory navigation', () => {
    it('navigates into directory when clicked', async () => {
      const entries = makeEntries([{ name: 'src', path: '/workspace/src', kind: 'directory' }]);
      const subEntries = makeEntries([{ name: 'index.ts', path: '/workspace/src/index.ts', kind: 'file' }]);
      const listDirectory = vi.fn()
        .mockResolvedValueOnce({ path: '/workspace', entries })
        .mockResolvedValueOnce({ path: '/workspace/src', entries: subEntries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.click(screen.getByText('src'));
      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(2); });
      expect(screen.getByText('index.ts')).toBeInTheDocument();
    });
  });

  describe('empty directory', () => {
    it('shows empty message when directory has no entries', async () => {
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries: [] });
      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      expect(screen.getByText('Empty directory')).toBeInTheDocument();
    });
  });

  describe('rename dialog', () => {
    it('opens rename dialog from context menu', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
      expect(screen.getByText('Rename "app.ts"')).toBeInTheDocument();
    });

    it('confirms rename with Enter key', async () => {
      const user = userEvent.setup();
      const renameFile = vi.fn().mockResolvedValue({ status: 'ok' });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, renameFile, toolCall: undefined })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByLabelText('New name');
      await user.clear(input);
      await user.type(input, 'newapp.ts');
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => { expect(renameFile).toHaveBeenCalled(); });
    });

    it('cancels rename with Escape key', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByLabelText('New name');
      fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
      expect(screen.queryByText('Rename "app.ts"')).not.toBeInTheDocument();
    });

    it('cancels rename when clicking Cancel button', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText('Rename "app.ts"')).not.toBeInTheDocument();
    });

    it('does not rename when value is empty', async () => {
      const user = userEvent.setup();
      const renameFile = vi.fn().mockResolvedValue({ status: 'ok' });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, renameFile, toolCall: undefined })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByLabelText('New name');
      await user.clear(input);
      await user.click(screen.getByRole('button', { name: 'Rename' }));

      expect(renameFile).not.toHaveBeenCalled();
      expect(screen.queryByText('Rename "app.ts"')).not.toBeInTheDocument();
    });

    it('does not rename when value is unchanged', async () => {
      const user = userEvent.setup();
      const renameFile = vi.fn().mockResolvedValue({ status: 'ok' });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, renameFile, toolCall: undefined })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
      await user.click(screen.getByRole('button', { name: 'Rename' }));
      expect(renameFile).not.toHaveBeenCalled();
    });
  });

  describe('delete with confirm', () => {
    it('deletes file when confirmed', async () => {
      const user = userEvent.setup();
      globalThis.confirm = vi.fn().mockReturnValue(true);
      const deleteFile = vi.fn().mockResolvedValue({ status: 'ok' });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, deleteFile, toolCall: undefined })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
      await waitFor(() => { expect(deleteFile).toHaveBeenCalledWith('/workspace/app.ts'); });
    });

    it('does not delete when not confirmed', async () => {
      const user = userEvent.setup();
      globalThis.confirm = vi.fn().mockReturnValue(false);
      const deleteFile = vi.fn().mockResolvedValue({ status: 'ok' });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, deleteFile, toolCall: undefined })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
      expect(deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('context menu copy path', () => {
    it('closes context menu after copy path', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalled(); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      expect(screen.getByRole('menu')).toBeInTheDocument();
      await user.click(screen.getByRole('menuitem', { name: 'Copy Path' }));
      // Context menu should close after copy
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes context menu after copy relative path', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalled(); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Copy Relative Path' }));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('context menu close on Escape', () => {
    it('closes context menu on Escape key', async () => {
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalled(); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('sensitive file indicator', () => {
    it('marks sensitive files with CSS class', async () => {
      const entries = makeEntries([{ name: '.env', path: '/workspace/.env', kind: 'file', isSensitive: true }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalled(); });
      const envItem = screen.getByText('.env').closest('.file-tree-item');
      expect(envItem).toHaveClass('sensitive');
    });
  });

  describe('debounced fs event refresh', () => {
    it('refreshes directory on fs change event', async () => {
      const onFsEvent = vi.fn().mockImplementation((handler: (event: FsChangeEvent) => void) => {
        (globalThis as unknown as Record<string, unknown>).__fsHandler = handler;
        return () => undefined;
      });
      const listDirectory = vi.fn()
        .mockResolvedValueOnce({ path: '/workspace', entries: [] })
        .mockResolvedValueOnce({ path: '/workspace', entries: [] });

      render(<Explorer agent={mockAgent({ onFsEvent, listDirectory })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });

      const handler = (globalThis as unknown as Record<string, unknown>).__fsHandler as (e: FsChangeEvent) => void;
      handler({ kind: 'change', path: '/workspace/index.ts' });
      vi.advanceTimersByTime(300);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(2); });
    });
  });

  describe('loading indicator', () => {
    it('shows loading indicator while loading', async () => {
      let resolveList: (value: unknown) => void;
      const listDirectory = vi.fn().mockImplementation(() => new Promise(resolve => { resolveList = resolve; }));

      render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

      expect(screen.getByText('Loading.')).toBeInTheDocument();
      resolveList!({ path: '/workspace', entries: [] });

      await waitFor(() => { expect(screen.queryByText('Loading.')).not.toBeInTheDocument(); });
    });
  });

  describe('rename via toolCall', () => {
    it('uses toolCall for rename when available', async () => {
      const user = userEvent.setup();
      const toolCall = vi.fn().mockResolvedValue({ status: 'ok', callId: 'dev', result: null });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, toolCall })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalled(); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByLabelText('New name');
      await user.clear(input);
      await user.type(input, 'newapp.ts');
      await user.click(screen.getByRole('button', { name: 'Rename' }));

      await waitFor(() => {
        expect(toolCall).toHaveBeenCalledWith(expect.objectContaining({
          toolName: 'renameFile',
          args: { oldPath: '/workspace/app.ts', newPath: '/workspace/newapp.ts' }
        }));
      });
    });
  });

  describe('delete via toolCall', () => {
    it('uses toolCall for delete when available', async () => {
      const user = userEvent.setup();
      globalThis.confirm = vi.fn().mockReturnValue(true);
      const toolCall = vi.fn().mockResolvedValue({ status: 'ok', callId: 'dev', result: null });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, toolCall })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalled(); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

      await waitFor(() => {
        expect(toolCall).toHaveBeenCalledWith(expect.objectContaining({
          toolName: 'deleteFile',
          args: { filePath: '/workspace/app.ts' }
        }));
      });
    });
  });

  describe('toolCall status handling', () => {
    it('does not refresh on delete when toolCall returns pending-approval', async () => {
      const user = userEvent.setup();
      globalThis.confirm = vi.fn().mockReturnValue(true);
      const toolCall = vi.fn().mockResolvedValue({
        status: 'pending-approval',
        callId: 'pending-123',
        classification: 'destructive',
        expiresAt: Date.now() + 60000,
      });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, toolCall })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

      await waitFor(() => {
        expect(toolCall).toHaveBeenCalledWith(expect.objectContaining({
          toolName: 'deleteFile',
          args: { filePath: '/workspace/app.ts' }
        }));
      });

      // Should NOT refresh — file still exists, approval pending
      expect(listDirectory).toHaveBeenCalledTimes(1);
    });

    it('does not refresh on delete when toolCall returns denied', async () => {
      const user = userEvent.setup();
      globalThis.confirm = vi.fn().mockReturnValue(true);
      const toolCall = vi.fn().mockResolvedValue({
        status: 'denied',
        callId: 'denied-456',
        reason: 'User denied the operation',
      });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, toolCall })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

      await waitFor(() => {
        expect(toolCall).toHaveBeenCalledWith(expect.objectContaining({
          toolName: 'deleteFile',
        }));
      });

      // Should NOT refresh — operation was denied
      expect(listDirectory).toHaveBeenCalledTimes(1);
    });

    it('does not refresh on delete when toolCall returns error', async () => {
      const user = userEvent.setup();
      globalThis.confirm = vi.fn().mockReturnValue(true);
      const toolCall = vi.fn().mockResolvedValue({
        status: 'error',
        callId: 'err-789',
        message: 'File not found',
      });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, toolCall })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

      await waitFor(() => {
        expect(toolCall).toHaveBeenCalledWith(expect.objectContaining({
          toolName: 'deleteFile',
        }));
      });

      // Should NOT refresh — operation errored
      expect(listDirectory).toHaveBeenCalledTimes(1);
    });

    it('does not refresh on rename when toolCall returns pending-approval', async () => {
      const user = userEvent.setup();
      const toolCall = vi.fn().mockResolvedValue({
        status: 'pending-approval',
        callId: 'pending-rename-123',
        classification: 'mutating',
        expiresAt: Date.now() + 60000,
      });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, toolCall })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByLabelText('New name');
      await user.clear(input);
      await user.type(input, 'newapp.ts');
      await user.click(screen.getByRole('button', { name: 'Rename' }));

      await waitFor(() => {
        expect(toolCall).toHaveBeenCalledWith(expect.objectContaining({
          toolName: 'renameFile',
        }));
      });

      // Should NOT refresh — approval pending
      expect(listDirectory).toHaveBeenCalledTimes(1);
    });

    it('does not refresh on rename when toolCall returns denied', async () => {
      const user = userEvent.setup();
      const toolCall = vi.fn().mockResolvedValue({
        status: 'denied',
        callId: 'denied-rename-456',
        reason: 'User denied the operation',
      });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, toolCall })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByLabelText('New name');
      await user.clear(input);
      await user.type(input, 'newapp.ts');
      await user.click(screen.getByRole('button', { name: 'Rename' }));

      await waitFor(() => {
        expect(toolCall).toHaveBeenCalledWith(expect.objectContaining({
          toolName: 'renameFile',
        }));
      });

      // Should NOT refresh — operation was denied
      expect(listDirectory).toHaveBeenCalledTimes(1);
    });

    it('refreshes on delete when toolCall returns ok', async () => {
      const user = userEvent.setup();
      globalThis.confirm = vi.fn().mockReturnValue(true);
      const toolCall = vi.fn().mockResolvedValue({ status: 'ok', callId: 'ok-123', result: null });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, toolCall })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

      await waitFor(() => {
        expect(toolCall).toHaveBeenCalledWith(expect.objectContaining({
          toolName: 'deleteFile',
        }));
      });

      // Should refresh — delete succeeded
      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(2); });
    });

    it('refreshes on rename when toolCall returns ok', async () => {
      const user = userEvent.setup();
      const toolCall = vi.fn().mockResolvedValue({ status: 'ok', callId: 'ok-rename-123', result: null });
      const entries = makeEntries([{ name: 'app.ts', path: '/workspace/app.ts', kind: 'file' }]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(<Explorer agent={mockAgent({ listDirectory, toolCall })} workspaceModel={singleRootWorkspace} />);

      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(1); });
      fireEvent.contextMenu(screen.getByText('app.ts'));
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByLabelText('New name');
      await user.clear(input);
      await user.type(input, 'newapp.ts');
      await user.click(screen.getByRole('button', { name: 'Rename' }));

      await waitFor(() => {
        expect(toolCall).toHaveBeenCalledWith(expect.objectContaining({
          toolName: 'renameFile',
        }));
      });

      // Should refresh — rename succeeded
      await waitFor(() => { expect(listDirectory).toHaveBeenCalledTimes(2); });
    });
  });
});
