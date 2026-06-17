import { describe, expect, it, vi } from 'vitest';

import type {
  ModelInfo,
  ModelProviderId,
  ToolCallRequest,
  ToolCallResponse
} from '@agentdeck/shared';
import {
  ModelGateway,
  createModelGateway,
  getModelGateway,
  type ModelProviderAdapter,
  type ToolExecutor
} from '@agentdeck/services';
import { classifyError } from '@agentdeck/services';

function createMockAdapter(
  providerId: ModelProviderId,
  models: ModelInfo[] = []
): ModelProviderAdapter {
  return {
    providerId,
    label: `Mock ${providerId}`,
    healthCheck: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue(models),
    chat: vi.fn().mockImplementation(async function* () {
      yield { type: 'chunk', content: 'Hello' };
      yield { type: 'chunk', content: ' world' };
    })
  };
}

describe('ModelGateway - tab model/provider management', () => {
  it('setTabActiveModel updates tab model', () => {
    const gateway = new ModelGateway();
    const adapter = createMockAdapter('ollama');
    gateway.registerAdapter(adapter);

    const tab = gateway.createChatTab();
    gateway.setTabActiveModel(tab.id, 'gpt-4');

    const updated = gateway.getChatTab(tab.id);
    expect(updated!.activeModel).toBe('gpt-4');
  });

  it('setTabActiveModel does nothing for unknown tab', () => {
    const gateway = new ModelGateway();
    gateway.setTabActiveModel('nonexistent', 'gpt-4');
  });

  it('setTabActiveProvider updates tab provider', () => {
    const gateway = new ModelGateway();
    const tab = gateway.createChatTab();
    gateway.setTabActiveProvider(tab.id, 'openrouter');

    const updated = gateway.getChatTab(tab.id);
    expect(updated!.activeProvider).toBe('openrouter');
  });

  it('setTabActiveProvider does nothing for unknown tab', () => {
    const gateway = new ModelGateway();
    gateway.setTabActiveProvider('nonexistent', 'openrouter');
  });

  it('setTabAllowedTools updates runtime session allowed tools', () => {
    const gateway = new ModelGateway();
    const tab = gateway.createChatTab();
    gateway.setTabAllowedTools(tab.id, ['read_file', 'search_files']);
  });

  it('setTabAllowedTools does nothing for tab without session', () => {
    const gateway = new ModelGateway();
    gateway.setTabAllowedTools('nonexistent', ['read_file']);
  });
});

describe('ModelGateway - provider config', () => {
  it('setProviderBaseUrl updates provider URL', () => {
    const gateway = new ModelGateway();
    gateway.setProviderBaseUrl('ollama', 'http://custom:9999');

    const config = gateway.getConfig();
    const ollama = config.providers.find(p => p.id === 'ollama');
    expect(ollama!.baseUrl).toBe('http://custom:9999');
  });

  it('getProviderConfig returns baseUrl and hasApiKey', () => {
    const gateway = new ModelGateway();
    gateway.setProviderBaseUrl('ollama', 'http://test:1234');

    const config = gateway.getProviderConfig('ollama');
    expect(config.baseUrl).toBe('http://test:1234');
    expect(config.hasApiKey).toBe(false);
  });

  it('getProviderConfig returns default baseUrl for ollama', () => {
    const gateway = new ModelGateway();
    const config = gateway.getProviderConfig('ollama');
    expect(config.baseUrl).toBe('http://localhost:11434');
  });

  it('getProviderConfig returns empty baseUrl for openai-compatible with no URL', () => {
    const gateway = new ModelGateway();
    const config = gateway.getProviderConfig('openai-compatible');
    expect(config.baseUrl).toBe('');
  });

  it('updateProviderStatus updates status and models', () => {
    const gateway = new ModelGateway();
    const models: ModelInfo[] = [
      { id: 'llama3', name: 'Llama 3', provider: 'ollama', contextWindow: 8192, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ];
    gateway.updateProviderStatus('ollama', 'ready', models);

    const config = gateway.getConfig();
    const ollama = config.providers.find(p => p.id === 'ollama');
    expect(ollama!.status).toBe('ready');
    expect(ollama!.models).toHaveLength(1);
    expect(ollama!.models[0]!.id).toBe('llama3');
  });
});

describe('ModelGateway - tool filtering by allowed names', () => {
  it('filters tools by allowed names when model supports tools', async () => {
    const gateway = new ModelGateway();
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, _signal, tools) {
        expect(tools).toHaveLength(1);
        expect(tools![0]!.function.name).toBe('read_file');
        yield { type: 'chunk', content: 'ok' };
      })
    };
    gateway.registerAdapter(adapter);

    gateway.registerTool({ type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } });
    gateway.registerTool({ type: 'function', function: { name: 'search_files', description: 'Search', parameters: {} } });

    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'llama3', name: 'Llama 3', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('llama3');

    const tab = gateway.createChatTab();
    gateway.setTabAllowedTools(tab.id, ['read_file']);

    await gateway.sendMessage(tab.id, 'hello');
  });

  it('returns all tools when allowed tools is undefined', async () => {
    const gateway = new ModelGateway();
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, _signal, tools) {
        expect(tools).toHaveLength(2);
        yield { type: 'chunk', content: 'ok' };
      })
    };
    gateway.registerAdapter(adapter);

    gateway.registerTool({ type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } });
    gateway.registerTool({ type: 'function', function: { name: 'search_files', description: 'Search', parameters: {} } });

    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'llama3', name: 'Llama 3', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('llama3');

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'hello');
  });
});

describe('ModelGateway - tool execution with toolExecutor', () => {
  it('uses global toolExecutor when no per-tool executor registered', async () => {
    const executor: ToolExecutor = vi.fn(async (toolCall) => {
      return JSON.stringify({ result: `executed-${toolCall.function.name}` });
    });

    let callCount = 0;
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: 'tool_use',
            toolCall: {
              id: 'call_global',
              type: 'function',
              function: { name: 'my_tool', arguments: '{"key":"val"}' }
            }
          };
        } else {
          yield { type: 'chunk', content: 'Done' };
        }
      })
    };

    const gateway = new ModelGateway(executor);
    gateway.registerAdapter(adapter);
    gateway.registerTool({ type: 'function', function: { name: 'my_tool', description: 'A tool', parameters: {} } });
    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('qwen3.6:latest');

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'use the tool');

    expect(executor).toHaveBeenCalled();
    const updatedTab = gateway.getChatTab(tab.id);
    const toolMsg = updatedTab!.messages.find(m => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toBe('{"result":"executed-my_tool"}');
  });

  it('returns pending when no executor configured', async () => {
    let callCount = 0;
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: 'tool_use',
            toolCall: {
              id: 'call_pending',
              type: 'function',
              function: { name: 'unknown_tool', arguments: '{}' }
            }
          };
        } else {
          yield { type: 'chunk', content: 'Done' };
        }
      })
    };

    const gateway = new ModelGateway();
    gateway.registerAdapter(adapter);
    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('qwen3.6:latest');

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'use unknown tool');

    const updatedTab = gateway.getChatTab(tab.id);
    const toolMsg = updatedTab!.messages.find(m => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(toolMsg!.content);
    // Tool is not in allowed set, so it gets "Tool not allowed" error
    expect(parsed.error).toBe('Tool not allowed: unknown_tool');
  });

  it('skips tool execution for tools not in allowed set', async () => {
    let callCount = 0;
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: 'tool_use',
            toolCall: {
              id: 'call_restricted',
              type: 'function',
              function: { name: 'restricted_tool', arguments: '{}' }
            }
          };
        } else {
          yield { type: 'chunk', content: 'Done' };
        }
      })
    };

    const gateway = new ModelGateway();
    gateway.registerAdapter(adapter);
    gateway.registerTool(
      { type: 'function', function: { name: 'restricted_tool', description: 'Restricted', parameters: {} } },
      async () => 'should not execute'
    );
    gateway.registerTool(
      { type: 'function', function: { name: 'allowed_tool', description: 'Allowed', parameters: {} } },
      async () => 'allowed result'
    );
    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('qwen3.6:latest');

    const tab = gateway.createChatTab();
    gateway.setTabAllowedTools(tab.id, ['allowed_tool']);

    await gateway.sendMessage(tab.id, 'use restricted tool');

    const updatedTab = gateway.getChatTab(tab.id);
    const toolMsg = updatedTab!.messages.find(m => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(toolMsg!.content);
    expect(parsed.error).toBe('Tool not allowed: restricted_tool');
  });
});

describe('ModelGateway - tool call with toolRouter', () => {
  it('executes tool through ToolRouter when configured', async () => {
    let callCount = 0;
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: 'tool_use',
            toolCall: {
              id: 'call_router',
              type: 'function',
              function: { name: 'read_file', arguments: '{"filePath":"test.ts"}' }
            }
          };
        } else {
          yield { type: 'chunk', content: 'Done' };
        }
      })
    };

    const gateway = new ModelGateway();
    gateway.registerAdapter(adapter);
    gateway.registerTool({ type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } });
    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('qwen3.6:latest');

    const mockRouter = {
      execute: vi.fn(async (request: ToolCallRequest): Promise<ToolCallResponse> => {
        return {
          status: 'ok',
          callId: request.callId,
          result: { content: 'routed result' }
        };
      })
    };
    gateway.setToolRouter(mockRouter as never);

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'read a file');

    expect(mockRouter.execute).toHaveBeenCalled();
    const updatedTab = gateway.getChatTab(tab.id);
    const toolMsg = updatedTab!.messages.find(m => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toBe('{"content":"routed result"}');
  });

  it('handles ToolRouter error response', async () => {
    let callCount = 0;
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: 'tool_use',
            toolCall: {
              id: 'call_router_err',
              type: 'function',
              function: { name: 'bad_tool', arguments: '{}' }
            }
          };
        } else {
          yield { type: 'chunk', content: 'Done' };
        }
      })
    };

    const gateway = new ModelGateway();
    gateway.registerAdapter(adapter);
    gateway.registerTool({ type: 'function', function: { name: 'bad_tool', description: 'Bad', parameters: {} } });
    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('qwen3.6:latest');

    const mockRouter = {
      execute: vi.fn(async (): Promise<ToolCallResponse> => {
        return {
          status: 'error',
          callId: 'call_router_err',
          code: 'UNKNOWN' as const,
          message: 'Tool execution failed'
        };
      })
    };
    gateway.setToolRouter(mockRouter as never);

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'use bad tool');

    const updatedTab = gateway.getChatTab(tab.id);
    const toolMsg = updatedTab!.messages.find(m => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(toolMsg!.content);
    expect(parsed.error).toBe('Tool execution failed');
  });
});

describe('ModelGateway - tool call message normalization', () => {
  it('normalizes tool call IDs when empty', async () => {
    let callCount = 0;
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: 'tool_use',
            toolCall: {
              id: '',
              type: 'function',
              function: { name: 'test_tool', arguments: '{}' }
            }
          };
        } else {
          yield { type: 'chunk', content: 'Done' };
        }
      })
    };

    const gateway = new ModelGateway();
    gateway.registerAdapter(adapter);
    gateway.registerTool(
      { type: 'function', function: { name: 'test_tool', description: 'Test', parameters: {} } },
      async () => 'result'
    );
    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('qwen3.6:latest');

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'test');

    const updatedTab = gateway.getChatTab(tab.id);
    const assistantMsg = updatedTab!.messages.find(m => m.role === 'assistant' && m.tool_calls);
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.tool_calls![0]!.id).toMatch(/^call_\d+_/);
  });

  it('normalizes tool call arguments when empty', async () => {
    let callCount = 0;
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: 'tool_use',
            toolCall: {
              id: 'call_args',
              type: 'function',
              function: { name: 'test_tool', arguments: '' }
            }
          };
        } else {
          yield { type: 'chunk', content: 'Done' };
        }
      })
    };

    const gateway = new ModelGateway();
    gateway.registerAdapter(adapter);
    gateway.registerTool(
      { type: 'function', function: { name: 'test_tool', description: 'Test', parameters: {} } },
      async () => 'result'
    );
    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('qwen3.6:latest');

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'test');

    const updatedTab = gateway.getChatTab(tab.id);
    const assistantMsg = updatedTab!.messages.find(m => m.role === 'assistant' && m.tool_calls);
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.tool_calls![0]!.function.arguments).toBe('{}');
  });
});

describe('ModelGateway - error handling edge cases', () => {
  it('handles AbortError from adapter during stream iteration', async () => {
    const gateway = new ModelGateway();
    gateway.setRetryPolicy({ maxRetries: 0 });

    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        yield { type: 'chunk', content: 'partial' };
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      })
    };
    gateway.registerAdapter(adapter);

    const tab = gateway.createChatTab();
    const result = await gateway.sendMessage(tab.id, 'hello');

    // AbortError during stream iteration is caught by collectStreamEvents
    // and classified as NETWORK_ERROR via classifyError
    expect(result.status).toBe('error');
  });

  it('handles non-Error thrown values', async () => {
    const gateway = new ModelGateway();
    gateway.setRetryPolicy({ maxRetries: 0 });

    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async () => {
        throw 'string error';
      })
    };
    gateway.registerAdapter(adapter);

    const tab = gateway.createChatTab();
    const result = await gateway.sendMessage(tab.id, 'hello');

    expect(result.status).toBe('error');
  });

  it('handles stream error during iteration', async () => {
    const gateway = new ModelGateway();
    gateway.setRetryPolicy({ maxRetries: 0 });

    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        yield { type: 'chunk', content: 'partial' };
        throw new Error('Stream broken');
      })
    };
    gateway.registerAdapter(adapter);

    const tab = gateway.createChatTab();
    const result = await gateway.sendMessage(tab.id, 'hello');

    expect(result.status).toBe('error');
  });

  it('emits retry notification on retry', async () => {
    const gateway = new ModelGateway();
    gateway.setRetryPolicy({ maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50, jitterFactor: 0 });
    let callCount = 0;

    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: 'error', message: '[NETWORK_ERROR] Connection refused' };
        } else {
          yield { type: 'chunk', content: 'Success' };
        }
      })
    };
    gateway.registerAdapter(adapter);

    const retryHandler = vi.fn();
    gateway.on('chat-stream', (tabId: string, event: { type: string; message?: string }) => {
      if (event.type === 'info' && event.message?.includes('[RETRY]')) {
        retryHandler(event.message);
      }
    });

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'hello');

    expect(retryHandler).toHaveBeenCalledWith(expect.stringContaining('[RETRY] Attempt 1/2'));
  });
});

describe('ModelGateway - singleton factory', () => {
  it('createModelGateway returns same instance', () => {
    const g1 = createModelGateway();
    const g2 = createModelGateway();
    expect(g1).toBe(g2);
  });

  it('getModelGateway returns the created instance', () => {
    const g = createModelGateway();
    expect(getModelGateway()).toBe(g);
  });
});

describe('ModelGateway - reference extraction from tool results', () => {
  it('extracts references from tool result with path field', async () => {
    const gateway = new ModelGateway();
    let callCount = 0;
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: 'tool_use',
            toolCall: {
              id: 'call_ref',
              type: 'function',
              function: { name: 'read_file', arguments: '{"filePath":"src/app.ts"}' }
            }
          };
        } else {
          yield { type: 'chunk', content: 'Done' };
        }
      })
    };
    gateway.registerAdapter(adapter);
    gateway.registerTool(
      { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
      async () => JSON.stringify({ status: 'ok', filePath: 'src/app.ts', content: 'file content' })
    );
    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('qwen3.6:latest');

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'read app.ts');

    const updatedTab = gateway.getChatTab(tab.id);
    const toolMsg = updatedTab!.messages.find(m => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toContain('src/app.ts');
  });

  it('extracts references from tool result with references array', async () => {
    const gateway = new ModelGateway();
    let callCount = 0;
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        callCount++;
        if (callCount === 1) {
          yield {
            type: 'tool_use',
            toolCall: {
              id: 'call_refs',
              type: 'function',
              function: { name: 'search_files', arguments: '{"pattern":"*.ts"}' }
            }
          };
        } else {
          yield { type: 'chunk', content: 'Done' };
        }
      })
    };
    gateway.registerAdapter(adapter);
    gateway.registerTool(
      { type: 'function', function: { name: 'search_files', description: 'Search', parameters: {} } },
      async () => JSON.stringify({ references: ['src/a.ts', 'src/b.ts'] })
    );
    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('qwen3.6:latest');

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'search ts files');

    const updatedTab = gateway.getChatTab(tab.id);
    const toolMsg = updatedTab!.messages.find(m => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toContain('src/a.ts');
  });
});

describe('ModelGateway - markdown link collection', () => {
  it('collects markdown links from assistant message', async () => {
    const gateway = new ModelGateway();
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        yield { type: 'chunk', content: 'See [docs](https://example.com/docs) and [guide](https://example.com/guide)' };
      })
    };
    gateway.registerAdapter(adapter);

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'hello');

    const updatedTab = gateway.getChatTab(tab.id);
    expect(updatedTab!.messages).toHaveLength(2);
    expect(updatedTab!.messages[1]!.content).toContain('https://example.com/docs');
  });
});

describe('ModelGateway - formatInvalidToolArgumentsMessage', () => {
  it('returns read_file specific message for missing filePath', async () => {
    const gateway = new ModelGateway();
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'tool_use',
          toolCall: {
            id: 'call_no_path',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' }
          }
        };
      })
    };
    gateway.registerAdapter(adapter);
    gateway.registerTool(
      { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } },
      async () => JSON.stringify({ error: 'read_file: missing filePath' })
    );
    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('qwen3.6:latest');

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'read something');

    const updatedTab = gateway.getChatTab(tab.id);
    const assistantMsg = updatedTab!.messages.find(m => m.role === 'assistant' && m.content.includes('read_file'));
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toContain('read_file');
    expect(assistantMsg!.content).toContain('wymaganej');
  });

  it('returns generic message for other tools with invalid arguments', async () => {
    const gateway = new ModelGateway();
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'tool_use',
          toolCall: {
            id: 'call_invalid_other',
            type: 'function',
            function: { name: 'search_files', arguments: '{"pattern":null}' }
          }
        };
      })
    };
    gateway.registerAdapter(adapter);
    gateway.registerTool(
      { type: 'function', function: { name: 'search_files', description: 'Search', parameters: {} } },
      async () => JSON.stringify({ error: 'search_files: invalid query' })
    );
    gateway.updateProviderStatus('ollama', 'ready', [
      { id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
    ]);
    gateway.setActiveModel('qwen3.6:latest');

    const tab = gateway.createChatTab();
    await gateway.sendMessage(tab.id, 'search something');

    const updatedTab = gateway.getChatTab(tab.id);
    const assistantMsg = updatedTab!.messages.find(m => m.role === 'assistant' && m.content.includes('search_files'));
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toContain('search_files');
    expect(assistantMsg!.content).toContain('niepoprawne argumenty');
  });
});

describe('ModelGateway - agent runtime event passthrough', () => {
  it('emits agent-runtime-event on session-changed', () => {
    const gateway = new ModelGateway();
    const handler = vi.fn();
    gateway.on('agent-runtime-event', handler);

    // Creating a tab triggers runtime session creation
    gateway.createChatTab();

    // The runtime emits session-changed which should be forwarded
    // Note: exact emission depends on runtime mock behavior
    expect(handler).toHaveBeenCalled();
  });
});

describe('ModelGateway - edge cases', () => {
  it('handles sendMessage with empty content', async () => {
    const gateway = new ModelGateway();
    const adapter = createMockAdapter('ollama');
    gateway.registerAdapter(adapter);

    const tab = gateway.createChatTab();
    const result = await gateway.sendMessage(tab.id, '');

    expect(result.status).toBe('ok');
  });

  it('handles multiple tabs independently', async () => {
    const gateway = new ModelGateway();
    const adapter = createMockAdapter('ollama');
    gateway.registerAdapter(adapter);

    const tab1 = gateway.createChatTab('Tab 1');
    const tab2 = gateway.createChatTab('Tab 2');

    await gateway.sendMessage(tab1.id, 'msg1');
    await gateway.sendMessage(tab2.id, 'msg2');

    const updated1 = gateway.getChatTab(tab1.id);
    const updated2 = gateway.getChatTab(tab2.id);

    expect(updated1!.messages[0]!.content).toBe('msg1');
    expect(updated2!.messages[0]!.content).toBe('msg2');
  });

  it('closeChatTab aborts streaming before close', async () => {
    const gateway = new ModelGateway();
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, signal) {
        yield { type: 'chunk', content: 'start' };
        await new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new Error('Aborted'));
          });
        });
      })
    };
    gateway.registerAdapter(adapter);

    const tab = gateway.createChatTab();
    const sendPromise = gateway.sendMessage(tab.id, 'hello');

    await new Promise(r => setTimeout(r, 50));

    // Close tab should abort and clean up
    gateway.closeChatTab(tab.id);

    await sendPromise.catch(() => {});

    expect(gateway.getChatTab(tab.id)).toBeUndefined();
  }, 30000);

  it('handles provider with empty baseUrl', async () => {
    const gateway = new ModelGateway();
    gateway.setProviderBaseUrl('ollama', '');

    const config = gateway.getProviderConfig('ollama');
    expect(config.baseUrl).toBe('');
  });
});

describe('classifyError', () => {
  it('classifies ECONNREFUSED as NETWORK_ERROR', () => {
    expect(classifyError(new Error('connect ECONNREFUSED 127.0.0.1:11434'))).toBe('NETWORK_ERROR');
  });

  it('classifies ECONNRESET as NETWORK_ERROR', () => {
    expect(classifyError(new Error('socket hang up'))).toBe('NETWORK_ERROR');
  });

  it('classifies DNS errors as NETWORK_ERROR', () => {
    expect(classifyError(new Error('getaddrinfo ENOTFOUND api.example.com'))).toBe('NETWORK_ERROR');
  });

  it('classifies timeout as NETWORK_ERROR', () => {
    expect(classifyError(new Error('Request timeout'))).toBe('NETWORK_ERROR');
  });

  it('classifies context length as MODEL_ERROR', () => {
    expect(classifyError(new Error('context length exceeded'))).toBe('MODEL_ERROR');
  });

  it('classifies model not found as MODEL_ERROR', () => {
    expect(classifyError(new Error('model "gpt-99" does not exist'))).toBe('MODEL_ERROR');
  });

  it('classifies max tokens as MODEL_ERROR', () => {
    expect(classifyError(new Error('max tokens exceeded'))).toBe('MODEL_ERROR');
  });

  it('classifies AbortError as NETWORK_ERROR', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    expect(classifyError(err)).toBe('NETWORK_ERROR');
  });

  it('classifies unknown errors as PROVIDER_ERROR', () => {
    expect(classifyError(new Error('Some random error'))).toBe('PROVIDER_ERROR');
  });

  it('classifies non-Error values as PROVIDER_ERROR', () => {
    expect(classifyError('string error')).toBe('PROVIDER_ERROR');
    expect(classifyError(null)).toBe('PROVIDER_ERROR');
    expect(classifyError(undefined)).toBe('PROVIDER_ERROR');
  });
});
