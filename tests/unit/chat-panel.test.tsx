import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AgentDeckPreloadApi, ChatStreamEvent, ChatTabState } from '@agentdeck/shared';
import { ChatPanel } from '../../packages/workbench/src/chat/ChatPanel';

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

interface MockAgentExtras {
  __emitStream: (tabId: string, event: ChatStreamEvent) => void;
  __emitTabsChanged: (tabs: readonly ChatTabState[]) => void;
}

function createMockAgentWithStream(): AgentDeckPreloadApi & MockAgentExtras {
  const onChatStreamHandlers: Array<(tabId: string, event: ChatStreamEvent) => void> = [];
  const onChatTabsChangeHandlers: Array<(tabs: readonly ChatTabState[]) => void> = [];

  const agent = {
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
    onChatStream: vi.fn().mockImplementation((handler: (tabId: string, event: ChatStreamEvent) => void) => {
      onChatStreamHandlers.push(handler);
      return () => {
        const idx = onChatStreamHandlers.indexOf(handler);
        if (idx >= 0) onChatStreamHandlers.splice(idx, 1);
      };
    }),
    onChatTabsChange: vi.fn().mockImplementation((handler: (tabs: readonly ChatTabState[]) => void) => {
      onChatTabsChangeHandlers.push(handler);
      return () => {
        const idx = onChatTabsChangeHandlers.indexOf(handler);
        if (idx >= 0) onChatTabsChangeHandlers.splice(idx, 1);
      };
    }),
    versions: { chrome: 'test', electron: 'test', node: 'test' },
    __emitStream: (tabId: string, event: ChatStreamEvent) => {
      for (const handler of onChatStreamHandlers) handler(tabId, event);
    },
    __emitTabsChanged: (tabs: readonly ChatTabState[]) => {
      for (const handler of onChatTabsChangeHandlers) handler(tabs);
    }
  } as unknown as AgentDeckPreloadApi & MockAgentExtras;

  return agent;
}

function createTab(overrides: Partial<ChatTabState> = {}): ChatTabState {
  return {
    id: 'test-tab',
    title: 'Test Chat',
    messages: [],
    activeModel: 'default',
    activeProvider: 'ollama',
    isStreaming: false,
    ...overrides
  };
}

describe('ChatPanel', () => {
  it('renders empty chat panel', () => {
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    expect(screen.getByLabelText('Chat message input')).toBeInTheDocument();
    expect(screen.getByLabelText('Send message')).toBeInTheDocument();
  });

  it('renders user and assistant messages', () => {
    const agent = createMockAgent();
    const tab = createTab({
      messages: [
        { role: 'user', content: 'Hello', timestamp: 1000 },
        { role: 'assistant', content: 'Hi there!', timestamp: 2000 }
      ]
    });

    render(<ChatPanel agent={agent} tab={tab} />);

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('sends message on button click', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    const input = screen.getByLabelText('Chat message input');
    await user.type(input, 'Hello AI');
    await user.click(screen.getByLabelText('Send message'));

    expect(agent.sendMessage).toHaveBeenCalledWith('test-tab', 'Hello AI');
  });

  it('sends message on Enter key', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    const input = screen.getByLabelText('Chat message input');
    await user.type(input, 'Hello AI{enter}');

    expect(agent.sendMessage).toHaveBeenCalledWith('test-tab', 'Hello AI');
  });

  it('does not send on Shift+Enter', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    const input = screen.getByLabelText('Chat message input');
    await user.type(input, 'Hello{Shift>}{enter}{/Shift}');

    expect(agent.sendMessage).not.toHaveBeenCalled();
  });

  it('disables send button when input is empty', () => {
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    expect(screen.getByLabelText('Send message')).toBeDisabled();
  });

  it('shows stop button when streaming', () => {
    const agent = createMockAgent();
    const tab = createTab({ isStreaming: true });

    render(<ChatPanel agent={agent} tab={tab} />);

    expect(screen.getByLabelText('Stop streaming')).toBeInTheDocument();
  });

  it('calls stopStreaming on stop button click', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab({ isStreaming: true });

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByLabelText('Stop streaming'));

    expect(agent.stopStreaming).toHaveBeenCalledWith('test-tab');
  });

  it('disables input when streaming', () => {
    const agent = createMockAgent();
    const tab = createTab({ isStreaming: true });

    render(<ChatPanel agent={agent} tab={tab} />);

    expect(screen.getByLabelText('Chat message input')).toBeDisabled();
  });

  it('displays error message', () => {
    const agent = createMockAgent();
    const tab = createTab({ error: 'Something went wrong' });

    render(<ChatPanel agent={agent} tab={tab} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('renders streaming content', () => {
    const agent = createMockAgent();
    const tab = createTab({ isStreaming: true });

    const { rerender } = render(<ChatPanel agent={agent} tab={tab} />);

    // Simulate streaming by re-rendering with updated tab
    rerender(<ChatPanel agent={agent} tab={tab} />);

    // The streaming content is shown separately from messages
    // This test verifies the component renders without errors during streaming
    expect(screen.getByLabelText('Stop streaming')).toBeInTheDocument();
  });

  it('accumulates chunk events into streaming content', async () => {
    const agent = createMockAgentWithStream();
    const tab = createTab({ isStreaming: true });

    render(<ChatPanel agent={agent} tab={tab} />);

    // Emit chunks synchronously inside act
    act(() => { agent.__emitStream('test-tab', { type: 'chunk', content: 'Hello' }); });
    act(() => { agent.__emitStream('test-tab', { type: 'chunk', content: ' world' }); });
    act(() => { agent.__emitStream('test-tab', { type: 'chunk', content: '!' }); });

    expect(screen.getByText('Hello world!')).toBeInTheDocument();

    // Emit done — clears streaming content
    act(() => { agent.__emitStream('test-tab', { type: 'done' }); });

    expect(screen.queryByText('Hello world!')).not.toBeInTheDocument();
  });

  it('renders tool_use events during streaming', async () => {
    const agent = createMockAgentWithStream();
    const tab = createTab({ isStreaming: true });

    render(<ChatPanel agent={agent} tab={tab} />);

    act(() => {
      agent.__emitStream('test-tab', { type: 'chunk', content: 'Let me check' });
      agent.__emitStream('test-tab', {
        type: 'tool_use',
        toolCall: {
          id: 'tc-1',
          type: 'function',
          function: { name: 'search', arguments: '{"query":"test"}' }
        }
      });
    });

    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByText('Let me check')).toBeInTheDocument();
  });

  it('clears streaming content on error event', async () => {
    const agent = createMockAgentWithStream();
    const tab = createTab({ isStreaming: true });

    render(<ChatPanel agent={agent} tab={tab} />);

    // Emit partial content
    act(() => { agent.__emitStream('test-tab', { type: 'chunk', content: 'Partial' }); });
    expect(screen.getByText('Partial')).toBeInTheDocument();

    // Emit error — clears streaming and shows error
    act(() => { agent.__emitStream('test-tab', { type: 'error', message: 'Connection lost' }); });

    expect(screen.queryByText('Partial')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
  });

  it('syncs messages when tabs-changed arrives', async () => {
    const agent = createMockAgentWithStream();
    const tab = createTab({ isStreaming: true });

    render(<ChatPanel agent={agent} tab={tab} />);

    // Emit streaming content and done
    act(() => {
      agent.__emitStream('test-tab', { type: 'chunk', content: 'Response' });
      agent.__emitStream('test-tab', { type: 'done' });
    });

    // After done, streaming content is cleared
    expect(screen.queryByText('Response')).not.toBeInTheDocument();

    // Simulate tabs-changed with updated messages
    const updatedMessages = [
      { role: 'user' as const, content: 'Hello', timestamp: 1000 },
      { role: 'assistant' as const, content: 'Response', timestamp: 2000 }
    ];
    act(() => { agent.__emitTabsChanged([{ ...tab, messages: updatedMessages }]); });

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Response')).toBeInTheDocument();
  });

  it('ignores empty chunk content', async () => {
    const agent = createMockAgentWithStream();
    const tab = createTab({ isStreaming: true });

    render(<ChatPanel agent={agent} tab={tab} />);

    act(() => {
      agent.__emitStream('test-tab', { type: 'chunk', content: '' });
      agent.__emitStream('test-tab', { type: 'chunk', content: 'Valid' });
    });

    expect(screen.getByText('Valid')).toBeInTheDocument();
  });
});
