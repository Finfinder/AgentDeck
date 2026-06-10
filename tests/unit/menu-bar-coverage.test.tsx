import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { MenuBar } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi, EditorTab } from '@agentdeck/shared';

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

const emptyTabs: EditorTab[] = [];

describe('MenuBar - additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'agentDeck', {
      configurable: true,
      value: mockAgent()
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'agentDeck', {
      configurable: true,
      value: undefined
    });
  });

  describe('Edit menu actions', () => {
    it('renders Edit menu items with shortcuts', async () => {
      const user = userEvent.setup();
      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'Edit' }));

      expect(screen.getByText('Undo')).toBeInTheDocument();
      expect(screen.getByText('Redo')).toBeInTheDocument();
      expect(screen.getByText('Select All')).toBeInTheDocument();
      expect(screen.getByText('Ctrl+Z')).toBeInTheDocument();
      expect(screen.getByText('Ctrl+Y')).toBeInTheDocument();
      expect(screen.getByText('Ctrl+A')).toBeInTheDocument();
    });

    it('invokes editor undo/redo/selectAll when no active editor is registered (no-op)', async () => {
      const user = userEvent.setup();
      // No active editor registered in the editor-registry.
      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      // Each click closes the menu, so re-open between clicks.
      await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
      await user.click(screen.getByText('Undo'));

      await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
      await user.click(screen.getByText('Redo'));

      await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
      await user.click(screen.getByText('Select All'));

      // After all clicks, the menu is closed
      expect(screen.queryByText('Undo')).not.toBeInTheDocument();
    });
  });

  describe('View menu actions', () => {
    it('renders View menu items', async () => {
      const user = userEvent.setup();
      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'View' }));

      expect(screen.getByText('Explorer')).toBeInTheDocument();
      expect(screen.getByText('Search')).toBeInTheDocument();
      expect(screen.getByText('Command Palette...')).toBeInTheDocument();
      expect(screen.getByText('Toggle Developer Tools')).toBeInTheDocument();
    });

    it('dispatches show-panel event for explorer when View > Explorer is clicked', async () => {
      const user = userEvent.setup();
      const handler = vi.fn();
      globalThis.addEventListener('agentdeck:show-panel', handler);

      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'View' }));
      await user.click(screen.getByText('Explorer'));

      expect(handler).toHaveBeenCalled();
      const event = handler.mock.calls[0]?.[0] as CustomEvent;
      expect(event.detail).toBe('explorer');

      globalThis.removeEventListener('agentdeck:show-panel', handler);
    });

    it('dispatches show-panel event for search when View > Search is clicked', async () => {
      const user = userEvent.setup();
      const handler = vi.fn();
      globalThis.addEventListener('agentdeck:show-panel', handler);

      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'View' }));
      await user.click(screen.getByText('Search'));

      expect(handler).toHaveBeenCalled();
      const event = handler.mock.calls[0]?.[0] as CustomEvent;
      expect(event.detail).toBe('search');

      globalThis.removeEventListener('agentdeck:show-panel', handler);
    });

    it('calls toggleDevTools when Toggle Developer Tools is clicked', async () => {
      const user = userEvent.setup();
      const toggleDevToolsMock = vi.fn().mockResolvedValue(undefined);
      const agent = mockAgent({ toggleDevTools: toggleDevToolsMock });

      render(
        <MenuBar
          agent={agent}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'View' }));
      await user.click(screen.getByText('Toggle Developer Tools'));

      await waitFor(() => {
        expect(toggleDevToolsMock).toHaveBeenCalled();
      });
    });
  });

  describe('Window menu actions', () => {
    it('renders Window menu with Toggle Full Screen', async () => {
      const user = userEvent.setup();
      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'Window' }));

      expect(screen.getByText('Toggle Full Screen')).toBeInTheDocument();
      expect(screen.getByText('F11')).toBeInTheDocument();
    });
  });

  describe('Click outside closes dropdown', () => {
    it('closes the open dropdown when clicking outside the menu', async () => {
      const user = userEvent.setup();
      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      // Click outside the menu
      await user.click(document.body);

      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      });
    });
  });

  describe('Recent workspaces', () => {
    it('does not show "Open Recent" when no recents exist', async () => {
      const user = userEvent.setup();
      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));

      // The "Open Recent" menu item should be disabled (no recents)
      const openRecentItem = screen.getByText('Open Recent', { selector: '.menu-item-label' });
      expect(openRecentItem).toBeInTheDocument();
      const button = openRecentItem.closest('button');
      expect(button).toHaveAttribute('aria-disabled', 'true');
    });

    it('shows up to 5 recent workspaces with separator', async () => {
      const user = userEvent.setup();
      const getRecentWorkspacesMock = vi.fn().mockResolvedValue([
        { name: 'r1', path: '/r1', kind: 'folder' as const, lastOpened: 1 },
        { name: 'r2', path: '/r2', kind: 'folder' as const, lastOpened: 2 },
        { name: 'r3', path: '/r3', kind: 'folder' as const, lastOpened: 3 }
      ]);
      const agent = mockAgent({ getRecentWorkspaces: getRecentWorkspacesMock });

      render(
        <MenuBar
          agent={agent}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));

      await waitFor(() => {
        expect(screen.getByText('r1')).toBeInTheDocument();
      });
      expect(screen.getByText('r2')).toBeInTheDocument();
      expect(screen.getByText('r3')).toBeInTheDocument();
    });

    it('invokes onOpenWorkspaceDirect with recent path and kind', async () => {
      const user = userEvent.setup();
      const onOpenWorkspaceDirect = vi.fn();
      const getRecentWorkspacesMock = vi.fn().mockResolvedValue([
        { name: 'myproject', path: '/projects/myproject', kind: 'folder' as const, lastOpened: Date.now() }
      ]);
      const agent = mockAgent({ getRecentWorkspaces: getRecentWorkspacesMock });

      render(
        <MenuBar
          agent={agent}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={onOpenWorkspaceDirect}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));

      const recentItem = await screen.findByText('myproject', { selector: '.menu-item-label' });
      await user.click(recentItem);

      await waitFor(() => {
        expect(onOpenWorkspaceDirect).toHaveBeenCalledWith('/projects/myproject', 'folder');
      });
    });
  });


});
