import { describe, expect, it, vi } from 'vitest';

import type { ModelProviderId } from '@agentdeck/shared';
import { ModelGateway, type ModelProviderAdapter } from '@agentdeck/services';

function createMockAdapter(
  providerId: ModelProviderId,
  response = 'Hello from runtime worker'
): ModelProviderAdapter {
  return {
    providerId,
    label: `Mock ${providerId}`,
    healthCheck: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    chat: vi.fn().mockImplementation(async function* () {
      yield { type: 'chunk', content: response };
    })
  };
}

describe('ModelGateway — AgentRuntime per ChatTab integration', () => {
  it('tworzy osobną sesję runtime dla każdego ChatTab', () => {
    const gateway = new ModelGateway();

    const firstTab = gateway.createChatTab('Pierwszy czat');
    const secondTab = gateway.createChatTab('Drugi czat');
    const sessions = gateway.listAgentRuntimeSessions();

    expect(sessions).toHaveLength(2);
    expect(sessions.map(session => session.chatTabId)).toEqual([firstTab.id, secondTab.id]);
    expect(new Set(sessions.map(session => session.id)).size).toBe(2);
    expect(sessions[0]!.permissionScope.sessionId).toBe(sessions[0]!.id);
    expect(sessions[1]!.permissionScope.sessionId).toBe(sessions[1]!.id);
  });

  it('przechowuje odrębny model i permission scope dla każdej sesji', () => {
    const gateway = new ModelGateway();
    gateway.registerTool({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Reads a file.',
        parameters: {}
      }
    });

    const firstTab = gateway.createChatTab();
    const secondTab = gateway.createChatTab();

    gateway.setActiveModel('model-first');
    gateway.setTabActiveModel(firstTab.id, 'model-first');
    gateway.setTabActiveModel(secondTab.id, 'model-second');
    gateway.setTabAllowedTools(firstTab.id, ['read_file']);
    gateway.setTabAllowedTools(secondTab.id, []);

    const sessions = [...gateway.listAgentRuntimeSessions()].sort((a, b) => a.chatTabId.localeCompare(b.chatTabId));

    expect(sessions[0]!.modelId).toBe('model-first');
    expect(sessions[0]!.permissionScope.allowedTools).toEqual(['read_file']);
    expect(sessions[1]!.modelId).toBe('model-second');
    expect(sessions[1]!.permissionScope.allowedTools).toEqual([]);
    expect(sessions[0]!.permissionScope.sessionId).not.toBe(sessions[1]!.permissionScope.sessionId);
  });

  it('aktualizuje model tylko w sesji powiązanej z wybranym ChatTab', () => {
    const gateway = new ModelGateway();

    const firstTab = gateway.createChatTab();
    const secondTab = gateway.createChatTab();
    gateway.setTabActiveModel(firstTab.id, 'model-first');
    gateway.setTabActiveModel(secondTab.id, 'model-second');

    gateway.setTabActiveModel(firstTab.id, 'model-first-updated');

    const sessions = [...gateway.listAgentRuntimeSessions()].sort((a, b) => a.chatTabId.localeCompare(b.chatTabId));

    expect(sessions.find(session => session.chatTabId === firstTab.id)?.modelId).toBe('model-first-updated');
    expect(sessions.find(session => session.chatTabId === secondTab.id)?.modelId).toBe('model-second');
  });

  it('utrzymuje osobny event log dla każdej sesji', async () => {
    const gateway = new ModelGateway();
    gateway.registerAdapter(createMockAdapter('ollama'));

    const firstTab = gateway.createChatTab();
    const secondTab = gateway.createChatTab();

    await gateway.sendMessage(firstTab.id, 'Cześć z pierwszego czatu');

    const sessionsBeforeSecondMessage = gateway.listAgentRuntimeSessions();
    const firstSession = sessionsBeforeSecondMessage.find(session => session.chatTabId === firstTab.id);
    const secondSession = sessionsBeforeSecondMessage.find(session => session.chatTabId === secondTab.id);

    expect(firstSession?.eventLog.map(event => event.type)).toContain('worker-started');
    expect(firstSession?.eventLog.map(event => event.type)).toContain('task-completed');
    expect(secondSession?.eventLog.map(event => event.type)).toEqual(['session-created']);
    expect(firstSession?.eventLog.map(event => event.sessionId)).toEqual(firstSession?.eventLog.map(() => firstSession.id));
    expect(secondSession?.eventLog.map(event => event.sessionId)).toEqual(secondSession?.eventLog.map(() => secondSession.id));
  });

  it('uruchamia izolowanego worker runtime dla wiadomości z ChatTab', async () => {
    const gateway = new ModelGateway();
    gateway.registerAdapter(createMockAdapter('ollama', 'Runtime response'));

    const tab = gateway.createChatTab();
    const result = await gateway.sendMessage(tab.id, 'Cześć');

    expect(result.status).toBe('ok');
    expect(gateway.getChatTab(tab.id)?.messages.at(-1)?.content).toBe('Runtime response');

    const session = gateway.listAgentRuntimeSessions().find(runtimeSession => runtimeSession.chatTabId === tab.id);
    expect(session?.tasks[0]?.status).toBe('completed');
    expect(session?.workers).toHaveLength(1);
    expect(session?.workers[0]?.status).toBe('stopped');
    expect(session?.workers[0]?.output?.summary).toBe('Chat response completed.');
  });

  it('uruchamia subagenta przez ModelGateway z ograniczonym zakresem narzędzi i zwraca wynik parentowi', async () => {
    const gateway = new ModelGateway(async toolCall => {
      if (toolCall.function.name === 'search_files') {
        return JSON.stringify({
          matches: ['docs/security.md'],
          references: ['docs/security.md'],
          url: 'https://docs.example.com/security'
        });
      }
      return JSON.stringify({ error: `Tool not found: ${toolCall.function.name}` });
    });
    const toolsForParent = vi.fn().mockImplementation(async function* () {
      yield { type: 'chunk', content: 'Parent tools: read_file, search_files' };
    });
    const toolsForSubagent = vi.fn().mockImplementation(async function* () {
      yield { type: 'tool_use', toolCall: {
        id: 'call-search-files',
        type: 'function',
        function: {
          name: 'search_files',
          arguments: JSON.stringify({ query: 'security' })
        }
      } };
      yield { type: 'chunk', content: 'Zobacz [raport bezpieczeństwa](docs/security.md) i [dokumentację](https://docs.example.com/security).' };
    });
    const adapter: ModelProviderAdapter = {
      providerId: 'ollama',
      label: 'Mock ollama',
      healthCheck: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue([]),
      chat: vi.fn().mockImplementation(async function* (baseUrl: string, modelId: string, messages: readonly { role: string }[]) {
        if (modelId === 'model-subagent') {
          const subagentCall = messages.filter(message => message.role === 'tool').length;
          if (subagentCall === 0) {
            yield* toolsForSubagent();
          } else {
            yield { type: 'chunk', content: 'Podsumowanie: brak krytycznych ryzyk.' };
          }
          return;
        }
        yield* toolsForParent();
      })
    };
    gateway.registerAdapter(adapter);
    gateway.registerTool({
      type: 'function',
      function: { name: 'read_file', description: 'Read a file.', parameters: {} }
    });
    gateway.registerTool({
      type: 'function',
      function: { name: 'search_files', description: 'Search files.', parameters: {} }
    });

    const tab = gateway.createChatTab();
    gateway.setTabAllowedTools(tab.id, ['read_file', 'search_files']);

    const sessions = gateway.listAgentRuntimeSessions();
    const parentSession = sessions.find(session => session.chatTabId === tab.id);
    expect(parentSession).toBeDefined();

    const subagent = await gateway.startAgentRuntimeSubagent({
      sessionId: parentSession!.id,
      name: 'security-reviewer',
      goal: 'Sprawdź bezpieczeństwo',
      modelId: 'model-subagent',
      context: ['kontekst subagenta'],
      allowedTools: ['search_files'],
      parentTaskId: parentSession!.tasks[0]!.id
    });

    expect(subagent.status).toBe('ok');
    if (subagent.status !== 'ok') {
      throw new Error('Expected subagent start ok.');
    }

    expect(subagent.value.kind).toBe('subagent');
    expect(subagent.value.permissionScope.kind).toBe('subagent');
    expect(subagent.value.permissionScope.allowedTools).toEqual(['search_files']);
    expect(subagent.value.parentTaskId).toBe(parentSession!.tasks[0]!.id);

    const completedTask = gateway.getAgentRuntimeTask(subagent.value.id);
    expect(completedTask?.status).toBe('completed');
    expect(completedTask?.result?.summary).toBe('Chat response completed.');
    expect(completedTask?.result?.references).toEqual([
      'docs/security.md',
      'https://docs.example.com/security'
    ]);
    expect(completedTask?.permissionScope.allowedTools).toEqual(['search_files']);
    expect(adapter.chat).toHaveBeenCalledWith(
      'http://localhost:11434',
      'model-subagent',
      [],
      undefined,
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: 'search_files' })
        })
      ])
    );
    expect(adapter.chat).not.toHaveBeenCalledWith(
      'http://localhost:11434',
      'qwen3.6:latest',
      expect.any(Array),
      expect.any(AbortSignal),
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: 'read_file' })
        })
      ])
    );
    expect(tab.activeModel).toBe('qwen3.6:latest');
  });

  it('zamyka tylko sesję runtime powiązaną z zamykanym ChatTab', () => {
    const gateway = new ModelGateway();

    const firstTab = gateway.createChatTab();
    const secondTab = gateway.createChatTab();

    gateway.closeChatTab(firstTab.id);

    const sessions = gateway.listAgentRuntimeSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.chatTabId).toBe(secondTab.id);
    expect(sessions[0]!.status).toBe('active');
    const remainingTabs = gateway.listChatTabs();
    expect(remainingTabs).toHaveLength(1);
    expect(remainingTabs[0]?.id).toBe(secondTab.id);
  });

  it('obsługuje zdarzenia runtime emitowane przez ModelGateway', () => {
    const gateway = new ModelGateway();
    const handler = vi.fn();
    gateway.on('agent-runtime-event', handler);

    gateway.createChatTab();

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls.some(([_event]: unknown[]) => {
      const event = _event as { type?: string };
      return event.type === 'session-changed';
    })).toBe(true);
  });
});
