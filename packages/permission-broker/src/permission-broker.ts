import type {
  PermissionAuditEntry,
  PermissionBroker,
  PermissionBrokerOptions,
  PermissionDecision,
  PermissionPrompt,
  PermissionRequest,
  PermissionEvaluation
} from './contracts';
import { createAuditLog, type AuditLogStore } from './audit-log';
import { createPermissionStore, type PermissionStore } from './permission-store';
import { createPolicyEngine, type PolicyEngine } from './policy-engine';

type PendingPrompt = {
  prompt: PermissionPrompt;
  decision: PermissionDecision;
};

export function createPermissionBroker(options: PermissionBrokerOptions = {}): PermissionBroker {
  const now = options.now ?? (() => Date.now());
  const store: PermissionStore = createPermissionStore({ now });
  const policy: PolicyEngine = createPolicyEngine({
    now,
    ...(options.workspaceRoots === undefined ? {} : { workspaceRoots: options.workspaceRoots })
  });
  const audit: AuditLogStore = createAuditLog();
  const decisions = new Map<string, PermissionDecision>();
  const prompts = new Map<string, PendingPrompt>();
  const decisionHandlers = new Set<(decision: PermissionDecision) => void>();

  function notifyDecision(decision: PermissionDecision): void {
    decisionHandlers.forEach(handler => handler(decision));
    options.onDecision?.(decision);
  }

  function requestToPrompt(request: PermissionRequest, decision: PermissionDecision): PermissionPrompt {
    return {
      decisionId: decision.id,
      requestId: request.id,
      sessionId: request.sessionId,
      taskId: request.taskId,
      workerId: request.workerId,
      actorKind: request.actorKind,
      kind: request.kind,
      toolName: request.toolName,
      target: request.target,
      risk: decision.risk,
      reason: decision.reason,
      metadata: sanitizeMetadata(request.metadata),
      createdAt: now()
    };
  }

  function createDecision(request: PermissionRequest, evaluation: PermissionEvaluation): PermissionDecision {
    return {
      id: `decision-${now()}-${crypto.randomUUID()}`,
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
      createdAt: now()
    };
  }

  return {
    async evaluate(input: PermissionRequest) {
      const request = buildRequest(input);
      const matchingGrant = store.findMatching(request, grant => grant.action === request.kind);
      const evaluated = policy.evaluate(request, matchingGrant);
      if (evaluated.decision === 'prompt') {
        const decision = createDecision(request, evaluated);
        const prompt = requestToPrompt(request, decision);
        prompts.set(decision.id, { prompt, decision });
        audit.append({
          id: `audit-${now()}-${crypto.randomUUID()}`,
          sessionId: request.sessionId,
          taskId: request.taskId,
          workerId: request.workerId,
          decisionId: decision.id,
          type: 'permission.request',
          actorKind: request.actorKind,
          action: request.kind,
          target: request.target,
          toolName: request.toolName,
          runtimeKind: request.runtimeKind,
          risk: decision.risk,
          decision: decision.decision,
          reason: decision.reason,
          createdAt: now()
        });
        return { ...evaluated, decision: 'prompt', decisionId: decision.id };
      }

      if (evaluated.decision === 'deny') {
        const decision = createDecision(request, evaluated);
        audit.append({
          id: `audit-${now()}-${crypto.randomUUID()}`,
          sessionId: request.sessionId,
          taskId: request.taskId,
          workerId: request.workerId,
          decisionId: decision.id,
          type: 'permission.decision',
          actorKind: request.actorKind,
          action: request.kind,
          target: request.target,
          toolName: request.toolName,
          runtimeKind: request.runtimeKind,
          risk: decision.risk,
          decision: decision.decision,
          reason: decision.reason,
          createdAt: now(),
          outcome: 'blocked'
        });
        return { ...evaluated, decision: 'deny', decisionId: decision.id };
      }

      const decision = createDecision(request, evaluated);
      audit.append({
        id: `audit-${now()}-${crypto.randomUUID()}`,
        sessionId: request.sessionId,
        taskId: request.taskId,
        workerId: request.workerId,
        decisionId: decision.id,
        type: 'permission.decision',
        actorKind: request.actorKind,
        action: request.kind,
        target: request.target,
        toolName: request.toolName,
        runtimeKind: request.runtimeKind,
        risk: decision.risk,
        decision: decision.decision,
        reason: decision.reason,
        createdAt: now(),
        outcome: 'success'
      });
      return { ...evaluated, decision: 'allow', decisionId: decision.id };
    },
    approve(input) {
      const pending = prompts.get(input.decisionId);
      if (!pending) {
        return { status: 'error', code: 'DECISION_NOT_FOUND', message: 'Decision was not found.' };
      }

      const decision = pending.decision;
      const grant = input.decision === 'allow'
        ? policy.createGrant(
            {
              id: pending.prompt.requestId,
              sessionId: pending.prompt.sessionId,
              taskId: pending.prompt.taskId,
              workerId: pending.prompt.workerId,
              actorKind: pending.prompt.actorKind,
              kind: pending.prompt.kind,
              toolName: pending.prompt.toolName,
              target: pending.prompt.target,
              metadata: pending.prompt.metadata,
              workspaceRoots: undefined
            },
            input.duration,
            input.scope
          )
        : undefined;

      if (grant !== undefined) {
        store.add(grant);
      }

      prompts.delete(input.decisionId);
      const frozenDecision = Object.freeze({
        ...decision,
        decision: input.decision,
        reason: input.decision === 'allow' ? 'Approved by user.' : 'Denied by user.',
        createdAt: now()
      }) as PermissionDecision;
      decisions.set(frozenDecision.id, frozenDecision);
      notifyDecision(frozenDecision);
      audit.append({
        id: `audit-${now()}-${crypto.randomUUID()}`,
        sessionId: pending.prompt.sessionId,
        taskId: pending.prompt.taskId,
        workerId: pending.prompt.workerId,
        decisionId: frozenDecision.id,
        type: 'permission.decision',
        actorKind: pending.prompt.actorKind,
        action: pending.prompt.kind,
        target: pending.prompt.target,
        toolName: pending.prompt.toolName,
        risk: frozenDecision.risk,
        decision: frozenDecision.decision,
        reason: frozenDecision.reason,
        createdAt: now(),
        outcome: frozenDecision.decision === 'allow' ? 'success' : 'blocked'
      });

      return { status: 'ok', decision: frozenDecision, grant };
    },
    afterToolCall(request, decision, outcome, durationMs) {
      const entry: PermissionAuditEntry = {
        id: `audit-${now()}-${crypto.randomUUID()}`,
        sessionId: request.sessionId,
        taskId: request.taskId,
        workerId: request.workerId,
        decisionId: decision.id,
        type: 'permission.after-tool',
        actorKind: request.actorKind,
        action: request.kind,
        target: request.target,
        toolName: request.toolName,
        risk: decision.risk,
        decision: decision.decision,
        reason: decision.reason,
        createdAt: now(),
        outcome,
        durationMs
      };
      audit.append(entry);
      return Object.freeze({ ...entry }) as PermissionAuditEntry;
    },
    getState() {
      return {
        decisions: Object.freeze([...decisions.values()]),
        prompts: Object.freeze([...prompts.values()].map(item => item.prompt)),
        grants: store.snapshot(),
        audit: audit.snapshot()
      };
    },
    onDecision(handler) {
      decisionHandlers.add(handler);
      return () => {
        decisionHandlers.delete(handler);
      };
    }
  };
}

function buildRequest(input: PermissionRequest): PermissionRequest {
  return Object.freeze({
    ...input,
    metadata: Object.freeze({ ...input.metadata })
  }) as PermissionRequest;
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key.toLowerCase().includes('secret') || key.toLowerCase().includes('token') || key.toLowerCase().includes('password') || key.toLowerCase().includes('api-key')) {
      result[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string' && /(?:secret|token|password|api-key)/i.test(value)) {
      result[key] = '[redacted]';
      continue;
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
