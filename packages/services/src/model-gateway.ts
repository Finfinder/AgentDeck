import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

import type {
  ChatMessage,
  ChatStreamEvent,
  ChatTabState,
  ModelGatewayConfig,
  ModelInfo,
  ModelProviderId,
  ModelProviderState,
  SendMessageResult,
  ToolCall,
  ToolCallRequest,
  ToolCallResponse,
  ToolName
} from '@agentdeck/shared';
import { classifyError } from './model-errors';
import type { ToolRouter } from './tool-router';

// ?? Retry policy ??????????????????????????????????????????????????????????

export interface RetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterFactor: number;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.25
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function computeBackoffDelay(attempt: number, policy: RetryPolicy): number {
  const exponential = policy.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, policy.maxDelayMs);
  const secureRandom = (randomBytes(4).readUInt32LE(0) / 0xffffffff);
  const jitter = capped * policy.jitterFactor * (secureRandom * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

function isRetryableError(code: string): boolean {
  return code === 'NETWORK_ERROR' || code === 'PROVIDER_ERROR';
}

// ?? Provider interface ?????????????????????????????????????????????????????

export interface ModelProviderAdapter {
  readonly providerId: ModelProviderId;
  readonly label: string;

  healthCheck(baseUrl: string): Promise<boolean>;
  listModels(baseUrl: string): Promise<readonly ModelInfo[]>;
  chat(
    baseUrl: string,
    modelId: string,
    messages: readonly ChatMessage[],
    signal?: AbortSignal,
    tools?: readonly ToolDefinition[]
  ): AsyncIterable<ChatStreamEvent>;
}

export type ToolDefinition = Readonly<{
  type: 'function';
  function: Readonly<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}>;

// ?? In-memory chat tab store ??????????????????????????????????????????????

type ChatTabInternal = {
  id: string;
  title: string;
  messages: ChatMessage[];
  activeModel: string;
  activeProvider: ModelProviderId;
  isStreaming: boolean;
  error: string | undefined;
  abortController: AbortController | undefined;
};

function toChatTabState(tab: ChatTabInternal): ChatTabState {
  const result: ChatTabState = {
    id: tab.id,
    title: tab.title,
    messages: tab.messages,
    activeModel: tab.activeModel,
    activeProvider: tab.activeProvider,
    isStreaming: tab.isStreaming
  };
  if (tab.error !== undefined) {
    (result as { error?: string }).error = tab.error;
  }
  return result;
}

let tabCounter = 0;

function generateTabId(): string {
  tabCounter += 1;
  return `chat-tab-${tabCounter}`;
}

function generateTitle(messages: readonly ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return 'New Chat';
  const text = firstUser.content.trim();
  if (text.length <= 40) return text;
  return `${text.slice(0, 37)}...`;
}

// ?? Default provider configurations ??????????????????????????????????????

const DEFAULT_PROVIDERS: readonly ModelProviderState[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    status: 'idle',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: []
  },
  {
    id: 'ollama',
    label: 'Ollama',
    status: 'idle',
    baseUrl: 'http://localhost:11434',
    models: []
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    status: 'idle',
    baseUrl: 'http://localhost:1234/v1',
    models: []
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI Compatible',
    status: 'idle',
    baseUrl: '',
    models: []
  }
];

const DEFAULT_MODEL: ModelInfo = {
  id: 'qwen3.6:latest',
  name: 'Qwen 3.6',
  provider: 'ollama',
  contextWindow: 4096,
  supportsTools: false,
  supportsStreaming: true,
  supportsEmbeddings: false
};

// ?? Model Gateway Service ?????????????????????????????????????????????????

export type ModelGatewayEventMap = {
  'chat-stream': (tabId: string, event: ChatStreamEvent) => void;
  'chat-tabs-changed': (tabs: readonly ChatTabState[]) => void;
};

export class ModelGateway extends EventEmitter {
  private readonly tabs = new Map<string, ChatTabInternal>();
  private readonly adapters = new Map<ModelProviderId, ModelProviderAdapter>();
  private readonly tools: ToolDefinition[] = [];
  private providers: ModelProviderState[] = [...DEFAULT_PROVIDERS];
  private activeProvider: ModelProviderId = 'ollama';
  private activeModel: string = DEFAULT_MODEL.id;
  private retryPolicy: RetryPolicy = { ...DEFAULT_RETRY_POLICY };
  private toolRouter: ToolRouter | null = null;

  /** Set the ToolRouter instance for executing tool calls through approval flow. */
  setToolRouter(router: ToolRouter): void {
    this.toolRouter = router;
  }

  // ?? Provider adapter registration ???????????????????????????????????????

  registerAdapter(adapter: ModelProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
  }

  getAdapter(providerId: ModelProviderId): ModelProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  // ?? Tool registration ???????????????????????????????????????????????????

  registerTool(tool: ToolDefinition): void {
    const existing = this.tools.findIndex(t => t.function.name === tool.function.name);
    if (existing >= 0) {
      this.tools[existing] = tool;
    } else {
      this.tools.push(tool);
    }
  }

  unregisterTool(name: string): void {
    const idx = this.tools.findIndex(t => t.function.name === name);
    if (idx >= 0) this.tools.splice(idx, 1);
  }

  getTools(): readonly ToolDefinition[] {
    return this.tools;
  }

  clearTools(): void {
    this.tools.length = 0;
  }

  // ?? Retry policy ?????????????????????????????????????????????????????????

  setRetryPolicy(policy: Partial<RetryPolicy>): void {
    this.retryPolicy = { ...this.retryPolicy, ...policy };
  }

  getRetryPolicy(): RetryPolicy {
    return { ...this.retryPolicy };
  }

  // ?? Provider configuration ???????????????????????????????????????????????

  setProviderBaseUrl(providerId: ModelProviderId, baseUrl: string): void {
    this.providers = this.providers.map(p =>
      p.id === providerId ? { ...p, baseUrl } : p
    );
  }

  getProviderConfig(providerId: ModelProviderId): { baseUrl: string; hasApiKey: boolean } {
    const provider = this.providers.find(p => p.id === providerId);
    return { baseUrl: provider?.baseUrl ?? '', hasApiKey: false };
  }

  updateProviderStatus(providerId: ModelProviderId, status: ModelProviderState['status'], models: readonly ModelInfo[] = []): void {
    this.providers = this.providers.map(p =>
      p.id === providerId ? { ...p, status, models } : p
    );
  }

  // ?? Config ???????????????????????????????????????????????????????????????

  getConfig(): ModelGatewayConfig {
    return {
      providers: this.providers,
      activeProvider: this.activeProvider,
      activeModel: this.activeModel
    };
  }

  setActiveProvider(providerId: ModelProviderId): void {
    this.activeProvider = providerId;
  }

  setActiveModel(modelId: string): void {
    this.activeModel = modelId;
  }

  setTabActiveModel(tabId: string, modelId: string): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.activeModel = modelId;
      this.emitTabsChanged();
    }
  }

  setTabActiveProvider(tabId: string, providerId: ModelProviderId): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.activeProvider = providerId;
      this.emitTabsChanged();
    }
  }

  async checkProviderHealth(providerId: ModelProviderId, baseUrl: string): Promise<boolean> {
    const adapter = this.adapters.get(providerId);
    if (!adapter) return false;
    try {
      return await adapter.healthCheck(baseUrl);
    } catch {
      return false;
    }
  }

  async listProviderModels(providerId: ModelProviderId, baseUrl: string): Promise<readonly ModelInfo[]> {
    const adapter = this.adapters.get(providerId);
    if (!adapter) return [];
    try {
      return await adapter.listModels(baseUrl);
    } catch {
      return [];
    }
  }

  // ?? Chat tab management ??????????????????????????????????????????????????

  listChatTabs(): readonly ChatTabState[] {
    return [...this.tabs.values()].map(toChatTabState);
  }

  createChatTab(title?: string): ChatTabState {
    const id = generateTabId();
    const tab: ChatTabInternal = {
      id,
      title: title ?? 'New Chat',
      messages: [],
      activeModel: this.activeModel,
      activeProvider: this.activeProvider,
      isStreaming: false,
      error: undefined,
      abortController: undefined
    };
    this.tabs.set(id, tab);
    this.emitTabsChanged();
    return toChatTabState(tab);
  }

  closeChatTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    // Abort any in-flight streaming
    if (tab.abortController) {
      tab.abortController.abort();
    }
    this.tabs.delete(tabId);
    this.emitTabsChanged();
  }

  getChatTab(tabId: string): ChatTabState | undefined {
    const tab = this.tabs.get(tabId);
    return tab ? toChatTabState(tab) : undefined;
  }

  // ?? Send message ?????????????????????????????????????????????????????????

  async sendMessage(tabId: string, content: string): Promise<SendMessageResult> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return { status: 'error', code: 'UNKNOWN', message: `Chat tab not found: ${tabId}` };
    }

    if (tab.isStreaming) {
      return { status: 'error', code: 'PROVIDER_ERROR', message: 'Already streaming a response.' };
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content,
      timestamp: Date.now()
    };
    tab.messages = [...tab.messages, userMessage];

    // Update title from first user message
    if (tab.messages.filter(m => m.role === 'user').length === 1) {
      tab.title = generateTitle(tab.messages);
    }

    tab.isStreaming = true;
    tab.error = undefined;
    tab.abortController = new AbortController();
    this.emitTabsChanged();

    try {
      const result = await this.runChatLoop(tabId, tab);
      return result;
    } catch (err) {
      tab.isStreaming = false;
      tab.abortController = undefined;

      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        tab.error = 'Streaming cancelled.';
        this.emit('chat-stream', tabId, { type: 'error', message: tab.error });
        this.emitTabsChanged();
        return { status: 'ok' };
      }

      const message = err instanceof Error ? err.message : 'Unknown error';
      const code = classifyError(err);
      tab.error = message;
      this.emit('chat-stream', tabId, { type: 'error', message });
      this.emitTabsChanged();
      return { status: 'error', code, message };
    }
  }

  /** Mark tab as failed and emit error stream event. */
  private failTab(tabId: string, tab: ChatTabInternal, code: string, message: string): SendMessageResult {
    tab.isStreaming = false;
    tab.abortController = undefined;
    tab.error = message;
    // Emit tabs-changed FIRST so renderer syncs messages before error clears streaming.
    this.emitTabsChanged();
    this.emit('chat-stream', tabId, { type: 'error', message });
    return { status: 'error', code, message } as SendMessageResult;
  }

  /** Mark tab as successfully finished and emit done event. */
  private finishTab(tabId: string, tab: ChatTabInternal): SendMessageResult {
    tab.isStreaming = false;
    tab.abortController = undefined;
    // Emit tabs-changed FIRST so renderer syncs messages before done clears streaming.
    this.emitTabsChanged();
    this.emit('chat-stream', tabId, { type: 'done' });
    return { status: 'ok' };
  }

  /** Extract normalized error code and message from a stream error event. */
  private parseStreamError(message: string): { code: 'PROVIDER_ERROR' | 'MODEL_ERROR' | 'NETWORK_ERROR' | 'UNKNOWN'; message: string } {
    const bracketEnd = message.indexOf(']');
    if (bracketEnd > 1 && message.startsWith('[')) {
      const code = message.slice(1, bracketEnd);
      const rest = message.slice(bracketEnd + 1).trimStart();
      if (code === 'PROVIDER_ERROR' || code === 'MODEL_ERROR' || code === 'NETWORK_ERROR' || code === 'UNKNOWN') {
        return { code, message: rest || message };
      }
    }
    return { code: classifyError(new Error(message)), message };
  }

  private getAdapterAndProvider(tab: ChatTabInternal): { adapter: ModelProviderAdapter; provider: ModelProviderState } | null {
    const adapter = this.adapters.get(tab.activeProvider);
    if (!adapter) {
      this.failTab(tab.id, tab, 'PROVIDER_ERROR', `No adapter registered for provider: ${tab.activeProvider}`);
      return null;
    }
    const provider = this.providers.find(p => p.id === tab.activeProvider);
    if (!provider) {
      this.failTab(tab.id, tab, 'PROVIDER_ERROR', `Provider not configured: ${tab.activeProvider}`);
      return null;
    }
    return { adapter, provider };
  }

  private async collectStreamEvents(
    stream: AsyncIterable<ChatStreamEvent>,
    tabId: string
  ): Promise<{ assistantContent: string; toolCalls: ToolCall[]; streamError?: { code: string; message: string } }> {
    let assistantContent = '';
    const toolCalls: ToolCall[] = [];
    let streamError: { code: string; message: string } | undefined;

    try {
      for await (const event of stream) {
        if (event.type === 'chunk') {
          assistantContent += event.content;
        } else if (event.type === 'tool_use') {
          toolCalls.push(event.toolCall);
        } else if (event.type === 'error') {
          streamError = this.parseStreamError(event.message);
        }
        this.emit('chat-stream', tabId, event);
      }
    } catch (err) {
      streamError = { code: classifyError(err), message: err instanceof Error ? err.message : 'Unknown error' };
    }

    const result: { assistantContent: string; toolCalls: ToolCall[]; streamError?: { code: string; message: string } } = { assistantContent, toolCalls };
    if (streamError !== undefined) {
      result.streamError = streamError;
    }
    return result;
  }

  private buildAssistantMessage(assistantContent: string, toolCalls: ToolCall[]): ChatMessage {
    const msg: ChatMessage = {
      role: 'assistant',
      content: assistantContent,
      timestamp: Date.now(),
    };
    if (toolCalls.length > 0) {
      (msg as { tool_calls?: readonly ToolCall[] }).tool_calls = toolCalls;
    }
    return msg;
  }

  private async processToolCalls(tab: ChatTabInternal, toolCalls: ToolCall[]): Promise<void> {
    for (const tc of toolCalls) {
      tab.messages = [...tab.messages, {
        role: 'tool',
        content: await this.executeToolCall(tc),
        timestamp: Date.now(),
        tool_call_id: tc.id
      }];
    }
  }

  private emitRetryNotification(tabId: string, attempt: number, maxRetries: number, delay: number): void {
    this.emit('chat-stream', tabId, {
      type: 'info',
      message: `[RETRY] Attempt ${attempt}/${maxRetries} after ${delay}ms delay...`
    });
  }

  private async runSingleAttempt(
    tabId: string,
    tab: ChatTabInternal,
    adapter: ModelProviderAdapter,
    provider: ModelProviderState,
    tools: readonly ToolDefinition[]
  ): Promise<{ hasToolCalls: boolean } | { error: { code: string; message: string } }> {
    if (tab.abortController?.signal.aborted) {
      return { error: { code: 'NETWORK_ERROR', message: 'Streaming cancelled during retry backoff.' } };
    }

    const result = await this.collectStreamEvents(
      adapter.chat(provider.baseUrl, tab.activeModel, tab.messages, tab.abortController?.signal, tools),
      tabId
    );

    if (result.streamError) {
      return { error: result.streamError };
    }

    tab.messages = [...tab.messages, this.buildAssistantMessage(result.assistantContent, result.toolCalls)];

    if (result.toolCalls.length > 0) {
      await this.processToolCalls(tab, result.toolCalls);
      return { hasToolCalls: true };
    }

    return { hasToolCalls: false };
  }

  private async runChatLoop(tabId: string, tab: ChatTabInternal, depth: number = 0): Promise<SendMessageResult> {
    const MAX_TOOL_CALL_DEPTH = 10;
    if (depth >= MAX_TOOL_CALL_DEPTH) {
      return this.failTab(tabId, tab, 'PROVIDER_ERROR', 'Maximum tool call depth exceeded.');
    }

    const resolved = this.getAdapterAndProvider(tab);
    if (!resolved) {
      return { status: 'error', code: 'PROVIDER_ERROR', message: `Provider resolution failed for: ${tab.activeProvider}` };
    }

    const { adapter, provider } = resolved;
    const activeModelInfo = provider.models.find(m => m.id === tab.activeModel);
    const tools = activeModelInfo?.supportsTools ? this.getTools() : [];
    const policy = this.retryPolicy;
    let lastError: { code: string; message: string } | undefined;

    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = computeBackoffDelay(attempt - 1, policy);
        this.emitRetryNotification(tabId, attempt, policy.maxRetries, delay);
        await sleep(delay);
      }

      const result = await this.runSingleAttempt(tabId, tab, adapter, provider, tools);

      if ('error' in result) {
        lastError = result.error;
        if (!isRetryableError(result.error.code)) {
          break;
        }
      } else if (result.hasToolCalls) {
        return this.runChatLoop(tabId, tab, depth + 1);
      } else {
        return this.finishTab(tabId, tab);
      }
    }

    if (!lastError) {
      return this.failTab(tabId, tab, 'UNKNOWN', 'All retries exhausted without capturing an error.');
    }
    return this.failTab(tabId, tab, lastError.code, lastError.message);
  }

  private async executeToolCall(toolCall: ToolCall): Promise<string> {
    const tool = this.tools.find(t => t.function.name === toolCall.function.name);
    if (!tool) {
      return JSON.stringify({ error: `Tool not found: ${toolCall.function.name}` });
    }

    // If no ToolRouter is configured, return a placeholder
    if (!this.toolRouter) {
      return JSON.stringify({ status: 'pending', tool: toolCall.function.name, arguments: toolCall.function.arguments });
    }

    // Parse tool arguments
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    } catch {
      parsedArgs = { raw: toolCall.function.arguments };
    }

    // Build ToolCallRequest and execute through ToolRouter (PermissionBroker + ConflictBroker)
    const request: ToolCallRequest = {
      callId: toolCall.id,
      toolName: toolCall.function.name as ToolName,
      args: parsedArgs
    };

    const response: ToolCallResponse = await this.toolRouter.execute(request);

    if (response.status === 'ok') {
      return JSON.stringify({ status: 'ok', result: response.result });
    }
    if (response.status === 'pending-approval') {
      return JSON.stringify({
        status: 'pending-approval',
        callId: response.callId,
        classification: response.classification,
        expiresAt: response.expiresAt,
        message: 'Narzędzie wymaga zatwierdzenia przez użytkownika.'
      });
    }
    if (response.status === 'denied') {
      return JSON.stringify({ status: 'denied', reason: response.reason });
    }
    // error
    return JSON.stringify({ status: 'error', code: response.code, message: response.message });
  }

  stopStreaming(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab?.isStreaming) return;
    if (tab.abortController) {
      tab.abortController.abort();
    }
  }

  // ?? Event helpers ????????????????????????????????????????????????????????

  private emitTabsChanged(): void {
    this.emit('chat-tabs-changed', this.listChatTabs());
  }
}

// ?? Singleton factory ??????????????????????????????????????????????????????

let gatewayInstance: ModelGateway | null = null;

export function createModelGateway(): ModelGateway {
  gatewayInstance ??= new ModelGateway();
  return gatewayInstance;
}

export function getModelGateway(): ModelGateway | null {
  return gatewayInstance;
}
