import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAgentRuntime,
  type AgentRuntimeResult,
  type AgentRuntimeTaskState,
  type AgentRuntimeWorkerDefinition,
  type AgentRuntimeWorkerInput,
  type AgentRuntimeWorkerOutput,
  type AgentRuntimeWorkerState
} from '@agentdeck/agent-runtime';

function expectOk<T>(result: AgentRuntimeResult<T>): T {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') {
    throw new Error(result.message);
  }
  return result.value;
}

function expectError<TCode extends string>(result: AgentRuntimeResult<unknown>): TCode {
  expect(result.status).toBe('error');
  if (result.status === 'ok') {
    throw new Error('Expected error result.');
  }
  return result.code as TCode;
}

function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error('Expected defined value.');
  }
  return value;
}

function firstTask(session: { tasks: readonly AgentRuntimeTaskState[] }): AgentRuntimeTaskState {
  return expectDefined(session.tasks[0]);
}

function createRuntime() {
  let now = 1000;
  const workers = new Map<string, AgentRuntimeWorkerDefinition>();
  const workerFactory = vi.fn((workerId: string) => {
    const worker = workers.get(workerId);
    if (!worker) {
      throw new Error(`No worker mock registered for ${workerId}`);
    }
    return worker;
  });

  const runtime = createAgentRuntime({
    workerFactory,
    now: () => now,
    maxRetries: 2
  });

  return {
    runtime,
    workerFactory,
    registerWorker(workerId: string, run: AgentRuntimeWorkerDefinition['run']) {
      workers.set(workerId, {
        id: workerId,
        run
      });
    },
    tick(ms = 1) {
      now += ms;
    }
  };
}

function createWorkerMock(output: Omit<AgentRuntimeWorkerOutput, 'toolsUsed'> & Partial<Pick<AgentRuntimeWorkerOutput, 'toolsUsed'>>) {
  return vi.fn().mockResolvedValue({
    ...output,
    toolsUsed: output.toolsUsed ?? []
  });
}

function createFailingWorkerMock(message = 'Worker failed') {
  return vi.fn().mockRejectedValue(new Error(message));
}

function createNeverWorkerMock() {
  let resolveSignal: (signal: AbortSignal) => void;
  const promise = new Promise<AbortSignal>(resolve => {
    resolveSignal = resolve;
  });

  const run = vi.fn(async (_input: AgentRuntimeWorkerInput, signal: AbortSignal) => {
    resolveSignal(signal);
    await promise;
    return { summary: 'never', references: [], toolsUsed: [] };
  });

  return { run, getSignal: () => promise };
}

describe('AgentRuntime Session Broker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createSession', () => {
    it('tworzy osobną sesję dla ChatTab z własnym kontekstem, zakresem uprawnień i dziennikiem zdarzeń', () => {
      const { runtime } = createRuntime();

      const firstSession = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect',
        context: ['projekt A'],
        allowedTools: ['mcp.filesystem.read']
      }));
      const secondSession = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-2',
        modelId: 'model-2',
        agentName: 'reviewer',
        context: ['projekt B'],
        allowedTools: ['mcp.seq.query']
      }));

      const sessions = runtime.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0]?.id).not.toBe(sessions[1]?.id);
      expect(sessions[0]?.chatTabId).toBe('chat-tab-1');
      expect(sessions[0]?.permissionScope.kind).toBe('parent');
      expect(sessions[0]?.permissionScope.allowedTools).toEqual(['mcp.filesystem.read']);
      expect(sessions[0]?.context).toEqual(['projekt A']);
      expect(sessions[1]?.context).toEqual(['projekt B']);
      expect(sessions[0]?.eventLog.map(event => event.type)).toContain('session-created');
      expect(sessions[0]?.tasks).toHaveLength(1);
      expect(sessions[0]?.tasks[0]?.kind).toBe('chat');
      expect(sessions[0]?.tasks[0]?.permissionScope.taskId).toBe(sessions[0]?.tasks[0]?.id);
      expect(firstSession.id).not.toBe(secondSession.id);
    });

    it('nie udostępnia mutowalnego kontekstu między sesjami ani snapshotami', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect',
        context: ['pierwszy']
      }));

      const snapshot = runtime.getSession(session.id);
      expect(snapshot?.context).toEqual(['pierwszy']);

      const mutableContext = snapshot?.context as unknown as string[];
      expect(() => mutableContext.push('drugi')).toThrow();

      const updated = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-2',
        modelId: 'model-1',
        agentName: 'architect',
        context: ['drugi']
      }));

      const sessions = runtime.listSessions();
      expect(sessions.map(session => session.context)).toEqual([['pierwszy'], ['drugi']]);
      expect(sessions[0]?.eventLog).toHaveLength(1);
      expect(sessions[1]?.eventLog).toHaveLength(1);
      expect(sessions[0]?.eventLog[0]?.sessionId).toBe(session.id);
      expect(sessions[1]?.eventLog[0]?.sessionId).toBe(updated.id);
    });

    it('nie pozwala mutować workerów i tasków ze snapshotów', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect'
      }));

      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Sprawdź izolację'
      }));
      const task = expectDefined(runtime.getTask(firstTask(session).id));

      expect(Object.isFrozen(worker)).toBe(true);
      expect(Object.isFrozen(task)).toBe(true);
      expect(Object.isFrozen(task.context)).toBe(true);

      const mutableWorker = worker as unknown as AgentRuntimeWorkerState & { status: AgentRuntimeWorkerState['status'] };
      expect(() => { mutableWorker.status = 'crashed'; }).toThrow();

      const mutableTask = task as unknown as AgentRuntimeTaskState & { context: string[] };
      expect(() => { mutableTask.context.push('mutacja'); }).toThrow();
    });

    it('emituje worker-changed i task-changed jako ni mutowalne kopie', async () => {
      const { runtime, registerWorker, tick } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect',
        context: ['rodzic']
      }));

      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Opracuj plan',
        context: ['worker']
      }));

      const run = createWorkerMock({
        summary: 'Plan opracowany',
        references: ['docs/architecture.md']
      });
      registerWorker(worker.id, run);

      const workerChanged = vi.fn((changedWorker: AgentRuntimeWorkerState) => {
        const mutableWorker = changedWorker as unknown as AgentRuntimeWorkerState & { status: AgentRuntimeWorkerState['status'] };
        expect(() => { mutableWorker.status = 'crashed'; }).toThrow();
      });
      const taskChanged = vi.fn((changedTask: AgentRuntimeTaskState) => {
        const mutableTask = changedTask as unknown as AgentRuntimeTaskState & { context: string[] };
        expect(() => { mutableTask.context.push('mutacja'); }).toThrow();
      });

      runtime.on('worker-changed', workerChanged);
      runtime.on('task-changed', taskChanged);

      const runResult = runtime.runWorker(worker.id);
      expect(runResult.status).toBe('ok');

      tick();
      await vi.waitFor(() => {
        expect(runtime.getTask(firstTask(session).id)?.status).toBe('completed');
      });

      expect(workerChanged).toHaveBeenCalled();
      expect(taskChanged).toHaveBeenCalled();
      const workerSnapshot = expectDefined(runtime.getWorker(worker.id));
      const taskSnapshot = expectDefined(runtime.getTask(firstTask(session).id));
      expect(workerChanged.mock.calls.flat().includes(workerSnapshot)).toBe(false);
      expect(taskChanged.mock.calls.flat().includes(taskSnapshot)).toBe(false);
    });
  });

  describe('worker lifecycle', () => {
    it('uruchamia, zatrzymuje i porzuca zadanie worker bez dzielenia stanu z innymi sesjami', async () => {
      const { runtime, registerWorker, tick } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect',
        context: ['kontekst rodzica']
      }));

      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Opracuj plan',
        context: ['dodatkowy kontekst'],
        allowedTools: ['mcp.filesystem.write']
      }));

      const run = createWorkerMock({
        summary: 'Plan opracowany',
        references: ['docs/architecture.md']
      });
      registerWorker(worker.id, run);

      const taskChanged = vi.fn();
      runtime.on('task-changed', taskChanged);

      const runResult = runtime.runWorker(worker.id);
      expect(runResult.status).toBe('ok');
      expectOk(runResult);

      expect(run).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: session.id,
        taskId: firstTask(session).id,
        agentName: 'architect',
        modelId: 'model-1',
        prompt: 'Opracuj plan',
        contextSnapshot: ['dodatkowy kontekst']
      }), expect.any(AbortSignal));

      tick();
      await vi.waitFor(() => {
        expect(runtime.getTask(firstTask(session).id)?.status).toBe('completed');
      });

      const completedTask = runtime.getTask(firstTask(session).id);
      expect(completedTask?.result).toEqual({
        summary: 'Plan opracowany',
        references: ['docs/architecture.md'],
        toolsUsed: []
      });
      expect(completedTask?.toolsUsed).toEqual([]);
      expect(taskChanged).toHaveBeenCalledWith(expect.objectContaining({
        status: 'completed',
        result: {
          summary: 'Plan opracowany',
          references: ['docs/architecture.md'],
          toolsUsed: []
        },
        toolsUsed: []
      }));

      const stopResult = runtime.stopWorker(worker.id);
      expect(stopResult.status).toBe('ok');
      const stoppedWorker = expectOk(stopResult);
      expect(stoppedWorker.status).toBe('stopped');

      const sessionSnapshot = runtime.getSession(session.id);
      expect(firstTask(expectDefined(sessionSnapshot)).status).toBe('completed');
      expect(sessionSnapshot?.eventLog.map(event => event.type)).toEqual(expect.arrayContaining([
        'session-created',
        'worker-stopped',
        'worker-started',
        'task-updated',
        'task-completed'
      ]));
    });

    it('przepisuje narzędzia użyte przez worker do zakończonego taska', async () => {
      const { runtime, registerWorker, tick } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect',
        context: ['kontekst rodzica']
      }));

      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Opracuj plan',
        context: ['dodatkowy kontekst'],
        allowedTools: ['mcp.filesystem.write']
      }));

      const run = createWorkerMock({
        summary: 'Plan opracowany',
        references: ['docs/architecture.md'],
        toolsUsed: ['mcp.filesystem.write', 'mcp.seq.query']
      });
      registerWorker(worker.id, run);

      const taskChanged = vi.fn();
      runtime.on('task-changed', taskChanged);

      const runResult = runtime.runWorker(worker.id);
      expect(runResult.status).toBe('ok');
      expectOk(runResult);

      tick();
      await vi.waitFor(() => {
        expect(runtime.getTask(firstTask(session).id)?.status).toBe('completed');
      });

      expect(runtime.getTask(firstTask(session).id)?.toolsUsed).toEqual(['mcp.filesystem.write', 'mcp.seq.query']);
      expect(taskChanged).toHaveBeenCalledWith(expect.objectContaining({
        status: 'completed',
        toolsUsed: ['mcp.filesystem.write', 'mcp.seq.query']
      }));
    });

    it('zgłasza błędny zakres przy próbie użycia tasku z innej sesji', () => {
      const { runtime } = createRuntime();
      const first = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect'
      }));
      const second = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-2',
        modelId: 'model-1',
        agentName: 'architect'
      }));

      const result = runtime.startWorker({
        sessionId: second.id,
        taskId: firstTask(first).id,
        prompt: 'Niepoprawne zadanie'
      });

      const code = expectError<'INVALID_SCOPE'>(result);

      expect(code).toBe('INVALID_SCOPE');
    });

    it('przerywa uruchomionego worker po stopWorker i oznacza task jako cancelled', async () => {
      const { runtime, registerWorker } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect'
      }));

      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Długie zadanie'
      }));

      const neverWorker = createNeverWorkerMock();
      registerWorker(worker.id, neverWorker.run);

      const runResult = runtime.runWorker(worker.id);
      expect(runResult.status).toBe('ok');
      expectOk(runResult);

      const signal = await neverWorker.getSignal();
      const stopResult = runtime.stopWorker(worker.id);

      expect(stopResult.status).toBe('ok');
      const stoppingWorker = expectOk(stopResult);
      expect(stoppingWorker.status).toBe('stopping');
      expect(signal.aborted).toBe(true);

      await vi.waitFor(() => {
        expect(runtime.getTask(firstTask(session).id)?.status).toBe('cancelled');
      });
    });

    it('zatrzymuje wszystkie aktywne workery sesji bez ubijania runtime', async () => {
      const { runtime, registerWorker } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect'
      }));

      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Długie zadanie sesji'
      }));

      const neverWorker = createNeverWorkerMock();
      registerWorker(worker.id, neverWorker.run);
      const runResult = runtime.runWorker(worker.id);
      expect(runResult.status).toBe('ok');
      expectOk(runResult);

      const signal = await neverWorker.getSignal();
      const result = runtime.stopSession(session.id);

      expect(result.status).toBe('ok');
      const stoppedWorkers = expectOk(result);
      expect(stoppedWorkers).toHaveLength(1);
      expect(stoppedWorkers[0]?.status).toBe('stopping');
      expect(signal.aborted).toBe(true);

      await vi.waitFor(() => {
        expect(runtime.getSession(session.id)?.status).toBe('stopped');
      });

      const nextSession = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-2',
        modelId: 'model-1',
        agentName: 'architect'
      }));
      expect(nextSession.id).not.toBe(session.id);
    });

    it('zwraca kontrolowany błąd gdy factory nie potrafi utworzyć worker', () => {
      const runtime = createAgentRuntime({
        workerFactory: () => {
          throw new Error('Factory down');
        },
        now: () => 1000,
        maxRetries: 2
      });
      const session = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect'
      }));

      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Zadanie awaryjne'
      }));

      const result = runtime.runWorker(worker.id);
      const code = expectError<'UNKNOWN'>(result);

      expect(code).toBe('UNKNOWN');
      expect(runtime.getWorker(worker.id)?.status).toBe('crashed');
      expect(runtime.getSession(session.id)?.status).toBe('crashed');
    });
  });

  describe('crash and resume', () => {
    it('raportuje crash worker w dzienniku i udostępnia token wznowienia', async () => {
      const { runtime, registerWorker } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect'
      }));

      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Zadanie awaryjne'
      }));

      registerWorker(worker.id, createFailingWorkerMock('Błąd narzędzia'));

      const crashed = vi.fn();
      runtime.on('session-crashed', crashed);

      const runResult = runtime.runWorker(worker.id);
      expect(runResult.status).toBe('ok');

      await vi.waitFor(() => {
        expect(runtime.getSession(session.id)?.status).toBe('crashed');
      });

      const crashedSession = runtime.getSession(session.id);
      expect(crashed).toHaveBeenCalledWith(expect.objectContaining({
        status: 'crashed',
        resumeToken: expect.stringMatching(/^resume-/)
      }), expect.any(Error));
      expect(crashedSession?.resumeToken).toEqual(expect.stringMatching(/^resume-/));
      expect(crashedSession?.eventLog.map(event => event.type)).toEqual(expect.arrayContaining([
        'worker-crashed',
        'task-failed'
      ]));
      expect(crashedSession?.eventLog.at(-1)?.message).toBe('Task failed.');
    });

    it('wznawia crashed worker i czyści poprzedni błąd', async () => {
      const { runtime, registerWorker } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect'
      }));

      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Zadanie do wznowienia'
      }));

      registerWorker(worker.id, createFailingWorkerMock('Poprzedni błąd'));
      const runResult = runtime.runWorker(worker.id);
      expect(runResult.status).toBe('ok');

      await vi.waitFor(() => {
        expect(runtime.getWorker(worker.id)?.status).toBe('crashed');
      });

      const result = runtime.resumeWorker({
        sessionId: session.id,
        workerId: worker.id
      });

      expect(result.status).toBe('ok');
      const resumedWorker = expectOk(result);
      expect(resumedWorker.status).toBe('idle');
      expect(resumedWorker.lastError).toBeUndefined();
      expect(runtime.getTask(firstTask(session).id)?.status).toBe('pending');
      expect(runtime.getTask(firstTask(session).id)?.error).toBeUndefined();
      expect(runtime.getSession(session.id)?.status).toBe('active');
      expect(runtime.getSession(session.id)?.resumeToken).toEqual(expect.stringMatching(/^resume-/));
      expect(runtime.getSession(session.id)?.eventLog.map(event => event.type)).toEqual(expect.arrayContaining([
        'worker-resumed',
        'task-updated'
      ]));
    });

    it('ponawia transientny błąd worker i kończy zadanie po sukcesie', async () => {
      const { runtime, registerWorker } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect'
      }));

      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Zadanie z retry'
      }));

      const run = vi.fn()
        .mockRejectedValueOnce(new Error('Transient failure'))
        .mockResolvedValueOnce({
          summary: 'Udało się po retry',
          references: ['docs/retry.md'],
          toolsUsed: []
        });
      registerWorker(worker.id, run);

      const runResult = runtime.runWorker(worker.id);
      expect(runResult.status).toBe('ok');
      expectOk(runResult);

      await vi.waitFor(() => {
        expect(runtime.getTask(firstTask(session).id)?.status).toBe('completed');
      });

      expect(run).toHaveBeenCalledTimes(2);
      const task = runtime.getTask(firstTask(session).id);
      expect(task?.result).toEqual({
        summary: 'Udało się po retry',
        references: ['docs/retry.md'],
        toolsUsed: []
      });
      expect(task?.error).toBeUndefined();
      expect(runtime.getSession(session.id)?.eventLog.map(event => event.type)).toEqual(expect.arrayContaining([
        'worker-crashed',
        'task-updated',
        'task-completed'
      ]));
    });
  });

  describe('subagent activity', () => {
    it('tworzy subagenta z ograniczonym zakresem uprawnień i zwraca task activity', async () => {
      const { runtime, registerWorker } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect',
        allowedTools: ['mcp.filesystem.read', 'mcp.seq.query']
      }));

      const subagent = expectOk(runtime.startSubagent({
        sessionId: session.id,
        name: 'security-reviewer',
        goal: 'Sprawdź ryzyka bezpieczeństwa',
        modelId: 'model-2',
        context: ['kontekst subagenta'],
        allowedTools: ['mcp.seq.query'],
        parentTaskId: firstTask(session).id
      }));

      expect(subagent.kind).toBe('subagent');
      expect(subagent.agentName).toBe('security-reviewer');
      expect(subagent.parentTaskId).toBe(firstTask(session).id);
      expect(subagent.permissionScope.kind).toBe('subagent');
      expect(subagent.permissionScope.allowedTools).toEqual(['mcp.seq.query']);
      expect(subagent.context).toEqual(['kontekst subagenta']);
      expect(runtime.getSession(session.id)?.tasks).toHaveLength(2);

      const run = createWorkerMock({
        summary: 'Brak krytycznych ryzyk',
        references: ['docs/security.md']
      });

      const subagentWorker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: subagent.id,
        prompt: subagent.prompt,
        context: subagent.context,
        allowedTools: subagent.permissionScope.allowedTools
      }));

      registerWorker(subagentWorker.id, run);

      const runResult = runtime.runWorker(subagentWorker.id);
      expect(runResult.status).toBe('ok');
      expectOk(runResult);

      const completedTaskId = subagentWorker.taskId;
      await vi.waitFor(() => {
        expect(runtime.getTask(completedTaskId)?.status).toBe('completed');
      });

      const task = runtime.getTask(completedTaskId);
      expect(task?.result).toEqual({
        summary: 'Brak krytycznych ryzyk',
        references: ['docs/security.md'],
        toolsUsed: []
      });
      expect(Object.isFrozen(task?.result)).toBe(true);
      expect(Object.isFrozen(task?.result?.references)).toBe(true);
      expect(task?.toolsUsed).toEqual([]);
      expect(runtime.getSession(session.id)?.eventLog.map(event => event.type)).toEqual(expect.arrayContaining([
        'task-created',
        'task-completed'
      ]));
    });

    it('odmawia subagenta podpiętego pod task z innej sesji', () => {
      const { runtime } = createRuntime();
      const parentSession = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-1',
        modelId: 'model-1',
        agentName: 'architect'
      }));
      const otherSession = expectOk(runtime.createSession({
        chatTabId: 'chat-tab-2',
        modelId: 'model-1',
        agentName: 'architect'
      }));

      const result = runtime.startSubagent({
        sessionId: parentSession.id,
        name: 'security-reviewer',
        goal: 'Sprawdź ryzyka',
        modelId: 'model-2',
        parentTaskId: firstTask(otherSession).id
      });

      const code = expectError<'INVALID_SCOPE'>(result);
      expect(code).toBe('INVALID_SCOPE');
    });
  });
});
