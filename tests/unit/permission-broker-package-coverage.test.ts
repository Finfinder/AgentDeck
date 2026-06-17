import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuditLog } from '../../packages/permission-broker/src/audit-log';
import { createPermissionBroker } from '../../packages/permission-broker/src/permission-broker';
import { createPermissionStore } from '../../packages/permission-broker/src/permission-store';
import { createPolicyEngine } from '../../packages/permission-broker/src/policy-engine';
import { classifyRequestRisk, classifyToolRisk, isGlobInsideScope, isScopeMatch } from '../../packages/permission-broker/src/risk-rules';
import {
  classifyRequestRisk as classifyRequestRiskFromIndex,
  classifyToolRisk as classifyToolRiskFromIndex,
  createAuditLog as createAuditLogFromIndex,
  createPermissionBroker as createPermissionBrokerFromIndex,
  createPermissionStore as createPermissionStoreFromIndex,
  createPolicyEngine as createPolicyEngineFromIndex,
  isGlobInsideScope as isGlobInsideScopeFromIndex
} from '../../packages/permission-broker/src/index';

import type { PermissionActionKind, PermissionDecisionKind, PermissionGrant, PermissionRequest, PermissionRiskLevel } from '../../packages/permission-broker/src/contracts';

let requestCounter = 0;

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  requestCounter += 1;
  return {
    id: `request-${requestCounter}`,
    sessionId: 'session-a',
    taskId: 'task-a',
    actorKind: 'agent',
    kind: 'read',
    target: '/workspace/readme.md',
    metadata: {},
    ...overrides
  };
}

function makeGrant(overrides: Partial<PermissionGrant> = {}): PermissionGrant {
  requestCounter += 1;
  return {
    id: `grant-${requestCounter}`,
    sessionId: 'session-a',
    actorKind: 'agent',
    action: 'read',
    scope: {},
    duration: 'once',
    requiresPrompt: false,
    grantedBy: 'user',
    createdAt: 1000,
    ...overrides
  };
}

function expectDecision(result: Awaited<ReturnType<ReturnType<typeof createPermissionBroker>['evaluate']>>, decision: 'allow' | 'deny' | 'prompt'): void {
  expect(result.decision).toBe(decision);
  expect(result.decisionId).toMatch(/^decision-/);
}

describe('permission-broker package coverage', () => {
  let randomUUIDSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    requestCounter = 0;
    randomUUIDSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
  });

  afterEach(() => {
    randomUUIDSpy.mockRestore();
  });

  it('re-exports runtime helpers from package index', () => {
    const request = makeRequest({ kind: 'read', target: '/workspace/readme.md' });

    expect(classifyToolRiskFromIndex('read_file', 'read')).toBe(classifyToolRisk('read_file', 'read'));
    expect(classifyRequestRiskFromIndex(request)).toBe(classifyRequestRisk(request));
    expect(isGlobInsideScopeFromIndex('/workspace/src/index.ts', '/workspace/src/*.ts')).toBe(isGlobInsideScope('/workspace/src/index.ts', '/workspace/src/*.ts'));
    expect(createAuditLogFromIndex).toBe(createAuditLog);
    expect(createPermissionStoreFromIndex).toBe(createPermissionStore);
    expect(createPolicyEngineFromIndex).toBe(createPolicyEngine);
    expect(createPermissionBrokerFromIndex).toBe(createPermissionBroker);
  });

  describe('audit-log', () => {
    it('stores entries immutably and returns immutable snapshots', () => {
      const audit = createAuditLog();
      const entry = makeRequest();
      const auditEntry = {
        id: 'audit-1',
        sessionId: entry.sessionId,
        taskId: entry.taskId,
        decisionId: 'decision-1',
        type: 'permission.decision' as const,
        actorKind: entry.actorKind,
        action: entry.kind,
        target: entry.target,
        risk: 'safe' as PermissionRiskLevel,
        decision: 'allow' as PermissionDecisionKind,
        reason: 'OK',
        createdAt: 1000,
        outcome: 'success' as const
      };

      audit.append(auditEntry);
      const snapshot = audit.snapshot();

      expect(snapshot).toHaveLength(1);
      expect(snapshot[0]).toEqual(auditEntry);

      expect(() => {
        (snapshot[0] as { reason: string }).reason = 'mutated';
      }).toThrow();

      expect(() => {
        (snapshot as unknown as PermissionRequest[]).push({} as PermissionRequest);
      }).toThrow();

      expect(audit.snapshot()).toHaveLength(1);
      expect(audit.snapshot()[0]?.reason).toBe('OK');
    });
  });

  describe('risk-rules', () => {
    it('classifies tool and action risk levels across all categories', () => {
      expect(classifyToolRisk('read_secret', 'read')).toBe('critical');
      expect(classifyToolRisk('read_file', 'secretsAccess')).toBe('critical');
      expect(classifyToolRisk('delete_file', 'read')).toBe('critical');
      expect(classifyToolRisk('read_file', 'delete')).toBe('critical');
      expect(classifyToolRisk('run_terminal', 'read')).toBe('high');
      expect(classifyToolRisk('read_file', 'terminal')).toBe('high');
      expect(classifyToolRisk('fetch_url', 'read')).toBe('high');
      expect(classifyToolRisk('read_file', 'network')).toBe('high');
      expect(classifyToolRisk('mcp_tool', 'read')).toBe('high');
      expect(classifyToolRisk('read_file', 'mcpTool')).toBe('high');
      expect(classifyToolRisk('create_file', 'read')).toBe('medium');
      expect(classifyToolRisk('read_file', 'write')).toBe('medium');
      expect(classifyToolRisk('read_file', 'workspaceEdit')).toBe('medium');
      expect(classifyToolRisk('read_file', 'read')).toBe('low');
      expect(classifyToolRisk('safe_tool', 'read')).toBe('low');
      expect(classifyToolRisk('safe_tool', 'unknown' as PermissionActionKind)).toBe('safe');
    });

    it('uses the highest risk between tool/action and target classification', () => {
      expect(classifyRequestRisk(makeRequest({ kind: 'read', toolName: undefined, target: '/workspace/readme.md' }))).toBe('low');
      expect(classifyRequestRisk(makeRequest({ kind: 'read', target: '/workspace/.env' }))).toBe('critical');
      expect(classifyRequestRisk(makeRequest({ kind: 'read', target: 'https://example.com/api' }))).toBe('high');
      expect(classifyRequestRisk(makeRequest({ kind: 'terminal', target: '/workspace/readme.md' }))).toBe('high');
      expect(classifyRequestRisk(makeRequest({ kind: 'read', target: 'C:/workspace/delete-me.txt' }))).toBe('critical');
    });

    it('matches exact, child and normalized glob scopes', () => {
      const request = makeRequest({ target: 'C:\\workspace\\src\\index.ts', metadata: {} });

      expect(isGlobInsideScope('/workspace/file.ts', '/workspace/file.ts')).toBe(true);
      expect(isGlobInsideScope('/workspace/src/index.ts', '/workspace')).toBe(true);
      expect(isGlobInsideScope('/workspace-other/index.ts', '/workspace')).toBe(false);
      expect(isGlobInsideScope(request.target, 'C:/workspace//src/*')).toBe(true);
      expect(isGlobInsideScope('/workspace/src/index.ts', '/workspace/src/*.ts')).toBe(true);
      expect(isGlobInsideScope('/workspace/src/nested/index.ts', '/workspace/src/*.ts')).toBe(false);
      expect(isGlobInsideScope('/workspace/src/nested/index.ts', '/workspace/src/**')).toBe(true);
      expect(isGlobInsideScope('/workspace/src/ab.ts', '/workspace/src/*?.ts')).toBe(true);
      expect(isGlobInsideScope('/workspace/src/file.ts', '/workspace/src/[file].ts')).toBe(false);
    });

    it('matches request scopes by tool, action, command, host, mcp server and workspace targets', () => {
      const baseRequest = makeRequest({
        kind: 'write',
        toolName: 'apply_patch',
        target: '/workspace/src/index.ts',
        metadata: {
          command: 'write',
          host: 'api.example.com',
          mcpServerId: 'mcp-a',
          targets: ['/workspace/src/index.ts']
        }
      });

      expect(isScopeMatch(baseRequest, {
        toolName: 'apply_patch',
        action: 'write',
        command: 'write',
        host: 'api.example.com',
        mcpServerId: 'mcp-a',
        workspaceGlob: '/workspace/src/*'
      })).toBe(true);

      expect(isScopeMatch(baseRequest, { toolName: 'read_file' })).toBe(false);
      expect(isScopeMatch(baseRequest, { action: 'read' })).toBe(false);
      expect(isScopeMatch(baseRequest, { command: 'delete' })).toBe(false);
      expect(isScopeMatch(baseRequest, { host: 'other.example.com' })).toBe(false);
      expect(isScopeMatch(baseRequest, { mcpServerId: 'other-mcp' })).toBe(false);
      expect(isScopeMatch(makeRequest({ metadata: { targets: [] } }), { workspaceGlob: '/workspace/*' })).toBe(false);
      expect(isScopeMatch(makeRequest({ metadata: { operations: [{ filePath: '/workspace/src/a.ts' }, { filePath: 123 }] } }), { workspaceGlob: '/workspace/src/*' })).toBe(true);
      expect(isScopeMatch(makeRequest({ metadata: {} }), {})).toBe(true);
    });
  });

  describe('permission-store', () => {
    it('stores frozen grants and finds the newest matching non-expired grant by session, predicate and scope', () => {
      let now = 1000;
      const store = createPermissionStore({ now: () => now });
      const oldGrant = makeGrant({ id: 'old', createdAt: 100, scope: { workspaceGlob: '/workspace/old/*' } });
      const newGrant = makeGrant({ id: 'new', action: 'write', createdAt: 200, scope: { action: 'write', workspaceGlob: '/workspace/src/*' } });
      const otherSessionGrant = makeGrant({ id: 'other-session', sessionId: 'session-b', action: 'write', createdAt: 300, scope: { action: 'write', workspaceGlob: '/workspace/src/*' } });
      const expiredGrant = makeGrant({ id: 'expired', action: 'write', createdAt: 400, expiresAt: 1000, scope: { action: 'write', workspaceGlob: '/workspace/src/*' } });

      store.add(oldGrant);
      store.add(newGrant);
      store.add(otherSessionGrant);
      store.add(expiredGrant);

      const request = makeRequest({ kind: 'write', target: '/workspace/src/index.ts', metadata: {} });

      expect(store.findMatching(request, grant => grant.action === 'write')).toMatchObject(newGrant);
      expect(store.snapshot()).toHaveLength(3);
      expect(store.snapshot().map(grant => grant.id)).toEqual(['old', 'new', 'other-session']);

      (newGrant as { scope: { action?: PermissionActionKind } }).scope.action = 'read';
      expect(store.snapshot().find(grant => grant.id === 'new')?.action).toBe('write');

      now = 1001;
      expect(store.findMatching(request, grant => grant.id === 'expired')).toBeUndefined();
      expect(store.snapshot()).toHaveLength(3);
    });
  });

  describe('policy-engine', () => {
    it('allows when a matching grant is supplied and distinguishes once from session grants', () => {
      const engine = createPolicyEngine({ now: () => 1000 });
      const onceGrant = makeGrant({ requiresPrompt: false });
      const sessionGrant = makeGrant({ id: 'session-grant', requiresPrompt: true, duration: 'session' });
      const request = makeRequest({ kind: 'write' });

      const onceResult = engine.evaluate(request, onceGrant);
      const sessionResult = engine.evaluate(request, sessionGrant);

      expect(onceResult).toMatchObject({
        decision: 'allow',
        risk: 'medium',
        grant: onceGrant
      });
      expect(onceResult.reason).toContain('jednorazowa');
      expect(sessionResult).toMatchObject({
        decision: 'allow',
        risk: 'medium',
        grant: sessionGrant
      });
      expect(sessionResult.reason).toContain('sesja');
    });

    it('denies blocked categories and subagent actions before prompting', () => {
      const engine = createPolicyEngine();

      expect(engine.evaluate(makeRequest({ kind: 'terminal', actorKind: 'mcp' })).decision).toBe('deny');
      expect(engine.evaluate(makeRequest({ kind: 'secretsAccess' })).decision).toBe('deny');
      expect(engine.evaluate(makeRequest({ kind: 'terminal', runtimeKind: 'subagent' })).decision).toBe('deny');
      expect(engine.evaluate(makeRequest({ kind: 'secretsAccess', runtimeKind: 'subagent' })).decision).toBe('deny');
    });

    it('auto-allows read operations only inside configured workspace roots', () => {
      const engine = createPolicyEngine({ workspaceRoots: ['/workspace', 'C:\\workspace'] });

      expect(engine.evaluate(makeRequest({ kind: 'read', target: '/workspace' })).decision).toBe('allow');
      expect(engine.evaluate(makeRequest({ kind: 'read', target: '/workspace/src/index.ts' })).decision).toBe('allow');
      expect(engine.evaluate(makeRequest({ kind: 'read', target: 'C:\\workspace\\src\\index.ts' })).decision).toBe('allow');
      expect(engine.evaluate(makeRequest({ kind: 'read', target: '/workspace-other/index.ts' })).decision).toBe('allow');
      expect(engine.evaluate(makeRequest({ kind: 'write', target: '/workspace/src/index.ts' })).decision).toBe('prompt');
    });

    it('prompts subagents for actions that require user approval', () => {
      const engine = createPolicyEngine();

      expect(engine.evaluate(makeRequest({ kind: 'delete', runtimeKind: 'subagent' })).decision).toBe('prompt');
      expect(engine.evaluate(makeRequest({ kind: 'network', runtimeKind: 'subagent' })).decision).toBe('prompt');
      expect(engine.evaluate(makeRequest({ kind: 'mcpTool', runtimeKind: 'subagent' })).decision).toBe('prompt');
      expect(engine.evaluate(makeRequest({ kind: 'workspaceEdit', runtimeKind: 'subagent' })).decision).toBe('prompt');
    });

    it('prompts mutating and high-risk operations, then allows low-risk deny-first operations', () => {
      const engine = createPolicyEngine();

      expect(engine.evaluate(makeRequest({ kind: 'write' })).decision).toBe('prompt');
      expect(engine.evaluate(makeRequest({ kind: 'delete' })).decision).toBe('prompt');
      expect(engine.evaluate(makeRequest({ kind: 'terminal' })).decision).toBe('prompt');
      expect(engine.evaluate(makeRequest({ kind: 'network' })).decision).toBe('prompt');
      expect(engine.evaluate(makeRequest({ kind: 'mcpTool' })).decision).toBe('prompt');
      expect(engine.evaluate(makeRequest({ kind: 'secretsAccess' })).decision).toBe('deny');
      expect(engine.evaluate(makeRequest({ kind: 'workspaceEdit' })).decision).toBe('prompt');
      expect(engine.evaluate(makeRequest({ kind: 'read', target: 'https://example.com/file.txt' })).decision).toBe('prompt');
      expect(engine.evaluate(makeRequest({ kind: 'read', target: '/workspace/readme.md' })).decision).toBe('allow');
    });

    it('creates frozen once and session grants with stable timestamps', () => {
      const engine = createPolicyEngine({ now: () => 1234 });
      const request = makeRequest({ kind: 'write' });
      const onceGrant = engine.createGrant(request, 'once', { action: 'write', workspaceGlob: '/workspace/*' });
      const sessionGrant = engine.createGrant(request, 'session');

      expect(onceGrant.id).toBe('grant-00000000-0000-4000-8000-000000000000');
      expect(onceGrant.sessionId).toBe('session-a');
      expect(onceGrant.taskId).toBe('task-a');
      expect(onceGrant.actorKind).toBe('agent');
      expect(onceGrant.action).toBe('write');
      expect(onceGrant.scope).toEqual({ action: 'write', workspaceGlob: '/workspace/*' });
      expect(onceGrant.duration).toBe('once');
      expect(onceGrant.requiresPrompt).toBe(false);
      expect(onceGrant.grantedBy).toBe('user');
      expect(onceGrant.createdAt).toBe(1234);
      expect(onceGrant.expiresAt).toBe(601234);
      expect(sessionGrant.requiresPrompt).toBe(true);
      expect(sessionGrant.expiresAt).toBeUndefined();

      expect(() => {
        (onceGrant as { duration: PermissionGrant['duration'] }).duration = 'session';
      }).toThrow();
      expect(() => {
        (onceGrant.scope as { action?: PermissionActionKind }).action = 'read';
      }).toThrow();
    });
  });

  describe('permission-broker', () => {
    it('creates request audit entries for prompted decisions and sanitizes prompt metadata', async () => {
      const onDecision = vi.fn();
      const broker = createPermissionBroker({ now: () => 1000, onDecision });
      const request = makeRequest({
        kind: 'write',
        toolName: 'apply_patch',
        target: '/workspace/src/index.ts',
        metadata: {
          token: 'secret-value',
          password: 'secret-value',
          note: 'contains api-key',
          safe: 'visible'
        }
      });

      const result = await broker.evaluate(request);

      expectDecision(result, 'prompt');
      expect(result.decisionId).toBeDefined();
      expect(broker.getState().prompts).toHaveLength(1);
      expect(onDecision).not.toHaveBeenCalled();
      expect(broker.getState().audit[0]).toMatchObject({
        type: 'permission.request',
        decision: 'prompt'
      });
      expect(broker.getState().prompts[0]?.metadata).toEqual({
        token: '[redacted]',
        password: '[redacted]',
        note: '[redacted]',
        safe: 'visible'
      });
    });

    it('creates blocked decision audit entries for denied decisions', async () => {
      const broker = createPermissionBroker({ now: () => 1000 });

      const result = await broker.evaluate(makeRequest({ kind: 'secretsAccess', target: '/workspace/secret.txt' }));

      expectDecision(result, 'deny');
      expect(broker.getState().prompts).toHaveLength(0);
      expect(broker.getState().decisions).toHaveLength(0);
      expect(broker.getState().audit[0]).toMatchObject({
        type: 'permission.decision',
        decision: 'deny',
        outcome: 'blocked'
      });
    });

    it('creates success decision audit entries for auto-allowed decisions', async () => {
      const broker = createPermissionBroker({ now: () => 1000, workspaceRoots: ['/workspace'] });

      const result = await broker.evaluate(makeRequest({ kind: 'read', target: '/workspace/readme.md' }));

      expectDecision(result, 'allow');
      expect(broker.getState().decisions).toHaveLength(0);
      expect(broker.getState().audit[0]).toMatchObject({
        type: 'permission.decision',
        decision: 'allow',
        outcome: 'success'
      });
    });

    it('returns an error when approving an unknown decision', () => {
      const broker = createPermissionBroker();

      expect(broker.approve({ decisionId: 'missing', decision: 'deny', duration: 'once' })).toEqual({
        status: 'error',
        code: 'DECISION_NOT_FOUND',
        message: 'Decision was not found.'
      });
    });

    it('records denied user approvals and notifies decision handlers', async () => {
      const handler = vi.fn();
      const unsubscribe = handler;
      const onDecision = vi.fn();
      const broker = createPermissionBroker({ now: () => 1000, onDecision });
      const removeHandler = broker.onDecision(handler);

      const prompt = await broker.evaluate(makeRequest({ kind: 'write', toolName: 'apply_patch', target: '/workspace/src/index.ts' }));
      expect(prompt.decisionId).toBeDefined();

      const result = broker.approve({ decisionId: prompt.decisionId!, decision: 'deny', duration: 'once' });

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.decision.decision).toBe('deny');
        expect(result.decision.reason).toBe('Denied by user.');
        expect(result.grant).toBeUndefined();
      }
      expect(broker.getState().prompts).toHaveLength(0);
      expect(broker.getState().decisions).toHaveLength(1);
      expect(broker.getState().audit).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'permission.decision', decision: 'deny', outcome: 'blocked' })
      ]));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(onDecision).toHaveBeenCalledTimes(1);

      removeHandler();
      unsubscribe();
      expect(removeHandler).toBeDefined();
    });

    it('stores one-time grants and reuses them for matching scoped requests', async () => {
      const broker = createPermissionBroker({ now: () => 1000 });

      const prompt = await broker.evaluate(makeRequest({ kind: 'write', toolName: 'apply_patch', target: '/workspace/src/index.ts' }));
      expect(prompt.decisionId).toBeDefined();

      const approval = broker.approve({
        decisionId: prompt.decisionId!,
        decision: 'allow',
        duration: 'once',
        scope: { action: 'write', workspaceGlob: '/workspace/src/*' }
      });

      expect(approval.status).toBe('ok');
      if (approval.status === 'ok') {
        expect(approval.grant).toMatchObject({
          id: 'grant-00000000-0000-4000-8000-000000000000',
          duration: 'once',
          requiresPrompt: false,
          expiresAt: 601000,
          scope: { action: 'write', workspaceGlob: '/workspace/src/*' }
        });
      }

      expect(broker.getState().grants).toHaveLength(1);
      expect(broker.getState().prompts).toHaveLength(0);
      expect(broker.getState().audit).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'permission.decision', decision: 'allow', outcome: 'success' })
      ]));

      const reused = await broker.evaluate(makeRequest({ id: 'request-reused', kind: 'write', toolName: 'apply_patch', target: '/workspace/src/app.ts' }));
      expectDecision(reused, 'allow');
    });

    it('stores session grants and reuses them for matching scoped requests', async () => {
      const broker = createPermissionBroker({ now: () => 1000 });

      const prompt = await broker.evaluate(makeRequest({ kind: 'network', toolName: 'fetch_url', target: 'https://example.com/file.txt' }));
      expect(prompt.decisionId).toBeDefined();

      const approval = broker.approve({
        decisionId: prompt.decisionId!,
        decision: 'allow',
        duration: 'session',
        scope: { action: 'network', host: 'example.com' }
      });

      expect(approval.status).toBe('ok');
      if (approval.status === 'ok') {
        expect(approval.grant).toMatchObject({
          duration: 'session',
          requiresPrompt: true,
          expiresAt: undefined,
          scope: { action: 'network', host: 'example.com' }
        });
      }

      const reused = await broker.evaluate(makeRequest({
        id: 'request-session-reused',
        kind: 'network',
        toolName: 'fetch_url',
        target: 'https://example.com/other.txt',
        metadata: { host: 'example.com' }
      }));
      expectDecision(reused, 'allow');
    });

    it('expires grants and forces a new prompt after the time window', async () => {
      let now = 1000;
      const broker = createPermissionBroker({ now: () => now });

      const prompt = await broker.evaluate(makeRequest({ kind: 'write', toolName: 'apply_patch', target: '/workspace/src/index.ts' }));
      expect(prompt.decisionId).toBeDefined();

      broker.approve({
        decisionId: prompt.decisionId!,
        decision: 'allow',
        duration: 'once',
        scope: { action: 'write', workspaceGlob: '/workspace/src/*' }
      });

      now = 601001;
      const expiredReuse = await broker.evaluate(makeRequest({ id: 'request-expired-reuse', kind: 'write', toolName: 'apply_patch', target: '/workspace/src/app.ts' }));
      expectDecision(expiredReuse, 'prompt');
    });

    it('records after-tool-call audit entries and returns immutable entries', async () => {
      const broker = createPermissionBroker({ now: () => 1000 });
      const request = makeRequest({ kind: 'read', target: '/workspace/readme.md' });
      const decision = {
        id: 'decision-after-tool',
        requestId: request.id,
        sessionId: request.sessionId,
        taskId: request.taskId,
        actorKind: request.actorKind,
        kind: request.kind,
        target: request.target,
        risk: 'low' as PermissionRiskLevel,
        decision: 'allow' as PermissionDecisionKind,
        reason: 'Allowed.',
        createdAt: 1000
      };

      const entry = broker.afterToolCall(request, decision, 'success', 42);

      expect(entry).toMatchObject({
        id: 'audit-1000-00000000-0000-4000-8000-000000000000',
        type: 'permission.after-tool',
        outcome: 'success',
        durationMs: 42
      });
      expect(broker.getState().audit[0]).toEqual(entry);
      expect(() => {
        (entry as { durationMs?: number }).durationMs = 99;
      }).toThrow();
    });

    it('returns a frozen state object and supports unsubscribing decision handlers', async () => {
      const firstHandler = vi.fn();
      const secondHandler = vi.fn();
      const broker = createPermissionBroker({ now: () => 1000 });
      const removeFirstHandler = broker.onDecision(firstHandler);
      broker.onDecision(secondHandler);

      const prompt = await broker.evaluate(makeRequest({ kind: 'write', toolName: 'apply_patch', target: '/workspace/src/index.ts' }));
      expect(prompt.decisionId).toBeDefined();
      broker.approve({ decisionId: prompt.decisionId!, decision: 'deny', duration: 'once' });
      removeFirstHandler();

      expect(() => {
        (broker.getState().decisions as unknown as { push: (value: unknown) => void }).push({});
      }).toThrow();
      expect(firstHandler).toHaveBeenCalledTimes(1);
      expect(secondHandler).toHaveBeenCalledTimes(1);
    });
  });
});
