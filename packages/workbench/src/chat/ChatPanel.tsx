import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AgentDeckPreloadApi,
  ChatStreamEvent,
  ChatTabState,
  ModelGatewayConfig,
  ModelInfo,
  ToolCall
} from '@agentdeck/shared';

interface ChatPanelProps {
  readonly agent: AgentDeckPreloadApi;
  readonly tab: ChatTabState;
}

interface ProviderConfigState {
  baseUrl: string;
  apiKey: string;
  showApiKey: boolean;
  testing: boolean;
  testResult: { status: 'ok' | 'error'; message?: string } | null;
}

export function ChatPanel({ agent, tab }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState(tab.messages);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingToolCalls, setStreamingToolCalls] = useState<readonly ToolCall[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [config, setConfig] = useState<ModelGatewayConfig | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfigState>>({});
  // Track the last persisted URL per provider to detect unsaved changes
  const savedUrlsRef = useRef<Record<string, string>>({});
  const [savingProviders, setSavingProviders] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const fetchProviderConfigs = useCallback(async (
    nextConfig: ModelGatewayConfig,
    currentConfigs: Record<string, ProviderConfigState>
  ): Promise<Record<string, ProviderConfigState>> => {
    const configs: Record<string, ProviderConfigState> = {};
    const initial: Record<string, string> = {};

    for (const provider of nextConfig.providers) {
      const providerConfig = await agent.getProviderConfig?.(provider.id) ?? { baseUrl: '', hasApiKey: false };
      const existing = currentConfigs[provider.id];

      configs[provider.id] = {
        baseUrl: providerConfig.baseUrl,
        apiKey: providerConfig.hasApiKey ? 'ÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇó' : (existing?.apiKey ?? ''),
        showApiKey: existing?.showApiKey ?? false,
        testing: existing?.testing ?? false,
        testResult: existing?.testResult ?? null
      };
      initial[provider.id] = providerConfig.baseUrl;
    }

    savedUrlsRef.current = initial;
    return configs;
  }, [agent]);

  const loadProviderConfigs = useCallback(async (
    nextConfig: ModelGatewayConfig,
    currentConfigs: Record<string, ProviderConfigState>
  ): Promise<void> => {
    setProviderConfigs(await fetchProviderConfigs(nextConfig, currentConfigs));
  }, [fetchProviderConfigs]);

  // Fetch gateway config on mount
  useEffect(() => {
    agent.getModelGatewayConfig()
      .then(async (gatewayConfig) => {
        setConfig(gatewayConfig);
        await loadProviderConfigs(gatewayConfig, {});
      })
      .catch(() => {});
  }, [agent, loadProviderConfigs]);

  // Sync messages from store
  useEffect(() => {
    setLocalMessages(tab.messages);
  }, [tab.messages]);

  // Subscribe to stream events for this tab
  useEffect(() => {
    if (!agent.onChatStream) return;

    const unsub = agent.onChatStream((tabId: string, event: ChatStreamEvent) => {
      if (tabId !== tab.id) return;

      if (event.type === 'chunk') {
        const content = typeof event.content === 'string' ? event.content : '';
        if (content.length > 0) {
          setStreamingContent(prev => prev + content);
        }
        setStreamError(null);
      } else if (event.type === 'tool_use') {
        setStreamingToolCalls(prev => [...prev, event.toolCall]);
      } else if (event.type === 'error') {
        setStreamingContent('');
        setStreamingToolCalls([]);
        setStreamError(event.message);
      } else if (event.type === 'info') {
        // Info events (e.g. retry notifications) don't affect streaming state
      } else if (event.type === 'done') {
        setStreamingContent('');
        setStreamingToolCalls([]);
      }
    });

    return unsub;
  }, [agent, tab.id]);

  // Subscribe to tab changes to sync messages.
  // The gateway emits tabs-changed BEFORE done/error, so by the time
  // tabs-changed arrives, tab.messages already contains the new assistant
  // message. We sync localMessages immediately and let the done/error
  // stream event clear the streaming state ÔÇö no duplication occurs.
  useEffect(() => {
    if (!agent.onChatTabsChange) return;

    const unsub = agent.onChatTabsChange((tabs) => {
      const updatedTab = (tabs as ChatTabState[]).find(t => t.id === tab.id);
      if (updatedTab) {
        setLocalMessages(updatedTab.messages);
      }
    });

    return unsub;
  }, [agent, tab.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages, streamingContent, streamingToolCalls]);

  const currentProvider = config?.providers.find(p => p.id === tab.activeProvider);
  const availableModels: readonly ModelInfo[] = currentProvider?.models ?? [];
  const currentConfig = providerConfigs[tab.activeProvider] ?? { baseUrl: '', apiKey: '', showApiKey: false, testing: false, testResult: null };

  const handleProviderChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const providerId = e.target.value;
      await agent.setProviderConfig?.(providerId, providerConfigs[providerId]?.baseUrl ?? '');
      await agent.setActiveProvider?.(tab.id, providerId);
    },
    [agent, providerConfigs, tab.id]
  );

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const modelId = e.target.value;
      agent.setActiveModel?.(tab.id, modelId);
    },
    [agent, tab.id]
  );

  const handleBaseUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const baseUrl = e.target.value;
      setProviderConfigs(prev => {
        const existing = prev[tab.activeProvider];
        return {
          ...prev,
          [tab.activeProvider]: {
            baseUrl,
            apiKey: existing?.apiKey ?? '',
            showApiKey: existing?.showApiKey ?? false,
            testing: false,
            testResult: null
          }
        };
      });
    },
    [tab.activeProvider]
  );

  const handleSaveBaseUrl = useCallback(async () => {
    const cfg = providerConfigs[tab.activeProvider];
    if (!cfg?.baseUrl) return;

    setSavingProviders(prev => ({ ...prev, [tab.activeProvider]: true }));
    try {
      await agent.setProviderConfig?.(tab.activeProvider, cfg.baseUrl);
      savedUrlsRef.current = { ...savedUrlsRef.current, [tab.activeProvider]: cfg.baseUrl };
    } finally {
      setSavingProviders(prev => ({ ...prev, [tab.activeProvider]: false }));
    }
  }, [agent, tab.activeProvider, providerConfigs]);

  const isBaseUrlUnchanged = useCallback(
    () => {
      const current = providerConfigs[tab.activeProvider]?.baseUrl ?? '';
      const saved = savedUrlsRef.current[tab.activeProvider] ?? '';
      return current === saved;
    },
    [tab.activeProvider, providerConfigs]
  );

  const handleApiKeyChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const apiKey = e.target.value;
      setProviderConfigs(prev => {
        const existing = prev[tab.activeProvider];
        return {
          ...prev,
          [tab.activeProvider]: {
            baseUrl: existing?.baseUrl ?? '',
            apiKey,
            showApiKey: existing?.showApiKey ?? false,
            testing: false,
            testResult: null
          }
        };
      });
    },
    [tab.activeProvider]
  );

  const handleSaveApiKey = useCallback(async () => {
    const cfg = providerConfigs[tab.activeProvider];
    if (!cfg?.apiKey || cfg.apiKey === 'ÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇó') return;
    await agent.setApiKey?.(tab.activeProvider, cfg.apiKey);
    setProviderConfigs(prev => ({
      ...prev,
      [tab.activeProvider]: { ...(prev[tab.activeProvider] ?? { baseUrl: '', apiKey: '', showApiKey: false, testing: false, testResult: null }), apiKey: 'ÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇó' }
    }));
  }, [agent, tab.activeProvider, providerConfigs]);

  const handleDeleteApiKey = useCallback(async () => {
    await agent.deleteApiKey?.(tab.activeProvider);
    setProviderConfigs(prev => ({
      ...prev,
      [tab.activeProvider]: { ...(prev[tab.activeProvider] ?? { baseUrl: '', apiKey: '', showApiKey: false, testing: false, testResult: null }), apiKey: '' }
    }));
  }, [agent, tab.activeProvider]);

  const handleTestConnection = useCallback(async () => {
    const cfg = providerConfigs[tab.activeProvider];
    if (!cfg?.baseUrl) return;

    // Persist the URL before testing so the main process uses the same URL
    // for the test as it will for subsequent requests.
    const currentSaved = savedUrlsRef.current[tab.activeProvider] ?? '';
    if (cfg.baseUrl !== currentSaved) {
      await agent.setProviderConfig?.(tab.activeProvider, cfg.baseUrl);
      savedUrlsRef.current = { ...savedUrlsRef.current, [tab.activeProvider]: cfg.baseUrl };
    }

    setProviderConfigs(prev => ({
      ...prev,
      [tab.activeProvider]: { ...(prev[tab.activeProvider] ?? { baseUrl: '', apiKey: '', showApiKey: false, testing: false, testResult: null }), testing: true, testResult: null }
    }));

    const startTime = Date.now();
    const result = await agent.testConnection?.(tab.activeProvider, cfg.baseUrl ?? '') ?? { status: 'error' as const, message: 'Not available' };

    // Ensure the "Testing..." state is visible for at least 1.5s so the user
    // sees feedback even on instant responses.
    const elapsed = Date.now() - startTime;
    if (elapsed < 1500) {
      await new Promise(resolve => setTimeout(resolve, 1500 - elapsed));
    }

    // Refresh gateway config to get updated models list and provider key status
    if (result.status === 'ok') {
      const freshConfig = await agent.getModelGatewayConfig();
      setConfig(freshConfig);
      await loadProviderConfigs(freshConfig, providerConfigs);
    }

    setProviderConfigs(prev => ({
      ...prev,
      [tab.activeProvider]: { ...(prev[tab.activeProvider] ?? { baseUrl: '', apiKey: '', showApiKey: false, testing: false, testResult: null }), testing: false, testResult: result }
    }));
  }, [agent, loadProviderConfigs, providerConfigs, tab.activeProvider]);

  const handleToggleApiKeyVisibility = useCallback(() => {
    setProviderConfigs(prev => ({
      ...prev,
      [tab.activeProvider]: { ...(prev[tab.activeProvider] ?? { baseUrl: '', apiKey: '', showApiKey: false, testing: false, testResult: null }), showApiKey: !prev[tab.activeProvider]?.showApiKey }
    }));
  }, [tab.activeProvider]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || tab.isStreaming) return;

    setInput('');
    setStreamingContent('');
    setStreamError(null);
    await agent.sendMessage(tab.id, trimmed);
  }, [agent, tab.id, tab.isStreaming, input]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleStop = useCallback(async () => {
    await agent.stopStreaming(tab.id);
    if (tab.runtimeWorkerId) {
      await agent.stopAgentRuntimeWorker?.(tab.runtimeWorkerId);
    }
  }, [agent, tab.id, tab.runtimeWorkerId]);

  return (
    <div className="chat-panel" role="tabpanel" aria-label={`Chat: ${tab.title}`}>
      {/* Model Configuration Header */}
      <div className="chat-config-header">
        <button
          className="chat-config-toggle"
          type="button"
          onClick={() => setShowConfig(prev => !prev)}
          aria-label={showConfig ? 'Hide model configuration' : 'Show model configuration'}
          title="Model configuration"
        >
          {showConfig ? 'Ôľ╝' : 'ÔľÂ'} Model
        </button>
        <span className="chat-config-summary">
          {currentProvider?.label ?? 'Unknown'} / {tab.activeModel}
        </span>
      </div>

      {showConfig && (
        <div className="chat-config-panel">
          {/* Provider Selection */}
          <div className="chat-config-row">
            <label className="chat-config-label" htmlFor={`provider-${tab.id}`}>
              Provider
            </label>
            <select
              id={`provider-${tab.id}`}
              className="chat-config-select"
              value={tab.activeProvider}
              onChange={handleProviderChange}
              disabled={tab.isStreaming}
            >
              {config?.providers.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.label} ({provider.status})
                </option>
              ))}
            </select>
          </div>

          {/* Model Selection */}
          <div className="chat-config-row">
            <label className="chat-config-label" htmlFor={`model-${tab.id}`}>
              Model
            </label>
            <select
              id={`model-${tab.id}`}
              className="chat-config-select"
              value={tab.activeModel}
              onChange={handleModelChange}
              disabled={tab.isStreaming || availableModels.length === 0}
            >
              {availableModels.length === 0 ? (
                <option value="">No models available</option>
              ) : (
                availableModels.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.contextWindow} ctx)
                  </option>
                ))
              )}
            </select>
          </div>

          {/* API Base URL */}
          <div className="chat-config-row">
            <label className="chat-config-label" htmlFor={`baseurl-${tab.id}`}>
              API URL
            </label>
            <div className="chat-config-url-row">
              <input
                id={`baseurl-${tab.id}`}
                className="chat-config-input"
                type="text"
                value={currentConfig.baseUrl}
                onChange={handleBaseUrlChange}
                placeholder="e.g. https://openrouter.ai/api/v1"
                disabled={tab.isStreaming}
                spellCheck={false}
              />
              <button
                className="chat-config-save-btn"
                type="button"
                onClick={() => { void handleSaveBaseUrl(); }}
                disabled={tab.isStreaming || savingProviders[tab.activeProvider] || isBaseUrlUnchanged() || !currentConfig.baseUrl}
                aria-label="Save API URL"
                title="Save API URL"
              >
                {savingProviders[tab.activeProvider] ? 'ÔĆ│' : '­čĺż'}
              </button>
            </div>
          </div>

          {/* API Key (secure) */}
          <div className="chat-config-row">
            <label className="chat-config-label" htmlFor={`apikey-${tab.id}`}>
              API Key
            </label>
            <div className="chat-config-apikey-row">
              <input
                id={`apikey-${tab.id}`}
                className="chat-config-input chat-config-apikey-input"
                type={currentConfig.showApiKey ? 'text' : 'password'}
                value={currentConfig.apiKey}
                onChange={handleApiKeyChange}
                placeholder="Enter API key..."
                disabled={tab.isStreaming}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                className="chat-config-icon-btn"
                type="button"
                onClick={handleToggleApiKeyVisibility}
                aria-label={currentConfig.showApiKey ? 'Hide API key' : 'Show API key'}
                title={currentConfig.showApiKey ? 'Hide' : 'Show'}
              >
                {currentConfig.showApiKey ? '­čÖł' : '­čĹü'}
              </button>
              <button
                className="chat-config-icon-btn"
                type="button"
                onClick={handleSaveApiKey}
                aria-label="Save API key"
                title="Save API key securely"
                disabled={tab.isStreaming || !currentConfig.apiKey || currentConfig.apiKey === 'ÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇóÔÇó'}
              >
                ­čĺż
              </button>
              <button
                className="chat-config-icon-btn chat-config-icon-btn-danger"
                type="button"
                onClick={handleDeleteApiKey}
                aria-label="Delete API key"
                title="Delete stored API key"
                disabled={tab.isStreaming || !currentConfig.apiKey}
              >
                ­čŚĹ
              </button>
            </div>
          </div>

          {/* Test Connection */}
          <div className="chat-config-row">
            <label className="chat-config-label" htmlFor={`test-${tab.id}`}>
              Connection
            </label>
            <div className="chat-config-test-row">
              <button
                className={`chat-config-test-btn ${currentConfig.testing ? 'test-btn-testing' : ''}`}
                type="button"
                onClick={handleTestConnection}
                disabled={tab.isStreaming || currentConfig.testing || !currentConfig.baseUrl}
                aria-label="Test connection"
                aria-busy={currentConfig.testing}
              >
                {currentConfig.testing ? 'ÔĆ│ Testing...' : 'Test Connection'}
              </button>
              {currentConfig.testResult && !currentConfig.testing && (
                <span className={`chat-config-test-result ${currentConfig.testResult.status === 'ok' ? 'test-ok' : 'test-error'}`} role="status">
                  {currentConfig.testResult.status === 'ok' ? 'Ôťô Connected' : `ÔťŚ ${currentConfig.testResult.message ?? 'Failed'}`}
                </span>
              )}
            </div>
          </div>

          {/* Provider Info */}
          {currentProvider && (
            <div className="chat-config-info">
              <span className="chat-config-status">
                Status: <span className={`status-${currentProvider.status}`}>{currentProvider.status}</span>
              </span>
              <span className="chat-config-models-count">
                {availableModels.length} model{availableModels.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages">
        {localMessages.map((msg, i) => (
          <div
            key={`${msg.timestamp}-${i}`}
            className={`chat-message chat-message-${msg.role}`}
          >
            <span className="chat-message-role">{msg.role}</span>
            <div className="chat-message-content">{msg.content}</div>
          </div>
        ))}
        {streamingContent && (
          <div className="chat-message chat-message-assistant chat-message-streaming">
            <span className="chat-message-role">assistant</span>
            <div className="chat-message-content">{streamingContent}</div>
          </div>
        )}
        {streamingToolCalls.length > 0 && (
          <div className="chat-message chat-message-tool-use">
            <span className="chat-message-role">tools</span>
            <div className="chat-tool-calls">
              {streamingToolCalls.map((tc, i) => (
                <div key={`${tc.id}-${i}`} className="chat-tool-call">
                  <span className="chat-tool-call-name">{tc.function.name}</span>
                  <span className="chat-tool-call-args">{tc.function.arguments}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {streamError && (
          <div className="chat-message-error" role="alert">
            Stream error: {streamError}
          </div>
        )}
        {tab.error && (
          <div className="chat-message-error" role="alert">
            {tab.error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          rows={2}
          disabled={tab.isStreaming}
          aria-label="Chat message input"
        />
        <div className="chat-input-actions">
          {tab.isStreaming ? (
            <button
              className="chat-stop-button"
              type="button"
              onClick={() => { void handleStop(); }}
              aria-label="Stop streaming"
            >
              Stop
            </button>
          ) : (
            <button
              className="chat-send-button"
              type="button"
              onClick={() => { void handleSend(); }}
              disabled={!input.trim()}
              aria-label="Send message"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
