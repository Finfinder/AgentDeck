import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentDeckPreloadApi, ChatTabState } from '@agentdeck/shared';
import { useChatStore } from '../../packages/workbench/src/chat/useChatStore';

let tabIdCounter = 0;

function createMockAgent(): AgentDeckPreloadApi {
  let tabs: ChatTabState[] = [];

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
    listChatTabs: vi.fn().mockImplementation(async () => tabs),
    createChatTab: vi.fn().mockImplementation(async (title?: string): Promise<ChatTabState> => {
      tabIdCounter += 1;
      const tab: ChatTabState = {
        id: `chat-tab-${tabIdCounter}`,
        title: title ?? 'New Chat',
        messages: [],
        activeModel: 'default',
        activeProvider: 'ollama' as const,
        isStreaming: false
      };
      tabs = [...tabs, tab];
      return tab;
    }),
    closeChatTab: vi.fn().mockImplementation(async (tabId: string) => {
      tabs = tabs.filter(t => t.id !== tabId);
    }),
    sendMessage: vi.fn().mockResolvedValue({ status: 'ok' }),
    stopStreaming: vi.fn().mockResolvedValue(undefined),
    onChatStream: vi.fn().mockReturnValue(() => undefined),
    onChatTabsChange: vi.fn().mockImplementation(() => () => undefined),
    versions: { chrome: 'test', electron: 'test', node: 'test' }
  } as unknown as AgentDeckPreloadApi;
}

describe('useChatStore', () => {
  it('returns empty tabs initially', () => {
    const agent = createMockAgent();
    const { result } = renderHook(() => useChatStore(agent));
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBeNull();
  });

  it('creates a new chat tab', async () => {
    const agent = createMockAgent();
    const { result } = renderHook(() => useChatStore(agent));

    await act(async () => { await result.current.createTab('Test Chat'); });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0]!.title).toBe('Test Chat');
    expect(result.current.activeTabId).toBe(result.current.tabs[0]!.id);
  });

  it('closes a chat tab', async () => {
    const agent = createMockAgent();
    const { result } = renderHook(() => useChatStore(agent));

    await act(async () => { await result.current.createTab('Test'); });
    const tabId = result.current.tabs[0]!.id;

    await act(async () => { await result.current.closeTab(tabId); });

    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeTabId).toBeNull();
  });

  it('sets active tab id', () => {
    const agent = createMockAgent();
    const { result } = renderHook(() => useChatStore(agent));

    act(() => { result.current.setActiveTabId('tab-1'); });
    expect(result.current.activeTabId).toBe('tab-1');
  });

  it('sends a message', async () => {
    const agent = createMockAgent();
    const { result } = renderHook(() => useChatStore(agent));

    await act(async () => { await result.current.createTab('Test'); });
    const tabId = result.current.tabs[0]!.id;

    await act(async () => { await result.current.sendMessage(tabId, 'Hello'); });
    expect(agent.sendMessage).toHaveBeenCalledWith(tabId, 'Hello');
  });

  it('stops streaming', async () => {
    const agent = createMockAgent();
    const { result } = renderHook(() => useChatStore(agent));

    await act(async () => { await result.current.createTab('Test'); });
    const tabId = result.current.tabs[0]!.id;

    await act(async () => { await result.current.stopStreaming(tabId); });
    expect(agent.stopStreaming).toHaveBeenCalledWith(tabId);
  });

  it('fetches initial tabs on mount', async () => {
    const existing: ChatTabState[] = [
      { id: 't1', title: 'Chat 1', messages: [], activeModel: 'default', activeProvider: 'ollama', isStreaming: false }
    ];
    const agent = createMockAgent();
    vi.spyOn(agent, 'listChatTabs').mockResolvedValue(existing);

    const { result } = renderHook(() => useChatStore(agent));

    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0]!.title).toBe('Chat 1');
  });

  it('subscribes to tab changes', async () => {
    const agent = createMockAgent();
    vi.spyOn(agent, 'listChatTabs').mockResolvedValue([]);
    vi.spyOn(agent, 'onChatTabsChange').mockReturnValue(() => undefined);

    renderHook(() => useChatStore(agent));

    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(agent.onChatTabsChange).toHaveBeenCalled();
  });

  it('switches active tab when current tab is closed externally', async () => {
    let handler: ((tabs: readonly ChatTabState[]) => void) | undefined;
    const agent = createMockAgent();
    vi.spyOn(agent, 'onChatTabsChange').mockImplementation((h: (tabs: readonly ChatTabState[]) => void) => {
      handler = h;
      return () => {};
    });

    const { result } = renderHook(() => useChatStore(agent));

    await act(async () => { await result.current.createTab('Test'); });
    const tabId = result.current.tabs[0]!.id;
    expect(result.current.activeTabId).toBe(tabId);

    await act(async () => { (handler as (tabs: readonly ChatTabState[]) => void)([]); });
    expect(result.current.activeTabId).toBeNull();
  });

  it('creates multiple tabs', async () => {
    const agent = createMockAgent();
    const { result } = renderHook(() => useChatStore(agent));

    await act(async () => { await result.current.createTab('Tab 1'); });
    await act(async () => { await result.current.createTab('Tab 2'); });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.tabs[0]!.title).toBe('Tab 1');
    expect(result.current.tabs[1]!.title).toBe('Tab 2');
  });

  it('closes active tab and switches to another', async () => {
    const agent = createMockAgent();
    const { result } = renderHook(() => useChatStore(agent));

    await act(async () => { await result.current.createTab('Tab 1'); });
    await act(async () => { await result.current.createTab('Tab 2'); });

    const firstTabId = result.current.tabs[0]!.id;
    await act(async () => { await result.current.closeTab(firstTabId); });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0]!.title).toBe('Tab 2');
  });
});
