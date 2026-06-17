import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

import { createAgentRuntime } from '@agentdeck/agent-runtime';
import type {
  AgentRuntime,
  AgentRuntimeCreateOptions,
  AgentRuntimeResult,
  AgentRuntimeSessionState,
  AgentRuntimeStartWorkerOptions,
  AgentRuntimeStartSubagentOptions,
  AgentRuntimeResumeOptions,
  AgentRuntimeTaskState,
  AgentRuntimeWorkerDefinition,
  AgentRuntimeWorkerInput,
  AgentRuntimeWorkerOutput,
  AgentRuntimeWorkerState
} from '@agentdeck/agent-runtime';

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

type AgentRuntimeEvent = {
  type: 'session-changed' | 'task-changed' | 'worker-changed' | 'session-crashed';
  payload: unknown;
};

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.25
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
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

export type ToolExecutor = (toolCall: ToolCall, context?: ToolExecutionContext) => Promise<string>;

export type ToolExecutionContext = {
  messages: readonly ChatMessage[];
  workspaceRoots: readonly string[];
};

export type WorkspaceRootProvider = () => readonly string[];

type ToolRegistration = {
  definition: ToolDefinition;
  executor?: ToolExecutor;
};

// ?? In-memory chat tab store ??????????????????????????????????????????????

type ChatTabInternal = {
  id: string;
  title: string;
  messages: ChatMessage[];
  activeModel: string;
  activeProvider: ModelProviderId;
  isStreaming: boolean;
  runtimeSessionId: string | undefined;
  runtimeWorkerId: string | undefined;
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
  if (tab.runtimeSessionId) {
    (result as { runtimeSessionId?: string }).runtimeSessionId = tab.runtimeSessionId;
  }
  if (tab.runtimeWorkerId) {
    (result as { runtimeWorkerId?: string }).runtimeWorkerId = tab.runtimeWorkerId;
  }
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
  'agent-runtime-event': (event: AgentRuntimeEvent) => void;
};

type ChatTabSession = Readonly<{
  sessionId: string;
  taskId: string;
  workerId: string;
  status: 'idle' | 'running' | 'stopped';
}>;

export class ModelGateway extends EventEmitter {
  private readonly tabs = new Map<string, ChatTabInternal>();
  private readonly sessionsByTab = new Map<string, ChatTabSession>();
  private readonly tabIdsBySessionId = new Map<string, string>();
  private readonly runtimeResultsByTab = new Map<string, SendMessageResult>();
  private readonly adapters = new Map<ModelProviderId, ModelProviderAdapter>();
  private readonly tools: ToolRegistration[] = [];
  private readonly runtime: AgentRuntime;
  private providers: ModelProviderState[] = [...DEFAULT_PROVIDERS];
  private activeProvider: ModelProviderId = 'ollama';
  private activeModel: string = DEFAULT_MODEL.id;
  private retryPolicy: RetryPolicy = { ...DEFAULT_RETRY_POLICY };

  constructor(
    private readonly toolExecutor?: ToolExecutor,
    private readonly workspaceRootProvider?: WorkspaceRootProvider,
    runtimeOptions?: Omit<AgentRuntimeCreateOptions, 'workerFactory'>
  ) {
    super();
    this.runtime = createAgentRuntime({
      ...runtimeOptions,
      workerFactory: workerId => this.createRuntimeWorker(workerId)
    });
    this.runtime.on('session-changed', session => this.emitAgentRuntimeEvent('session-changed', session));
    this.runtime.on('task-changed', task => this.emitAgentRuntimeEvent('task-changed', task));
    this.runtime.on('worker-changed', worker => this.emitAgentRuntimeEvent('worker-changed', worker));
    this.runtime.on('session-crashed', (session, error) => this.emitAgentRuntimeEvent('session-crashed', { session, error }));
  }

  // Phase 7: Tool Router
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

  registerTool(tool: ToolDefinition, executor?: ToolExecutor): void {
    const existing = this.tools.findIndex(t => t.definition.function.name === tool.function.name);
    const registration: ToolRegistration = { definition: tool };
    if (executor) {
      registration.executor = executor;
    }
    if (existing >= 0) {
      this.tools[existing] = registration;
    } else {
      this.tools.push(registration);
    }
  }

  unregisterTool(name: string): void {
    const idx = this.tools.findIndex(t => t.definition.function.name === name);
    if (idx >= 0) this.tools.splice(idx, 1);
  }

  getTools(): readonly ToolDefinition[] {
    return this.tools.map(t => t.definition);
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
      const session = this.sessionsByTab.get(tabId);
      if (session) {
        this.runtime.updateSessionModel(session.sessionId, modelId);
      }
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
      runtimeSessionId: undefined,
      runtimeWorkerId: undefined,
      error: undefined,
      abortController: undefined
    };
    const sessionResult = this.runtime.createSession({
      chatTabId: id,
      modelId: tab.activeModel,
      agentName: 'chat-agent',
      allowedTools: this.getTools().map(tool => tool.function.name)
    });
    if (sessionResult.status === 'ok') {
      const parentTask = sessionResult.value.tasks[0];
      this.sessionsByTab.set(id, {
        sessionId: sessionResult.value.id,
        taskId: parentTask?.id ?? '',
        workerId: '',
        status: 'idle'
      });
      tab.runtimeSessionId = sessionResult.value.id;
      this.tabIdsBySessionId.set(sessionResult.value.id, id);
    }
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
    tab.runtimeWorkerId = undefined;
    const session = this.sessionsByTab.get(tabId);
    if (session) {
      this.runtime.stopSession(session.sessionId);
      this.tabIdsBySessionId.delete(session.sessionId);
      this.runtimeResultsByTab.delete(tabId);
      this.sessionsByTab.delete(tabId);
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
      return this.unknownTabError(tabId);
    }

    if (tab.isStreaming) {
      return this.alreadyStreamingError();
    }

    this.prepareTabForStreaming(tabId, tab, content);

    const session = this.sessionsByTab.get(tabId);
    if (session) {
      return this.sendWithRuntimeWorker(tabId, tab, session, content);
    }

    return this.sendWithoutRuntimeSession(tabId, tab);
  }

  private unknownTabError(tabId: string): SendMessageResult {
    return { status: 'error', code: 'UNKNOWN', message: `Chat tab not found: ${tabId}` };
  }

  private alreadyStreamingError(): SendMessageResult {
    return { status: 'error', code: 'PROVIDER_ERROR', message: 'Already streaming a response.' };
  }

  private prepareTabForStreaming(tabId: string, tab: ChatTabInternal, content: string): void {
    const userMessage: ChatMessage = {
      role: 'user',
      content,
      timestamp: Date.now()
    };
    tab.messages = [...tab.messages, userMessage];

    if (tab.messages.filter(m => m.role === 'user').length === 1) {
      tab.title = generateTitle(tab.messages);
    }

    tab.isStreaming = true;
    tab.error = undefined;
    tab.abortController = new AbortController();
    this.emitTabsChanged();
  }

  private async sendWithRuntimeWorker(
    tabId: string,
    tab: ChatTabInternal,
    session: ChatTabSession,
    content: string
  ): Promise<SendMessageResult> {
    const started = this.startRuntimeWorkerForTab(tabId, tab, session, content);
    if ('status' in started) {
      return started;
    }

    const runResult = this.runtime.runWorker(started.workerId);
    if (runResult.status === 'error') {
      return this.failRuntimeWorker(tabId, tab, session, runResult.message);
    }

    const waitResult = await this.runtime.waitForWorker(started.workerId);
    return this.finishRuntimeWorker(tabId, tab, session, waitResult);
  }

  private startRuntimeWorkerForTab(
    tabId: string,
    tab: ChatTabInternal,
    session: ChatTabSession,
    content: string
  ): { workerId: string } | SendMessageResult {
    const startResult = this.runtime.startWorker(this.buildRuntimeStartOptions(tabId, tab, session, content));
    if (startResult.status === 'error') {
      return this.failRuntimeWorker(tabId, tab, session, startResult.message);
    }

    const workerId = startResult.value.id;
    tab.runtimeWorkerId = workerId;
    this.sessionsByTab.set(tabId, {
      ...session,
      workerId,
      status: 'running'
    });
    return { workerId };
  }

  private buildRuntimeStartOptions(
    tabId: string,
    tab: ChatTabInternal,
    session: ChatTabSession,
    content: string
  ): AgentRuntimeStartWorkerOptions {
    return {
      sessionId: session.sessionId,
      taskId: session.taskId,
      prompt: content,
      context: tab.messages.map(message => `${message.role}: ${message.content}`),
      allowedTools: this.getAllowedToolsForTab(tab) ?? this.getTools().map(tool => tool.function.name)
    };
  }

  private failRuntimeWorker(tabId: string, tab: ChatTabInternal, session: ChatTabSession, message: string): SendMessageResult {
    tab.isStreaming = false;
    tab.abortController = undefined;
    tab.runtimeWorkerId = undefined;
    tab.error = message;
    this.sessionsByTab.set(tabId, { ...session, status: 'idle', workerId: '' });
    this.emitTabsChanged();
    return { status: 'error', code: 'UNKNOWN', message };
  }

  private finishRuntimeWorker(
    tabId: string,
    tab: ChatTabInternal,
    session: ChatTabSession,
    waitResult: AgentRuntimeResult<AgentRuntimeWorkerState>
  ): SendMessageResult {
    tab.runtimeWorkerId = undefined;
    this.sessionsByTab.set(tabId, { ...session, status: 'idle', workerId: '' });

    if (waitResult.status === 'error') {
      return this.failRuntimeWorker(tabId, tab, session, waitResult.message);
    }
    if (waitResult.value.status === 'crashed') {
      return this.failRuntimeWorker(tabId, tab, session, waitResult.value.lastError ?? 'Runtime worker crashed.');
    }

    const result = this.runtimeResultsByTab.get(tabId);
    return result ?? { status: 'ok' };
  }

  private async sendWithoutRuntimeSession(tabId: string, tab: ChatTabInternal): Promise<SendMessageResult> {
    try {
      const result = await this.runChatLoop(tabId, tab);
      this.runtimeResultsByTab.set(tabId, result);
      return result;
    } catch (err) {
      return this.handleSendMessageError(tabId, tab, err);
    } finally {
      this.clearRuntimeWorkerFromTab(tabId, tab);
    }
  }

  private handleSendMessageError(tabId: string, tab: ChatTabInternal, err: unknown): SendMessageResult {
    tab.isStreaming = false;
    tab.abortController = undefined;

    if (this.isAbortError(err)) {
      return this.handleAbortError(tabId, tab);
    }

    const message = this.toErrorMessage(err);
    const code = classifyError(err);
    tab.error = message;
    this.emit('chat-stream', tabId, { type: 'error', message });
    this.emitTabsChanged();
    return { status: 'error', code, message };
  }

  private handleAbortError(tabId: string, tab: ChatTabInternal): SendMessageResult {
    const session = this.sessionsByTab.get(tabId);
    if (session?.workerId) {
      this.runtime.stopWorker(session.workerId);
      this.sessionsByTab.set(tabId, { ...session, status: 'idle', workerId: '' });
      tab.runtimeWorkerId = undefined;
    }
    tab.error = 'Streaming cancelled.';
    this.emit('chat-stream', tabId, { type: 'error', message: tab.error });
    this.emitTabsChanged();
    return { status: 'ok' };
  }

  private clearRuntimeWorkerFromTab(tabId: string, tab: ChatTabInternal): void {
    const session = this.sessionsByTab.get(tabId);
    if (session?.workerId) {
      this.sessionsByTab.set(tabId, { ...session, status: 'idle', workerId: '' });
      tab.runtimeWorkerId = undefined;
    }
  }

  private isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError';
  }

  private toErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
  }

  setTabAllowedTools(tabId: string, allowedTools: readonly string[]): void {
    const session = this.sessionsByTab.get(tabId);
    if (!session) return;
    this.runtime.updateSessionAllowedTools(session.sessionId, [...allowedTools]);
  }

  listAgentRuntimeSessions(): readonly AgentRuntimeSessionState[] {
    return this.runtime.listSessions().filter(session => session.status !== 'stopped');
  }

  getAgentRuntimeSession(sessionId: string): AgentRuntimeSessionState | undefined {
    const session = this.runtime.getSession(sessionId);
    return session?.status === 'stopped' ? undefined : session;
  }

  listAgentRuntimeWorkers(sessionId?: string): readonly AgentRuntimeWorkerState[] {
    return this.runtime.listWorkers(sessionId);
  }

  getAgentRuntimeWorker(workerId: string): AgentRuntimeWorkerState | undefined {
    return this.runtime.getWorker(workerId);
  }

  listAgentRuntimeTasks(sessionId?: string): readonly AgentRuntimeTaskState[] {
    return this.runtime.listTasks(sessionId);
  }

  getAgentRuntimeTask(taskId: string): AgentRuntimeTaskState | undefined {
    return this.runtime.getTask(taskId);
  }

  startAgentRuntimeWorker(options: AgentRuntimeStartWorkerOptions): AgentRuntimeResult<AgentRuntimeWorkerState> {
    return this.runtime.startWorker(options);
  }

  async runtimeWaitForWorker(workerId: string): Promise<AgentRuntimeResult<AgentRuntimeWorkerState>> {
    return await this.runtime.waitForWorker(workerId);
  }

  async startAgentRuntimeSubagent(options: AgentRuntimeStartSubagentOptions): Promise<AgentRuntimeResult<AgentRuntimeTaskState>> {
    const taskResult = this.runtime.startSubagent(options);
    if (taskResult.status === 'error') {
      return taskResult;
    }

    const task = taskResult.value;
    const workerResult = this.runtime.startWorker({
      sessionId: options.sessionId,
      taskId: task.id,
      prompt: task.prompt,
      context: task.context,
      allowedTools: task.permissionScope.allowedTools
    });

    if (workerResult.status === 'error') {
      return workerResult;
    }

    const runResult = this.runtime.runWorker(workerResult.value.id);
    if (runResult.status === 'error') {
      return runResult;
    }

    const waitResult = await this.runtime.waitForWorker(workerResult.value.id);
    if (waitResult.status === 'error') {
      return waitResult;
    }

    const updatedTask = this.runtime.getTask(task.id);
    if (!updatedTask) {
      return { status: 'error', code: 'TASK_NOT_FOUND', message: 'Subagent task disappeared after worker completion.' };
    }

    return { status: 'ok', value: updatedTask };
  }

  resumeAgentRuntimeWorker(options: AgentRuntimeResumeOptions): AgentRuntimeResult<AgentRuntimeWorkerState> {
    return this.runtime.resumeWorker(options);
  }

  stopAgentRuntimeWorker(workerId: string): AgentRuntimeResult<AgentRuntimeWorkerState> {
    const result = this.runtime.stopWorker(workerId);
    if (result.status === 'ok') {
      this.clearWorkerFromTab(workerId);
    }
    return result;
  }

  stopAgentRuntimeSession(sessionId: string): AgentRuntimeResult<readonly AgentRuntimeWorkerState[]> {
    const result = this.runtime.stopSession(sessionId);
    if (result.status === 'ok') {
      const tabId = this.tabIdsBySessionId.get(sessionId);
      if (tabId) {
        const tab = this.tabs.get(tabId);
        if (tab) {
          tab.runtimeWorkerId = undefined;
          this.emitTabsChanged();
        }
      }
    }
    return result;
  }

  private clearWorkerFromTab(workerId: string): void {
    for (const [tabId, session] of this.sessionsByTab) {
      if (session.workerId === workerId) {
        this.sessionsByTab.set(tabId, { ...session, status: 'idle', workerId: '' });
        const tab = this.tabs.get(tabId);
        if (tab) {
          tab.runtimeWorkerId = undefined;
        }
        this.emitTabsChanged();
        return;
      }
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
      content: assistantContent || ' ',
      timestamp: Date.now(),
    };
    if (toolCalls.length > 0) {
      const normalized = toolCalls.map((tc, index) => ({
        id: tc.id?.trim() ? tc.id : `call_${Date.now()}_${index}`,
        type: tc.type,
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string' && tc.function.arguments.trim()
            ? tc.function.arguments
            : '{}'
        }
      }));
      (msg as { tool_calls?: readonly ToolCall[] }).tool_calls = normalized;
    }
    return msg;
  }

  private createRuntimeWorker(workerId: string): AgentRuntimeWorkerDefinition {
    return {
      id: workerId,
      run: async (input: AgentRuntimeWorkerInput, signal: AbortSignal): Promise<AgentRuntimeWorkerOutput> => {
        const tabId = this.tabIdsBySessionId.get(input.sessionId) ?? input.permissionScope.sessionId;
        const tab = this.tabs.get(tabId);
        if (!tab) {
          throw createAbortError();
        }

        if (signal.aborted) {
          tab.abortController?.abort();
          throw createAbortError();
        }
        signal.addEventListener('abort', () => tab.abortController?.abort(), { once: true });

        const previousModelId = tab.activeModel;
        tab.activeModel = input.modelId;
        try {
          const toolsUsed = new Set<string>();
          const result = await this.runChatLoop(tabId, tab, 0, input.permissionScope.allowedTools, toolsUsed);
          this.runtimeResultsByTab.set(tabId, result);

          if (signal.aborted) {
            throw createAbortError();
          }

          const summary = this.createWorkerSummary(result);

          return {
            summary,
            references: this.createWorkerReferences(tab.messages),
            toolsUsed: [...toolsUsed]
          };
        } finally {
          tab.activeModel = previousModelId;
        }
      }
    };
  }

  private createWorkerSummary(result: SendMessageResult): string {
    if (result.status === 'ok') {
      return 'Chat response completed.';
    }
    return `Chat response failed: ${result.message ?? 'unknown'}`;
  }

  private createWorkerReferences(messages: readonly ChatMessage[]): string[] {
    const references = new Set<string>();

    for (const message of messages) {
      if (message.role === 'tool') {
        for (const reference of extractReferencesFromToolResult(message.content)) {
          addReference(references, reference);
        }
      }
    }

    const lastAssistantMessage = [...messages].reverse().find(message => message.role === 'assistant');
    if (lastAssistantMessage) {
      collectReferencesFromMarkdownLinks(lastAssistantMessage.content, references);
    }

    return [...references];
  }

  private emitAgentRuntimeEvent(type: AgentRuntimeEvent['type'], payload: unknown): void {
    this.emit('agent-runtime-event', { type, payload });
  }

  private async processToolCalls(tab: ChatTabInternal, toolCalls: ToolCall[], allowedToolNames?: readonly string[]): Promise<{ finished: boolean; toolsUsed: string[] }> {
    const allowedToolSet = allowedToolNames === undefined ? undefined : new Set(allowedToolNames);
    const toolsUsed: string[] = [];

    for (const tc of toolCalls) {
      if (allowedToolSet !== undefined && !allowedToolSet.has(tc.function.name)) {
        tab.messages = [...tab.messages, {
          role: 'tool',
          content: JSON.stringify({ error: `Tool not allowed: ${tc.function.name}` }),
          timestamp: Date.now(),
          tool_call_id: tc.id
        }];
        continue;
      }

      toolsUsed.push(tc.function.name);

      const result = await this.executeToolCall(tc, tab);
      const parsed = parseToolResult(result);
      const missingFilePath = isMissingFilePathError(parsed, tc.function.name);
      const invalidArguments = isInvalidToolArgumentsError(parsed, tc.function.name);
      const emptyToolResult = typeof result === 'string' && result.trim() === '';

      if (!missingFilePath && !invalidArguments && !emptyToolResult) {
        tab.messages = [...tab.messages, {
          role: 'tool',
          content: result,
          timestamp: Date.now(),
          tool_call_id: tc.id
        }];
        continue;
      }

      tab.messages = [...tab.messages, {
        role: 'assistant',
        content: formatInvalidToolArgumentsMessage(tc.function.name),
        timestamp: Date.now()
      }];
      return { finished: true, toolsUsed };
    }

    return { finished: false, toolsUsed };
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
    tools: readonly ToolDefinition[],
    allowedToolNames?: readonly string[],
    toolsUsedCollector?: Set<string>
  ): Promise<{ hasToolCalls: boolean } | { finishedAfterInvalidTool: boolean } | { error: { code: string; message: string } }> {
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

    const assistantMessage = this.buildAssistantMessage(result.assistantContent, result.toolCalls);
    tab.messages = [...tab.messages, assistantMessage];

    if (result.toolCalls.length > 0) {
      const normalizedToolCalls = assistantMessage.tool_calls ? [...assistantMessage.tool_calls] : result.toolCalls;
      const processed = await this.processToolCalls(tab, normalizedToolCalls, allowedToolNames);
      processed.toolsUsed.forEach(toolName => toolsUsedCollector?.add(toolName));
      if (processed.finished) {
        return { finishedAfterInvalidTool: true };
      }
      return { hasToolCalls: true };
    }

    return { hasToolCalls: false };
  }

  private resolveToolsForTab(tab: ChatTabInternal, provider: ModelProviderState, allowedToolsOverride?: readonly string[]): readonly ToolDefinition[] {
    const activeModelInfo = provider.models.find(m => m.id === tab.activeModel);
    if (activeModelInfo === undefined || activeModelInfo.supportsTools) {
      return this.resolveToolsByAllowedNames(this.getTools(), allowedToolsOverride ?? this.getAllowedToolsForTab(tab));
    }
    return [];
  }

  private getAllowedToolsForTab(tab: ChatTabInternal): readonly string[] | undefined {
    const session = this.sessionsByTab.get(tab.id);
    if (!session) return undefined;
    const runtimeSession = this.runtime.getSession(session.sessionId);
    return runtimeSession?.permissionScope.allowedTools;
  }

  private resolveToolsByAllowedNames(tools: readonly ToolDefinition[], allowedTools: readonly string[] | undefined): readonly ToolDefinition[] {
    if (allowedTools === undefined) {
      return tools;
    }

    const allowedNames = new Set(allowedTools);
    return tools.filter(tool => allowedNames.has(tool.function.name));
  }

  private async runChatLoop(
    tabId: string,
    tab: ChatTabInternal,
    depth: number = 0,
    allowedToolsOverride?: readonly string[],
    toolsUsedCollector?: Set<string>
  ): Promise<SendMessageResult> {
    const MAX_TOOL_CALL_DEPTH = 10;
    if (depth >= MAX_TOOL_CALL_DEPTH) {
      return this.failTab(tabId, tab, 'PROVIDER_ERROR', 'Maximum tool call depth exceeded.');
    }

    const resolved = this.getAdapterAndProvider(tab);
    if (!resolved) {
      return { status: 'error', code: 'PROVIDER_ERROR', message: `Provider resolution failed for: ${tab.activeProvider}` };
    }

    const { adapter, provider } = resolved;
    const tools = this.resolveToolsForTab(tab, provider, allowedToolsOverride);
    const policy = this.retryPolicy;
    let lastError: { code: string; message: string } | undefined;

    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = computeBackoffDelay(attempt - 1, policy);
        this.emitRetryNotification(tabId, attempt, policy.maxRetries, delay);
        await sleep(delay);
      }

      const result = await this.runSingleAttempt(tabId, tab, adapter, provider, tools, allowedToolsOverride, toolsUsedCollector);

      if ('error' in result) {
        lastError = result.error;
        if (!isRetryableError(result.error.code)) {
          break;
        }
        continue;
      }

      if ('finishedAfterInvalidTool' in result) {
        return this.finishTab(tabId, tab);
      }

      if (result.hasToolCalls) {
        return this.runChatLoop(tabId, tab, depth + 1, allowedToolsOverride, toolsUsedCollector);
      }
      return this.finishTab(tabId, tab);
    }

    if (!lastError) {
      return this.failTab(tabId, tab, 'UNKNOWN', 'All retries exhausted without capturing an error.');
    }
    return this.failTab(tabId, tab, lastError.code, lastError.message);
  }

  private async executeToolCall(toolCall: ToolCall, tab: ChatTabInternal): Promise<string> {
    const registration = this.tools.find(t => t.definition.function.name === toolCall.function.name);
    if (!registration) {
      return JSON.stringify({ error: `Tool not found: ${toolCall.function.name}` });
    }
    if (registration.executor) {
      return registration.executor(toolCall, this.buildToolExecutionContext(tab));
    }
    if (this.toolExecutor) {
      return this.toolExecutor(toolCall, this.buildToolExecutionContext(tab));
    }
    // Phase 7: If ToolRouter is configured, execute through approval flow
    if (this.toolRouter) {
      const request: ToolCallRequest = {
        callId: toolCall.id,
        toolName: toolCall.function.name as ToolName,
        args: JSON.parse(toolCall.function.arguments || '{}'),
      };
      const response: ToolCallResponse = await this.toolRouter.execute(request);
      if (response.status === 'ok') {
        return JSON.stringify(response.result);
      }
      if (response.status === 'error') {
        return JSON.stringify({ error: response.message });
      }
      return JSON.stringify({ status: 'pending', tool: toolCall.function.name, arguments: toolCall.function.arguments });
    }
    return JSON.stringify({ status: 'pending', tool: toolCall.function.name, arguments: toolCall.function.arguments });
  }

  private buildToolExecutionContext(tab: ChatTabInternal): ToolExecutionContext {
    return {
      messages: [...tab.messages],
      workspaceRoots: this.workspaceRootProvider?.() ?? []
    };
  }

  stopStreaming(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab?.isStreaming) return;
    if (tab.abortController) {
      tab.abortController.abort();
    }

    const session = this.sessionsByTab.get(tabId);
    if (session?.workerId) {
      this.runtime.stopWorker(session.workerId);
    }
  }

  // ?? Event helpers ????????????????????????????????????????????????????????

  private emitTabsChanged(): void {
    this.emit('chat-tabs-changed', this.listChatTabs());
  }
}

// ?? Singleton factory ??????????????????????????????????????????????????????

let gatewayInstance: ModelGateway | null = null;

export function createModelGateway(toolExecutor?: ToolExecutor, workspaceRootProvider?: WorkspaceRootProvider): ModelGateway {
  gatewayInstance ??= new ModelGateway(toolExecutor, workspaceRootProvider);
  return gatewayInstance;
}

export function getModelGateway(): ModelGateway | null {
  return gatewayInstance;
}

function parseToolResult(result: string): unknown {
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

function isMissingFilePathError(parsed: unknown, toolName: string): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const candidate = parsed as Record<string, unknown>;
  return candidate.error === `read_file: missing filePath` || (
    toolName === 'read_file'
    && typeof candidate.error === 'string'
    && candidate.error.includes('missing filePath')
  );
}

function isInvalidToolArgumentsError(parsed: unknown, toolName: string): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.error !== 'string') return false;

  const expectedPrefixes = [
    'read_file:',
    'search_files:',
    'create_file:',
    'apply_patch:',
    'show_diff:'
  ];
  const errorMessage = candidate.error;

  return toolName !== 'read_file'
    && expectedPrefixes.some(prefix => errorMessage.startsWith(prefix))
    && errorMessage.includes('invalid');
}

function extractReferencesFromToolResult(content: string): string[] {
  const references: string[] = [];
  const parsed = parseToolResult(content);

  if (typeof parsed === 'string') {
    const markdownReferences = new Set<string>();
    collectReferencesFromMarkdownLinks(parsed, markdownReferences);
    return [...markdownReferences];
  }

  if (!parsed || typeof parsed !== 'object') {
    return references;
  }

  const candidate = parsed as Record<string, unknown>;
  collectReferenceFromRecord(references, candidate, 'references');
  collectReferenceFromRecord(references, candidate, 'path');
  collectReferenceFromRecord(references, candidate, 'filePath');
  collectReferenceFromRecord(references, candidate, 'file');
  collectReferenceFromRecord(references, candidate, 'url');

  return references;
}

function collectReferenceFromRecord(references: string[], record: Record<string, unknown>, key: string): void {
  const value = record[key];

  if (typeof value === 'string') {
    addReference(references, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        addReference(references, item);
      }
    }
  }
}

function addReference(references: string[] | Set<string>, reference: string): void {
  const normalized = reference.trim();
  if (!normalized) return;

  if (Array.isArray(references)) {
    if (!references.includes(normalized)) {
      references.push(normalized);
    }
    return;
  }

  references.add(normalized);
}

function collectReferencesFromMarkdownLinks(content: string, references: Set<string>): void {
  // Guard against excessively long input to prevent potential ReDoS
  if (content.length > 100_000) return;

  // Use a non-backtracking pattern: negated character classes are deterministic
  const markdownLinkPattern = /\[([^\]]{1,500})\]\(([^)]{1,2000})\)/g;
  let match: RegExpExecArray | null;

  while ((match = markdownLinkPattern.exec(content)) !== null) {
    addReference(references, match[2] ?? '');
  }
}

function formatInvalidToolArgumentsMessage(toolName: string): string {
  if (toolName === 'read_file') {
    return 'Nie mog─Ö wykona─ç narz─Ödzia `read_file`, bo model nie poda┼é wymaganej ┼Ťcie┼╝ki pliku. Popro┼Ť u┼╝ytkownika o dok┼éadn─ů nazw─Ö lub ┼Ťcie┼╝k─Ö pliku.';
  }

  return `Nie mog─Ö wykona─ç narz─Ödzia \`${toolName}\`, bo model przekaza┼é niepoprawne argumenty. Popro┼Ť u┼╝ytkownika o dok┼éadniejsze dane lub ┼Ťcie┼╝k─Ö pliku.`;
}
