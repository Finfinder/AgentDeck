export type PermissionActionKind =
  | 'read'
  | 'write'
  | 'delete'
  | 'terminal'
  | 'network'
  | 'mcpTool'
  | 'secretsAccess'
  | 'workspaceEdit';

export type PermissionRuntimeKind = 'parent' | 'subagent';

export type PermissionActorKind = 'agent' | 'extension' | 'mcp' | 'user';

export type PermissionDecisionKind = 'allow' | 'prompt' | 'deny';

export type PermissionRiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export type PermissionGrantDuration = 'once' | 'session';

export type PermissionGrantScope = Readonly<{
  toolName?: string | undefined;
  action?: PermissionActionKind | undefined;
  workspaceGlob?: string | undefined;
  host?: string | undefined;
  command?: string | undefined;
  mcpServerId?: string | undefined;
}>;

export type PermissionGrant = Readonly<{
  id: string;
  sessionId: string;
  taskId?: string | undefined;
  actorKind: PermissionActorKind;
  action: PermissionActionKind;
  scope: PermissionGrantScope;
  duration: PermissionGrantDuration;
  requiresPrompt: boolean;
  grantedBy: 'user';
  createdAt: number;
  runtimeKind?: PermissionRuntimeKind | undefined;
  expiresAt?: number | undefined;
}>;

export type PermissionAuditEntry = Readonly<{
  id: string;
  sessionId: string;
  taskId?: string | undefined;
  workerId?: string | undefined;
  decisionId: string;
  type: 'permission.request' | 'permission.decision' | 'permission.after-tool';
  actorKind: PermissionActorKind;
  action: PermissionActionKind;
  target: string;
  toolName?: string | undefined;
  runtimeKind?: PermissionRuntimeKind | undefined;
  risk: PermissionRiskLevel;
  decision: PermissionDecisionKind;
  reason: string;
  createdAt: number;
  outcome?: 'success' | 'error' | 'blocked' | undefined;
  durationMs?: number | undefined;
}>;

export type PermissionRequest = Readonly<{
  id: string;
  sessionId: string;
  taskId: string;
  workerId?: string | undefined;
  actorKind: PermissionActorKind;
  kind: PermissionActionKind;
  toolName?: string | undefined;
  target: string;
  metadata: Record<string, unknown>;
  workspaceRoots?: readonly string[] | undefined;
  runtimeKind?: PermissionRuntimeKind | undefined;
}>;

export type PermissionEvaluation = Readonly<{
  decision: PermissionDecisionKind;
  risk: PermissionRiskLevel;
  reason: string;
  grant?: PermissionGrant | undefined;
  decisionId?: string | undefined;
}>;

export type PermissionDecision = Readonly<{
  id: string;
  requestId: string;
  sessionId: string;
  taskId: string;
  workerId?: string | undefined;
  actorKind: PermissionActorKind;
  kind: PermissionActionKind;
  toolName?: string | undefined;
  target: string;
  runtimeKind?: PermissionRuntimeKind | undefined;
  risk: PermissionRiskLevel;
  decision: PermissionDecisionKind;
  reason: string;
  createdAt: number;
}>;

export type PermissionPrompt = Readonly<{
  decisionId: string;
  requestId: string;
  sessionId: string;
  taskId: string;
  workerId?: string | undefined;
  actorKind: PermissionActorKind;
  kind: PermissionActionKind;
  toolName?: string | undefined;
  target: string;
  runtimeKind?: PermissionRuntimeKind | undefined;
  risk: PermissionRiskLevel;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}>;

export type PermissionApprovalInput = Readonly<{
  decisionId: string;
  decision: 'allow' | 'deny';
  duration: PermissionGrantDuration;
  scope?: PermissionGrantScope | undefined;
}>;

export type PermissionApprovalResult = Readonly<{
  status: 'ok';
  decision: PermissionDecision;
  grant?: PermissionGrant | undefined;
} | {
  status: 'error';
  code: 'DECISION_NOT_FOUND' | 'INVALID_SCOPE' | 'UNKNOWN';
  message: string;
}>;

export type PermissionBrokerState = Readonly<{
  decisions: readonly PermissionDecision[];
  prompts: readonly PermissionPrompt[];
  grants: readonly PermissionGrant[];
  audit: readonly PermissionAuditEntry[];
}>;

export type PermissionBroker = {
  evaluate(request: PermissionRequest): Promise<PermissionEvaluation>;
  approve(input: PermissionApprovalInput): PermissionApprovalResult;
  afterToolCall(request: PermissionRequest, decision: PermissionDecision, outcome: 'success' | 'error' | 'blocked', durationMs: number): PermissionAuditEntry;
  getState(): PermissionBrokerState;
  onDecision(handler: (decision: PermissionDecision) => void): () => void;
};

export type PermissionToolInput = Readonly<{
  toolName: string;
  action: PermissionActionKind;
  target: string;
  sessionId: string;
  taskId: string;
  workerId?: string | undefined;
  actorKind: PermissionActorKind;
  metadata?: Record<string, unknown> | undefined;
  workspaceRoots?: readonly string[] | undefined;
  runtimeKind?: PermissionRuntimeKind | undefined;
}>;

export type PermissionToolResult<T> =
  | Readonly<{ status: 'allowed'; value: T; decision: PermissionDecision }>
  | Readonly<{ status: 'blocked'; reason: string; decision: PermissionDecision }>;

export type PermissionDecisionHandler = (decision: PermissionDecision) => void;

export type PermissionBrokerOptions = Readonly<{
  now?: () => number;
  workspaceRoots?: readonly string[];
  onDecision?: PermissionDecisionHandler;
}>;


