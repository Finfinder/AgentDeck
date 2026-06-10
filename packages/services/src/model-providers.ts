import type {
  ChatMessage,
  ChatStreamEvent,
  ModelInfo,
  ModelProviderId,
  ToolCall
} from '@agentdeck/shared';
import type { ModelProviderAdapter, ToolDefinition } from './model-gateway';
import { classifyError } from './model-errors';

// ?? Stream heartbeat timeout ?????????????????????????????????????????????

/**
 * Maximum time (ms) to wait for the next chunk from the provider
 * before considering the stream stale. Prevents infinite hangs
 * when the provider stops sending data without closing the connection.
 */
export const STREAM_HEARTBEAT_TIMEOUT_MS = 60000;

// ?? HTTP helper with timeout ???????????????????????????????????????????????

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 30000, signal: callerSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Combine timeout signal with caller-provided signal so that
  // both timeout and explicit abort (e.g. stopStreaming) cancel the fetch.
  const signal = callerSignal
    ? AbortSignal.any([controller.signal, callerSignal])
    : controller.signal;

  try {
    const response = await fetch(url, { ...fetchOptions, signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ?? SSE line parsing ?????????????????????????????????????????????????????

/**
 * Ekstrahuje zawartosc linii SSE.
 *
 * @returns string — zawartosc linii `data:`
 * @returns null   — koniec strumienia (`[DONE]`)
 * @returns undefined — linia do pominiecia (pusta, `event:`, `id:`, komentarz)
 */
function extractSseContent(line: string): string | null | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined; // pusta linia — pomin
  if (!trimmed.startsWith('data: ')) return undefined; // nie-data (event/id/komentarz) — pomin
  const data = trimmed.slice(6);
  if (data === '[DONE]') return null; // koniec strumienia
  return data;
}

function tryParseDelta(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || !('choices' in parsed)) return null;
    const choices = (parsed as Record<string, unknown>).choices as unknown[];
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const first = choices[0] as Record<string, unknown> | undefined;
    if (!first || typeof first !== 'object' || !('delta' in first)) return null;
    const delta = first.delta as Record<string, unknown> | undefined;
    return delta ?? null;
  } catch {
    return null;
  }
}

function extractToolCallsFromDelta(delta: Record<string, unknown>): ToolCall[] {
  const rawToolCalls = delta.tool_calls;
  if (!Array.isArray(rawToolCalls)) return [];
  const result: ToolCall[] = [];
  for (const tc of rawToolCalls) {
    if (typeof tc !== 'object' || tc === null) continue;
    const tcObj = tc as Record<string, unknown>;
    if (tcObj.type !== 'function') continue;
    const fn = tcObj.function as Record<string, unknown> | undefined;
    if (!fn || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') continue;
    result.push({ id: String(tcObj.id ?? ''), type: 'function', function: { name: fn.name, arguments: fn.arguments } });
  }
  return result;
}

function parseDelta(data: string): { content: string | null; toolCalls: ToolCall[] | null } | null {
  try {
    const delta = tryParseDelta(data);
    if (!delta) return null;
    const content = typeof delta.content === 'string' ? delta.content : null;
    const toolCalls = extractToolCallsFromDelta(delta);
    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : null };
  } catch {
    return null;
  }
}

// ?? OpenAI-compatible chat stream parser ??????????????????????????????????

function eventsFromParsedDelta(parsed: { content: string | null; toolCalls: ToolCall[] | null }): ChatStreamEvent[] {
  const events: ChatStreamEvent[] = [];
  if (parsed.content) events.push({ type: 'chunk', content: parsed.content });
  if (parsed.toolCalls) {
    for (const tc of parsed.toolCalls) events.push({ type: 'tool_use', toolCall: tc });
  }
  return events;
}

function processSseBuffer(buffer: string): { events: ChatStreamEvent[]; remaining: string; done: boolean } {
  const lines = buffer.split('\n');
  const remaining = lines.pop() ?? '';
  const events: ChatStreamEvent[] = [];

  for (const line of lines) {
    const data = extractSseContent(line);
    if (data === null) return { events, remaining, done: true };
    if (data === undefined) continue;
    const parsed = parseDelta(data);
    if (parsed) events.push(...eventsFromParsedDelta(parsed));
  }

  return { events, remaining, done: false };
}

/** Discriminated union for readWithHeartbeat result. */
type HeartbeatReadResult =
  | { kind: 'data'; value: Uint8Array }
  | { kind: 'done' }
  | { kind: 'heartbeat-timeout' }
  | { kind: 'abort' };

/**
 * Reads from a stream with a heartbeat timeout.
 * Returns a discriminated union describing the outcome.
 */
async function readWithHeartbeat(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  heartbeatTimeoutMs: number
): Promise<HeartbeatReadResult> {
  const readPromise = reader.read();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const bailoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Stream heartbeat timeout: no data for ${heartbeatTimeoutMs}ms`)),
      heartbeatTimeoutMs
    );
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      },
      { once: true }
    );
  });

  try {
    const { done, value } = await Promise.race([readPromise, bailoutPromise]);
    clearTimeout(timer);
    return done ? { kind: 'done' } : { kind: 'data', value };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') return { kind: 'abort' };
    if (err instanceof Error && err.message.includes('heartbeat timeout')) return { kind: 'heartbeat-timeout' };
    throw err;
  }
}

async function* parseOpenAIStream(
  response: Response,
  signal?: AbortSignal,
  heartbeatTimeoutMs: number = STREAM_HEARTBEAT_TIMEOUT_MS
): AsyncIterable<ChatStreamEvent> {
  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: 'error', message: 'No response body from provider.' };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const r = await readWithHeartbeat(reader, signal, heartbeatTimeoutMs);
      if (r.kind === 'abort' || r.kind === 'done') break;
      if (r.kind === 'heartbeat-timeout') {
        yield { type: 'error', message: `Stream heartbeat timeout: no data for ${heartbeatTimeoutMs}ms` };
        break;
      }

      buffer += decoder.decode(r.value, { stream: true });
      const sseResult = processSseBuffer(buffer);
      buffer = sseResult.remaining;

      for (const event of sseResult.events) yield event;
      if (sseResult.done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

// ?? OpenAI-compatible base adapter ???????????????????????????????????????

abstract class OpenAICompatibleAdapter implements ModelProviderAdapter {
  abstract readonly providerId: ModelProviderId;
  abstract readonly label: string;

  protected abstract buildChatUrl(baseUrl: string): string;
  protected abstract buildModelsUrl(baseUrl: string): string;
  protected abstract buildHeaders(baseUrl: string): Record<string, string>;
  protected abstract parseModelsResponse(data: unknown): readonly ModelInfo[];

  async healthCheck(baseUrl: string): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(this.buildModelsUrl(baseUrl), {
        method: 'GET',
        headers: this.buildHeaders(baseUrl),
        timeoutMs: 5000
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(baseUrl: string): Promise<readonly ModelInfo[]> {
    try {
      const response = await fetchWithTimeout(this.buildModelsUrl(baseUrl), {
        method: 'GET',
        headers: this.buildHeaders(baseUrl),
        timeoutMs: 10000
      });
      if (!response.ok) return [];
      const data: unknown = await response.json();
      return this.parseModelsResponse(data);
    } catch {
      return [];
    }
  }

  protected buildMessagePayload(message: ChatMessage): Record<string, unknown> {
    const payload: Record<string, unknown> = { role: message.role, content: message.content };
    if (message.tool_calls !== undefined) {
      payload.tool_calls = message.tool_calls.map(tc => ({
        id: tc.id,
        type: tc.type,
        function: { name: tc.function.name, arguments: tc.function.arguments }
      }));
    }
    if (message.tool_call_id !== undefined) {
      payload.tool_call_id = message.tool_call_id;
    }
    return payload;
  }

  async *chat(
    baseUrl: string,
    modelId: string,
    messages: readonly ChatMessage[],
    signal?: AbortSignal,
    tools?: readonly ToolDefinition[]
  ): AsyncIterable<ChatStreamEvent> {
    try {
      const body: Record<string, unknown> = {
        model: modelId,
        messages: messages.map(m => this.buildMessagePayload(m)),
        stream: true
      };
      if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }

      const response = await fetchWithTimeout(this.buildChatUrl(baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.buildHeaders(baseUrl)
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
        timeoutMs: 120000
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        yield {
          type: 'error',
          message: `Provider returned ${response.status}: ${body.slice(0, 200)}`
        };
        return;
      }

      yield* parseOpenAIStream(response, signal);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const code = classifyError(err);
      const message = err instanceof Error ? err.message : 'Network error';
      yield { type: 'error', message: `[${code}] ${message}` };
    }
  }
}

// ?? OpenRouter adapter ???????????????????????????????????????????????????

export class OpenRouterAdapter extends OpenAICompatibleAdapter {
  readonly providerId = 'openrouter' as const;
  readonly label = 'OpenRouter';

  protected buildChatUrl(baseUrl: string): string {
    return `${baseUrl}/chat/completions`;
  }

  protected buildModelsUrl(baseUrl: string): string {
    return `${baseUrl}/models`;
  }

  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  protected parseModelsResponse(data: unknown): readonly ModelInfo[] {
    if (!data || typeof data !== 'object' || !('data' in data)) return [];
    const items = (data as Record<string, unknown>).data as unknown[];
    if (!Array.isArray(items)) return [];

    return items
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map(item => ({
        id: String(item.id ?? ''),
        name: String(item.name ?? item.id ?? 'Unknown'),
        provider: 'openrouter' as const,
        contextWindow: typeof item.context_length === 'number' ? item.context_length : 4096,
        supportsTools: Array.isArray(item.supported_parameters) && item.supported_parameters.includes('tools'),
        supportsStreaming: true,
        supportsEmbeddings: false
      }))
      .filter(m => m.id);
  }
}

// ?? Ollama adapter ???????????????????????????????????????????????????????

export class OllamaAdapter extends OpenAICompatibleAdapter {
  readonly providerId = 'ollama' as const;
  readonly label = 'Ollama';

  protected buildChatUrl(baseUrl: string): string {
    return `${baseUrl}/api/chat`;
  }

  protected buildModelsUrl(baseUrl: string): string {
    return `${baseUrl}/api/tags`;
  }

  protected buildHeaders(): Record<string, string> {
    return {};
  }

  protected parseModelsResponse(data: unknown): readonly ModelInfo[] {
    if (!data || typeof data !== 'object' || !('models' in data)) return [];
    const items = (data as Record<string, unknown>).models as unknown[];
    if (!Array.isArray(items)) return [];

    return items
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map(item => ({
        id: String(item.name ?? ''),
        name: String(item.name ?? 'Unknown'),
        provider: 'ollama' as const,
        contextWindow: 4096,
        supportsTools: false,
        supportsStreaming: true,
        supportsEmbeddings: false
      }))
      .filter(m => m.id);
  }

  // Override chat to use Ollama's native /api/chat format
  override async *chat(
    baseUrl: string,
    modelId: string,
    messages: readonly ChatMessage[],
    signal?: AbortSignal,
    tools?: readonly ToolDefinition[]
  ): AsyncIterable<ChatStreamEvent> {
    try {
      const response = await this.fetchOllamaResponse(baseUrl, modelId, messages, signal, tools);
      if (!response.ok) return;

      yield* this.streamOllamaChunks(response, signal);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const code = classifyError(err);
      const message = err instanceof Error ? err.message : 'Network error';
      yield { type: 'error', message: `[${code}] ${message}` };
    }
  }

  private async fetchOllamaResponse(
    baseUrl: string,
    modelId: string,
    messages: readonly ChatMessage[],
    signal?: AbortSignal,
    tools?: readonly ToolDefinition[]
  ): Promise<Response> {
    const body: Record<string, unknown> = {
      model: modelId,
      messages: messages.map(m => this.buildMessagePayload(m)),
      stream: true
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetchWithTimeout(this.buildChatUrl(baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
      timeoutMs: 120000
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const errorMsg = `Ollama returned ${response.status}: ${body.slice(0, 200)}`;
      // We can't yield from here, so we throw and let the caller handle
      throw new Error(errorMsg);
    }

    return response;
  }

  private async *readOllamaLines(response: Response, signal?: AbortSignal): AsyncIterable<string> {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buf = '';

    try {
      while (true) {
        const r = await readWithHeartbeat(reader, signal, STREAM_HEARTBEAT_TIMEOUT_MS);
        if (r.kind === 'abort' || r.kind === 'done') break;
        if (r.kind === 'heartbeat-timeout') throw new Error(`Stream heartbeat timeout: no data for ${STREAM_HEARTBEAT_TIMEOUT_MS}ms`);

        buf += decoder.decode(r.value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) yield line.trim();
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async *streamOllamaChunks(
    response: Response,
    signal?: AbortSignal
  ): AsyncIterable<ChatStreamEvent> {
    for await (const line of this.readOllamaLines(response, signal)) {
      const result = this.parseOllamaLine(line);
      if (result === 'done') return;
      if (result) {
        for (const event of result) yield event;
      }
    }
  }

  private extractOllamaToolEvents(toolCalls: unknown): ChatStreamEvent[] {
    if (!Array.isArray(toolCalls)) return [];
    const events: ChatStreamEvent[] = [];
    for (const tc of toolCalls) {
      if (typeof tc !== 'object' || tc === null) continue;
      const tcObj = tc as Record<string, unknown>;
      // Ollama native format may omit 'type'; OpenAI format requires 'function'
      const tcType = tcObj.type;
      if (tcType !== undefined && tcType !== 'function') continue;
      const fn = tcObj.function as Record<string, unknown> | undefined;
      if (!fn || typeof fn.name !== 'string' || fn.name === '') continue;
      const argsStr = this.normalizeOllamaArguments(fn.arguments);
      if (argsStr === null) continue;
      const rawId = tcObj.id;
      events.push({
        type: 'tool_use',
        toolCall: { id: typeof rawId === 'string' ? rawId : '', type: 'function', function: { name: fn.name, arguments: argsStr } }
      });
    }
    return events;
  }

  private normalizeOllamaArguments(args: unknown): string | null {
    if (typeof args === 'string') return args;
    if (typeof args === 'object' && args !== null) return JSON.stringify(args);
    return null;
  }

  private parseOllamaLine(trimmed: string): ChatStreamEvent[] | 'done' | null {
    if (!trimmed) return null;

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== 'object') return null;

      if ((parsed as Record<string, unknown>).done === true) return 'done';

      if ('message' in parsed) {
        const msg = (parsed as Record<string, unknown>).message as Record<string, unknown> | undefined;
        if (!msg) return null;

        const events: ChatStreamEvent[] = [];
        if (typeof msg.content === 'string' && msg.content) {
          events.push({ type: 'chunk', content: msg.content });
        }
        if (Array.isArray(msg.tool_calls)) {
          events.push(...this.extractOllamaToolEvents(msg.tool_calls));
        }
        return events.length > 0 ? events : null;
      }
    } catch {
      // Partial lines at chunk boundaries are expected during streaming — return null silently.
      // If you need parse diagnostics, enable debug logging here.
    }

    return null;
  }
}

// ?? LM Studio adapter ????????????????????????????????????????????????????

export class LmStudioAdapter extends OpenAICompatibleAdapter {
  readonly providerId = 'lmstudio' as const;
  readonly label = 'LM Studio';

  protected buildChatUrl(baseUrl: string): string {
    return `${baseUrl}/chat/completions`;
  }

  protected buildModelsUrl(baseUrl: string): string {
    return `${baseUrl}/models`;
  }

  protected buildHeaders(): Record<string, string> {
    return {};
  }

  protected parseModelsResponse(data: unknown): readonly ModelInfo[] {
    if (!data || typeof data !== 'object' || !('data' in data)) return [];
    const items = (data as Record<string, unknown>).data as unknown[];
    if (!Array.isArray(items)) return [];

    return items
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map(item => ({
        id: String(item.id ?? ''),
        name: String(item.id ?? 'Unknown'),
        provider: 'lmstudio' as const,
        contextWindow: typeof item.context_length === 'number' ? item.context_length : 4096,
        supportsTools: false,
        supportsStreaming: true,
        supportsEmbeddings: false
      }))
      .filter(m => m.id);
  }
}

// ?? Generic OpenAI-compatible adapter ???????????????????????????????????

export class OpenAiCompatibleAdapter extends OpenAICompatibleAdapter {
  readonly providerId = 'openai-compatible' as const;
  readonly label = 'OpenAI Compatible';

  protected buildChatUrl(baseUrl: string): string {
    return `${baseUrl}/chat/completions`;
  }

  protected buildModelsUrl(baseUrl: string): string {
    return `${baseUrl}/models`;
  }

  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  protected parseModelsResponse(data: unknown): readonly ModelInfo[] {
    if (!data || typeof data !== 'object' || !('data' in data)) return [];
    const items = (data as Record<string, unknown>).data as unknown[];
    if (!Array.isArray(items)) return [];

    return items
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map(item => ({
        id: String(item.id ?? ''),
        name: String(item.id ?? 'Unknown'),
        provider: 'openai-compatible' as const,
        contextWindow: 4096,
        supportsTools: true,
        supportsStreaming: true,
        supportsEmbeddings: false
      }))
      .filter(m => m.id);
  }
}

// ?? Factory ???????????????????????????????????????????????????????????????

export function createDefaultAdapters(): readonly ModelProviderAdapter[] {
  return [
    new OpenRouterAdapter(),
    new OllamaAdapter(),
    new LmStudioAdapter(),
    new OpenAiCompatibleAdapter()
  ];
}
