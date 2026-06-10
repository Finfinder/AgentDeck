import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { AgentDeckPreloadApi, ChatTabState, ModelGatewayConfig } from '@agentdeck/shared';
import { ChatPanel } from '../../packages/workbench/src/chat/ChatPanel';

function createMockAgent(overrides: Partial<AgentDeckPreloadApi> = {}): AgentDeckPreloadApi {
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
    getModelGatewayConfig: vi.fn().mockResolvedValue({
      providers: [
        { id: 'ollama', label: 'Ollama', status: 'ready', baseUrl: 'http://localhost:11434', models: [
          { id: 'llama2', name: 'Llama 2', provider: 'ollama', contextWindow: 4096, supportsTools: false, supportsStreaming: true, supportsEmbeddings: false },
          { id: 'mistral', name: 'Mistral', provider: 'ollama', contextWindow: 8192, supportsTools: false, supportsStreaming: true, supportsEmbeddings: false }
        ]},
        { id: 'openrouter', label: 'OpenRouter', status: 'idle', baseUrl: 'https://openrouter.ai/api/v1', models: [] }
      ],
      activeProvider: 'ollama',
      activeModel: 'llama2'
    }),
    listChatTabs: vi.fn().mockResolvedValue([]),
    createChatTab: vi.fn().mockResolvedValue({ id: 'test', title: 'Test', messages: [], activeModel: 'default', activeProvider: 'ollama', isStreaming: false }),
    closeChatTab: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ status: 'ok' }),
    stopStreaming: vi.fn().mockResolvedValue(undefined),
    onChatStream: vi.fn().mockReturnValue(() => undefined),
    onChatTabsChange: vi.fn().mockReturnValue(() => undefined),
    getApiKey: vi.fn().mockResolvedValue(null),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    deleteApiKey: vi.fn().mockResolvedValue(undefined),
    testConnection: vi.fn().mockResolvedValue({ status: 'ok' }),
    setProviderConfig: vi.fn().mockResolvedValue(undefined),
    getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: 'http://localhost:11434', hasApiKey: false }),
    versions: { chrome: 'test', electron: 'test', node: 'test' },
    ...overrides
  } as unknown as AgentDeckPreloadApi;
}

function createTab(overrides: Partial<ChatTabState> = {}): ChatTabState {
  return {
    id: 'test-tab',
    title: 'Test Chat',
    messages: [],
    activeModel: 'llama2',
    activeProvider: 'ollama',
    isStreaming: false,
    ...overrides
  };
}

describe('ChatPanel — Model Configuration', () => {
  it('renders model config toggle button', async () => {
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /show model configuration/i })).toBeInTheDocument();
    });
  });

  it('shows provider/model summary in header', async () => {
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await waitFor(() => {
      expect(screen.getByText('Ollama / llama2')).toBeInTheDocument();
    });
  });

  it('toggles config panel visibility', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    // Initially collapsed
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /show model configuration/i })).toBeInTheDocument();
    });

    // Expand
    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    // Config panel should be visible
    expect(screen.getByLabelText('Provider')).toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toBeInTheDocument();

    // Collapse
    await user.click(screen.getByRole('button', { name: /hide model configuration/i }));

    expect(screen.queryByLabelText('Provider')).not.toBeInTheDocument();
  });

  it('renders provider dropdown with all providers', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const providerSelect = screen.getByLabelText('Provider') as HTMLSelectElement;
    expect(providerSelect).toBeInTheDocument();
    expect(providerSelect.options.length).toBe(2);
    expect(providerSelect.options[0]!.text).toContain('Ollama');
    expect(providerSelect.options[0]!.text).toContain('ready');
    expect(providerSelect.options[1]!.text).toContain('OpenRouter');
    expect(providerSelect.options[1]!.text).toContain('idle');
  });

  it('renders model dropdown with available models', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement;
    expect(modelSelect).toBeInTheDocument();
    expect(modelSelect.options.length).toBe(2);
    expect(modelSelect.options[0]!.text).toContain('Llama 2');
    expect(modelSelect.options[0]!.text).toContain('4096');
    expect(modelSelect.options[1]!.text).toContain('Mistral');
    expect(modelSelect.options[1]!.text).toContain('8192');
  });

  it('renders "No models available" when provider has no models', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab({ activeProvider: 'openrouter', activeModel: 'default' });

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement;
    expect(modelSelect.options.length).toBe(1);
    expect(modelSelect.options[0]!.text).toBe('No models available');
  });

  it('renders API URL input', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const urlInput = screen.getByLabelText('API URL') as HTMLInputElement;
    expect(urlInput).toBeInTheDocument();
    expect(urlInput.placeholder).toContain('openrouter.ai');
  });

  it('renders API Key input as password field', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const apiKeyInput = screen.getByLabelText('API Key') as HTMLInputElement;
    expect(apiKeyInput).toBeInTheDocument();
    expect(apiKeyInput.type).toBe('password');
  });

  it('renders test connection button', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument();
  });

  it('renders provider status and model count info', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const statusEl = screen.getByText(/status:/i);
    expect(statusEl).toBeInTheDocument();
    expect(screen.getByText(/2 models/i)).toBeInTheDocument();
  });

  it('renders "1 model" (singular) when provider has one model', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent({
      getModelGatewayConfig: vi.fn().mockResolvedValue({
        providers: [
          { id: 'ollama', label: 'Ollama', status: 'ready', baseUrl: '', models: [
            { id: 'llama2', name: 'Llama 2', provider: 'ollama', contextWindow: 4096, supportsTools: false, supportsStreaming: true, supportsEmbeddings: false }
          ]}
        ],
        activeProvider: 'ollama',
        activeModel: 'llama2'
      } as ModelGatewayConfig)
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    expect(screen.getByText(/1 model$/i)).toBeInTheDocument();
  });

  it('shows "Unknown" when provider not found', async () => {
    const agent = createMockAgent({
      getModelGatewayConfig: vi.fn().mockResolvedValue({
        providers: [],
        activeProvider: 'ollama',
        activeModel: 'default'
      } as ModelGatewayConfig)
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await waitFor(() => {
      expect(screen.getByText('Unknown / llama2')).toBeInTheDocument();
    });
  });

  it('disables provider and model selects when streaming', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab({ isStreaming: true });

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    expect(screen.getByLabelText('Provider')).toBeDisabled();
    expect(screen.getByLabelText('Model')).toBeDisabled();
  });

  it('disables test connection button when no base URL', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent({
      getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: '', hasApiKey: false })
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    // Test button should be disabled when URL is empty
    const testBtn = screen.getByRole('button', { name: /test connection/i });
    expect(testBtn).toBeDisabled();
  });

  it('calls testConnection when test button is clicked with URL', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent({
      getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: '', hasApiKey: false }),
      testConnection: vi.fn().mockResolvedValue({ status: 'ok' })
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    // Type a URL
    const urlInput = screen.getByLabelText('API URL');
    await user.type(urlInput, 'http://localhost:11434');

    // Click test
    const testBtn = screen.getByRole('button', { name: /test connection/i });
    await user.click(testBtn);

    expect(agent.testConnection).toHaveBeenCalledWith('ollama', 'http://localhost:11434');
  });

  it('calls setApiKey when save button is clicked', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    // Type API key
    const apiKeyInput = screen.getByLabelText('API Key');
    await user.type(apiKeyInput, 'sk-test-key');

    // Click save
    const saveBtn = screen.getByRole('button', { name: /save api key/i });
    await user.click(saveBtn);

    expect(agent.setApiKey).toHaveBeenCalledWith('ollama', 'sk-test-key');
  });

  it('calls deleteApiKey when delete button is clicked', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent({
      getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: 'http://localhost:11434', hasApiKey: false })
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    // Type a real API key first
    const apiKeyInput = screen.getByLabelText('API Key');
    await user.type(apiKeyInput, 'sk-real-key');

    // Save the key
    const saveBtn = screen.getByRole('button', { name: /save api key/i });
    await waitFor(() => expect(saveBtn).toBeEnabled());
    await user.click(saveBtn);

    // Now delete button should be enabled (key is '••••••••' after save)
    const deleteBtn = screen.getByRole('button', { name: /delete api key/i });
    await user.click(deleteBtn);

    expect(agent.deleteApiKey).toHaveBeenCalledWith('ollama');
  });

  it('toggles API key visibility', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const apiKeyInput = screen.getByLabelText('API Key') as HTMLInputElement;
    expect(apiKeyInput.type).toBe('password');

    // Toggle visibility
    const toggleBtn = screen.getByRole('button', { name: /show api key/i });
    await user.click(toggleBtn);

    expect(apiKeyInput.type).toBe('text');

    // Toggle back
    const hideBtn = screen.getByRole('button', { name: /hide api key/i });
    await user.click(hideBtn);

    expect(apiKeyInput.type).toBe('password');
  });

  it('disables save button when API key is empty', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const saveBtn = screen.getByRole('button', { name: /save api key/i });
    await waitFor(() => expect(saveBtn).toBeDisabled());
  });

  it('disables save button when API key is masked (already saved)', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent({
      getApiKey: vi.fn().mockResolvedValue('sk-existing')
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const saveBtn = screen.getByRole('button', { name: /save api key/i });
    await waitFor(() => expect(saveBtn).toBeDisabled());
  });

  // --- API URL persist tests ---

  it('renders save URL button next to API URL input', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent();
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    expect(screen.getByRole('button', { name: /save api url/i })).toBeInTheDocument();
  });

  it('disables save URL button when URL is unchanged from saved value', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent({
      getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: 'http://localhost:11434', hasApiKey: false })
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const saveUrlBtn = screen.getByRole('button', { name: /save api url/i });
    await waitFor(() => expect(saveUrlBtn).toBeDisabled());
  });

  it('enables save URL button when URL is changed', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent({
      getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: 'http://localhost:11434', hasApiKey: false })
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const urlInput = screen.getByLabelText('API URL');
    await user.clear(urlInput);
    await user.type(urlInput, 'http://custom:8080');

    const saveUrlBtn = screen.getByRole('button', { name: /save api url/i });
    await waitFor(() => expect(saveUrlBtn).toBeEnabled());
  });

  it('calls setProviderConfig when save URL button is clicked', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent({
      getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: 'http://localhost:11434', hasApiKey: false }),
      setProviderConfig: vi.fn().mockResolvedValue(undefined)
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const urlInput = screen.getByLabelText('API URL');
    await user.clear(urlInput);
    await user.type(urlInput, 'http://custom:8080');

    const saveUrlBtn = screen.getByRole('button', { name: /save api url/i });
    await waitFor(() => expect(saveUrlBtn).toBeEnabled());
    await user.click(saveUrlBtn);

    expect(agent.setProviderConfig).toHaveBeenCalledWith('ollama', 'http://custom:8080');
  });

  it('disables save URL button after saving', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent({
      getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: 'http://localhost:11434', hasApiKey: false }),
      setProviderConfig: vi.fn().mockResolvedValue(undefined)
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    // Change URL
    const urlInput = screen.getByLabelText('API URL');
    await user.clear(urlInput);
    await user.type(urlInput, 'http://custom:8080');

    // Save
    const saveUrlBtn = screen.getByRole('button', { name: /save api url/i });
    await waitFor(() => expect(saveUrlBtn).toBeEnabled());
    await user.click(saveUrlBtn);

    // Button should be disabled again after saving
    await waitFor(() => expect(saveUrlBtn).toBeDisabled());
  });

  it('persists URL via setProviderConfig before testing connection when URL changed', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent({
      getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: 'http://localhost:11434', hasApiKey: false }),
      setProviderConfig: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn().mockResolvedValue({ status: 'ok' })
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    // Change URL
    const urlInput = screen.getByLabelText('API URL');
    await user.clear(urlInput);
    await user.type(urlInput, 'http://custom:8080');

    // Click test
    const testBtn = screen.getByRole('button', { name: /test connection/i });
    await user.click(testBtn);

    // setProviderConfig should be called before testConnection
    expect(agent.setProviderConfig).toHaveBeenCalledWith('ollama', 'http://custom:8080');
    expect(agent.testConnection).toHaveBeenCalledWith('ollama', 'http://custom:8080');

    // Verify call order: setProviderConfig before testConnection
    const setCallOrder = (agent.setProviderConfig as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const testCallOrder = (agent.testConnection as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    expect(setCallOrder).toBeLessThan(testCallOrder);
  });

  it('does not call setProviderConfig before test when URL is unchanged', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent({
      getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: 'http://localhost:11434', hasApiKey: false }),
      setProviderConfig: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn().mockResolvedValue({ status: 'ok' })
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    // Click test without changing URL
    const testBtn = screen.getByRole('button', { name: /test connection/i });
    await user.click(testBtn);

    // setProviderConfig should NOT be called since URL didn't change
    expect(agent.setProviderConfig).not.toHaveBeenCalled();
    expect(agent.testConnection).toHaveBeenCalledWith('ollama', 'http://localhost:11434');
  });

  it('disables save URL button when URL is empty', async () => {
    const user = userEvent.setup();
    const agent = createMockAgent({
      getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: '', hasApiKey: false })
    } as Partial<AgentDeckPreloadApi>);
    const tab = createTab();

    render(<ChatPanel agent={agent} tab={tab} />);

    await user.click(screen.getByRole('button', { name: /show model configuration/i }));

    const saveUrlBtn = screen.getByRole('button', { name: /save api url/i });
    await waitFor(() => expect(saveUrlBtn).toBeDisabled());
  });
});
