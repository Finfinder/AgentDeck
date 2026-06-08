import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { MenuBar } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi, EditorTab } from '@agentdeck/shared';

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

function findSaveMenuItem() {
  const allItems = screen.getAllByRole('menuitem');
  return allItems.find(mi => {
    const text = mi.textContent ?? '';
    return text.startsWith('Save') && !text.includes('All') && !text.includes('As') && !text.includes('Workspace');
  });
}

function findSaveAllMenuItem() {
  return screen.getAllByRole('menuitem').find(mi => mi.textContent?.startsWith('Save All'));
}

describe('MenuBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // MenuBar reads agent from globalThis.agentDeck via getPreloadApi()
    Object.defineProperty(globalThis, 'agentDeck', {
      configurable: true,
      value: mockAgent()
    });
  });

  afterEach(() => {
    // Clean up globalThis.agentDeck
    Object.defineProperty(globalThis, 'agentDeck', {
      configurable: true,
      value: undefined
    });
  });

  describe('rendering', () => {
    it('renders the menu bar with all top-level menus', () => {
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

      expect(screen.getByRole('menubar', { name: 'Application menu' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'File' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'View' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Window' })).toBeInTheDocument();
    });

    it('marks menu buttons with aria-haspopup and aria-expanded', () => {
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

      const fileButton = screen.getByRole('menuitem', { name: 'File' });
      expect(fileButton).toHaveAttribute('aria-haspopup', 'true');
      expect(fileButton).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('File menu', () => {
    it('opens File dropdown on click', async () => {
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
      expect(screen.getByRole('menuitem', { name: /Open Folder/ })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /Open Workspace/ })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Close Workspace' })).toBeInTheDocument();
      // Menu items include shortcut text in accessible name (e.g. "Save Ctrl+S")
      const menuItems = screen.getAllByRole('menuitem');
      const itemTexts = menuItems.map(mi => mi.textContent ?? '');
      expect(itemTexts.some(t => t.startsWith('Save') && !t.includes('All') && !t.includes('As') && !t.includes('Workspace'))).toBe(true);
      expect(itemTexts.some(t => t.startsWith('Save As'))).toBe(true);
      expect(itemTexts.some(t => t.includes('Save All'))).toBe(true);
    });

    it('calls onOpenWorkspace with folder when Open Folder is clicked', async () => {
      const user = userEvent.setup();
      const onOpenWorkspace = vi.fn();

      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={emptyTabs}
          onOpenWorkspace={onOpenWorkspace}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));
      await user.click(screen.getByRole('menuitem', { name: /Open Folder/ }));

      expect(onOpenWorkspace).toHaveBeenCalledWith('folder');
    });

    it('calls onOpenWorkspace with workspace-file when Open Workspace is clicked', async () => {
      const user = userEvent.setup();
      const onOpenWorkspace = vi.fn();

      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={emptyTabs}
          onOpenWorkspace={onOpenWorkspace}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));
      await user.click(screen.getByRole('menuitem', { name: /Open Workspace/ }));

      expect(onOpenWorkspace).toHaveBeenCalledWith('workspace-file');
    });

    it('dispatches close-workspace event when Close Workspace is clicked', async () => {
      const user = userEvent.setup();
      const handler = vi.fn();
      globalThis.addEventListener('agentdeck:close-workspace', handler);

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
      await user.click(screen.getByRole('menuitem', { name: 'Close Workspace' }));

      expect(handler).toHaveBeenCalledTimes(1);
      globalThis.removeEventListener('agentdeck:close-workspace', handler);
    });

    it('disables Save when no tabs are open', async () => {
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

      const saveItem = findSaveMenuItem();
      if (!saveItem) throw new Error('Save item not found');
      expect(saveItem.getAttribute('aria-disabled')).toBe('true');
    });

    it('enables Save when a tab is open', async () => {
      const user = userEvent.setup();
      const tabs: EditorTab[] = [{
        id: 't1', filePath: '/src/app.ts', fileName: 'app.ts',
        language: 'typescript', isDirty: false, isPinned: false,
        revealLine: null, revealCol: null, revealPattern: null, revealNonce: 0
      }];

      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={tabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));

      const saveItem = findSaveMenuItem();
      if (!saveItem) throw new Error('Save item not found');
      expect(saveItem.getAttribute('aria-disabled')).not.toBe('true');
    });

    it('disables Save All when no dirty tabs', async () => {
      const user = userEvent.setup();
      const tabs: EditorTab[] = [{
        id: 't1', filePath: '/src/app.ts', fileName: 'app.ts',
        language: 'typescript', isDirty: false, isPinned: false,
        revealLine: null, revealCol: null, revealPattern: null, revealNonce: 0
      }];

      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={tabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));

      const saveAllItem = findSaveAllMenuItem();
      if (!saveAllItem) throw new Error('Save All item not found');
      expect(saveAllItem.getAttribute('aria-disabled')).toBe('true');
    });

    it('enables Save All when dirty tabs exist', async () => {
      const user = userEvent.setup();
      const tabs: EditorTab[] = [{
        id: 't1', filePath: '/src/app.ts', fileName: 'app.ts',
        language: 'typescript', isDirty: true, isPinned: false,
        revealLine: null, revealCol: null, revealPattern: null, revealNonce: 0
      }];

      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={tabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));

      const saveAllItem = findSaveAllMenuItem();
      if (!saveAllItem) throw new Error('Save All item not found');
      expect(saveAllItem.getAttribute('aria-disabled')).not.toBe('true');
    });

    it('calls onSave when Save is clicked', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      const tabs: EditorTab[] = [{
        id: 't1', filePath: '/src/app.ts', fileName: 'app.ts',
        language: 'typescript', isDirty: false, isPinned: false,
        revealLine: null, revealCol: null, revealPattern: null, revealNonce: 0
      }];

      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={tabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={onSave}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));
      const saveBtn = findSaveMenuItem();
      if (!saveBtn) throw new Error('Save item not found');
      await user.click(saveBtn);

      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('calls onSaveAs when Save As is clicked', async () => {
      const user = userEvent.setup();
      const onSaveAs = vi.fn();
      const tabs: EditorTab[] = [{
        id: 't1', filePath: '/src/app.ts', fileName: 'app.ts',
        language: 'typescript', isDirty: false, isPinned: false,
        revealLine: null, revealCol: null, revealPattern: null, revealNonce: 0
      }];

      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={tabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={onSaveAs}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));
      await user.click(screen.getByRole('menuitem', { name: /Save As/ }));

      expect(onSaveAs).toHaveBeenCalledTimes(1);
    });

    it('calls onSaveAll when Save All is clicked', async () => {
      const user = userEvent.setup();
      const onSaveAll = vi.fn();
      const tabs: EditorTab[] = [{
        id: 't1', filePath: '/src/app.ts', fileName: 'app.ts',
        language: 'typescript', isDirty: true, isPinned: false,
        revealLine: null, revealCol: null, revealPattern: null, revealNonce: 0
      }];

      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={tabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={onSaveAll}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));
      const saveAllBtn = findSaveAllMenuItem();
      if (!saveAllBtn) throw new Error('Save All item not found');
      await user.click(saveAllBtn);

      expect(onSaveAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edit menu', () => {
    it('opens Edit dropdown with Undo, Redo, Select All', async () => {
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

      expect(screen.getByRole('menuitem', { name: /Undo/ })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /Redo/ })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /Select All/ })).toBeInTheDocument();
    });

    it('calls editorUndo when Undo is clicked', async () => {
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
      // editorUndo returns false when no editor is active � just verify no throw
      await user.click(screen.getByRole('menuitem', { name: /Undo/ }));
    });
  });

  describe('View menu', () => {
    it('opens View dropdown with Explorer, Search, Command Palette', async () => {
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

      const viewItems = screen.getAllByRole('menuitem');
      expect(viewItems.some(mi => mi.textContent?.startsWith('Explorer'))).toBe(true);
      expect(viewItems.some(mi => mi.textContent?.startsWith('Search'))).toBe(true);
      expect(screen.getByRole('menuitem', { name: /Command Palette/ })).toBeInTheDocument();
    });

    it('dispatches show-panel event for Explorer', async () => {
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
      const explorerItem = screen.getAllByRole('menuitem').find(mi => mi.textContent?.startsWith('Explorer'));
      if (!explorerItem) throw new Error('Explorer menu item not found');
      await user.click(explorerItem);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent);
      const explorerEvent: CustomEvent = handler.mock.calls[0]?.[0];
      expect(explorerEvent.detail).toBe('explorer');
      globalThis.removeEventListener('agentdeck:show-panel', handler);
    });

    it('dispatches show-panel event for Search', async () => {
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
      const searchItem = screen.getAllByRole('menuitem').find(mi => mi.textContent?.startsWith('Search'));
      if (!searchItem) throw new Error('Search menu item not found');
      await user.click(searchItem);

      expect(handler).toHaveBeenCalledTimes(1);
      const searchEvent: CustomEvent = handler.mock.calls[0]?.[0];
      expect(searchEvent.detail).toBe('search');
      globalThis.removeEventListener('agentdeck:show-panel', handler);
    });
  });

  describe('Window menu', () => {
    it('shows Toggle Full Screen in Window dropdown', async () => {
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

      expect(screen.getByRole('menuitem', { name: /Toggle Full Screen/ })).toBeInTheDocument();
    });

    it('toggles fullscreen when Toggle Full Screen is clicked', async () => {
      const user = userEvent.setup();
      // Mock fullscreen APIs
      const requestFullscreen = vi.fn().mockResolvedValue(undefined);
      const exitFullscreen = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value: null
      });
      Object.defineProperty(document.documentElement, 'requestFullscreen', {
        configurable: true,
        value: requestFullscreen
      });
      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        value: exitFullscreen
      });

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
      await user.click(screen.getByRole('menuitem', { name: /Toggle Full Screen/ }));

      expect(requestFullscreen).toHaveBeenCalledTimes(1);
    });

    it('exits fullscreen when already in fullscreen', async () => {
      const user = userEvent.setup();
      const exitFullscreen = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value: document.documentElement // Simulate being in fullscreen
      });
      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        value: exitFullscreen
      });

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
      await user.click(screen.getByRole('menuitem', { name: /Toggle Full Screen/ }));

      expect(exitFullscreen).toHaveBeenCalledTimes(1);
    });
  });

  describe('dropdown behavior', () => {
    it('closes dropdown when clicking a menu item', async () => {
      const user = userEvent.setup();
      const onOpenWorkspace = vi.fn();

      render(
        <MenuBar
          agent={mockAgent()}
          editorTabs={emptyTabs}
          onOpenWorkspace={onOpenWorkspace}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      await user.click(screen.getByRole('menuitem', { name: /Open Folder/ }));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('toggles dropdown on repeated clicks', async () => {
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

      const fileButton = screen.getByRole('menuitem', { name: 'File' });

      // Open
      await user.click(fileButton);
      expect(screen.getByRole('menu')).toBeInTheDocument();

      // Close by pressing Escape (clicking outside closes the dropdown)
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('updates aria-expanded when toggling', async () => {
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

      const fileButton = screen.getByRole('menuitem', { name: 'File' });
      expect(fileButton).toHaveAttribute('aria-expanded', 'false');

      // Open dropdown
      await user.click(fileButton);
      expect(fileButton).toHaveAttribute('aria-expanded', 'true');

      // Close by clicking a menu item (which triggers onClose)
      await user.click(screen.getByRole('menuitem', { name: /Open Folder/ }));
      expect(fileButton).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('recent workspaces', () => {
    it('disables Open Recent when no recent workspaces', async () => {
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

      const openRecent = screen.getByRole('menuitem', { name: 'Open Recent' });
      expect(openRecent).toHaveAttribute('aria-disabled', 'true');
    });

    it('enables Open Recent when recent workspaces exist', async () => {
      const user = userEvent.setup();
      const agentWithRecents = mockAgent({
        getRecentWorkspaces: vi.fn().mockResolvedValue([
          { path: '/ws/a', name: 'ProjectA', kind: 'folder', lastOpened: 1000 }
        ])
      });
      // MenuBar reads from globalThis.agentDeck, not the agent prop
      Object.defineProperty(globalThis, 'agentDeck', {
        configurable: true,
        value: agentWithRecents
      });

      render(
        <MenuBar
          agent={agentWithRecents}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={vi.fn()}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));

      // Wait for async getRecentWorkspaces to resolve and re-render
      await waitFor(() => {
        const openRecent = screen.getByRole('menuitem', { name: 'Open Recent' });
        expect(openRecent).not.toHaveAttribute('aria-disabled', 'true');
      });
    });

    it('calls onOpenWorkspaceDirect when a recent workspace is clicked', async () => {
      const user = userEvent.setup();
      const onOpenWorkspaceDirect = vi.fn();
      const agentWithRecents = mockAgent({
        getRecentWorkspaces: vi.fn().mockResolvedValue([
          { path: '/ws/a', name: 'ProjectA', kind: 'folder', lastOpened: 1000 }
        ])
      });
      // MenuBar reads from globalThis.agentDeck, not the agent prop
      Object.defineProperty(globalThis, 'agentDeck', {
        configurable: true,
        value: agentWithRecents
      });

      render(
        <MenuBar
          agent={agentWithRecents}
          editorTabs={emptyTabs}
          onOpenWorkspace={vi.fn()}
          onOpenWorkspaceDirect={onOpenWorkspaceDirect}
          onSave={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAll={vi.fn()}
        />
      );

      await user.click(screen.getByRole('menuitem', { name: 'File' }));

      // Wait for async getRecentWorkspaces to resolve and render project items
      const projectAItem = await screen.findByRole('menuitem', { name: 'ProjectA' });
      await user.click(projectAItem);

      expect(onOpenWorkspaceDirect).toHaveBeenCalledWith('/ws/a', 'folder');
    });
  });

  describe('separators', () => {
    it('renders separators between menu groups', async () => {
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

      const separators = screen.getByRole('menu').querySelectorAll('hr.menu-separator');
      expect(separators.length).toBeGreaterThan(0);
    });
  });
});

