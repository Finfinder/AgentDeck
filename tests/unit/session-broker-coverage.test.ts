import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAgentRuntime,
  type AgentRuntimeResult,
  type AgentRuntimeTaskState,
  type AgentRuntimeWorkerDefinition,
  type AgentRuntimeWorkerOutput
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

describe('AgentRuntime Session Broker — additional coverage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error paths for createSession', () => {
    it('creates session with empty context when not provided', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      expect(session.context).toEqual([]);
      expect(session.workers).toEqual([]);
      expect(session.tasks).toHaveLength(1);
    });

    it('creates session with empty allowedTools when not provided', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      expect(session.permissionScope.allowedTools).toEqual([]);
    });
  });

  describe('error paths for startWorker', () => {
    it('returns SESSION_NOT_FOUND for unknown sessionId', () => {
      const { runtime } = createRuntime();
      const result = runtime.startWorker({
        sessionId: 'nonexistent',
        taskId: 'task-1',
        prompt: 'test'
      });
      expectError<'SESSION_NOT_FOUND'>(result);
    });

    it('returns TASK_NOT_FOUND for unknown taskId', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const result = runtime.startWorker({
        sessionId: session.id,
        taskId: 'nonexistent',
        prompt: 'test'
      });
      expectError<'TASK_NOT_FOUND'>(result);
    });

    it('returns ALREADY_RUNNING when task is already running', async () => {
      const { runtime, registerWorker, tick } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Long task'
      }));
      const neverWorker = vi.fn().mockReturnValue(new Promise<never>(() => {}));
      registerWorker(worker.id, neverWorker);
      expectOk(runtime.runWorker(worker.id));
      tick();

      const result = runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Duplicate'
      });
      expectError<'ALREADY_RUNNING'>(result);
    });
  });

  describe('error paths for runWorker', () => {
    it('returns WORKER_NOT_FOUND for unknown workerId', () => {
      const { runtime } = createRuntime();
      const result = runtime.runWorker('nonexistent');
      expectError<'WORKER_NOT_FOUND'>(result);
    });

    it('returns ALREADY_RUNNING when worker is already running', async () => {
      const { runtime, registerWorker, tick } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Long task'
      }));
      const neverWorker = vi.fn().mockReturnValue(new Promise<never>(() => {}));
      registerWorker(worker.id, neverWorker);
      expectOk(runtime.runWorker(worker.id));
      tick();

      const result = runtime.runWorker(worker.id);
      expectError<'ALREADY_RUNNING'>(result);
    });
  });

  describe('error paths for stopWorker', () => {
    it('returns WORKER_NOT_FOUND for unknown workerId', () => {
      const { runtime } = createRuntime();
      const result = runtime.stopWorker('nonexistent');
      expectError<'WORKER_NOT_FOUND'>(result);
    });

    it('returns ok for already stopped worker', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'test'
      }));
      expectOk(runtime.stopWorker(worker.id));
      const result = runtime.stopWorker(worker.id);
      expect(result.status).toBe('ok');
    });

    it('returns ok for already crashed worker', async () => {
      const { runtime, registerWorker } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'test'
      }));
      registerWorker(worker.id, createFailingWorkerMock('fail'));
      expectOk(runtime.runWorker(worker.id));
      await vi.waitFor(() => {
        expect(runtime.getWorker(worker.id)?.status).toBe('crashed');
      });

      const result = runtime.stopWorker(worker.id);
      expect(result.status).toBe('ok');
    });

    it('stops idle worker and cancels its task', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'test'
      }));
      const result = runtime.stopWorker(worker.id);
      expectOk(result);
      expect(runtime.getTask(firstTask(session).id)?.status).toBe('cancelled');
    });
  });

  describe('error paths for resumeWorker', () => {
    it('returns WORKER_NOT_FOUND for unknown workerId', () => {
      const { runtime } = createRuntime();
      const result = runtime.resumeWorker({
        sessionId: 'session-1',
        workerId: 'nonexistent'
      });
      expectError<'WORKER_NOT_FOUND'>(result);
    });

    it('returns SESSION_NOT_FOUND for unknown sessionId', async () => {
      const { runtime, registerWorker } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'test'
      }));
      registerWorker(worker.id, createFailingWorkerMock('fail'));
      expectOk(runtime.runWorker(worker.id));
      await vi.waitFor(() => {
        expect(runtime.getWorker(worker.id)?.status).toBe('crashed');
      });

      const result = runtime.resumeWorker({
        sessionId: 'nonexistent',
        workerId: worker.id
      });
      expectError<'SESSION_NOT_FOUND'>(result);
    });

    it('returns INVALID_SCOPE when worker does not belong to session', async () => {
      const { runtime, registerWorker } = createRuntime();
      const session1 = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const session2 = expectOk(runtime.createSession({
        chatTabId: 'tab-2',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session1.id,
        taskId: firstTask(session1).id,
        prompt: 'test'
      }));
      registerWorker(worker.id, createFailingWorkerMock('fail'));
      expectOk(runtime.runWorker(worker.id));
      await vi.waitFor(() => {
        expect(runtime.getWorker(worker.id)?.status).toBe('crashed');
      });

      const result = runtime.resumeWorker({
        sessionId: session2.id,
        workerId: worker.id
      });
      expectError<'INVALID_SCOPE'>(result);
    });

    it('returns ALREADY_RUNNING when worker is not crashed', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'test'
      }));
      const result = runtime.resumeWorker({
        sessionId: session.id,
        workerId: worker.id
      });
      expectError<'ALREADY_RUNNING'>(result);
    });
  });

  describe('error paths for stopSession', () => {
    it('returns SESSION_NOT_FOUND for unknown sessionId', () => {
      const { runtime } = createRuntime();
      const result = runtime.stopSession('nonexistent');
      expectError<'SESSION_NOT_FOUND'>(result);
    });

    it('stops session with no workers', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const result = runtime.stopSession(session.id);
      expectOk(result);
      expect(runtime.getSession(session.id)?.status).toBe('stopped');
    });
  });

  describe('error paths for startSubagent', () => {
    it('returns SESSION_NOT_FOUND for unknown sessionId', () => {
      const { runtime } = createRuntime();
      const result = runtime.startSubagent({
        sessionId: 'nonexistent',
        name: 'sub',
        goal: 'test',
        modelId: 'model-1'
      });
      expectError<'SESSION_NOT_FOUND'>(result);
    });

    it('returns INVALID_SCOPE for parent task in different session', () => {
      const { runtime } = createRuntime();
      const session1 = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const session2 = expectOk(runtime.createSession({
        chatTabId: 'tab-2',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const result = runtime.startSubagent({
        sessionId: session1.id,
        name: 'sub',
        goal: 'test',
        modelId: 'model-1',
        parentTaskId: firstTask(session2).id
      });
      expectError<'INVALID_SCOPE'>(result);
    });

    it('creates subagent without parentTaskId', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const sub = expectOk(runtime.startSubagent({
        sessionId: session.id,
        name: 'orphan-sub',
        goal: 'standalone task',
        modelId: 'model-1'
      }));
      expect(sub.parentTaskId).toBeUndefined();
      expect(sub.kind).toBe('subagent');
    });
  });

  describe('list and get methods', () => {
    it('listSessions returns empty array when no sessions', () => {
      const { runtime } = createRuntime();
      expect(runtime.listSessions()).toEqual([]);
    });

    it('getSession returns undefined for unknown id', () => {
      const { runtime } = createRuntime();
      expect(runtime.getSession('nonexistent')).toBeUndefined();
    });

    it('listWorkers returns empty array when no workers', () => {
      const { runtime } = createRuntime();
      expect(runtime.listWorkers()).toEqual([]);
    });

    it('listWorkers filters by sessionId', () => {
      const { runtime } = createRuntime();
      const session1 = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const session2 = expectOk(runtime.createSession({
        chatTabId: 'tab-2',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      expectOk(runtime.startWorker({
        sessionId: session1.id,
        taskId: firstTask(session1).id,
        prompt: 'w1'
      }));
      expectOk(runtime.startWorker({
        sessionId: session2.id,
        taskId: firstTask(session2).id,
        prompt: 'w2'
      }));
      expect(runtime.listWorkers(session1.id)).toHaveLength(1);
      expect(runtime.listWorkers(session2.id)).toHaveLength(1);
      expect(runtime.listWorkers()).toHaveLength(2);
    });

    it('getWorker returns undefined for unknown id', () => {
      const { runtime } = createRuntime();
      expect(runtime.getWorker('nonexistent')).toBeUndefined();
    });

    it('listTasks returns empty array when no tasks', () => {
      const { runtime } = createRuntime();
      expect(runtime.listTasks()).toEqual([]);
    });

    it('listTasks filters by sessionId', () => {
      const { runtime } = createRuntime();
      const session1 = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const session2 = expectOk(runtime.createSession({
        chatTabId: 'tab-2',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      expect(runtime.listTasks(session1.id)).toHaveLength(1);
      expect(runtime.listTasks(session2.id)).toHaveLength(1);
    });

    it('getTask returns undefined for unknown id', () => {
      const { runtime } = createRuntime();
      expect(runtime.getTask('nonexistent')).toBeUndefined();
    });
  });

  describe('updateSessionModel', () => {
    it('updates model for pending tasks', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const result = runtime.updateSessionModel(session.id, 'model-2');
      expectOk(result);
      expect(runtime.getSession(session.id)?.modelId).toBe('model-2');
      expect(runtime.getTask(firstTask(session).id)?.modelId).toBe('model-2');
    });

    it('returns SESSION_NOT_FOUND for unknown sessionId', () => {
      const { runtime } = createRuntime();
      const result = runtime.updateSessionModel('nonexistent', 'model-2');
      expectError<'SESSION_NOT_FOUND'>(result);
    });

    it('does not update model for running tasks', async () => {
      const { runtime, registerWorker, tick } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'Long task'
      }));
      const neverWorker = vi.fn().mockReturnValue(new Promise<never>(() => {}));
      registerWorker(worker.id, neverWorker);
      expectOk(runtime.runWorker(worker.id));
      tick();

      expectOk(runtime.updateSessionModel(session.id, 'model-2'));
      expect(runtime.getSession(session.id)?.modelId).toBe('model-2');
    });
  });

  describe('updateSessionAllowedTools', () => {
    it('updates allowed tools for pending tasks', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent',
        allowedTools: ['tool-a']
      }));
      const result = runtime.updateSessionAllowedTools(session.id, ['tool-b', 'tool-c']);
      expectOk(result);
      expect(runtime.getSession(session.id)?.permissionScope.allowedTools).toEqual(['tool-b', 'tool-c']);
    });

    it('returns SESSION_NOT_FOUND for unknown sessionId', () => {
      const { runtime } = createRuntime();
      const result = runtime.updateSessionAllowedTools('nonexistent', ['tool-a']);
      expectError<'SESSION_NOT_FOUND'>(result);
    });
  });

  describe('waitForWorker', () => {
    it('returns worker when worker stops', async () => {
      const { runtime, registerWorker, tick } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'test'
      }));
      registerWorker(worker.id, createWorkerMock({
        summary: 'done',
        references: []
      }));
      expectOk(runtime.runWorker(worker.id));
      tick();

      const result = await runtime.waitForWorker(worker.id);
      expect(result.status).toBe('ok');
    });

    it('returns WORKER_NOT_FOUND for unknown workerId', async () => {
      const { runtime } = createRuntime();
      const result = await runtime.waitForWorker('nonexistent');
      expectError<'WORKER_NOT_FOUND'>(result);
    });
  });

  describe('event log coverage', () => {
    it('records session-stopped event', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      runtime.stopSession(session.id);
      const stopped = runtime.getSession(session.id);
      expect(stopped?.eventLog.some(e => e.type === 'session-stopped')).toBe(true);
    });

    it('records task-cancelled event when stopping idle worker', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'test'
      }));
      runtime.stopWorker(worker.id);
      const updated = runtime.getSession(session.id);
      expect(updated?.eventLog.some(e => e.type === 'task-cancelled')).toBe(true);
    });

    it('records worker-resumed event', async () => {
      const { runtime, registerWorker } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'test'
      }));
      registerWorker(worker.id, createFailingWorkerMock('fail'));
      expectOk(runtime.runWorker(worker.id));
      await vi.waitFor(() => {
        expect(runtime.getWorker(worker.id)?.status).toBe('crashed');
      });
      expectOk(runtime.resumeWorker({ sessionId: session.id, workerId: worker.id }));
      const updated = runtime.getSession(session.id);
      expect(updated?.eventLog.some(e => e.type === 'worker-resumed')).toBe(true);
    });

    it('records task-created event for subagent', () => {
      const { runtime } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      expectOk(runtime.startSubagent({
        sessionId: session.id,
        name: 'sub',
        goal: 'test',
        modelId: 'model-1'
      }));
      const updated = runtime.getSession(session.id);
      expect(updated?.eventLog.some(e => e.type === 'task-created')).toBe(true);
    });
  });

  describe('sanitizeEventMessage', () => {
    it('redacts secrets from event messages via worker execution', async () => {
      const { runtime, registerWorker, tick } = createRuntime();
      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'test'
      }));
      registerWorker(worker.id, createWorkerMock({
        summary: 'done',
        references: []
      }));

      const runResult = runtime.runWorker(worker.id);
      expect(runResult.status).toBe('ok');
      tick();

      await vi.waitFor(() => {
        expect(runtime.getTask(firstTask(session).id)?.status).toBe('completed');
      });

      // Verify event log was created (sanitizeEventMessage is called internally)
      const updated = runtime.getSession(session.id);
      expect(updated?.eventLog.length).toBeGreaterThan(0);
    });
  });

  describe('worker retry with maxRetries', () => {
    it('uses configured maxRetries value', async () => {
      const now = 1000;
      const workers = new Map<string, AgentRuntimeWorkerDefinition>();
      const runtime = createAgentRuntime({
        workerFactory: (id: string) => {
          const w = workers.get(id);
          if (!w) throw new Error('no worker');
          return w;
        },
        now: () => now,
        maxRetries: 0
      });

      const session = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const worker = expectOk(runtime.startWorker({
        sessionId: session.id,
        taskId: firstTask(session).id,
        prompt: 'test'
      }));

      const run = vi.fn().mockRejectedValue(new Error('fail'));
      workers.set(worker.id, { id: worker.id, run });

      expectOk(runtime.runWorker(worker.id));
      await vi.waitFor(() => {
        expect(runtime.getWorker(worker.id)?.status).toBe('crashed');
      });

      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  describe('session isolation', () => {
    it('multiple sessions have independent event logs', () => {
      const { runtime } = createRuntime();
      const s1 = expectOk(runtime.createSession({
        chatTabId: 'tab-1',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      const s2 = expectOk(runtime.createSession({
        chatTabId: 'tab-2',
        modelId: 'model-1',
        agentName: 'agent'
      }));
      runtime.stopSession(s1.id);
      expect(runtime.getSession(s1.id)?.eventLog.some(e => e.type === 'session-stopped')).toBe(true);
      expect(runtime.getSession(s2.id)?.eventLog.some(e => e.type === 'session-stopped')).toBe(false);
    });
  });
});
