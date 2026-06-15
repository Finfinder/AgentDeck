import { describe, expect, it } from 'vitest';

import { ModelGateway } from '@agentdeck/services';

describe('ModelGateway — Provider Configuration', () => {
  describe('setProviderBaseUrl', () => {
    it('updates the base URL for a provider', () => {
      const gateway = new ModelGateway();
      gateway.setProviderBaseUrl('ollama', 'http://localhost:11434');

      const config = gateway.getConfig();
      const ollama = config.providers.find(p => p.id === 'ollama');
      expect(ollama?.baseUrl).toBe('http://localhost:11434');
    });

    it('does not affect other providers', () => {
      const gateway = new ModelGateway();
      gateway.setProviderBaseUrl('ollama', 'http://localhost:11434');

      const config = gateway.getConfig();
      const openrouter = config.providers.find(p => p.id === 'openrouter');
      expect(openrouter?.baseUrl).toBe('https://openrouter.ai/api/v1');
    });
  });

  describe('getProviderConfig', () => {
    it('returns base URL and hasApiKey false by default', () => {
      const gateway = new ModelGateway();
      const config = gateway.getProviderConfig('ollama');

      expect(config).toEqual({ baseUrl: 'http://localhost:11434', hasApiKey: false });
    });

    it('returns updated base URL after setProviderBaseUrl', () => {
      const gateway = new ModelGateway();
      gateway.setProviderBaseUrl('ollama', 'https://custom.example.test:8080');

      const config = gateway.getProviderConfig('ollama');
      expect(config.baseUrl).toBe('https://custom.example.test:8080');
    });

    it('returns defaults for unknown provider', () => {
      const gateway = new ModelGateway();
      const config = gateway.getProviderConfig('unknown' as Parameters<typeof gateway.getProviderConfig>[0]);

      expect(config).toEqual({ baseUrl: '', hasApiKey: false });
    });
  });

  describe('updateProviderStatus', () => {
    it('updates provider status', () => {
      const gateway = new ModelGateway();
      gateway.updateProviderStatus('ollama', 'ready');

      const config = gateway.getConfig();
      const ollama = config.providers.find(p => p.id === 'ollama');
      expect(ollama?.status).toBe('ready');
    });

    it('updates provider models', () => {
      const gateway = new ModelGateway();
      const models = [
        { id: 'llama2', name: 'Llama 2', provider: 'ollama' as const, contextWindow: 4096, supportsTools: false, supportsStreaming: true, supportsEmbeddings: false }
      ];
      gateway.updateProviderStatus('ollama', 'ready', models);

      const config = gateway.getConfig();
      const ollama = config.providers.find(p => p.id === 'ollama');
      expect(ollama?.models).toHaveLength(1);
      expect(ollama?.models[0]!.id).toBe('llama2');
    });
  });

  describe('getConfig', () => {
    it('returns current providers state', () => {
      const gateway = new ModelGateway();
      gateway.setProviderBaseUrl('ollama', 'https://custom.example.test:8080');

      const config = gateway.getConfig();
      expect(config.providers).toHaveLength(4);
      expect(config.activeProvider).toBe('ollama');
      expect(config.activeModel).toBe('qwen3.6:latest');
    });
  });
});
