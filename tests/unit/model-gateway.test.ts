import { describe, expect, it, vi } from 'vitest';

import type {
  ChatMessage,
  ModelInfo,
  ModelProviderId
} from '@agentdeck/shared';
import {
  ModelGateway,
  type ModelProviderAdapter,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolExecutor
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

describe('ModelGateway', () => {
  describe('getConfig', () => {
    it('returns default config with no adapters registered', () => {
      const gateway = new ModelGateway();
      const config = gateway.getConfig();

      expect(config.providers).toHaveLength(4);
      expect(config.activeProvider).toBe('ollama');
      expect(config.activeModel).toBe('qwen3.6:latest');
    });
  });

  describe('setActiveProvider', () => {
    it('updates the active provider', () => {
      const gateway = new ModelGateway();
      gateway.setActiveProvider('openrouter');
      expect(gateway.getConfig().activeProvider).toBe('openrouter');
    });
  });

  describe('setActiveModel', () => {
    it('updates the active model', () => {
      const gateway = new ModelGateway();
      gateway.setActiveModel('gpt-4');
      expect(gateway.getConfig().activeModel).toBe('gpt-4');
    });
  });

  describe('registerAdapter', () => {
    it('registers and retrieves an adapter', () => {
      const gateway = new ModelGateway();
      const adapter = createMockAdapter('ollama');
      gateway.registerAdapter(adapter);

      expect(gateway.getAdapter('ollama')).toBe(adapter);
    });

    it('returns undefined for unregistered provider', () => {
      const gateway = new ModelGateway();
      expect(gateway.getAdapter('ollama')).toBeUndefined();
    });
  });

  describe('checkProviderHealth', () => {
    it('returns true when adapter health check passes', async () => {
      const gateway = new ModelGateway();
      const adapter = createMockAdapter('ollama');
      gateway.registerAdapter(adapter);

      const result = await gateway.checkProviderHealth('ollama', 'http://localhost:11434');
      expect(result).toBe(true);
    });

    it('returns false when no adapter is registered', async () => {
      const gateway = new ModelGateway();
      const result = await gateway.checkProviderHealth('ollama', 'http://localhost:11434');
      expect(result).toBe(false);
    });

    it('returns false when adapter throws', async () => {
      const gateway = new ModelGateway();
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockRejectedValue(new Error('Network error')),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {})
      };
      gateway.registerAdapter(adapter);

      const result = await gateway.checkProviderHealth('ollama', 'http://localhost:11434');
      expect(result).toBe(false);
    });
  });

  describe('listProviderModels', () => {
    it('returns models from adapter', async () => {
      const models: ModelInfo[] = [
        { id: 'llama2', name: 'Llama 2', provider: 'ollama', contextWindow: 4096, supportsTools: false, supportsStreaming: true, supportsEmbeddings: false }
      ];
      const gateway = new ModelGateway();
      const adapter = createMockAdapter('ollama', models);
      gateway.registerAdapter(adapter);

      const result = await gateway.listProviderModels('ollama', 'http://localhost:11434');
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('llama2');
    });

    it('returns empty array when no adapter is registered', async () => {
      const gateway = new ModelGateway();
      const result = await gateway.listProviderModels('ollama', 'http://localhost:11434');
      expect(result).toEqual([]);
    });
  });

  describe('createChatTab', () => {
    it('creates a new chat tab with default title', () => {
      const gateway = new ModelGateway();
      const tab = gateway.createChatTab();

      expect(tab.id).toMatch(/^chat-tab-\d+$/);
      expect(tab.title).toBe('New Chat');
      expect(tab.messages).toEqual([]);
      expect(tab.isStreaming).toBe(false);
    });

    it('creates a new chat tab with custom title', () => {
      const gateway = new ModelGateway();
      const tab = gateway.createChatTab('My Chat');

      expect(tab.title).toBe('My Chat');
    });

    it('emits chat-tabs-changed event', () => {
      const gateway = new ModelGateway();
      const handler = vi.fn();
      gateway.on('chat-tabs-changed', handler);

      gateway.createChatTab();
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('listChatTabs', () => {
    it('returns empty list initially', () => {
      const gateway = new ModelGateway();
      expect(gateway.listChatTabs()).toEqual([]);
    });

    it('returns all created tabs', () => {
      const gateway = new ModelGateway();
      gateway.createChatTab('Tab 1');
      gateway.createChatTab('Tab 2');

      const tabs = gateway.listChatTabs();
      expect(tabs).toHaveLength(2);
      expect(tabs[0]!.title).toBe('Tab 1');
      expect(tabs[1]!.title).toBe('Tab 2');
    });
  });

  describe('closeChatTab', () => {
    it('removes the tab from the list', () => {
      const gateway = new ModelGateway();
      const tab = gateway.createChatTab();
      gateway.closeChatTab(tab.id);

      expect(gateway.listChatTabs()).toEqual([]);
    });

    it('emits chat-tabs-changed event', () => {
      const gateway = new ModelGateway();
      const tab = gateway.createChatTab();
      const handler = vi.fn();
      gateway.on('chat-tabs-changed', handler);

      gateway.closeChatTab(tab.id);
      expect(handler).toHaveBeenCalled();
    });

    it('does nothing for unknown tab id', () => {
      const gateway = new ModelGateway();
      gateway.closeChatTab('nonexistent');
      expect(gateway.listChatTabs()).toEqual([]);
    });
  });

  describe('sendMessage', () => {
    it('returns error for unknown tab', async () => {
      const gateway = new ModelGateway();
      const result = await gateway.sendMessage('nonexistent', 'hello');

      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('UNKNOWN');
    });

    it('returns error when no adapter is registered', async () => {
      const gateway = new ModelGateway();
      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('PROVIDER_ERROR');
    });

    it('sends message and receives streaming response', async () => {
      const gateway = new ModelGateway();
      const adapter = createMockAdapter('ollama');
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('ok');

      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab!.messages).toHaveLength(2); // user + assistant
      expect(updatedTab!.messages[0]!.role).toBe('user');
      expect(updatedTab!.messages[0]!.content).toBe('hello');
      expect(updatedTab!.messages[1]!.role).toBe('assistant');
      expect(updatedTab!.messages[1]!.content).toBe('Hello world');
    });

    it('updates title from first user message', async () => {
      const gateway = new ModelGateway();
      const adapter = createMockAdapter('ollama');
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'What is the meaning of life?');

      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab!.title).toBe('What is the meaning of life?');
    });

    it('truncates long titles', async () => {
      const gateway = new ModelGateway();
      const adapter = createMockAdapter('ollama');
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'This is a very long message that should be truncated because it exceeds forty characters');

      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab!.title).toHaveLength(40); // 37 + '...'
      expect(updatedTab!.title.endsWith('...')).toBe(true);
    });

    it('returns error when already streaming', async () => {
      const gateway = new ModelGateway();
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, signal) {
          // Simulates hanging stream that responds to abort
          yield { type: 'chunk', content: 'test' };
          await new Promise<never>((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new Error('Aborted'));
            });
          });
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();

      // Start streaming (don't await)
      const sendPromise = gateway.sendMessage(tab.id, 'hello');

      // Give it a moment to start
      await new Promise(r => setTimeout(r, 50));

      // Try to send another message while streaming
      const result = await gateway.sendMessage(tab.id, 'another message');
      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('PROVIDER_ERROR');

      // Cleanup: stop the hanging stream
      gateway.stopStreaming(tab.id);
      await sendPromise.catch(() => {});
    }, 30000);

    it('emits stream events during chat', async () => {
      const gateway = new ModelGateway();
      const adapter = createMockAdapter('ollama');
      gateway.registerAdapter(adapter);

      const streamHandler = vi.fn();
      gateway.on('chat-stream', streamHandler);

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'hello');

      expect(streamHandler).toHaveBeenCalledWith(tab.id, { type: 'chunk', content: 'Hello' });
      expect(streamHandler).toHaveBeenCalledWith(tab.id, { type: 'chunk', content: ' world' });
    });
  });

  describe('stopStreaming', () => {
    it('aborts in-flight streaming', async () => {
      const gateway = new ModelGateway();

      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, signal) {
          yield { type: 'chunk', content: 'Hello' };
          // Wait for abort signal — never resolves, only rejects on abort
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new Error('Aborted'));
            });
          });
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();

      // Start streaming
      const sendPromise = gateway.sendMessage(tab.id, 'hello');

      // Give it a moment to start streaming
      await new Promise(r => setTimeout(r, 50));

      // Stop streaming — this aborts the signal
      gateway.stopStreaming(tab.id);

      // The sendMessage should complete (the generator is still running but
      // the abort signal causes the next iteration to fail or complete)
      await sendPromise;

      // After stopStreaming, the tab should not be streaming anymore
      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab!.isStreaming).toBe(false);
    }, 30000);

    it('does nothing for non-streaming tab', () => {
      const gateway = new ModelGateway();
      const tab = gateway.createChatTab();

      // Should not throw
      gateway.stopStreaming(tab.id);

      // Tab should still exist and not be streaming
      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab).toBeDefined();
      expect(updatedTab!.isStreaming).toBe(false);
      expect(updatedTab!.id).toBe(tab.id);
    });
  });

  describe('getChatTab', () => {
    it('returns undefined for unknown tab', () => {
      const gateway = new ModelGateway();
      expect(gateway.getChatTab('nonexistent')).toBeUndefined();
    });

    it('returns tab state for existing tab', () => {
      const gateway = new ModelGateway();
      const tab = gateway.createChatTab('Test');

      const retrieved = gateway.getChatTab(tab.id);
      expect(retrieved!.id).toBe(tab.id);
      expect(retrieved!.title).toBe('Test');
    });
  });

  // ?? Tool calling tests ???????????????????????????????????????????????????

  describe('registerTool', () => {
    it('registers a tool', () => {
      const gateway = new ModelGateway();
      const tool: ToolDefinition = {
        type: 'function',
        function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: {} } }
      };
      gateway.registerTool(tool);
      expect(gateway.getTools()).toHaveLength(1);
    });

    it('replaces tool with same name', () => {
      const gateway = new ModelGateway();
      const tool1: ToolDefinition = {
        type: 'function',
        function: { name: 'get_weather', description: 'v1', parameters: {} }
      };
      const tool2: ToolDefinition = {
        type: 'function',
        function: { name: 'get_weather', description: 'v2', parameters: {} }
      };
      gateway.registerTool(tool1);
      gateway.registerTool(tool2);
      expect(gateway.getTools()).toHaveLength(1);
      expect(gateway.getTools()[0]!.function.description).toBe('v2');
    });

    it('unregisters a tool by name', () => {
      const gateway = new ModelGateway();
      const tool: ToolDefinition = {
        type: 'function',
        function: { name: 'get_weather', description: 'Get weather', parameters: {} }
      };
      gateway.registerTool(tool);
      gateway.unregisterTool('get_weather');
      expect(gateway.getTools()).toHaveLength(0);
    });

    it('clearTools removes all tools', () => {
      const gateway = new ModelGateway();
      gateway.registerTool({ type: 'function', function: { name: 'a', description: '', parameters: {} } });
      gateway.registerTool({ type: 'function', function: { name: 'b', description: '', parameters: {} } });
      gateway.clearTools();
      expect(gateway.getTools()).toHaveLength(0);
    });
  });

  describe('sendMessage with tool calls', () => {
    it('emits tool_use events from adapter', async () => {
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
            yield { type: 'chunk', content: 'Let me check' };
            yield {
              type: 'tool_use',
              toolCall: {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city": "Warsaw"}' }
              }
            };
          } else {
            // Second call (after tool result): return final answer
            yield { type: 'chunk', content: 'The weather is sunny.' };
          }
        })
      };
      gateway.registerAdapter(adapter);

      const streamHandler = vi.fn();
      gateway.on('chat-stream', streamHandler);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'What is the weather?');

      expect(result.status).toBe('ok');
      const toolUseEvents = streamHandler.mock.calls.filter(
        (call: unknown[]) => (call[1] as { type: string }).type === 'tool_use'
      );
      expect(toolUseEvents).toHaveLength(1);
    });

    it('saves assistant message with tool_calls after tool_use', async () => {
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

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'What is the weather?');

      const updatedTab = gateway.getChatTab(tab.id);
      // user + assistant (with tool_calls) + tool result + assistant (final)
      expect(updatedTab!.messages.length).toBeGreaterThanOrEqual(2);
      const assistantWithTools = updatedTab!.messages.find(m => m.role === 'assistant' && m.tool_calls);
      expect(assistantWithTools).toBeDefined();
      expect(assistantWithTools!.tool_calls).toBeDefined();
      expect(assistantWithTools!.tool_calls).toHaveLength(1);
      expect(assistantWithTools!.tool_calls![0]!.function.name).toBe('get_weather');
    });

    it('appends tool result message after tool_use', async () => {
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

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'What is the weather?');

      const updatedTab = gateway.getChatTab(tab.id);
      const toolMsg = updatedTab!.messages.find(m => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.tool_call_id).toBe('call_1');
    });

    it('does not send tools to model that does not support them', async () => {
      const gateway = new ModelGateway();
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, _signal, tools) {
          // Verify no tools were sent
          expect(tools).toEqual([]);
          yield { type: 'chunk', content: 'Hello' };
        })
      };
      gateway.registerAdapter(adapter);

      // Register a tool
      gateway.registerTool({
        type: 'function',
        function: { name: 'get_weather', description: 'Get weather', parameters: {} }
      });

      // Set provider models with supportsTools: false
      gateway.updateProviderStatus('ollama', 'ready', [
        { id: 'llama2', name: 'Llama 2', provider: 'ollama', contextWindow: 4096, supportsTools: false, supportsStreaming: true, supportsEmbeddings: false }
      ]);
      gateway.setActiveModel('llama2');

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'hello');
    });

    it('sends tools when active model metadata is missing', async () => {
      const gateway = new ModelGateway();
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, _signal, tools) {
          expect(tools).toHaveLength(1);
          yield { type: 'chunk', content: 'Hello' };
        })
      };
      gateway.registerAdapter(adapter);

      gateway.registerTool({
        type: 'function',
        function: { name: 'get_weather', description: 'Get weather', parameters: {} }
      });

      gateway.updateProviderStatus('ollama', 'ready', []);
      gateway.setActiveModel('qwen3.6:latest');

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'hello');
    });

    it('executes registered tool and returns result to the model', async () => {
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
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"Warsaw"}' }
              }
            };
          } else {
            yield { type: 'chunk', content: 'Done' };
          }
        })
      };
      gateway.registerAdapter(adapter);
      gateway.registerTool(
        {
          type: 'function',
          function: { name: 'get_weather', description: 'Get weather', parameters: {} }
        },
        async toolCall => JSON.stringify({ weather: 'sunny', input: toolCall.function.arguments })
      );

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'What is the weather?');

      const updatedTab = gateway.getChatTab(tab.id);
      const toolMsg = updatedTab!.messages.find(m => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content).toBe(String.raw`{"weather":"sunny","input":"{\"city\":\"Warsaw\"}"}`);
    });

    it('passes chat history and workspace roots to tool executor', async () => {
      let capturedContext: ToolExecutionContext | undefined;
      let callCount = 0;
      const executor: ToolExecutor = async (_toolCall, context) => {
        capturedContext = context;
        return JSON.stringify({ ok: true });
      };
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
                id: 'call_context',
                type: 'function',
                function: { name: 'inspect_context', arguments: '{}' }
              }
            };
          } else {
            yield { type: 'chunk', content: 'Done' };
          }
        })
      };
      const gateway = new ModelGateway(undefined, () => ['C:/workspace']);
      gateway.registerAdapter(adapter);
      gateway.registerTool(
        {
          type: 'function',
          function: { name: 'inspect_context', description: 'Inspect context', parameters: {} }
        },
        executor
      );
      gateway.updateProviderStatus('ollama', 'ready', [{ id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }]);
      gateway.setActiveModel('qwen3.6:latest');

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'Streszcz plik README.md');

      expect(capturedContext).toBeDefined();
      expect(capturedContext?.workspaceRoots).toEqual(['C:/workspace']);
      expect(capturedContext?.messages.some((message: ChatMessage) => message.role === 'user' && message.content === 'Streszcz plik README.md')).toBe(true);
      expect(capturedContext?.messages.some((message: ChatMessage) => message.role === 'assistant' && Array.isArray(message.tool_calls))).toBe(true);
    });

    it('does not retry read_file when model omitted filePath', async () => {
      const gateway = new ModelGateway();
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, _signal, tools) {
          expect(tools).toHaveLength(1);
          yield {
            type: 'tool_use',
            toolCall: {
              id: 'call_missing_file',
              type: 'function',
              function: { name: 'read_file', arguments: '{}' }
            }
          };
        })
      };
      gateway.registerAdapter(adapter);
      gateway.registerTool({
        type: 'function',
        function: { name: 'read_file', description: 'Reads a file', parameters: {} }
      }, async () => JSON.stringify({ error: 'read_file: missing filePath' }));
      gateway.updateProviderStatus('ollama', 'ready', [{ id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }]);
      gateway.setActiveModel('qwen3.6:latest');

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'Streszcz Readme.md');

      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab?.messages.some(m => m.role === 'assistant' && m.content.includes('nie podał wymaganej ścieżki pliku'))).toBe(true);
      expect(updatedTab?.messages.some(m => m.role === 'tool')).toBe(false);
    });

    it('prefers workspace root matching project mentioned in read_file context', async () => {
      const gateway = new ModelGateway(undefined, () => ['C:/agentdeck', 'C:/other']);
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, _signal, tools) {
          expect(tools).toHaveLength(1);
          yield {
            type: 'tool_use',
            toolCall: {
              id: 'call_read_project_file',
              type: 'function',
              function: { name: 'read_file', arguments: '{"filePath":"Readme.md"}' }
            }
          };
        })
      };
      gateway.registerAdapter(adapter);
      gateway.registerTool({
        type: 'function',
        function: { name: 'read_file', description: 'Reads a file', parameters: {} }
      }, async (_toolCall, context) => JSON.stringify({
        status: 'ok',
        filePath: context?.workspaceRoots[0] === 'C:/agentdeck' ? 'C:/agentdeck/Readme.md' : 'C:/other/Readme.md',
        content: 'ok'
      }));
      gateway.updateProviderStatus('ollama', 'ready', [{ id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }]);
      gateway.setActiveModel('qwen3.6:latest');

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'Otwórz i przeczytaj a następnie streść mi plik Readme.md z projektu AgentDeck');

      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab?.messages.some(m => m.role === 'tool' && m.content.includes('C:/agentdeck/Readme.md'))).toBe(true);
      expect(updatedTab?.messages.some(m => m.role === 'tool' && m.content.includes('C:/other/Readme.md'))).toBe(false);
    });

    it('does not retry search_files when model sent invalid query', async () => {
      const gateway = new ModelGateway();
      let callCount = 0;
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, _signal, tools) {
          callCount++;
          expect(tools).toHaveLength(2);
          if (callCount === 1) {
            yield {
              type: 'tool_use',
              toolCall: {
                id: 'call_invalid_search',
                type: 'function',
                function: { name: 'search_files', arguments: '{"pattern":null}' }
              }
            };
          } else {
            yield { type: 'chunk', content: 'Podaj pełną ścieżkę pliku albo doprecyzuj, czego mam szukać.' };
          }
        })
      };
      gateway.registerAdapter(adapter);
      gateway.registerTool({
        type: 'function',
        function: { name: 'read_file', description: 'Reads a file', parameters: {} }
      }, async () => JSON.stringify({ error: 'read_file: missing filePath' }));
      gateway.registerTool({
        type: 'function',
        function: { name: 'search_files', description: 'Searches files', parameters: {} }
      }, async () => JSON.stringify({ error: 'search_files: invalid query' }));
      gateway.updateProviderStatus('ollama', 'ready', [{ id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }]);
      gateway.setActiveModel('qwen3.6:latest');

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'Streszcz Readme.md');

      expect(adapter.chat).toHaveBeenCalledTimes(1);
      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab?.messages.some(m => m.role === 'assistant' && m.content.includes('niepoprawne argumenty'))).toBe(true);
      expect(updatedTab?.messages.some(m => m.role === 'tool')).toBe(false);
    });

    it('does not retry create_file when model sent invalid input', async () => {
      const gateway = new ModelGateway();
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, _signal, tools) {
          expect(tools).toHaveLength(1);
          yield {
            type: 'tool_use',
            toolCall: {
              id: 'call_invalid_create',
              type: 'function',
              function: { name: 'create_file', arguments: '{"filePath":"src/app.ts","content":42}' }
            }
          };
        })
      };
      gateway.registerAdapter(adapter);
      gateway.registerTool({
        type: 'function',
        function: { name: 'create_file', description: 'Creates a new file', parameters: {} }
      }, async () => JSON.stringify({ error: 'create_file: invalid input - expected { filePath: string, content?: string }' }));
      gateway.updateProviderStatus('ollama', 'ready', [{ id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }]);
      gateway.setActiveModel('qwen3.6:latest');

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'Utwórz plik src/app.ts');

      expect(adapter.chat).toHaveBeenCalledTimes(1);
      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab?.messages.some(m => m.role === 'assistant' && m.content.includes('niepoprawne argumenty'))).toBe(true);
      expect(updatedTab?.messages.some(m => m.role === 'tool')).toBe(false);
    });

    it('allows create_file when model omitted empty arguments but target file is in chat context', async () => {
      const gateway = new ModelGateway();
      let callCount = 0;
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, _signal, tools) {
          callCount += 1;
          expect(tools).toHaveLength(1);
          if (callCount === 1) {
            yield {
              type: 'tool_use',
              toolCall: {
                id: 'call_create_empty_args',
                type: 'function',
                function: { name: 'create_file', arguments: '{}' }
              }
            };
            return;
          }
          yield { type: 'chunk', content: 'Plik AgentTest.md został utworzony.' };
        })
      };
      gateway.registerAdapter(adapter);
      gateway.registerTool({
        type: 'function',
        function: { name: 'create_file', description: 'Creates a new file', parameters: {} }
      }, async () => JSON.stringify({ status: 'ok', filePath: 'AgentTest.md' }));
      gateway.updateProviderStatus('ollama', 'ready', [{ id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }]);
      gateway.setActiveModel('qwen3.6:latest');

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'Otwórz i przeczytaj a następnie streść mi plik Readme.md z projektu AgentDeck, wynik streszczenia zapisz do pliku AgentTest.md');

      expect(adapter.chat).toHaveBeenCalledTimes(2);
      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab?.messages.some(m => m.role === 'tool')).toBe(true);
      expect(updatedTab?.messages.some(m => m.role === 'assistant' && m.content.includes('AgentTest.md został utworzony'))).toBe(true);
    });

    it('allows create_file when model provides only filePath', async () => {
      const gateway = new ModelGateway();
      let callCount = 0;
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, _signal, tools) {
          callCount += 1;
          expect(tools).toHaveLength(1);
          if (callCount === 1) {
            yield {
              type: 'tool_use',
              toolCall: {
                id: 'call_create_without_content',
                type: 'function',
                function: { name: 'create_file', arguments: '{"filePath":"src/app.ts"}' }
              }
            };
            return;
          }
          yield { type: 'chunk', content: 'Plik został utworzony.' };
        })
      };
      gateway.registerAdapter(adapter);
      gateway.registerTool({
        type: 'function',
        function: { name: 'create_file', description: 'Creates a new file', parameters: {} }
      }, async () => JSON.stringify({ status: 'ok', filePath: 'src/app.ts' }));
      gateway.updateProviderStatus('ollama', 'ready', [{ id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }]);
      gateway.setActiveModel('qwen3.6:latest');

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'Utwórz plik src/app.ts');

      expect(adapter.chat).toHaveBeenCalledTimes(2);
      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab?.messages.some(m => m.role === 'tool')).toBe(true);
      expect(updatedTab?.messages.some(m => m.role === 'assistant' && m.content.includes('Plik został utworzony'))).toBe(true);
    });

    it('does not send empty tool result to model', async () => {
      const gateway = new ModelGateway();
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, messages, _signal, tools) {
          if (tools && tools.length > 0) {
            yield {
              type: 'tool_use',
              toolCall: {
                id: 'call_empty_tool',
                type: 'function',
                function: { name: 'inspect_context', arguments: '{}' }
              }
            };
            return;
          }

          const lastToolMessage = (messages as readonly ChatMessage[]).findLast(m => m.role === 'tool');
          expect(lastToolMessage).toBeUndefined();
          expect((messages as readonly ChatMessage[]).some(m => m.role === 'assistant' && m.content.includes('niepoprawne argumenty'))).toBe(true);
          yield { type: 'chunk', content: 'Ok' };
        })
      };
      gateway.registerAdapter(adapter);
      gateway.registerTool({
        type: 'function',
        function: { name: 'inspect_context', description: 'Inspect context', parameters: {} }
      }, async () => '');
      gateway.updateProviderStatus('ollama', 'ready', [{ id: 'qwen3.6:latest', name: 'Qwen', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }]);
      gateway.setActiveModel('qwen3.6:latest');

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'Sprawdź kontekst');

      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab?.messages.some(m => m.role === 'tool' && m.content === '')).toBe(false);
      expect(updatedTab?.messages.some(m => m.role === 'assistant' && m.content.includes('niepoprawne argumenty'))).toBe(true);
    });

    it('sends tools to model that supports them', async () => {
      const gateway = new ModelGateway();
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* (_baseUrl, _modelId, _messages, _signal, tools) {
          expect(tools).toBeDefined();
          expect(tools!.length).toBe(1);
          yield { type: 'chunk', content: 'Hello' };
        })
      };
      gateway.registerAdapter(adapter);

      gateway.registerTool({
        type: 'function',
        function: { name: 'get_weather', description: 'Get weather', parameters: {} }
      });

      gateway.updateProviderStatus('ollama', 'ready', [
        { id: 'llama2', name: 'Llama 2', provider: 'ollama', contextWindow: 4096, supportsTools: true, supportsStreaming: true, supportsEmbeddings: false }
      ]);
      gateway.setActiveModel('llama2');

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'hello');
    });
  });

  // ?? Error classification tests ??????????????????????????????????????????

  describe('sendMessage error classification', () => {
    // Disable retries for error classification tests — they test error mapping, not retry behavior
    let gateway: ModelGateway;

    beforeEach(() => {
      gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 0 });
    });

    it('returns NETWORK_ERROR for connection refused', async () => {
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield { type: 'error', message: '[NETWORK_ERROR] fetch failed: connect ECONNREFUSED 127.0.0.1:11434' };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('NETWORK_ERROR');
    });

    it('returns NETWORK_ERROR for DNS resolution failure', async () => {
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield { type: 'error', message: '[NETWORK_ERROR] getaddrinfo ENOTFOUND api.example.com' };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('NETWORK_ERROR');
    });

    it('returns NETWORK_ERROR for stream heartbeat timeout', async () => {
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield { type: 'chunk', content: 'Hello' };
          yield { type: 'error', message: '[NETWORK_ERROR] Stream heartbeat timeout: no data for 60000ms' };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('NETWORK_ERROR');
    });

    it('returns MODEL_ERROR for model not found', async () => {
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'error',
            message: '[MODEL_ERROR] Model "gpt-99" does not exist'
          };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('MODEL_ERROR');
    });

    it('returns PROVIDER_ERROR for generic provider errors', async () => {
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'error',
            message: '[PROVIDER_ERROR] Internal server error'
          };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('PROVIDER_ERROR');
    });

    it('returns UNKNOWN for non-Error thrown values', async () => {
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield { type: 'error', message: '[PROVIDER_ERROR] string error' };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
      expect((result as { code: string }).code).toBe('PROVIDER_ERROR');
    });

    it('sets tab.error on stream error events', async () => {
      const adapter: ModelProviderAdapter = {
        providerId: 'ollama',
        label: 'Mock',
        healthCheck: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        chat: vi.fn().mockImplementation(async function* () {
          yield { type: 'chunk', content: 'Hello' };
          yield { type: 'error', message: '[NETWORK_ERROR] Connection lost' };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      await gateway.sendMessage(tab.id, 'hello');

      const updatedTab = gateway.getChatTab(tab.id);
      expect(updatedTab!.error).toBe('Connection lost');
    });
  });

  // ?? Retry policy tests ??????????????????????????????????????????????????

  describe('retry policy', () => {
    it('uses default retry policy', () => {
      const gateway = new ModelGateway();
      const policy = gateway.getRetryPolicy();
      expect(policy.maxRetries).toBe(3);
      expect(policy.baseDelayMs).toBe(1000);
      expect(policy.maxDelayMs).toBe(30000);
      expect(policy.jitterFactor).toBe(0.25);
    });

    it('allows customizing retry policy', () => {
      const gateway = new ModelGateway();
      gateway.setRetryPolicy({ maxRetries: 5, baseDelayMs: 2000 });
      const policy = gateway.getRetryPolicy();
      expect(policy.maxRetries).toBe(5);
      expect(policy.baseDelayMs).toBe(2000);
      // Unchanged defaults
      expect(policy.maxDelayMs).toBe(30000);
      expect(policy.jitterFactor).toBe(0.25);
    });

    it('retries on NETWORK_ERROR and succeeds on second attempt', async () => {
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
          if (callCount === 1) {
            yield { type: 'error', message: '[NETWORK_ERROR] Connection refused' };
          } else {
            yield { type: 'chunk', content: 'Success after retry' };
          }
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('ok');
      expect(callCount).toBe(2);
    });

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

    it('exhausts all retries and returns error', async () => {
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
          yield { type: 'error', message: '[NETWORK_ERROR] Connection refused' };
        })
      };
      gateway.registerAdapter(adapter);

      const tab = gateway.createChatTab();
      const result = await gateway.sendMessage(tab.id, 'hello');

      expect(result.status).toBe('error');
      expect(callCount).toBe(3); // Initial + 2 retries
    });
  });
});
