import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Explorer } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi, FileEntry, WorkspaceModel } from '@agentdeck/shared';

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

const workspace: WorkspaceModel & { status: 'ok' } = {
  status: 'ok',
  filePath: '/workspace.code-workspace',
  kind: 'workspace-file',
  folders: [{ path: '/workspace', name: 'workspace' }]
};

function makeEntries(items: Array<{ name: string; path: string; kind: 'file' | 'directory'; isSensitive?: boolean }>): FileEntry[] {
  return items.map(e => ({
    name: e.name,
    path: e.path,
    kind: e.kind,
    isSensitive: e.isSensitive ?? false
  }));
}

// Mock globalThis.confirm for delete confirmation
const mockConfirm = vi.fn();
const originalConfirm = globalThis.confirm;

describe('Explorer context menu and dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.confirm = mockConfirm;
  });

  afterEach(() => {
    globalThis.confirm = originalConfirm;
  });

  describe('context menu', () => {
    it('opens context menu on right-click with Copy Path, Copy Relative Path, Rename, Delete', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory })}
          workspaceModel={workspace}
        />
      );

      const fileItem = await screen.findByRole('treeitem', { name: /app.ts/ });

      // Right-click to open context menu
      await user.pointer({ keys: '[MouseRight]', target: fileItem });

      const contextMenu = screen.getByRole('menu', { name: 'File context menu' });
      expect(contextMenu).toBeInTheDocument();
      expect(within(contextMenu).getByRole('menuitem', { name: 'Copy Path' })).toBeInTheDocument();
      expect(within(contextMenu).getByRole('menuitem', { name: 'Copy Relative Path' })).toBeInTheDocument();
      expect(within(contextMenu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
      expect(within(contextMenu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    });

    it('closes context menu when clicking outside', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory })}
          workspaceModel={workspace}
        />
      );

      const fileItem = await screen.findByRole('treeitem', { name: /app.ts/ });
      await user.pointer({ keys: '[MouseRight]', target: fileItem });

      expect(screen.getByRole('menu', { name: 'File context menu' })).toBeInTheDocument();

      // Click outside the context menu
      await user.click(screen.getByRole('tree'));

      await waitFor(() => {
        expect(screen.queryByRole('menu', { name: 'File context menu' })).not.toBeInTheDocument();
      });
    });

    it('opens context menu on directory entries', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([
        { name: 'src', path: '/workspace/src', kind: 'directory' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory })}
          workspaceModel={workspace}
        />
      );

      const dirItem = await screen.findByRole('treeitem', { name: /src/ });
      await user.pointer({ keys: '[MouseRight]', target: dirItem });

      expect(screen.getByRole('menu', { name: 'File context menu' })).toBeInTheDocument();
    });
  });

  describe('rename dialog', () => {
    it('opens rename dialog when Rename is clicked in context menu', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory })}
          workspaceModel={workspace}
        />
      );

      const fileItem = await screen.findByRole('treeitem', { name: /app.ts/ });
      await user.pointer({ keys: '[MouseRight]', target: fileItem });

      const renameItem = screen.getByRole('menuitem', { name: 'Rename' });
      await user.click(renameItem);

      // Rename dialog should appear (no role="dialog" attribute, query by text)
      expect(screen.getByText(/Rename "app.ts"/)).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'New name' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    });

    it('pre-fills rename input with current file name', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory })}
          workspaceModel={workspace}
        />
      );

      const fileItem = await screen.findByRole('treeitem', { name: /app.ts/ });
      await user.pointer({ keys: '[MouseRight]', target: fileItem });
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByRole('textbox', { name: 'New name' }) as HTMLInputElement;
      expect(input.value).toBe('app.ts');
    });

    it('calls agent.renameFile and closes dialog on Rename confirm', async () => {
      const user = userEvent.setup();
      const renameFile = vi.fn().mockResolvedValue({ status: 'ok' });
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory, renameFile })}
          workspaceModel={workspace}
        />
      );

      const fileItem = await screen.findByRole('treeitem', { name: /app.ts/ });
      await user.pointer({ keys: '[MouseRight]', target: fileItem });
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const input = screen.getByRole('textbox', { name: 'New name' });
      fireEvent.change(input, { target: { value: 'new-app.ts' } });

      await user.click(screen.getByRole('button', { name: 'Rename' }));

      expect(renameFile).toHaveBeenCalledWith('/workspace/src/app.ts', '/workspace/src/new-app.ts');
      await waitFor(() => {
        expect(screen.queryByText(/Rename "app.ts"/)).not.toBeInTheDocument();
      });
    });

    it('closes rename dialog on Cancel', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory })}
          workspaceModel={workspace}
        />
      );

      const fileItem = await screen.findByRole('treeitem', { name: /app.ts/ });
      await user.pointer({ keys: '[MouseRight]', target: fileItem });
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      expect(screen.getByText(/Rename "app.ts"/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByText(/Rename "app.ts"/)).not.toBeInTheDocument();
    });

    it('closes rename dialog on Escape key', async () => {
      const user = userEvent.setup();
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory })}
          workspaceModel={workspace}
        />
      );

      const fileItem = await screen.findByRole('treeitem', { name: /app.ts/ });
      await user.pointer({ keys: '[MouseRight]', target: fileItem });
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      expect(screen.getByText(/Rename "app.ts"/)).toBeInTheDocument();

      // Focus the input and press Escape
      const input = screen.getByRole('textbox', { name: 'New name' });
      await user.click(input);
      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByText(/Rename "app.ts"/)).not.toBeInTheDocument();
      });
    });
  });

  describe('delete confirmation', () => {
    it('shows confirm dialog when Delete is clicked', async () => {
      const user = userEvent.setup();
      mockConfirm.mockReturnValue(false);
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory })}
          workspaceModel={workspace}
        />
      );

      const fileItem = await screen.findByRole('treeitem', { name: /app.ts/ });
      await user.pointer({ keys: '[MouseRight]', target: fileItem });
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.stringContaining('app.ts')
      );
    });

    it('calls agent.deleteFile when delete is confirmed', async () => {
      const user = userEvent.setup();
      mockConfirm.mockReturnValue(true);
      const deleteFile = vi.fn().mockResolvedValue({ status: 'ok' });
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory, deleteFile })}
          workspaceModel={workspace}
        />
      );

      const fileItem = await screen.findByRole('treeitem', { name: /app.ts/ });
      await user.pointer({ keys: '[MouseRight]', target: fileItem });
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

      expect(deleteFile).toHaveBeenCalledWith('/workspace/src/app.ts');
    });

    it('does not call deleteFile when delete is cancelled', async () => {
      const user = userEvent.setup();
      mockConfirm.mockReturnValue(false);
      const deleteFile = vi.fn().mockResolvedValue({ status: 'ok' });
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/src/app.ts', kind: 'file' }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory, deleteFile })}
          workspaceModel={workspace}
        />
      );

      const fileItem = await screen.findByRole('treeitem', { name: /app.ts/ });
      await user.pointer({ keys: '[MouseRight]', target: fileItem });
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

      expect(deleteFile).not.toHaveBeenCalled();
    });
  });

  describe('sensitive file indicator', () => {
    it('marks sensitive files with sensitive class', async () => {
      const entries = makeEntries([
        { name: '.env', path: '/workspace/.env', kind: 'file', isSensitive: true }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory })}
          workspaceModel={workspace}
        />
      );

      const fileItem = await screen.findByRole('treeitem', { name: /\.env/ });
      expect(fileItem.parentElement).toHaveClass('sensitive');
    });

    it('does not mark non-sensitive files', async () => {
      const entries = makeEntries([
        { name: 'app.ts', path: '/workspace/app.ts', kind: 'file', isSensitive: false }
      ]);
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

      render(
        <Explorer
          agent={mockAgent({ listDirectory })}
          workspaceModel={workspace}
        />
      );

      const fileItem = await screen.findByRole('treeitem', { name: /app.ts/ });
      expect(fileItem).not.toHaveClass('sensitive');
    });
  });

  describe('empty directory', () => {
    it('shows empty directory message', async () => {
      const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries: [] });

      render(
        <Explorer
          agent={mockAgent({ listDirectory })}
          workspaceModel={workspace}
        />
      );

      expect(await screen.findByText('Empty directory')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading indicator while loading', async () => {
      // Create a promise that doesn't resolve immediately
      let resolveList: (value: { path: string; entries: FileEntry[] }) => void;
      const listDirectory = vi.fn().mockImplementation(() => new Promise(resolve => {
        resolveList = resolve;
      }));

      render(
        <Explorer
          agent={mockAgent({ listDirectory })}
          workspaceModel={workspace}
        />
      );

      // Should show loading initially
      expect(screen.getByText('Loading.')).toBeInTheDocument();

      // Resolve the promise
      resolveList!({ path: '/workspace', entries: [] });

      await waitFor(() => {
        expect(screen.queryByText('Loading.')).not.toBeInTheDocument();
      });
    });
  });
});

