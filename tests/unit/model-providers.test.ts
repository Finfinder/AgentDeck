import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage, ChatStreamEvent } from '@agentdeck/shared';
import {
  OpenRouterAdapter,
  OllamaAdapter,
  LmStudioAdapter,
  OpenAiCompatibleAdapter,
  createDefaultAdapters,
  classifyError,
  STREAM_HEARTBEAT_TIMEOUT_MS
} from '@agentdeck/services';

function createMockResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

function createSSEStream(chunks: Array<{ choices: Array<{ delta: { content: string } }> }>): Response {
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

async function collectStream(generator: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('createDefaultAdapters', () => {
  it('returns all 4 default adapters', () => {
    const adapters = createDefaultAdapters();
    expect(adapters).toHaveLength(4);
    expect(adapters[0]!.providerId).toBe('openrouter');
    expect(adapters[1]!.providerId).toBe('ollama');
    expect(adapters[2]!.providerId).toBe('lmstudio');
    expect(adapters[3]!.providerId).toBe('openai-compatible');
  });
});

describe('OpenRouterAdapter', () => {
  it('has correct provider id and label', () => {
    const adapter = new OpenRouterAdapter();
    expect(adapter.providerId).toBe('openrouter');
    expect(adapter.label).toBe('OpenRouter');
  });

  it('streams chat completions', async () => {
    const adapter = new OpenRouterAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    globalThis.fetch = vi.fn().mockResolvedValue(
      createSSEStream([
        { choices: [{ delta: { content: 'Hi' } }] },
        { choices: [{ delta: { content: ' there' } }] }
      ])
    );

    const events = await collectStream(adapter.chat('https://openrouter.ai/api/v1', 'gpt-4', messages));
    const chunks = events.filter(e => e.type === 'chunk');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.content).toBe('Hi');
    expect(chunks[1]!.content).toBe(' there');
  });

  it('includes Authorization header when API key is set', async () => {
    const adapter = new OpenRouterAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    process.env.OPENROUTER_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue(
      createSSEStream([{ choices: [{ delta: { content: 'Hi' } }] }])
    );

    await collectStream(adapter.chat('https://openrouter.ai/api/v1', 'gpt-4', messages));

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key');

    delete process.env.OPENROUTER_API_KEY;
  });

  it('includes Authorization header from API key provider', async () => {
    const adapter = new OpenRouterAdapter(async providerId => providerId === 'openrouter' ? 'provider-key' : null);
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    globalThis.fetch = vi.fn().mockResolvedValue(
      createSSEStream([{ choices: [{ delta: { content: 'Hi' } }] }])
    );

    await collectStream(adapter.chat('https://openrouter.ai/api/v1', 'gpt-4', messages));

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer provider-key');
  });

  it('lists models from API', async () => {
    const adapter = new OpenRouterAdapter();
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(JSON.stringify({
        data: [
          { id: 'gpt-4', name: 'GPT-4', context_length: 8192 },
          { id: 'claude-3', name: 'Claude 3', context_length: 200000 }
        ]
      }))
    );

    const models = await adapter.listModels('https://openrouter.ai/api/v1');
    expect(models).toHaveLength(2);
    expect(models[0]!.id).toBe('gpt-4');
    expect(models[0]!.contextWindow).toBe(8192);
    expect(models[1]!.id).toBe('claude-3');
  });

  it('returns empty models on error', async () => {
    const adapter = new OpenRouterAdapter();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const models = await adapter.listModels('https://openrouter.ai/api/v1');
    expect(models).toEqual([]);
  });

  it('health check returns true on ok response', async () => {
    const adapter = new OpenRouterAdapter();
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse('{}'));

    const result = await adapter.healthCheck('https://openrouter.ai/api/v1');
    expect(result).toBe(true);
  });

  it('health check returns false on error', async () => {
    const adapter = new OpenRouterAdapter();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await adapter.healthCheck('https://openrouter.ai/api/v1');
    expect(result).toBe(false);
  });
});

describe('OllamaAdapter', () => {
  it('has correct provider id and label', () => {
    const adapter = new OllamaAdapter();
    expect(adapter.providerId).toBe('ollama');
    expect(adapter.label).toBe('Ollama');
  });

  it('streams chat via Ollama native format', async () => {
    const adapter = new OllamaAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: { content: 'Hi' }, done: false }) + '\n' +
        JSON.stringify({ message: { content: ' there' }, done: false }) + '\n' +
        JSON.stringify({ done: true }) + '\n',
        { status: 200 }
      )
    );

    const events = await collectStream(adapter.chat('http://localhost:11434', 'llama2', messages));
    const chunks = events.filter(e => e.type === 'chunk');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.content).toBe('Hi');
    expect(chunks[1]!.content).toBe(' there');
  });

  it('lists models from /api/tags', async () => {
    const adapter = new OllamaAdapter();
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(JSON.stringify({
        models: [{ name: 'llama2' }, { name: 'mistral' }]
      }))
    );

    const models = await adapter.listModels('http://localhost:11434');
    expect(models).toHaveLength(2);
    expect(models[0]!.id).toBe('llama2');
    expect(models[1]!.id).toBe('mistral');
  });

  it('handles non-ok response', async () => {
    const adapter = new OllamaAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Not Found', { status: 404 })
    );

    const events = await collectStream(adapter.chat('http://localhost:11434', 'llama2', messages));
    expect(events.some(e => e.type === 'error')).toBe(true);
  });
});

describe('LmStudioAdapter', () => {
  it('has correct provider id and label', () => {
    const adapter = new LmStudioAdapter();
    expect(adapter.providerId).toBe('lmstudio');
    expect(adapter.label).toBe('LM Studio');
  });

  it('uses OpenAI-compatible endpoint', async () => {
    const adapter = new LmStudioAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    globalThis.fetch = vi.fn().mockResolvedValue(
      createSSEStream([{ choices: [{ delta: { content: 'Hello from LM Studio' } }] }])
    );

    await collectStream(adapter.chat('http://localhost:1234/v1', 'llama-3', messages));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:1234/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('lists models from /v1/models', async () => {
    const adapter = new LmStudioAdapter();
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(JSON.stringify({
        data: [{ id: 'llama-3-8b', context_length: 8192 }]
      }))
    );

    const models = await adapter.listModels('http://localhost:1234/v1');
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe('llama-3-8b');
  });

  it('health check works', async () => {
    const adapter = new LmStudioAdapter();
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse('{}'));

    expect(await adapter.healthCheck('http://localhost:1234/v1')).toBe(true);
  });
});

describe('OpenRouterAdapter edge cases', () => {
  it('works without API key', async () => {
    const adapter = new OpenRouterAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    delete process.env.OPENROUTER_API_KEY;
    globalThis.fetch = vi.fn().mockResolvedValue(
      createSSEStream([{ choices: [{ delta: { content: 'Hi' } }] }])
    );

    await collectStream(adapter.chat('https://openrouter.ai/api/v1', 'gpt-4', messages));

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});

describe('OpenAiCompatibleAdapter', () => {
  it('has correct provider id and label', () => {
    const adapter = new OpenAiCompatibleAdapter();
    expect(adapter.providerId).toBe('openai-compatible');
    expect(adapter.label).toBe('OpenAI Compatible');
  });

  it('includes Authorization header when API key is set', async () => {
    const adapter = new OpenAiCompatibleAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    process.env.OPENAI_API_KEY = 'sk-test';
    globalThis.fetch = vi.fn().mockResolvedValue(
      createSSEStream([{ choices: [{ delta: { content: 'Hi' } }] }])
    );

    await collectStream(adapter.chat('https://api.example.com/v1', 'gpt-4', messages));

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');

    delete process.env.OPENAI_API_KEY;
  });

  it('lists models from API', async () => {
    const adapter = new OpenAiCompatibleAdapter();
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(JSON.stringify({
        data: [{ id: 'gpt-4', context_length: 8192 }]
      }))
    );

    const models = await adapter.listModels('https://api.example.com/v1');
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe('gpt-4');
  });

  it('health check works', async () => {
    const adapter = new OpenAiCompatibleAdapter();
    globalThis.fetch = vi.fn().mockResolvedValue(createMockResponse('{}'));

    expect(await adapter.healthCheck('https://api.example.com/v1')).toBe(true);
  });
});

// ?? Tool calling tests ???????????????????????????????????????????????????

function createSSEToolCallStream(toolCalls: Array<{ id: string; name: string; args: string }>): Response {
  const chunks = toolCalls.map(tc => ({
    choices: [{
      delta: {
        tool_calls: [{
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.args }
        }]
      }
    }]
  }));
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

describe('Tool calling - OpenAI-compatible adapters', () => {
  it('parses tool_use events from SSE stream (OpenRouter)', async () => {
    const adapter = new OpenRouterAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'weather?', timestamp: 1000 }];

    globalThis.fetch = vi.fn().mockResolvedValue(
      createSSEToolCallStream([{ id: 'call_1', name: 'get_weather', args: '{"city":"Warsaw"}' }])
    );

    const events = await collectStream(adapter.chat('https://openrouter.ai/api/v1', 'gpt-4', messages));
    const toolUseEvents = events.filter(e => e.type === 'tool_use');
    expect(toolUseEvents).toHaveLength(1);
    expect(toolUseEvents[0]!.toolCall.function.name).toBe('get_weather');
    expect(toolUseEvents[0]!.toolCall.function.arguments).toBe('{"city":"Warsaw"}');
  });

  it('parses tool_use events from SSE stream (LM Studio)', async () => {
    const adapter = new LmStudioAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'weather?', timestamp: 1000 }];

    globalThis.fetch = vi.fn().mockResolvedValue(
      createSSEToolCallStream([{ id: 'call_1', name: 'get_weather', args: '{"city":"Warsaw"}' }])
    );

    const events = await collectStream(adapter.chat('http://localhost:1234/v1', 'llama-3', messages));
    const toolUseEvents = events.filter(e => e.type === 'tool_use');
    expect(toolUseEvents).toHaveLength(1);
  });

  it('parses mixed content and tool_use events', async () => {
    const adapter = new OpenRouterAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'weather?', timestamp: 1000 }];

    const body =
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Let me check' } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }] } }] })}\n\n` +
      'data: [DONE]\n\n';

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    );

    const events = await collectStream(adapter.chat('https://openrouter.ai/api/v1', 'gpt-4', messages));
    const chunks = events.filter(e => e.type === 'chunk');
    const toolUses = events.filter(e => e.type === 'tool_use');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('Let me check');
    expect(toolUses).toHaveLength(1);
  });

  it('sends tools in request body when provided', async () => {
    const adapter = new OpenRouterAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    delete process.env.OPENROUTER_API_KEY;
    globalThis.fetch = vi.fn().mockResolvedValue(
      createSSEStream([{ choices: [{ delta: { content: 'Hi' } }] }])
    );

    const tools = [{
      type: 'function' as const,
      function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } }
    }];

    await collectStream(adapter.chat('https://openrouter.ai/api/v1', 'gpt-4', messages, undefined, tools));

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.tools).toBeDefined();
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe('get_weather');
    expect(body.tool_choice).toBe('auto');
  });

  it('sends assistant tool_calls message with null content', async () => {
    const adapter = new OpenRouterAdapter();
    const messages: ChatMessage[] = [
      { role: 'assistant', content: ' ', timestamp: 1000, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_files', arguments: '{"pattern":"Readme.md"}' } }] }
    ];

    delete process.env.OPENROUTER_API_KEY;
    globalThis.fetch = vi.fn().mockResolvedValue(
      createSSEStream([{ choices: [{ delta: { content: 'Hi' } }] }])
    );

    await collectStream(adapter.chat('https://openrouter.ai/api/v1', 'gpt-4', messages));

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.messages[0].role).toBe('assistant');
    expect(body.messages[0].content).toBeNull();
    expect(body.messages[0].tool_calls).toHaveLength(1);
    expect(body.messages[0].tool_calls[0].function.name).toBe('search_files');
  });

  it('does not send tools when not provided', async () => {
    const adapter = new OpenRouterAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    delete process.env.OPENROUTER_API_KEY;
    globalThis.fetch = vi.fn().mockResolvedValue(
      createSSEStream([{ choices: [{ delta: { content: 'Hi' } }] }])
    );

    await collectStream(adapter.chat('https://openrouter.ai/api/v1', 'gpt-4', messages));

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});

describe('Tool calling - Ollama adapter', () => {
  it('parses tool_use from Ollama native format (string arguments)', async () => {
    const adapter = new OllamaAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'weather?', timestamp: 1000 }];

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            tool_calls: [{
              function: { name: 'get_weather', arguments: '{"city":"Warsaw"}' }
            }]
          },
          done: false
        }) + '\n' +
        JSON.stringify({ done: true }) + '\n',
        { status: 200 }
      )
    );

    const events = await collectStream(adapter.chat('http://localhost:11434', 'llama3', messages));
    const toolUseEvents = events.filter(e => e.type === 'tool_use');
    expect(toolUseEvents).toHaveLength(1);
    expect(toolUseEvents[0]!.toolCall.function.name).toBe('get_weather');
    expect(toolUseEvents[0]!.toolCall.function.arguments).toBe('{"city":"Warsaw"}');
  });

  it('parses tool_use from Ollama native format (object arguments)', async () => {
    const adapter = new OllamaAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'weather?', timestamp: 1000 }];

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            tool_calls: [{
              function: { name: 'get_weather', arguments: { city: 'Warsaw' } }
            }]
          },
          done: false
        }) + '\n' +
        JSON.stringify({ done: true }) + '\n',
        { status: 200 }
      )
    );

    const events = await collectStream(adapter.chat('http://localhost:11434', 'llama3', messages));
    const toolUseEvents = events.filter(e => e.type === 'tool_use');
    expect(toolUseEvents).toHaveLength(1);
    expect(toolUseEvents[0]!.toolCall.function.name).toBe('get_weather');
    expect(toolUseEvents[0]!.toolCall.function.arguments).toBe('{"city":"Warsaw"}');
  });

  it('sends tools in Ollama request body when provided', async () => {
    const adapter = new OllamaAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: { content: 'Hi' }, done: false }) + '\n' +
        JSON.stringify({ done: true }) + '\n',
        { status: 200 }
      )
    );

    const tools = [{
      type: 'function' as const,
      function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } }
    }];

    await collectStream(adapter.chat('http://localhost:11434', 'llama3', messages, undefined, tools));

    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.tools).toBeDefined();
    expect(body.tools).toHaveLength(1);
  });
});

describe('Tool calling - OpenRouter supportsTools detection', () => {
  it('sets supportsTools true when model has tools in supported_parameters', async () => {
    const adapter = new OpenRouterAdapter();
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(JSON.stringify({
        data: [
          { id: 'gpt-4', name: 'GPT-4', context_length: 8192, supported_parameters: ['tools', 'streaming'] }
        ]
      }))
    );

    const models = await adapter.listModels('https://openrouter.ai/api/v1');
    expect(models[0]!.supportsTools).toBe(true);
  });

  it('sets supportsTools false when model lacks tools in supported_parameters', async () => {
    const adapter = new OpenRouterAdapter();
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse(JSON.stringify({
        data: [
          { id: 'llama2', name: 'Llama 2', context_length: 4096, supported_parameters: ['streaming'] }
        ]
      }))
    );

    const models = await adapter.listModels('https://openrouter.ai/api/v1');
    expect(models[0]!.supportsTools).toBe(false);
  });
});

// ?? Error classification tests ??????????????????????????????????????????

describe('classifyError', () => {
  it('returns NETWORK_ERROR for ECONNREFUSED', () => {
    expect(classifyError(new Error('connect ECONNREFUSED 127.0.0.1:11434'))).toBe('NETWORK_ERROR');
  });

  it('returns NETWORK_ERROR for ENOTFOUND', () => {
    expect(classifyError(new Error('getaddrinfo ENOTFOUND api.example.com'))).toBe('NETWORK_ERROR');
  });

  it('returns NETWORK_ERROR for socket hang up', () => {
    expect(classifyError(new Error('socket hang up'))).toBe('NETWORK_ERROR');
  });

  it('returns NETWORK_ERROR for fetch failed', () => {
    expect(classifyError(new Error('fetch failed'))).toBe('NETWORK_ERROR');
  });

  it('returns NETWORK_ERROR for timeout', () => {
    expect(classifyError(new Error('request timed out'))).toBe('NETWORK_ERROR');
  });

  it('returns NETWORK_ERROR for heartbeat timeout', () => {
    expect(classifyError(new Error('Stream heartbeat timeout: no data for 60000ms'))).toBe('NETWORK_ERROR');
  });

  it('returns NETWORK_ERROR for AbortError', () => {
    expect(classifyError(new Error('The operation was aborted'))).toBe('NETWORK_ERROR');
  });

  it('returns MODEL_ERROR for model not found', () => {
    expect(classifyError(new Error('model "gpt-99" does not exist'))).toBe('MODEL_ERROR');
  });

  it('returns MODEL_ERROR for context length exceeded', () => {
    expect(classifyError(new Error('context length exceeded'))).toBe('MODEL_ERROR');
  });

  it('returns MODEL_ERROR for max tokens', () => {
    expect(classifyError(new Error('max tokens exceeded for model'))).toBe('MODEL_ERROR');
  });

  it('returns PROVIDER_ERROR for generic errors', () => {
    expect(classifyError(new Error('Internal server error'))).toBe('PROVIDER_ERROR');
  });

  it('returns PROVIDER_ERROR for non-Error values', () => {
    expect(classifyError('string error')).toBe('PROVIDER_ERROR');
  });

  it('returns PROVIDER_ERROR for null', () => {
    expect(classifyError(null)).toBe('PROVIDER_ERROR');
  });

  it('returns PROVIDER_ERROR for undefined', () => {
    expect(classifyError(undefined)).toBe('PROVIDER_ERROR');
  });
});

// ?? Stream heartbeat timeout tests ??????????????????????????????????????

describe('STREAM_HEARTBEAT_TIMEOUT_MS', () => {
  it('is set to 60000ms', () => {
    expect(STREAM_HEARTBEAT_TIMEOUT_MS).toBe(60000);
  });
});

// ?? Adapter error message format tests ??????????????????????????????????

describe('Adapter error message format', () => {
  it('OpenAI-compatible adapter wraps errors with [CODE] prefix', async () => {
    const adapter = new OpenRouterAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    delete process.env.OPENROUTER_API_KEY;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    const events = await collectStream(adapter.chat('https://openrouter.ai/api/v1', 'gpt-4', messages));
    const errorEvents = events.filter(e => e.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.message).toMatch(/^\[NETWORK_ERROR\]/);
  });

  it('Ollama adapter wraps errors with [CODE] prefix', async () => {
    const adapter = new OllamaAdapter();
    const messages: ChatMessage[] = [{ role: 'user', content: 'hello', timestamp: 1000 }];

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));

    const events = await collectStream(adapter.chat('http://localhost:11434', 'llama3', messages));
    const errorEvents = events.filter(e => e.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.message).toMatch(/^\[NETWORK_ERROR\]/);
  });
});
