import { describe, it, expect } from 'vitest';
import { createPermissionBroker } from '@agentdeck/permission-broker';
import type { PermissionRequest } from '@agentdeck/permission-broker';

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: `req-${Date.now()}`,
    sessionId: 'session-1',
    taskId: 'task-1',
    workerId: undefined,
    actorKind: 'agent',
    kind: 'read',
    toolName: 'read_file',
    target: '/workspace/file.ts',
    metadata: {},
    workspaceRoots: ['/workspace'],
    runtimeKind: 'parent',
    ...overrides
  };
}

describe('PermissionBroker', () => {
  it('auto-allows read operations within workspace', async () => {
    const broker = createPermissionBroker();
    const request = makeRequest({ kind: 'read', target: '/workspace/src/index.ts' });
    const result = await broker.evaluate(request);
    expect(result.decision).toBe('allow');
    expect(result.risk).toBe('low');
  });

  it('prompts for write operations', async () => {
    const broker = createPermissionBroker();
    const request = makeRequest({ kind: 'write', toolName: 'create_file', target: '/workspace/new.ts' });
    const result = await broker.evaluate(request);
    expect(result.decision).toBe('prompt');
    expect(result.risk).toBe('medium');
  });

  it('prompts for delete operations', async () => {
    const broker = createPermissionBroker();
    const request = makeRequest({ kind: 'delete', toolName: 'delete_file', target: '/workspace/old.ts' });
    const result = await broker.evaluate(request);
    expect(result.decision).toBe('prompt');
    expect(result.risk).toBe('critical');
  });

  it('denies secrets access', async () => {
    const broker = createPermissionBroker();
    const request = makeRequest({ kind: 'secretsAccess', toolName: 'get_api_key', target: 'api-key' });
    const result = await broker.evaluate(request);
    expect(result.decision).toBe('deny');
  });

  it('denies terminal for mcp actor', async () => {
    const broker = createPermissionBroker();
    const request = makeRequest({ kind: 'terminal', actorKind: 'mcp', toolName: 'run_terminal', target: 'shell' });
    const result = await broker.evaluate(request);
    expect(result.decision).toBe('deny');
  });

  it('tracks audit entries in state', async () => {
    const broker = createPermissionBroker();
    const request = makeRequest({ kind: 'read' });
    await broker.evaluate(request);
    const state = broker.getState();
    expect(state.audit.length).toBeGreaterThanOrEqual(1);
  });

  it('supports approve flow for prompted decisions', async () => {
    const broker = createPermissionBroker();
    const request = makeRequest({ kind: 'write', toolName: 'create_file' });
    const evaluation = await broker.evaluate(request);
    expect(evaluation.decision).toBe('prompt');
    expect(evaluation.decisionId).toBeDefined();

    const approval = broker.approve({
      decisionId: evaluation.decisionId!,
      decision: 'allow',
      duration: 'session'
    });
    expect(approval.status).toBe('ok');
  });

  it('supports deny flow for prompted decisions', async () => {
    const broker = createPermissionBroker();
    const request = makeRequest({ kind: 'write', toolName: 'create_file' });
    const evaluation = await broker.evaluate(request);
    expect(evaluation.decision).toBe('prompt');

    const denial = broker.approve({
      decisionId: evaluation.decisionId!,
      decision: 'deny',
      duration: 'once'
    });
    expect(denial.status).toBe('ok');
    if (denial.status === 'ok') {
      expect(denial.decision.decision).toBe('deny');
    }
  });

  it('returns error for unknown decision id', () => {
    const broker = createPermissionBroker();
    const result = broker.approve({
      decisionId: 'nonexistent',
      decision: 'allow',
      duration: 'once'
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('DECISION_NOT_FOUND');
    }
  });

  it('records audit entries after tool call', async () => {
    const broker = createPermissionBroker();
    const request = makeRequest({ kind: 'read' });
    const evaluation = await broker.evaluate(request);
    const decision = {
      id: 'test-decision',
      requestId: request.id,
      sessionId: request.sessionId,
      taskId: request.taskId,
      workerId: request.workerId,
      actorKind: request.actorKind,
      kind: request.kind,
      toolName: request.toolName,
      target: request.target,
      risk: evaluation.risk,
      decision: evaluation.decision,
      reason: evaluation.reason,
      createdAt: Date.now()
    };
    broker.afterToolCall(request, decision, 'success', 42);
    const state = broker.getState();
    expect(state.audit.length).toBeGreaterThanOrEqual(1);
    const lastAudit = state.audit[state.audit.length - 1]!;
    expect(lastAudit.outcome).toBe('success');
    expect(lastAudit.durationMs).toBe(42);
  });

  it('notifies decision handlers', async () => {
    const broker = createPermissionBroker();
    const decisions: unknown[] = [];
    broker.onDecision((d) => decisions.push(d));

    const request = makeRequest({ kind: 'write' });
    const evaluation = await broker.evaluate(request);
    if (evaluation.decisionId) {
      broker.approve({ decisionId: evaluation.decisionId, decision: 'allow', duration: 'once' });
    }
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });

  it('subagent kind is preserved in requests', async () => {
    const broker = createPermissionBroker();
    const request = makeRequest({ runtimeKind: 'subagent', kind: 'write' });
    const result = await broker.evaluate(request);
    expect(result.decision).toBe('prompt');
  });
});
