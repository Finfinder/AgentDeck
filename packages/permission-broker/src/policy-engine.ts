import type { PermissionEvaluation, PermissionGrant, PermissionRequest } from './contracts';
import { classifyRequestRisk } from './risk-rules';

export type PolicyEngine = {
  evaluate(request: PermissionRequest, grant?: PermissionGrant): PermissionEvaluation;
  createGrant(request: PermissionRequest, duration: PermissionGrant['duration'], scope?: PermissionGrant['scope']): PermissionGrant;
};

export type PolicyEngineOptions = {
  now?: () => number;
  workspaceRoots?: readonly string[];
};

const MUTATING_ACTIONS = new Set(['write', 'delete', 'terminal', 'network', 'mcpTool', 'secretsAccess', 'workspaceEdit']);
const SUBAGENT_BLOCKED_ACTIONS = new Set(['terminal', 'secretsAccess']);
const SUBAGENT_PROMPT_ACTIONS = new Set(['delete', 'network', 'mcpTool', 'workspaceEdit']);

export function createPolicyEngine(options: PolicyEngineOptions = {}): PolicyEngine {
  const now = options.now ?? (() => Date.now());

  return {
    evaluate(request, grant) {
      const risk = classifyRequestRisk(request);
      if (grant !== undefined) {
        return {
          decision: 'allow',
          risk,
          reason: grant.requiresPrompt ? 'Zatwierdzona przez użytkownika sesja z limitem ryzyka.' : 'Zatwierdzona przez użytkownika jednorazowa zgoda.',
          grant
        };
      }

      if (isDeniedByKind(request)) {
        return {
          decision: 'deny',
          risk,
          reason: `Kategoria ${request.kind} jest domyślnie zablokowana w bieżącym kontekście.`
        };
      }

      if (isSubagentDenied(request)) {
        return {
          decision: 'deny',
          risk,
          reason: `Akcja ${request.kind} jest zablokowana dla subagentów.`
        };
      }

      if (isAutoAllowed(request, options.workspaceRoots ?? [])) {
        return {
          decision: 'allow',
          risk,
          reason: 'Operacja odczytu mieści się w zaufanym workspace.'
        };
      }

      if (isSubagentPrompt(request)) {
        return {
          decision: 'prompt',
          risk,
          reason: `Akcja ${request.kind} wymaga zatwierdzenia użytkownika dla subagentów.`
        };
      }

      if (MUTATING_ACTIONS.has(request.kind)) {
        return {
          decision: 'prompt',
          risk,
          reason: 'Operacja zmieniająca stan wymaga jawnej decyzji użytkownika.'
        };
      }

      if (risk === 'critical' || risk === 'high') {
        return {
          decision: 'prompt',
          risk,
          reason: 'Operacja o podwyższonym ryzyku wymaga jawnej decyzji użytkownika.'
        };
      }

      return {
        decision: 'allow',
        risk,
        reason: 'Operacja o niskim ryzyku mieści się w polityce deny-first.'
      };
    },
    createGrant(request, duration, scope) {
      const createdAt = now();
      const grant: PermissionGrant = {
        id: `grant-${crypto.randomUUID()}`,
        sessionId: request.sessionId,
        taskId: request.taskId,
        actorKind: request.actorKind,
        action: request.kind,
        scope: scope ?? {},
        duration,
        requiresPrompt: duration === 'session',
        grantedBy: 'user',
        createdAt,
        expiresAt: duration === 'once' ? createdAt + 10 * 60 * 1000 : undefined
      };
      return Object.freeze({ ...grant, scope: Object.freeze({ ...grant.scope }) }) as PermissionGrant;
    }
  };
}

function isDeniedByKind(request: PermissionRequest): boolean {
  if (request.kind === 'terminal' && request.actorKind === 'mcp') return true;
  if (request.kind === 'secretsAccess') return true;
  return false;
}

function isSubagentDenied(request: PermissionRequest): boolean {
  if (request.runtimeKind !== 'subagent') return false;
  return SUBAGENT_BLOCKED_ACTIONS.has(request.kind);
}

function isSubagentPrompt(request: PermissionRequest): boolean {
  if (request.runtimeKind !== 'subagent') return false;
  return SUBAGENT_PROMPT_ACTIONS.has(request.kind);
}

function isAutoAllowed(request: PermissionRequest, workspaceRoots: readonly string[]): boolean {
  if (request.kind !== 'read') return false;
  if (workspaceRoots.length === 0) return false;
  return workspaceRoots.some(root => request.target === root || request.target.startsWith(`${root}/`) || request.target.startsWith(`${root}\\`));
}
