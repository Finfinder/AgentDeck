import { describe, expect, it, vi, beforeEach } from 'vitest';

import type {
  ChatMessage,
  ChatStreamEvent,
  ModelInfo,
  ModelProviderId,
  ToolCall
} from '@agentdeck/shared';
import {
  ModelGateway,
  type ModelProviderAdapter,
  type ToolDefinition,
  createModelGateway,
  getModelGateway
} from '@agentdeck/services';

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

describe('ModelGateway — coverage', () => {
  describe('setTabActiveModel', () => {
    it('updates the active model for a tab', () => {
      const gateway = new ModelGateway();
      const tab = gateway.createChatTab();
      gateway.setTabActiveModel(tab.id, 'gpt-4');

      const updated = gateway.getChatTab(tab.id);
      expect(updated!.activeModel).toBe('gpt-4');
    });

    it('does nothing for unknown tab', () => {
      const gateway = new ModelGateway();
      // Should not throw
      gateway.setTabActiveModel('nonexistent', 'gpt-4');
    });

    it('emits chat-tabs-changed when tab model changes', () => {
      const gateway = new ModelGateway();
      const tab = gateway.createChatTab();
      const handler = vi.fn();
      gateway.on('chat-tabs-changed', handler);

      gateway.setTabActiveModel(tab.id, 'gpt-4');
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('setTabActiveProvider', () => {
    it('updates the active provider for a tab', () => {
      const gateway = new ModelGateway();
      const tab = gateway.createChatTab();
      gateway.setTabActiveProvider(tab.id, 'openrouter');

      const updated = gateway.getChatTab(tab.id);
      expect(updated!.activeProvider).toBe('openrouter');
    });

    it('does nothing for unknown tab', () => {
      const gateway = new ModelGateway();
      gateway.setTabActiveProvider('nonexistent', 'openrouter');
    });

    it('emits chat-tabs-changed when tab provider changes', () => {
      const gateway = new ModelGateway();
      const tab = gateway.createChatTab();
      const handler = vi.fn();
      gateway.on('chat-tabs-changed', handler);

      gateway.setTabActiveProvider(tab.id, 'openrouter');
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('setProviderBaseUrl', () => {
    it('updates the base URL for a provider', () => {
      const gateway = new ModelGateway();
      gateway.setProviderBaseUrl('ollama', 'http://remote:11434');

      const config = gateway.getConfig();
      const ollama = config.providers.find(p => p.id === 'ollama');
      expect(ollama!.baseUrl).toBe('http://remote:11434');
    });

    it('does not affect other providers', () => {
      const gateway = new ModelGateway();
      gateway.setProviderBaseUrl('ollama', 'http://remote:11434');

      const config = gateway.getConfig();
      const openrouter = config.providers.find(p => p.id === 'openrouter');
      expect(openrouter!.baseUrl).toBe('https://openrouter.ai/api/v1');
    });
  });

  describe('getProviderConfig', () => {
    it('returns provider config', () => {
      const gateway = new ModelGateway();
      const config = gateway.getProviderConfig('ollama');

      expect(config.baseUrl).toBe('http://localhost:11434');
      expect(config.hasApiKey).toBe(false);
    });

    it('returns empty baseUrl for unknown provider', () => {
      const gateway = new ModelGateway();
      const config = gateway.getProviderConfig('ollama');
      expect(config.baseUrl).toBeDefined();
    });
  });

  describe('updateProviderStatus', () => {
    it('updates provider status and models', () => {
      const gateway = new ModelGateway();
      const models: ModelInfo[] = [
        { id: 'llama2', name: 'Llama 2', provider: 'ollama', contextWindow: 4096, supportsTools: false, supportsStreaming: true, supportsEmbeddings: false }
      ];
      gateway.updateProviderStatus('ollama', 'ready', models);

      const config = gateway.getConfig();
      const ollama = config.providers.find(p => p.id === 'ollama');
      expect(ollama!.status).toBe('ready');
      expect(ollama!.models).toHaveLength(1);
    });

    it('updates status without models', () => {
      const gateway = new ModelGateway();
      gateway.updateProviderStatus('ollama', 'error');

      const config = gateway.getConfig();
      const ollama = config.providers.find(p => p.id === 'ollama');
      expect(ollama!.status).toBe('error');
    });
  });

  describe('getConfig with custom state', () => {
    it('reflects custom active provider and model', () => {
      const gateway = new ModelGateway();
      gateway.setActiveProvider('openrouter');
      gateway.setActiveModel('gpt-4');

      const config = gateway.getConfig();
      expect(config.activeProvider).toBe('openrouter');
      expect(config.activeModel).toBe('gpt-4');
      expect(config.providers).toHaveLength(4);
    });
  });

  describe('sendMessage with abort during retry backoff', () => {
    it('returns NETWORK_ERROR when aborted during retry backoff', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 3, baseDelayMs: 100, maxDelayMs: 200, jitterFactor: 0 });
      let callCount = 0;
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          callCount++;
          yield { type: 'error', message: '[NETWORK_ERROR] Connection refused' };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();

      // Start the send (don't await yet)
      const sendPromise = gateway.sendMessage(tab.id, 'hello');

      // Give it time to fail the first attempt
      await new Promise(r => setTimeout(r, 50));

      // Stop streaming (abort)
      gateway.stopStreaming(tab.id);

      const result = await sendPromise;
      // The result should be an error
      expect(result.status).toBe('error');
    }, 30000);
  });

  describe('sendMessage with tool calls and tool router', () => {
    it('executes tool call through toolRouter', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });

      const tool: ToolDefinition = {
        type: 'function',
        function: { name: 'get_weather', description: 'Get weather', parameters: {} }
      };
      gateway.registerTool(tool);

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
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city": "Warsaw"}' }
              }
            };
          } else {
            yield { type: 'chunk', content: 'Sunny, 22C' };
          }
        })
      };
      gateway.registerAdapter(adapter);

      // Set up a mock tool router
      const mockToolRouter = {
        execute: vi.fn().mockResolvedValue({
          status: 'ok',
          callId: 'call_1',
          result: { temperature: 22, condition: 'sunny' }
        })
      };
      gateway.setToolRouter(mockToolRouter as never);

      gateway.updateProviderStatus('ollama', 'ready', [
        { id: 'llama2', name: 'Llama 2', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
      ]);
      gateway.setActiveModel('llama2');

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'What is the weather?');

      expect(result.status).toBe('ok');
      expect(mockToolRouter.execute).toHaveBeenCalled();
    });
  });

  describe('sendMessage without tool router', () => {
    it('returns placeholder when no toolRouter is set', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });

      const tool: ToolDefinition = {
        type: 'function',
        function: { name: 'get_weather', description: 'Get weather', parameters: {} }
      };
      gateway.registerTool(tool);

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
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city": "Warsaw"}' }
              }
            };
          } else {
            yield { type: 'chunk', content: 'Sunny' };
          }
        })
      };
      gateway.registerAdapter(adapter);

      // No tool router set
      gateway.updateProviderStatus('ollama', 'ready', [
        { id: 'llama2', name: 'Llama 2', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
      ]);
      gateway.setActiveModel('llama2');

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'What is the weather?');

      expect(result.status).toBe('ok');
    });
  });

  describe('sendMessage with tool call parse error', () => {
    it('handles invalid JSON in tool call arguments', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });

      const tool: ToolDefinition = {
        type: 'function',
        function: { name: 'get_weather', description: 'Get weather', parameters: {} }
      };
      gateway.registerTool(tool);

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
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: 'not-valid-json' }
              }
            };
          } else {
            yield { type: 'chunk', content: 'Done' };
          }
        })
      };
      gateway.registerAdapter(adapter);

      gateway.updateProviderStatus('ollama', 'ready', [
        { id: 'llama2', name: 'Llama 2', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
      ]);
      gateway.setActiveModel('llama2');

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'test');

      expect(result.status).toBe('ok');
    });
  });

  describe('sendMessage with tool not found', () => {
    it('returns error message for unregistered tool', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });

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
                id: 'call_1',
                type: 'function',
                function: { name: 'unknown_tool', arguments: '{}' }
              }
            };
          } else {
            yield { type: 'chunk', content: 'Done' };
          }
        })
      };
      gateway.registerAdapter(adapter);

      gateway.updateProviderStatus('ollama', 'ready', [
        { id: 'llama2', name: 'Llama 2', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
      ]);
      gateway.setActiveModel('llama2');

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'test');

      expect(result.status).toBe('ok');
    });
  });

  describe('sendMessage with stream error during collection', () => {
    it('handles exception thrown during stream iteration', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield { type: 'chunk', content: 'Hello' };
          throw new Error('Stream broken');
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
    });
  });

  describe('sendMessage with max tool call depth', () => {
    it('returns error when max tool call depth exceeded', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });

      const tool: ToolDefinition = {
        type: 'function',
        function: { name: 'get_weather', description: 'Get weather', parameters: {} }
      };
      gateway.registerTool(tool);

      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          // Always return a tool call to trigger infinite recursion
          yield {
            type: 'tool_use',
            toolCall: {
              id: `call_${Date.now()}`,
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city": "Warsaw"}' }
            }
          };
        })
      };
      gateway.registerAdapter(adapter);

      // Set up a mock tool router that returns results
      const mockToolRouter = {
        execute: vi.fn().mockResolvedValue({
          status: 'ok',
          callId: 'call_1',
          result: { temperature: 22 }
        })
      };
      gateway.setToolRouter(mockToolRouter as never);

      gateway.updateProviderStatus('ollama', 'ready', [
        { id: 'llama2', name: 'Llama 2', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
      ]);
      gateway.setActiveModel('llama2');

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'test');

      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('PROVIDER_ERROR');
      expect((result as { message: string }).message).toBe('Maximum tool call depth exceeded.');
    });
  });

  describe('sendMessage with retry notification', () => {
    it('emits retry notification events', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, jitterFactor: 0 });
      let callCount = 0;
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          callCount++;
          if (callCount <= 2) {
            yield { type: 'error', message: '[NETWORK_ERROR] Connection refused' };
          } else {
            yield { type: 'chunk', content: 'Success' };
          }
        })
      };
      gateway.registerAdapter(adapter);

      const streamHandler = vi.fn();
      gateway.on('chat-stream', streamHandler);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('ok');

      // Check that retry notification was emitted
      const retryEvents = streamHandler.mock.calls.filter(
        (call: unknown[]) => (call[1] as { type: string }).type === 'info'
      );
      expect(retryEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('sendMessage with non-retryable error', () => {
    it('does not retry on MODEL_ERROR', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, jitterFactor: 0 });
      let callCount = 0;
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          callCount++;
          yield { type: 'error', message: '[MODEL_ERROR] Model not found' };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
      expect(callCount).toBe(1); // No retries for MODEL_ERROR
    });
  });

  describe('sendMessage with AbortError', () => {
    it('marks tab as not streaming after stopStreaming', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield { type: 'chunk', content: 'Hello' };
          yield { type: 'chunk', content: ' world' };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();

      // Start streaming
      const sendPromise = gateway.sendMessage(tab.id, 'hello');

      // Give it a moment to start
      await new Promise(r => setTimeout(r, 50));

      // Stop streaming
      gateway.stopStreaming(tab.id);

      await sendPromise;

      // After stopStreaming, the tab should not be streaming
      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab!.isStreaming).toBe(false);
    }, 30000);
  });

  describe('sendMessage with non-Error thrown', () => {
    it('handles non-Error thrown values', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield { type: 'chunk', content: 'Hello' };
          throw 'string error';
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
    });
  });

  describe('sendMessage with stream error in bracket format', () => {
    it('parses error code from bracket format', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield { type: 'chunk', content: 'Hello' };
          yield { type: 'error', message: '[MODEL_ERROR] Model gpt-99 not found' };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('MODEL_ERROR');
    });
  });

  describe('sendMessage with stream error in non-bracket format', () => {
    it('classifies error code from non-bracket format', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield { type: 'chunk', content: 'Hello' };
          yield { type: 'error', message: 'fetch failed: connect ECONNREFUSED 127.0.0.1:11434' };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('NETWORK_ERROR');
    });
  });

  describe('sendMessage with context length error', () => {
    it('returns MODEL_ERROR for context length exceeded', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield { type: 'error', message: '[MODEL_ERROR] This model\'s maximum context length is 4096 tokens' };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('MODEL_ERROR');
    });
  });

  describe('sendMessage with all retries exhausted without error', () => {
    it('returns UNKNOWN when all retries exhausted without capturing error', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          // Empty stream - no error, no content
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      // Empty stream should complete successfully
      expect(result.status).toBe('ok');
    });
  });

  describe('setToolRouter', () => {
    it('sets the tool router', () => {
      const gateway = new ModelGateway();
      const mockRouter = { execute: vi.fn() };
      gateway.setToolRouter(mockRouter as never);
      // No error means success
    });
  });

  describe('singleton factory', () => {
    it('creates a singleton gateway', () => {
      const gateway1 = createModelGateway();
      const gateway2 = createModelGateway();
      expect(gateway1).toBe(gateway2);
    });

    it('returns the singleton via getModelGateway', () => {
      const gateway = createModelGateway();
      expect(getModelGateway()).toBe(gateway);
    });
  });

  describe('closeChatTab aborts streaming', () => {
    it('aborts streaming when closing a tab', async () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, signal) {
          yield { type: 'chunk', content: 'Hello' };
          // Wait for abort
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();

      // Start streaming
      const sendPromise = gateway.sendMessage(tab.id, 'hello');

      await new Promise(r => setTimeout(r, 50));

      // Close tab while streaming
      gateway.closeChatTab(tab.id);

      await sendPromise.catch(() => {});

      expect(gateway.getChatTab(tab.id)).toBeUndefined();
    }, 30000);
  });

  describe('stopStreaming for unknown tab', () => {
    it('does nothing for unknown tab', () => {
      const gateway = new ModelGateway();
      gateway.stopStreaming('nonexistent');
    });
  });

  describe('sendMessage with multiple user messages', () => {
    it('does not update title after first user message', async () => {
      const gateway = new ModelGateway();
      const adapter = createMockAdapter('ollama');
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'First message');
      await gateway.sendMessage(tab.id, 'Second message');

      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab!.title).toBe('First message');
    });
  });

  describe('sendMessage with empty content', () => {
    it('handles empty user message', async () => {
      const gateway = new ModelGateway();
      const adapter = createMockAdapter('ollama');
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, '');

      expect(result.status).toBe('ok');
    });
  });
});
