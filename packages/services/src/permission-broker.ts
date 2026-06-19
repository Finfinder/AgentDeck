import { extname } from 'node:path';

import type {
  ApprovalDecision,
  SensitivePathCheckResult,
  ToolCallRequest,
  ToolCallResponse,
  ToolClassification,
  ToolName,
  ToolRiskLevel
} from '@agentdeck/shared';

import { BINARY_EXTS } from './workspace-service';

// ?? Tool classification registry ???????????????????????????????????????????

const TOOL_CLASSIFICATIONS: Record<ToolName, ToolClassification> = {
  readFile: {
    name: 'readFile',
    riskLevel: 'read-only',
    requiresApproval: false,
    description: 'Odczyt zawartości pliku z workspace.'
  },
  searchFiles: {
    name: 'searchFiles',
    riskLevel: 'read-only',
    requiresApproval: false,
    description: 'Wyszukiwanie tekstowe w plikach workspace.'
  },
  listDirectory: {
    name: 'listDirectory',
    riskLevel: 'read-only',
    requiresApproval: false,
    description: 'Listowanie zawartości katalogu.'
  },
  proposePatch: {
    name: 'proposePatch',
    riskLevel: 'low',
    requiresApproval: false,
    description: 'Propozycja zmiany pliku (podgląd diff).'
  },
  applyPatch: {
    name: 'applyPatch',
    riskLevel: 'medium',
    requiresApproval: true,
    description: 'Zastosowanie zmiany pliku na dysku.'
  },
  writeFile: {
    name: 'writeFile',
    riskLevel: 'high',
    requiresApproval: true,
    description: 'Nadpisanie zawartości pliku.'
  },
  deleteFile: {
    name: 'deleteFile',
    riskLevel: 'critical',
    requiresApproval: true,
    description: 'Usunięcie pliku z dysku.'
  },
  renameFile: {
    name: 'renameFile',
    riskLevel: 'high',
    requiresApproval: true,
    description: 'Zmiana nazwy lub ścieżki pliku.'
  },
  proposeMemoryChange: {
    name: 'proposeMemoryChange',
    riskLevel: 'read-only',
    requiresApproval: false,
    description: 'Utworzenie propozycji zmiany pliku pamięci (bez zapisu).'
  },
  applyMemoryChange: {
    name: 'applyMemoryChange',
    riskLevel: 'medium',
    requiresApproval: true,
    description: 'Zastosowanie propozycji zmiany pliku pamięci (z zapisem).'
  }
};

// ?? Sensitive path patterns (reuse from workspace-service) ???????????????

const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /\.env($|\.)/i,
  /\.(key|pem|crt|cer|p12|pfx|jks)$/i,
  /\/secrets?\//i,
  /\.storage_state\.json$/i,
  /credentials?(\.|$)/i,
  /\.(npmrc|yarnrc)$/i,
  /[/\\]\.ssh[/\\]/i,
  /keystore/i,
  /[/\\]\.aws[/\\]/i,
  /[/\\]\.azure[/\\]/i,
  /id_rsa/i,
  /id_ed25519/i,
  /[/\\]\.gnupg[/\\]/i,
  /[/\\]\.password-store[/\\]/i,
  /\.pfx$/i,
  /\.p12$/i
];

// ?? Approval queue ???????????????????????????????????????????????????????=

interface PendingApproval {
  request: ToolCallRequest;
  classification: ToolClassification;
  expiresAt: number;
  resolve: (decision: ApprovalDecision) => void;
  promise: Promise<ApprovalDecision>;
}

// ?? Permission Broker ?????????????????????????????????????????????????????

export interface PermissionBrokerOptions {
  /** Approval timeout in milliseconds. Default: 120000 (2 minutes) */
  approvalTimeoutMs?: number;
}

export class PermissionBroker {
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly allowRules = new Map<ToolName, boolean>();
  private readonly approvalTimeoutMs: number;

  constructor(options: PermissionBrokerOptions = {}) {
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? 120_000;
  }

  /** Return the static classification for a tool name. */
  classifyTool(toolName: ToolName): ToolClassification {
    return TOOL_CLASSIFICATIONS[toolName];
  }

  /** Return all tool classifications. */
  listClassifications(): readonly ToolClassification[] {
    return Object.values(TOOL_CLASSIFICATIONS);
  }

  /**
   * Check if a tool call requires approval.
   * Read-only tools never require approval.
   * Mutating tools require approval unless an allow rule is set.
   * Sensitive paths always require approval regardless of tool.
   * Binary file operations always require approval (escalated to critical).
   */
  requiresApproval(request: ToolCallRequest, sensitiveCheck?: SensitivePathCheckResult): boolean {
    const classification = TOOL_CLASSIFICATIONS[request.toolName];
    if (!classification) return true;

    // Read-only tools never require approval
    if (classification.riskLevel === 'read-only') return false;

    // Sensitive paths always require approval, regardless of allow rules
    if (sensitiveCheck?.isSensitive) return true;

    // Binary file operations always require approval
    if (this.isBinaryOperation(request)) return true;

    // Check explicit allow rule
    if (this.allowRules.get(request.toolName) === true) return false;

    return classification.requiresApproval;
  }

  /**
   * Check whether a tool call targets a binary file.
   * Binary operations are escalated to critical risk.
   */
  isBinaryOperation(request: ToolCallRequest): boolean {
    const filePath = this.extractFilePath(request);
    if (!filePath) return false;
    const ext = extname(filePath).toLowerCase();
    return BINARY_EXTS.has(ext);
  }

  /** Extract the primary file path from a tool call request's args. */
  extractFilePath(request: ToolCallRequest): string | undefined {
    const args = request.args;
    if (!args) return undefined;
    // Common arg names across tools
    const candidates = ['filePath', 'path', 'oldPath', 'sourcePath'];
    for (const key of candidates) {
      const val = args[key];
      if (typeof val === 'string' && val.length > 0) return val;
    }
    return undefined;
  }

  /**
   * Extract the effective risk level for a request, accounting for
   * binary file escalation.
   */
  getEffectiveRisk(request: ToolCallRequest, sensitiveCheck?: SensitivePathCheckResult): ToolRiskLevel {
    const classification = TOOL_CLASSIFICATIONS[request.toolName];
    if (!classification) return 'critical';
    if (this.isBinaryOperation(request)) return 'critical';
    if (sensitiveCheck?.isSensitive) return escalateRisk(classification.riskLevel, true);
    return classification.riskLevel;
  }

  /**
   * Set an allow rule for a tool. When allowed, the tool won't require
   * per-call approval (but sensitive paths still do).
   */
  setAllowRule(toolName: ToolName, allowed: boolean): void {
    this.allowRules.set(toolName, allowed);
  }

  /** Remove an allow rule. */
  removeAllowRule(toolName: ToolName): void {
    this.allowRules.delete(toolName);
  }

  /** Check whether an allow rule is set for a tool. */
  hasAllowRule(toolName: ToolName): boolean {
    return this.allowRules.get(toolName) === true;
  }

  /**
   * Process a tool call request through the deny-first permission check.
   * Returns either an immediate result or a pending-approval response.
   * When approval is required, the request is stored in the pending queue
   * and can be resolved via submitApproval or waitForApproval.
   */
  async processToolCall(
    request: ToolCallRequest,
    sensitiveCheck?: SensitivePathCheckResult
  ): Promise<ToolCallResponse> {
    const classification = TOOL_CLASSIFICATIONS[request.toolName];

    if (!classification) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'TOOL_NOT_FOUND',
        message: `Unknown tool: ${request.toolName}`
      };
    }

    if (!this.requiresApproval(request, sensitiveCheck)) {
      return {
        status: 'ok',
        callId: request.callId,
        result: { toolName: request.toolName, args: request.args }
      };
    }

    // Need approval - store in pending queue and return pending-approval response
    const expiresAt = Date.now() + this.approvalTimeoutMs;

    // Create the pending approval entry with a resolvable promise
    let resolveFn: (decision: ApprovalDecision) => void;
    const promise = new Promise<ApprovalDecision>(resolve => {
      resolveFn = resolve;
    });

    this.pendingApprovals.set(request.callId, {
      request,
      classification,
      expiresAt,
      resolve: resolveFn!,
      promise
    });

    return {
      status: 'pending-approval',
      callId: request.callId,
      classification,
      expiresAt
    };
  }

  /**
   * Submit an approval decision for a pending tool call.
   * Returns the original request if found and resolved, null if expired/unknown.
   */
  submitApproval(decision: ApprovalDecision): ToolCallRequest | null {
    const pending = this.pendingApprovals.get(decision.callId);
    if (!pending) return null;

    this.pendingApprovals.delete(decision.callId);
    pending.resolve(decision);
    return pending.request;
  }

  /**
   * Wait for an approval decision with timeout.
   * Returns both the decision and the original request, or null if timed out.
   *
   * Uses Promise.race between the approval promise and a timeout promise.
   * On timeout the pending entry is deleted and null is returned.
   * The timeout handle is always cleared to prevent stale deletions
   * when the approval resolves first.
   */
  async waitForApproval(callId: string): Promise<{ decision: ApprovalDecision; request: ToolCallRequest } | null> {
    const pending = this.pendingApprovals.get(callId);
    if (!pending) return null;

    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<null>(resolve => {
      timeoutHandle = setTimeout(() => {
        this.pendingApprovals.delete(callId);
        resolve(null);
      }, this.approvalTimeoutMs);
    });

    const decision = await Promise.race([pending.promise, timeoutPromise]);
    clearTimeout(timeoutHandle!);

    if (!decision) return null;
    return { decision, request: pending.request };
  }

  /** Get all pending approval call IDs. */
  getPendingCallIds(): readonly string[] {
    return Array.from(this.pendingApprovals.keys());
  }

  /** Clear all pending approvals. */
  clearPendingApprovals(): void {
    this.pendingApprovals.clear();
  }
}

// ?? Sensitive path check ??????????????????????????????????????????????????

export function checkSensitivePath(filePath: string): SensitivePathCheckResult {
  const normalized = filePath.replaceAll('\\', '/');
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        filePath,
        isSensitive: true,
        matchedPattern: pattern.source
      };
    }
  }
  return {
    filePath,
    isSensitive: false
  };
}

// ?? Risk level helpers ???????????????????????????????????????????????????=

export function escalateRisk(baseRisk: ToolRiskLevel, isSensitive: boolean): ToolRiskLevel {
  if (!isSensitive) return baseRisk;

  const escalation: Record<ToolRiskLevel, ToolRiskLevel> = {
    'read-only': 'low',
    'low': 'medium',
    'medium': 'high',
    'high': 'critical',
    'critical': 'critical'
  };
  return escalation[baseRisk];
}

export function isHighRisk(risk: ToolRiskLevel): boolean {
  return risk === 'high' || risk === 'critical';
}

/** Check whether a file path has a binary extension. */
export function isBinaryFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return BINARY_EXTS.has(ext);
}
