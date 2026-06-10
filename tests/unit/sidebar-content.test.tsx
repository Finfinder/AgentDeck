import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AgentDeckPreloadApi, ChatTabState, WorkspaceModel, WorkspaceSelection } from '@agentdeck/shared';
import type { EditorStore } from '../../packages/workbench/src/editor/useEditorStore';
import type { ChatStore } from '../../packages/workbench/src/chat/useChatStore';
import { SidebarContent } from '../../packages/workbench/src/SidebarContent';

function createMockAgent(): AgentDeckPreloadApi {
  return {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }),
    getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    startOAuth: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    signOut: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    onIdentityChange: vi.fn().mockReturnValue(() => undefined),
    onDeviceCode: vi.fn().mockReturnValue(() => undefined),
    onIdentityWarning: vi.fn().mockReturnValue(() => undefined),
    getThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }),
    setThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }),
    selectWorkspaceEntry: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    openWorkspace: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'Test' }),
    listDirectory: vi.fn().mockResolvedValue({ path: '', entries: [] }),
    searchFiles: vi.fn().mockResolvedValue([]),
    getRecentWorkspaces: vi.fn().mockResolvedValue([]),
    onFsEvent: vi.fn().mockReturnValue(() => undefined),
    readFile: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'Test' }),
    writeFile: vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'Test' }),
    markBufferDirty: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'Test' }),
    renameFile: vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'Test' }),
    getEditorDiagnostics: vi.fn().mockResolvedValue([]),
    applyWorkspaceEdit: vi.fn().mockResolvedValue({ status: 'error', code: 'UNKNOWN', message: 'Test' }),
    showDiff: vi.fn().mockResolvedValue({ status: 'error', code: 'UNKNOWN', message: 'Test' }),
    showSaveDialog: vi.fn().mockResolvedValue(null),
    toggleDevTools: vi.fn().mockResolvedValue(undefined),
    getModelGatewayConfig: vi.fn().mockResolvedValue({ providers: [], activeProvider: 'ollama', activeModel: 'default' }),
    listChatTabs: vi.fn().mockResolvedValue([]),
    createChatTab: vi.fn().mockResolvedValue({ id: 'test', title: 'Test', messages: [], activeModel: 'default', activeProvider: 'ollama', isStreaming: false }),
    closeChatTab: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ status: 'ok' }),
    stopStreaming: vi.fn().mockResolvedValue(undefined),
    onChatStream: vi.fn().mockReturnValue(() => undefined),
    onChatTabsChange: vi.fn().mockReturnValue(() => undefined),
    versions: { chrome: 'test', electron: 'test', node: 'test' }
  } as unknown as AgentDeckPreloadApi;
}

function createMockEditorStore(): EditorStore {
  return {
    tabs: [],
    activeTabId: null,
    openTab: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    setTabDirty: vi.fn(),
    setTabPinned: vi.fn(),
    getTabByPath: vi.fn().mockReturnValue(undefined)
  };
}

function createMockChatStore(tabs: ChatTabState[] = []): ChatStore {
  return {
    tabs,
    activeTabId: tabs.length > 0 ? tabs[0]!.id : null,
    setActiveTabId: vi.fn(),
    createTab: vi.fn(),
    closeTab: vi.fn(),
    sendMessage: vi.fn(),
    stopStreaming: vi.fn()
  };
}

const defaultProps = {
  activePanel: 'explorer' as const,
  agent: createMockAgent(),
  workspaceModel: null,
  workspaceSelection: null,
  editorStore: createMockEditorStore(),
  chatStore: createMockChatStore(),
  onOpenWorkspace: vi.fn()
};

describe('SidebarContent', () => {
  describe('Explorer panel', () => {
    it('renders workspace actions', () => {
      render(<SidebarContent {...defaultProps} activePanel="explorer" />);

      expect(screen.getByRole('button', { name: /open workspace/i })).toBeVisible();
      expect(screen.getByRole('button', { name: /open folder/i })).toBeVisible();
    });

    it('renders no workspace message when workspace is not open', () => {
      render(<SidebarContent {...defaultProps} activePanel="explorer" />);

      expect(screen.getByText('No workspace opened.')).toBeVisible();
    });

    it('renders workspace error message when workspace fails to open', () => {
      const props = {
        ...defaultProps,
        activePanel: 'explorer' as const,
        workspaceModel: {
          status: 'error',
          code: 'FILE_NOT_FOUND',
          message: 'Workspace file not found.'
        } as WorkspaceModel,
        workspaceSelection: {
          status: 'selected',
          kind: 'workspace-file' as const,
          path: '/test',
          name: 'test'
        } as WorkspaceSelection
      };

      render(<SidebarContent {...props} />);

      expect(screen.getByText('Workspace file not found.')).toBeVisible();
    });
  });

  describe('Chat panel', () => {
    it('renders New Chat button', () => {
      render(<SidebarContent {...defaultProps} activePanel="chat" />);

      expect(screen.getByRole('button', { name: /new chat/i })).toBeVisible();
    });

    it('renders chat sidebar list when tabs exist', () => {
      const tabs: ChatTabState[] = [
        { id: 'tab-1', title: 'My Chat', messages: [], activeModel: 'default', activeProvider: 'ollama', isStreaming: false }
      ];
      const chatStore = createMockChatStore(tabs);

      render(<SidebarContent {...defaultProps} activePanel="chat" chatStore={chatStore} />);

      expect(screen.getByText('My Chat')).toBeVisible();
    });

    it('calls createTab when New Chat button in sidebar is clicked', async () => {
      const user = userEvent.setup();
      const chatStore = createMockChatStore();

      render(<SidebarContent {...defaultProps} activePanel="chat" chatStore={chatStore} />);

      await user.click(screen.getByRole('button', { name: /new chat/i }));
      expect(chatStore.createTab).toHaveBeenCalled();
    });

    it('calls setActiveTabId when sidebar item is clicked', async () => {
      const user = userEvent.setup();
      const tabs: ChatTabState[] = [
        { id: 'tab-1', title: 'My Chat', messages: [], activeModel: 'default', activeProvider: 'ollama', isStreaming: false }
      ];
      const chatStore = createMockChatStore(tabs);

      render(<SidebarContent {...defaultProps} activePanel="chat" chatStore={chatStore} />);

      await user.click(screen.getByText('My Chat'));
      expect(chatStore.setActiveTabId).toHaveBeenCalledWith('tab-1');
    });

    it('calls onOpenWorkspace when Open Folder button is clicked', async () => {
      const user = userEvent.setup();
      const onOpenWorkspace = vi.fn();
      const props = { ...defaultProps, activePanel: 'explorer' as const, onOpenWorkspace };

      render(<SidebarContent {...props} />);

      await user.click(screen.getByRole('button', { name: /open folder/i }));
      expect(onOpenWorkspace).toHaveBeenCalledWith('folder');
    });

    it('calls onOpenWorkspace when Open Workspace button is clicked', async () => {
      const user = userEvent.setup();
      const onOpenWorkspace = vi.fn();
      const props = { ...defaultProps, activePanel: 'explorer' as const, onOpenWorkspace };

      render(<SidebarContent {...props} />);

      await user.click(screen.getByRole('button', { name: /open workspace/i }));
      expect(onOpenWorkspace).toHaveBeenCalledWith('workspace-file');
    });
  });

  describe('Search panel', () => {
    it('renders workspace actions', () => {
      render(<SidebarContent {...defaultProps} activePanel="search" />);

      expect(screen.getByRole('button', { name: /open workspace/i })).toBeVisible();
      expect(screen.getByRole('button', { name: /open folder/i })).toBeVisible();
    });
  });
});
