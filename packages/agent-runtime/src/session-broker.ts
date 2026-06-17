import { EventEmitter } from 'node:events';

export type AgentRuntimeTaskStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';

export type AgentRuntimeWorkerStatus = 'idle' | 'running' | 'retrying' | 'stopping' | 'stopped' | 'crashed';

export type AgentRuntimePermissionScope = Readonly<{
  sessionId: string;
  taskId: string;
  kind: 'parent' | 'subagent';
  allowedTools: readonly string[];
}>;

export type AgentRuntimeWorkerInput = Readonly<{
  sessionId: string;
  taskId: string;
  agentName: string;
  modelId: string;
  prompt: string;
  contextSnapshot: readonly string[];
  permissionScope: AgentRuntimePermissionScope;
}>;

export type AgentRuntimeWorkerOutput = Readonly<{
  summary: string;
  references: readonly string[];
  toolsUsed: readonly string[];
}>;

export type AgentRuntimeWorkerDefinition = Readonly<{
  id: string;
  run(
    input: AgentRuntimeWorkerInput,
    signal: AbortSignal
  ): Promise<AgentRuntimeWorkerOutput>;
}>;

export type AgentRuntimeEventMap = {
  'session-changed': (session: AgentRuntimeSessionState) => void;
  'session-crashed': (session: AgentRuntimeSessionState, error: Error) => void;
  'task-changed': (task: AgentRuntimeTaskState) => void;
  'worker-changed': (worker: AgentRuntimeWorkerState) => void;
};

export type AgentRuntimeSessionState = Readonly<{
  id: string;
  chatTabId: string;
  modelId: string;
  agentName: string;
  status: 'active' | 'crashed' | 'stopped';
  permissionScope: AgentRuntimePermissionScope;
  context: readonly string[];
  eventLog: readonly AgentRuntimeEventEntry[];
  workers: readonly AgentRuntimeWorkerState[];
  tasks: readonly AgentRuntimeTaskState[];
  resumeToken?: string;
}>;

export type AgentRuntimeWorkerState = Readonly<{
  id: string;
  sessionId: string;
  taskId: string;
  status: AgentRuntimeWorkerStatus;
  attempt: number;
  maxRetries: number;
  lastError?: string;
  startedAt?: number;
  stoppedAt?: number;
  output?: AgentRuntimeWorkerOutput;
}>;

export type AgentRuntimeTaskState = Readonly<{
  id: string;
  sessionId: string;
  parentTaskId?: string;
  kind: 'chat' | 'subagent';
  agentName: string;
  modelId: string;
  prompt: string;
  status: AgentRuntimeTaskStatus;
  permissionScope: AgentRuntimePermissionScope;
  context: readonly string[];
  toolsUsed: readonly string[];
  result?: AgentRuntimeWorkerOutput;
  error?: string;
  createdAt: number;
  updatedAt: number;
}>;

export type PatchSet = Readonly<{
  id: string;
  sessionId: string;
  taskId: string;
  filePath: string;
  baseHash: string;
  operations: readonly Readonly<{
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
    text: string;
  }>[];
  authorSessionId: string;
  riskLevel: 'low' | 'medium' | 'high';
}>;

export type AgentRuntimeEventEntry = Readonly<{
  id: string;
  sessionId: string;
  taskId?: string;
  workerId?: string;
  type: 'session-created' | 'session-stopped' | 'worker-started' | 'worker-stopped' | 'worker-crashed' | 'worker-resumed' | 'task-created' | 'task-updated' | 'task-completed' | 'task-failed' | 'task-cancelled';
  message: string;
  timestamp: number;
}>;

type MutableAgentRuntimeSessionState = {
  id: string;
  chatTabId: string;
  modelId: string;
  agentName: string;
  status: AgentRuntimeSessionState['status'];
  permissionScope: AgentRuntimePermissionScope;
  context: string[];
  eventLog: AgentRuntimeEventEntry[];
  workers: MutableAgentRuntimeWorkerState[];
  tasks: MutableAgentRuntimeTaskState[];
  resumeToken?: string;
};

type MutableAgentRuntimeWorkerState = {
  id: string;
  sessionId: string;
  taskId: string;
  status: AgentRuntimeWorkerState['status'];
  attempt: number;
  maxRetries: number;
  lastError?: string;
  startedAt?: number;
  stoppedAt?: number;
  output?: AgentRuntimeWorkerOutput;
};

type MutableAgentRuntimeTaskState = {
  id: string;
  sessionId: string;
  parentTaskId?: string;
  kind: AgentRuntimeTaskState['kind'];
  agentName: string;
  modelId: string;
  prompt: string;
  status: AgentRuntimeTaskState['status'];
  permissionScope: AgentRuntimePermissionScope;
  context: string[];
  toolsUsed: string[];
  result?: AgentRuntimeWorkerOutput;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

type MutableAgentRuntimeEventEntry = {
  id: string;
  sessionId: string;
  taskId?: string;
  workerId?: string;
  type: AgentRuntimeEventEntry['type'];
  message: string;
  timestamp: number;
};

type MutableAgentRuntimeWorkerSnapshot = {
  id: string;
  sessionId: string;
  taskId: string;
  status: AgentRuntimeWorkerState['status'];
  attempt: number;
  maxRetries: number;
  lastError?: string;
  startedAt?: number;
  stoppedAt?: number;
  output?: AgentRuntimeWorkerOutput;
};

type MutableAgentRuntimeTaskSnapshot = {
  id: string;
  sessionId: string;
  parentTaskId?: string;
  kind: AgentRuntimeTaskState['kind'];
  agentName: string;
  modelId: string;
  prompt: string;
  status: AgentRuntimeTaskState['status'];
  permissionScope: AgentRuntimePermissionScope;
  context: readonly string[];
  toolsUsed: readonly string[];
  result?: AgentRuntimeWorkerOutput;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

type MutableAgentRuntimeSessionSnapshot = {
  id: string;
  chatTabId: string;
  modelId: string;
  agentName: string;
  status: AgentRuntimeSessionState['status'];
  permissionScope: AgentRuntimePermissionScope;
  context: readonly string[];
  eventLog: readonly AgentRuntimeEventEntry[];
  workers: readonly AgentRuntimeWorkerState[];
  tasks: readonly AgentRuntimeTaskState[];
  resumeToken?: string;
};

type CreateTaskInput = {
  id: string;
  sessionId: string;
  parentTaskId?: string;
  kind: AgentRuntimeTaskState['kind'];
  agentName: string;
  modelId: string;
  prompt: string;
  status: AgentRuntimeTaskState['status'];
  permissionScope: AgentRuntimePermissionScope;
  context: string[];
  toolsUsed: string[];
  createdAt: number;
};

export type AgentRuntimeCreateOptions = Readonly<{
  workerFactory: (workerId: string) => AgentRuntimeWorkerDefinition;
  now?: () => number;
  maxRetries?: number;
}>;

export type AgentRuntimeStartSessionOptions = Readonly<{
  chatTabId: string;
  modelId: string;
  agentName: string;
  context?: readonly string[];
  allowedTools?: readonly string[];
}>;

export type AgentRuntimeStartWorkerOptions = Readonly<{
  sessionId: string;
  taskId: string;
  prompt: string;
  context?: readonly string[];
  allowedTools?: readonly string[];
}>;

export type AgentRuntimeStartSubagentOptions = Readonly<{
  sessionId: string;
  name: string;
  goal: string;
  modelId: string;
  context?: readonly string[];
  allowedTools?: readonly string[];
  parentTaskId?: string;
}>;

export type AgentRuntimeResumeOptions = Readonly<{
  sessionId: string;
  workerId: string;
}>;

export type AgentRuntimeResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; code: 'SESSION_NOT_FOUND' | 'WORKER_NOT_FOUND' | 'INVALID_SCOPE' | 'TASK_NOT_FOUND' | 'ALREADY_RUNNING' | 'UNKNOWN'; message: string };

function createId(prefix: string, now: () => number): string {
  return `${prefix}-${crypto.randomUUID()}-${now().toString(36)}`;
}

function isTaskRunning(task: AgentRuntimeTaskState): boolean {
  return task.status === 'running';
}

function isWorkerRunning(worker: AgentRuntimeWorkerState): boolean {
  return worker.status === 'running' || worker.status === 'retrying' || worker.status === 'stopping';
}

function cloneOutput(output: AgentRuntimeWorkerOutput): AgentRuntimeWorkerOutput {
  return Object.freeze({
    summary: output.summary,
    references: Object.freeze([...output.references]),
    toolsUsed: Object.freeze([...output.toolsUsed])
  });
}

export class AgentRuntime extends EventEmitter {
  private readonly sessions = new Map<string, MutableAgentRuntimeSessionState>();
  private readonly tasks = new Map<string, MutableAgentRuntimeTaskState>();
  private readonly workers = new Map<string, MutableAgentRuntimeWorkerState>();
  private readonly events = new Map<string, AgentRuntimeEventEntry>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly workerFactory: (workerId: string) => AgentRuntimeWorkerDefinition;
  private readonly now: () => number;
  private readonly maxRetries: number;

  constructor(options: AgentRuntimeCreateOptions) {
    super();
    this.workerFactory = options.workerFactory;
    this.now = options.now ?? (() => Date.now());
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
  }

  createSession(options: AgentRuntimeStartSessionOptions): AgentRuntimeResult<AgentRuntimeSessionState> {
    const id = createId('session', this.now);
    const taskId = createId('task', this.now);
    const scope = this.createPermissionScope({
      sessionId: id,
      taskId,
      kind: 'parent',
      allowedTools: options.allowedTools ?? []
    });

    const session: MutableAgentRuntimeSessionState = {
      id,
      chatTabId: options.chatTabId,
      modelId: options.modelId,
      agentName: options.agentName,
      status: 'active',
      permissionScope: scope,
      context: [...(options.context ?? [])],
      eventLog: [],
      workers: [],
      tasks: []
    };

    this.sessions.set(id, session);
    const task = this.createTask({
      id: taskId,
      sessionId: id,
      kind: 'chat',
      agentName: options.agentName,
      modelId: options.modelId,
      prompt: '',
      status: 'pending',
      permissionScope: scope,
      context: [...(options.context ?? [])],
      toolsUsed: [],
      createdAt: this.now()
    });
    session.tasks = [task];
    this.appendEvent({
      sessionId: id,
      taskId,
      type: 'session-created',
      message: 'Session created.'
    });
    this.emit('session-changed', this.getSessionSnapshot(id));

    return { status: 'ok', value: this.getSessionSnapshot(id) };
  }

  startWorker(options: AgentRuntimeStartWorkerOptions): AgentRuntimeResult<AgentRuntimeWorkerState> {
    const session = this.sessions.get(options.sessionId);
    if (!session) {
      return { status: 'error', code: 'SESSION_NOT_FOUND', message: 'Session not found.' };
    }

    const task = this.tasks.get(options.taskId);
    if (!task) {
      return { status: 'error', code: 'TASK_NOT_FOUND', message: 'Task not found.' };
    }

    if (isTaskRunning(task)) {
      return { status: 'error', code: 'ALREADY_RUNNING', message: 'Task is already running.' };
    }

    if (task.sessionId !== options.sessionId) {
      return { status: 'error', code: 'INVALID_SCOPE', message: 'Task does not belong to this session.' };
    }

    const workerId = createId('worker', this.now);
    const worker: MutableAgentRuntimeWorkerState = {
      id: workerId,
      sessionId: options.sessionId,
      taskId: options.taskId,
      status: 'idle',
      attempt: 0,
      maxRetries: this.maxRetries
    };

    task.prompt = options.prompt;
    task.context = [...(options.context ?? [])];
    task.permissionScope = this.createPermissionScope({
      sessionId: options.sessionId,
      taskId: task.id,
      kind: task.kind === 'subagent' ? 'subagent' : 'parent',
      allowedTools: options.allowedTools ?? task.permissionScope.allowedTools
    });

    this.workers.set(workerId, worker);
    session.workers = [...session.workers, worker];
    this.appendEvent({
      sessionId: options.sessionId,
      taskId: options.taskId,
      workerId,
      type: 'worker-started',
      message: 'Worker created.'
    });
    this.emit('worker-changed', this.cloneWorker(worker));
    this.emit('session-changed', this.getSessionSnapshot(options.sessionId));

    return { status: 'ok', value: this.cloneWorker(worker) };
  }

  updateSessionModel(sessionId: string, modelId: string): AgentRuntimeResult<AgentRuntimeSessionState> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { status: 'error', code: 'SESSION_NOT_FOUND', message: 'Session not found.' };
    }

    session.modelId = modelId;
    session.tasks.forEach(task => {
      if (task.status === 'pending') {
        task.modelId = modelId;
      }
    });

    this.appendEvent({
      sessionId: session.id,
      type: 'task-updated',
      message: 'Session model updated.'
    });
    this.emit('session-changed', this.getSessionSnapshot(session.id));

    return { status: 'ok', value: this.getSessionSnapshot(session.id) };
  }

  updateSessionAllowedTools(sessionId: string, allowedTools: readonly string[]): AgentRuntimeResult<AgentRuntimeSessionState> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { status: 'error', code: 'SESSION_NOT_FOUND', message: 'Session not found.' };
    }

    const scope = this.createPermissionScope({
      sessionId: session.id,
      taskId: session.permissionScope.taskId,
      kind: session.permissionScope.kind,
      allowedTools
    });
    session.permissionScope = scope;
    session.tasks.forEach(task => {
      if (task.status === 'pending') {
        task.permissionScope = scope;
      }
    });

    this.appendEvent({
      sessionId: session.id,
      type: 'task-updated',
      message: 'Session allowed tools updated.'
    });
    this.emit('session-changed', this.getSessionSnapshot(session.id));

    return { status: 'ok', value: this.getSessionSnapshot(session.id) };
  }

  runWorker(workerId: string): AgentRuntimeResult<AgentRuntimeWorkerState> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return { status: 'error', code: 'WORKER_NOT_FOUND', message: 'Worker not found.' };
    }

    const session = this.sessions.get(worker.sessionId);
    if (!session) {
      return { status: 'error', code: 'SESSION_NOT_FOUND', message: 'Session not found.' };
    }

    const task = this.tasks.get(worker.taskId);
    if (!task) {
      return { status: 'error', code: 'TASK_NOT_FOUND', message: 'Task not found.' };
    }

    if (isWorkerRunning(worker)) {
      return { status: 'error', code: 'ALREADY_RUNNING', message: 'Worker is already running.' };
    }

    let definition: AgentRuntimeWorkerDefinition;
    try {
      definition = this.workerFactory(workerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      worker.status = 'crashed';
      worker.lastError = message;
      worker.stoppedAt = this.now();
      task.status = 'failed';
      task.error = message;
      session.status = 'crashed';
      session.resumeToken = createId('resume', this.now);

      this.appendEvent({
        sessionId: session.id,
        taskId: task.id,
        workerId,
        type: 'worker-crashed',
        message: `Worker crashed: ${message}`
      });
      this.appendEvent({
        sessionId: session.id,
        taskId: task.id,
        type: 'task-failed',
        message: 'Task failed.'
      });
      this.emit('session-crashed', this.getSessionSnapshot(session.id), error instanceof Error ? error : new Error(message));
      this.emit('worker-changed', this.cloneWorker(worker));
      this.emit('task-changed', this.cloneTask(task));
      this.emit('session-changed', this.getSessionSnapshot(session.id));

      return { status: 'error', code: 'UNKNOWN', message: `Failed to create worker: ${message}` };
    }

    const abortController = new AbortController();
    const promise = this.executeWorker(workerId, definition, abortController.signal);

    void promise.catch(() => undefined);
    this.abortControllers.set(workerId, abortController);

    worker.status = 'running';
    worker.attempt += 1;
    worker.startedAt = this.now();
    delete worker.lastError;
    task.status = 'running';
    task.updatedAt = this.now();

    this.appendEvent({
      sessionId: session.id,
      taskId: task.id,
      workerId,
      type: 'worker-started',
      message: 'Worker started.'
    });
    this.appendEvent({
      sessionId: session.id,
      taskId: task.id,
      type: 'task-updated',
      message: 'Task started.'
    });
    this.emit('worker-changed', this.cloneWorker(worker));
    this.emit('task-changed', this.cloneTask(task));
    this.emit('session-changed', this.getSessionSnapshot(session.id));

    return { status: 'ok', value: this.cloneWorker(worker) };
  }

  async waitForWorker(workerId: string): Promise<AgentRuntimeResult<AgentRuntimeWorkerState>> {
    const timeoutMs = 30000;
    const startedAt = this.now();

    while (true) {
      const worker = this.workers.get(workerId);
      if (!worker) {
        return { status: 'error', code: 'WORKER_NOT_FOUND', message: 'Worker not found.' };
      }
      if (worker.status === 'stopped' || worker.status === 'crashed') {
        return { status: 'ok', value: this.cloneWorker(worker) };
      }
      if (this.now() - startedAt >= timeoutMs) {
        return { status: 'error', code: 'UNKNOWN', message: 'Timed out waiting for runtime worker.' };
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  stopWorker(workerId: string): AgentRuntimeResult<AgentRuntimeWorkerState> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return { status: 'error', code: 'WORKER_NOT_FOUND', message: 'Worker not found.' };
    }

    if (worker.status === 'stopped' || worker.status === 'crashed') {
      return { status: 'ok', value: this.cloneWorker(worker) };
    }

    if (worker.status === 'idle') {
      const task = this.tasks.get(worker.taskId);
      worker.status = 'stopped';
      worker.stoppedAt = this.now();
      if (task) {
        task.status = 'cancelled';
        task.updatedAt = this.now();
      }

      this.appendEvent({
        sessionId: worker.sessionId,
        taskId: worker.taskId,
        workerId,
        type: 'worker-stopped',
        message: 'Worker stopped before start.'
      });
      if (task) {
        this.appendEvent({
          sessionId: worker.sessionId,
          taskId: worker.taskId,
          type: 'task-cancelled',
          message: 'Task cancelled before start.'
        });
      }
      this.emit('worker-changed', this.cloneWorker(worker));
      if (task) {
        this.emit('task-changed', this.cloneTask(task));
      }
      this.emit('session-changed', this.getSessionSnapshot(worker.sessionId));

      return { status: 'ok', value: this.cloneWorker(worker) };
    }

    if (worker.status === 'retrying' || worker.status === 'stopping') {
      const controller = this.abortControllers.get(workerId);
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }

      if (worker.status === 'retrying') {
        worker.status = 'stopping';
        worker.stoppedAt = this.now();
        this.appendEvent({
          sessionId: worker.sessionId,
          taskId: worker.taskId,
          workerId,
          type: 'worker-stopped',
          message: 'Worker stop requested during retry.'
        });
        this.emit('worker-changed', this.cloneWorker(worker));
        this.emit('session-changed', this.getSessionSnapshot(worker.sessionId));
      }

      return { status: 'ok', value: this.cloneWorker(worker) };
    }

    const controller = this.abortControllers.get(workerId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }

    worker.status = 'stopping';
    worker.stoppedAt = this.now();
    this.appendEvent({
      sessionId: worker.sessionId,
      taskId: worker.taskId,
      workerId,
      type: 'worker-stopped',
      message: 'Worker stop requested.'
    });
    this.emit('worker-changed', this.cloneWorker(worker));
    this.emit('session-changed', this.getSessionSnapshot(worker.sessionId));

    return { status: 'ok', value: this.cloneWorker(worker) };
  }

  resumeWorker(options: AgentRuntimeResumeOptions): AgentRuntimeResult<AgentRuntimeWorkerState> {
    const worker = this.workers.get(options.workerId);
    if (!worker) {
      return { status: 'error', code: 'WORKER_NOT_FOUND', message: 'Worker not found.' };
    }

    const session = this.sessions.get(options.sessionId);
    if (!session) {
      return { status: 'error', code: 'SESSION_NOT_FOUND', message: 'Session not found.' };
    }

    if (worker.sessionId !== options.sessionId) {
      return { status: 'error', code: 'INVALID_SCOPE', message: 'Worker does not belong to this session.' };
    }

    if (worker.status !== 'crashed') {
      return { status: 'error', code: 'ALREADY_RUNNING', message: 'Worker is not crashed.' };
    }

    const task = this.tasks.get(worker.taskId);
    if (!task) {
      return { status: 'error', code: 'TASK_NOT_FOUND', message: 'Task not found.' };
    }

    worker.status = 'idle';
    worker.attempt = 0;
    delete worker.lastError;
    task.status = 'pending';
    delete task.error;
    task.updatedAt = this.now();
    session.status = 'active';
    session.resumeToken = createId('resume', this.now);

    this.appendEvent({
      sessionId: session.id,
      taskId: task.id,
      workerId: worker.id,
      type: 'worker-resumed',
      message: 'Worker resumed.'
    });
    this.appendEvent({
      sessionId: session.id,
      taskId: task.id,
      type: 'task-updated',
      message: 'Task resumed.'
    });
    this.emit('worker-changed', this.cloneWorker(worker));
    this.emit('task-changed', this.cloneTask(task));
    this.emit('session-changed', this.getSessionSnapshot(session.id));

    return { status: 'ok', value: this.cloneWorker(worker) };
  }

  stopSession(sessionId: string): AgentRuntimeResult<readonly AgentRuntimeWorkerState[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { status: 'error', code: 'SESSION_NOT_FOUND', message: 'Session not found.' };
    }

    const stoppedWorkers = session.workers
      .filter(worker => worker.status !== 'stopped' && worker.status !== 'crashed')
      .map(worker => this.stopWorker(worker.id));

    const workers = stoppedWorkers
      .filter((result): result is Extract<AgentRuntimeResult<AgentRuntimeWorkerState>, { status: 'ok' }> => result.status === 'ok')
      .map(result => result.value);

    session.status = 'stopped';
    session.tasks.forEach(task => {
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'cancelled';
        task.updatedAt = this.now();
      }
    });

    this.appendEvent({
      sessionId: session.id,
      type: 'session-stopped',
      message: 'Session stopped.'
    });
    this.emit('session-changed', this.getSessionSnapshot(session.id));

    return { status: 'ok', value: Object.freeze(workers.map(worker => this.cloneWorker(worker))) };
  }

  startSubagent(options: AgentRuntimeStartSubagentOptions): AgentRuntimeResult<AgentRuntimeTaskState> {
    const session = this.sessions.get(options.sessionId);
    if (!session) {
      return { status: 'error', code: 'SESSION_NOT_FOUND', message: 'Session not found.' };
    }

    const taskId = createId('task', this.now);
    const scope = this.createPermissionScope({
      sessionId: session.id,
      taskId,
      kind: 'subagent',
      allowedTools: options.allowedTools ?? []
    });

    const taskInput: CreateTaskInput = {
      id: taskId,
      sessionId: session.id,
      kind: 'subagent',
      agentName: options.name,
      modelId: options.modelId,
      prompt: options.goal,
      status: 'pending',
      permissionScope: scope,
      context: [...(options.context ?? [])],
      toolsUsed: [],
      createdAt: this.now()
    };

    if (options.parentTaskId !== undefined) {
      const parentTask = this.tasks.get(options.parentTaskId);
      if (parentTask?.sessionId !== session.id) {
        return { status: 'error', code: 'INVALID_SCOPE', message: 'Parent task does not belong to this session.' };
      }
      taskInput.parentTaskId = options.parentTaskId;
    }

    const task = this.createTask(taskInput);

    session.tasks = [...session.tasks, task];
    this.appendEvent({
      sessionId: session.id,
      taskId,
      type: 'task-created',
      message: 'Subagent task created.'
    });
    this.emit('task-changed', this.cloneTask(task));
    this.emit('session-changed', this.getSessionSnapshot(session.id));

    return { status: 'ok', value: this.cloneTask(task) };
  }

  listSessions(): readonly AgentRuntimeSessionState[] {
    return [...this.sessions.values()].map(session => this.getSessionSnapshot(session.id));
  }

  getSession(sessionId: string): AgentRuntimeSessionState | undefined {
    const session = this.sessions.get(sessionId);
    return session ? this.getSessionSnapshot(session.id) : undefined;
  }

  listWorkers(sessionId?: string): readonly AgentRuntimeWorkerState[] {
    const workers = sessionId ? [...this.workers.values()].filter(worker => worker.sessionId === sessionId) : [...this.workers.values()];
    return workers.map(worker => this.cloneWorker(worker));
  }

  getWorker(workerId: string): AgentRuntimeWorkerState | undefined {
    const worker = this.workers.get(workerId);
    return worker ? this.cloneWorker(worker) : undefined;
  }

  listTasks(sessionId?: string): readonly AgentRuntimeTaskState[] {
    const tasks = sessionId ? [...this.tasks.values()].filter(task => task.sessionId === sessionId) : [...this.tasks.values()];
    return tasks.map(task => this.cloneTask(task));
  }

  getTask(taskId: string): AgentRuntimeTaskState | undefined {
    const task = this.tasks.get(taskId);
    return task ? this.cloneTask(task) : undefined;
  }

  private async executeWorker(
    workerId: string,
    definition: AgentRuntimeWorkerDefinition,
    signal: AbortSignal
  ): Promise<void> {
    const worker = this.workers.get(workerId);
    const session = worker ? this.sessions.get(worker.sessionId) : undefined;
    const task = worker ? this.tasks.get(worker.taskId) : undefined;
    if (!worker || !session || !task) return;

    const maxAttempts = worker.maxRetries + 1;

    while (!signal.aborted) {
      const attemptResult = await this.runWorkerAttempt(workerId, worker, session, task, definition, signal, maxAttempts);

      if (attemptResult === 'completed' || attemptResult === 'cancelled' || attemptResult === 'crashed') {
        return;
      }
    }

    if (signal.aborted && worker.status !== 'stopped' && worker.status !== 'crashed') {
      this.cancelWorker(workerId, 'cancelled');
    }
  }

  private async runWorkerAttempt(
    workerId: string,
    worker: MutableAgentRuntimeWorkerState,
    session: MutableAgentRuntimeSessionState,
    task: MutableAgentRuntimeTaskState,
    definition: AgentRuntimeWorkerDefinition,
    signal: AbortSignal,
    maxAttempts: number
  ): Promise<'retry' | 'completed' | 'cancelled' | 'crashed'> {
    try {
      const output = await definition.run({
        sessionId: session.id,
        taskId: task.id,
        agentName: session.agentName,
        modelId: task.modelId,
        prompt: task.prompt,
        contextSnapshot: [...task.context],
        permissionScope: {
          ...task.permissionScope,
          allowedTools: [...task.permissionScope.allowedTools]
        }
      }, signal);

      if (signal.aborted) {
        this.cancelWorker(workerId, 'cancelled');
        return 'cancelled';
      }

      this.completeWorker(workerId, worker, session, task, output);
      return 'completed';
    } catch (error) {
      if (this.isAbortError(error, signal)) {
        this.cancelWorker(workerId, 'cancelled');
        return 'cancelled';
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      worker.lastError = message;
      worker.status = 'retrying';
      task.status = 'pending';
      task.updatedAt = this.now();

      if (worker.attempt >= maxAttempts) {
        this.crashWorker(workerId, worker, session, task, message, error);
        return 'crashed';
      }

      worker.attempt += 1;
      this.recordRetry(workerId, worker, session, task, message, maxAttempts);
      return 'retry';
    }
  }

  private isAbortError(error: unknown, signal: AbortSignal): boolean {
    return signal.aborted || (error instanceof Error && error.name === 'AbortError');
  }

  private completeWorker(
    workerId: string,
    worker: MutableAgentRuntimeWorkerState,
    session: MutableAgentRuntimeSessionState,
    task: MutableAgentRuntimeTaskState,
    output: AgentRuntimeWorkerOutput
  ): void {
    const result = cloneOutput(output);

    worker.status = 'stopped';
    worker.output = result;
    worker.stoppedAt = this.now();
    task.status = 'completed';
    task.result = result;
    task.updatedAt = this.now();
    task.toolsUsed = [...result.toolsUsed];

    this.appendEvent({
      sessionId: session.id,
      taskId: task.id,
      workerId,
      type: 'worker-stopped',
      message: 'Worker completed.'
    });
    this.appendEvent({
      sessionId: session.id,
      taskId: task.id,
      type: 'task-completed',
      message: 'Task completed.'
    });
    this.abortControllers.delete(worker.id);
    this.emitChanged(session, task, worker.id);
  }

  private crashWorker(
    workerId: string,
    worker: MutableAgentRuntimeWorkerState,
    session: MutableAgentRuntimeSessionState,
    task: MutableAgentRuntimeTaskState,
    message: string,
    error: unknown
  ): void {
    worker.status = 'crashed';
    task.status = 'failed';
    task.error = message;
    session.status = 'crashed';
    session.resumeToken = createId('resume', this.now);

    this.appendEvent({
      sessionId: session.id,
      taskId: task.id,
      workerId,
      type: 'worker-crashed',
      message: `Worker crashed: ${message}`
    });
    this.appendEvent({
      sessionId: session.id,
      taskId: task.id,
      type: 'task-failed',
      message: 'Task failed.'
    });
    this.abortControllers.delete(worker.id);
    this.emit('session-crashed', this.getSessionSnapshot(session.id), error instanceof Error ? error : new Error(message));
    this.emitChanged(session, task, worker.id);
  }

  private recordRetry(
    workerId: string,
    worker: MutableAgentRuntimeWorkerState,
    session: MutableAgentRuntimeSessionState,
    task: MutableAgentRuntimeTaskState,
    message: string,
    maxAttempts: number
  ): void {
    this.appendEvent({
      sessionId: session.id,
      taskId: task.id,
      workerId,
      type: 'worker-crashed',
      message: `Worker failed: ${message} (retry ${worker.attempt}/${maxAttempts}).`
    });
    this.appendEvent({
      sessionId: session.id,
      taskId: task.id,
      type: 'task-updated',
      message: 'Task queued for retry.'
    });
    this.emitChanged(session, task, worker.id);
  }

  private emitChanged(session: MutableAgentRuntimeSessionState, task: MutableAgentRuntimeTaskState, workerId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      this.emit('worker-changed', this.cloneWorker(worker));
    }
    this.emit('task-changed', this.cloneTask(task));
    this.emit('session-changed', this.getSessionSnapshot(session.id));
  }

  private cancelWorker(workerId: string, reason: string): void {
    const worker = this.workers.get(workerId);
    const task = worker ? this.tasks.get(worker.taskId) : undefined;
    const session = worker ? this.sessions.get(worker.sessionId) : undefined;

    if (!worker || !task || !session) return;

    worker.status = 'stopped';
    worker.stoppedAt = this.now();
    task.status = 'cancelled';
    task.error = reason;
    task.updatedAt = this.now();

    this.appendEvent({
      sessionId: session.id,
      taskId: task.id,
      workerId,
      type: 'worker-stopped',
      message: 'Worker cancelled.'
    });
    this.appendEvent({
      sessionId: session.id,
      taskId: task.id,
      type: 'task-cancelled',
      message: 'Task cancelled.'
    });
    this.emit('worker-changed', this.cloneWorker(worker));
    this.emit('task-changed', this.cloneTask(task));
    this.emit('session-changed', this.getSessionSnapshot(session.id));
  }

  private createTask(input: CreateTaskInput): MutableAgentRuntimeTaskState {
    const task: MutableAgentRuntimeTaskState = {
      ...input,
      updatedAt: this.now()
    };
    this.tasks.set(task.id, task);
    return task;
  }

  private createPermissionScope(input: AgentRuntimePermissionScope): AgentRuntimePermissionScope {
    return this.clonePermissionScope(input);
  }

  private appendEvent(input: Omit<AgentRuntimeEventEntry, 'id' | 'timestamp'>): AgentRuntimeEventEntry {
    const entry: AgentRuntimeEventEntry = {
      id: createId('event', this.now),
      timestamp: this.now(),
      ...input
    };
    this.events.set(entry.id, entry);

    const session = this.sessions.get(input.sessionId);
    if (session) {
      session.eventLog = [...session.eventLog, entry];
    }

    return entry;
  }

  private clonePermissionScope(scope: AgentRuntimePermissionScope): AgentRuntimePermissionScope {
    return Object.freeze({
      sessionId: scope.sessionId,
      taskId: scope.taskId,
      kind: scope.kind,
      allowedTools: Object.freeze([...scope.allowedTools])
    });
  }

  private cloneEvent(entry: AgentRuntimeEventEntry): AgentRuntimeEventEntry {
    const clone: MutableAgentRuntimeEventEntry = {
      id: entry.id,
      sessionId: entry.sessionId,
      type: entry.type,
      message: entry.message,
      timestamp: entry.timestamp
    };

    if (entry.taskId) {
      clone.taskId = entry.taskId;
    }
    if (entry.workerId) {
      clone.workerId = entry.workerId;
    }

    return Object.freeze(clone);
  }

  private cloneWorker(worker: MutableAgentRuntimeWorkerState): AgentRuntimeWorkerState {
    const clone: MutableAgentRuntimeWorkerSnapshot = {
      id: worker.id,
      sessionId: worker.sessionId,
      taskId: worker.taskId,
      status: worker.status,
      attempt: worker.attempt,
      maxRetries: worker.maxRetries
    };

    if (worker.lastError) {
      clone.lastError = worker.lastError;
    }
    if (worker.startedAt) {
      clone.startedAt = worker.startedAt;
    }
    if (worker.stoppedAt) {
      clone.stoppedAt = worker.stoppedAt;
    }
    if (worker.output) {
      clone.output = cloneOutput(worker.output);
    }

    return Object.freeze(clone);
  }

  private cloneTask(task: MutableAgentRuntimeTaskState): AgentRuntimeTaskState {
    const clone: MutableAgentRuntimeTaskSnapshot = {
      id: task.id,
      sessionId: task.sessionId,
      kind: task.kind,
      agentName: task.agentName,
      modelId: task.modelId,
      prompt: task.prompt,
      status: task.status,
      permissionScope: this.clonePermissionScope(task.permissionScope),
      context: Object.freeze([...task.context]),
      toolsUsed: Object.freeze([...task.toolsUsed]),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };

    if (task.parentTaskId) {
      clone.parentTaskId = task.parentTaskId;
    }
    if (task.result) {
      clone.result = cloneOutput(task.result);
    }
    if (task.error) {
      clone.error = task.error;
    }

    return Object.freeze(clone);
  }

  private getSessionSnapshot(sessionId: string): AgentRuntimeSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found.');
    }

    const clone: MutableAgentRuntimeSessionSnapshot = {
      id: session.id,
      chatTabId: session.chatTabId,
      modelId: session.modelId,
      agentName: session.agentName,
      status: session.status,
      permissionScope: this.clonePermissionScope(session.permissionScope),
      context: Object.freeze([...session.context]),
      eventLog: Object.freeze(session.eventLog.map(event => this.cloneEvent(event))),
      workers: Object.freeze(session.workers.map(worker => this.cloneWorker(worker))),
      tasks: Object.freeze(session.tasks.map(task => this.cloneTask(task)))
    };

    if (session.resumeToken) {
      clone.resumeToken = session.resumeToken;
    }

    return Object.freeze(clone);
  }
}

export function createAgentRuntime(options: AgentRuntimeCreateOptions): AgentRuntime {
  return new AgentRuntime(options);
}
