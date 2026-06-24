import { readFile } from 'node:fs/promises';
import {
  isMemoryScope,
  type Conflict,
  type MemoryChangeProposal,
  type MemoryConflict,
  type MemoryEdit,
  type MemoryScope,
  type PatchSet,
  type ToolCallRequest,
  type ToolCallResponse
} from '@agentdeck/shared';
import { checkSensitivePath, isBinaryFile, type PermissionBroker } from './permission-broker';
import {
  applyPatchWithConflictCheck,
  type ConflictBroker,
  classifyOperationKind,
  classifyPatchRisk,
  generatePatchId
} from './conflict-broker';
import { readEditorFile, writeEditorFile } from './editor-service';
import type { EventLogService } from './event-log-service';
import { searchFilesStandalone as workspaceSearch } from './workspace-service';
import type { MemoryService } from '@agentdeck/memory-service';

// ?? Code mapping & type adapters ???????????????????????????????????????????

/**
 * Jawne mapowanie kodów MemoryApplyResult na ToolCallResponse.
 * Gdy MemoryApplyResult dostanie nowy kod, kompilator wymusi aktualizację mapy.
 */
type MemoryErrorCode = 'CONFLICT' | 'FILE_NOT_FOUND' | 'ACCESS_DENIED' | 'UNKNOWN';
type ResponseErrorCode = 'TOOL_NOT_FOUND' | 'ACCESS_DENIED' | 'TIMEOUT' | 'WRITE_CONFLICT' | 'INVALID_ARGUMENT' | 'UNKNOWN';

/**
 * Jawne mapowanie kodów MemoryApplyResult na ToolCallResponse.
 * Gdy MemoryApplyResult dostanie nowy kod, kompilator wymusi aktualizację mapy.
 */
const MEMORY_CODE_TO_RESPONSE_CODE: Record<MemoryErrorCode, ResponseErrorCode> = {
  'CONFLICT': 'WRITE_CONFLICT',
  'FILE_NOT_FOUND': 'TOOL_NOT_FOUND',
  'ACCESS_DENIED': 'ACCESS_DENIED',
  'UNKNOWN': 'UNKNOWN'
};

/**
 * Adapter: MemoryConflict → Conflict.
 * Oba typy mają różne pola (proposalId vs patchId, MemoryConflictKind vs ConflictKind),
 * więc potrzebne jest jawne mapowanie zamiast niebezpiecznego casta.
 */
function adaptMemoryConflictToConflict(mc: MemoryConflict): Conflict {
  return {
    id: mc.id,
    kind: 'high-risk',
    patchId: mc.proposalId,
    filePath: mc.filePath,
    description: mc.description,
    riskLevel: mc.riskLevel,
    createdAt: mc.createdAt
  };
}

// ?? Tool execution context ?????????????????????????????????????????????????

export interface ToolRouterOptions {
  workspaceRoots: readonly string[];
  permissionBroker: PermissionBroker;
  conflictBroker: ConflictBroker;
  eventLogService?: EventLogService;
  memoryService?: MemoryService;
}

// ?? Tool Router ???????????????????????????????????????????????????????????=

export class ToolRouter {
  private readonly workspaceRoots: readonly string[];
  private readonly permissionBroker: PermissionBroker;
  private readonly conflictBroker: ConflictBroker;
  private readonly eventLogService: EventLogService | null;
  private readonly memoryService: MemoryService | null;

  constructor(options: ToolRouterOptions) {
    this.workspaceRoots = options.workspaceRoots;
    this.permissionBroker = options.permissionBroker;
    this.conflictBroker = options.conflictBroker;
    this.eventLogService = options.eventLogService ?? null;
    this.memoryService = options.memoryService ?? null;
  }

  /**
   * Log a patch-related event with diff to the event log.
   */
  private logPatchEvent(params: {
    level: 'info' | 'warn' | 'error';
    message: string;
    diff: string;
    filePath: string;
    patchId: string;
  }): void {
    if (!this.eventLogService) return;
    try {
      this.eventLogService.appendPatchEvent({
        level: params.level,
        source: 'tool-router',
        message: params.message,
        diff: params.diff,
        filePath: params.filePath,
        patchId: params.patchId
      });
    } catch {
      // Event log failure should not break tool execution
    }
  }

  /**
   * Execute a tool call request through the permission broker.
   * Returns a response indicating success, pending approval, or error.
   */
  async execute(request: ToolCallRequest): Promise<ToolCallResponse> {
    // Check sensitive paths for file-operating tools.
    // For applyPatch, the file path is nested inside args.patch.filePath,
    // so extractFilePath now handles that case.
    const filePath = this.extractFilePath(request);
    const sensitiveCheck = filePath ? checkSensitivePath(filePath) : undefined;

    // Process through permission broker
    const permissionResult = await this.permissionBroker.processToolCall(request, sensitiveCheck);

    if (permissionResult.status === 'pending-approval') {
      return permissionResult;
    }

    if (permissionResult.status === 'error') {
      return permissionResult;
    }

    // Execute the tool
    return this.runTool(request, sensitiveCheck);
  }

  /**
   * Execute a tool that has been approved (bypass permission check).
   */
  async executeApproved(request: ToolCallRequest): Promise<ToolCallResponse> {
    const filePath = this.extractFilePath(request);
    return this.runTool(request, filePath ? checkSensitivePath(filePath) : undefined);
  }

  // ?? Tool implementations ???????????????????????????????????????????????=

  private async runTool(
    request: ToolCallRequest,
    sensitiveCheck?: { filePath: string; isSensitive: boolean; matchedPattern?: string }
  ): Promise<ToolCallResponse> {
    try {
      switch (request.toolName) {
        case 'readFile':
          return await this.toolReadFile(request);
        case 'searchFiles':
          return await this.toolSearchFiles(request);
        case 'listDirectory':
          return await this.toolListDirectory(request);
        case 'proposeMemoryChange':
          return await this.toolProposeMemoryChange(request);
        case 'applyMemoryChange':
          return await this.toolApplyMemoryChange(request);
        case 'proposePatch':
          return await this.toolProposePatch(request);
        case 'applyPatch':
          return await this.toolApplyPatch(request, sensitiveCheck);
        case 'writeFile':
          return await this.toolWriteFile(request, sensitiveCheck);
        case 'deleteFile':
          return await this.toolDeleteFile(request, sensitiveCheck);
        case 'renameFile':
          return await this.toolRenameFile(request);
        default:
          return {
            status: 'error',
            callId: request.callId,
            code: 'TOOL_NOT_FOUND',
            message: `Unknown tool: ${request.toolName}`
          };
      }
    } catch (error) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'UNKNOWN' as const,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async toolReadFile(request: ToolCallRequest): Promise<ToolCallResponse> {
    const filePath = this.getStringArg(request, 'filePath');
    if (!filePath) {
      return this.missingArg(request, 'filePath');
    }

    // Size limit: 1MB
    const MAX_SIZE = 1_048_576;

    const result = await readEditorFile(filePath);
    if (result.status === 'error') {
      return {
        status: 'error',
        callId: request.callId,
        code: 'UNKNOWN' as const,
        message: result.message
      };
    }

    if (result.content.length > MAX_SIZE) {
      return {
        status: 'ok',
        callId: request.callId,
        result: {
          content: result.content.slice(0, MAX_SIZE),
          truncated: true,
          totalSize: result.content.length
        }
      };
    }

    return {
      status: 'ok',
      callId: request.callId,
      result: { content: result.content, truncated: false }
    };
  }

  private async toolSearchFiles(request: ToolCallRequest): Promise<ToolCallResponse> {
    const pattern = this.getStringArg(request, 'pattern');
    if (!pattern) {
      return this.missingArg(request, 'pattern');
    }

    const include = this.getStringArg(request, 'include');
    const exclude = this.getStringArg(request, 'exclude');

    const results = await workspaceSearch({
      pattern,
      include: include || undefined,
      exclude: exclude || undefined,
      workspaceRoots: this.workspaceRoots
    });

    return {
      status: 'ok',
      callId: request.callId,
      result: { results }
    };
  }

  private async toolListDirectory(request: ToolCallRequest): Promise<ToolCallResponse> {
    const dirPath = this.getStringArg(request, 'path');
    if (!dirPath) {
      return this.missingArg(request, 'path');
    }

    const { listDirectoryStandalone } = await import('./workspace-service');
    const result = await listDirectoryStandalone(dirPath);

    return {
      status: 'ok',
      callId: request.callId,
      result: { entries: result.entries }
    };
  }

  private async toolProposePatch(request: ToolCallRequest): Promise<ToolCallResponse> {
    const filePath = this.getStringArg(request, 'filePath');
    if (!filePath) {
      return this.missingArg(request, 'filePath');
    }

    const operations = request.args['operations'];
    if (!Array.isArray(operations) || operations.length === 0) {
      return this.missingArg(request, 'operations');
    }

    // Read current file to compute base hash
    const { createHash } = await import('node:crypto');
    let baseHash: string;
    try {
      const content = await readFile(filePath, 'utf8');
      baseHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    } catch {
      return {
        status: 'error',
        callId: request.callId,
        code: 'UNKNOWN' as const,
        message: `Cannot read file for patch base: ${filePath}`
      };
    }

    const riskLevel = classifyPatchRisk(operations);

    const patch: PatchSet = {
      id: generatePatchId(),
      filePath,
      baseHash,
      operations,
      author: 'agent',
      riskLevel,
      createdAt: Date.now()
    };

    // Generate diff preview
    const { showDiff } = await import('./editor-service');
    let diffResult: Awaited<ReturnType<typeof showDiff>>;
    try {
      const currentContent = await readFile(filePath, 'utf8');
      // Apply patch to get modified content for diff
      let modifiedContent = currentContent;
      for (const op of operations) {
        if (op.range) {
          const lines = modifiedContent.split('\n');
          const beforeLines = lines.slice(0, op.range.startLine - 1);
          const afterLines = lines.slice(op.range.endLine);
          const firstLine = lines[op.range.startLine - 1] ?? '';
          const beforePart = firstLine.slice(0, op.range.startCol - 1);
          const lastLine = lines[op.range.endLine - 1] ?? '';
          const afterPart = lastLine.slice(op.range.endCol - 1);
          modifiedContent = [
            ...beforeLines,
            beforePart + op.text + afterPart,
            ...afterLines
          ].join('\n');
        } else {
          modifiedContent = op.text;
        }
      }
      diffResult = showDiff(currentContent, modifiedContent);
    } catch {
      diffResult = { status: 'error', code: 'UNKNOWN' as const, message: 'Failed to generate diff' };
    }

    // Log patch event with diff to event log
    if (diffResult.status === 'ok') {
      this.logPatchEvent({
        level: 'info',
        message: `Patch ${patch.id} zaproponowany dla ${filePath}`,
        diff: diffResult.diff,
        filePath,
        patchId: patch.id
      });
    }

    return {
      status: 'ok',
      callId: request.callId,
      result: { patch, diff: diffResult }
    };
  }

  private async toolApplyPatch(
    request: ToolCallRequest,
    sensitiveCheck?: { filePath: string; isSensitive: boolean; matchedPattern?: string }
  ): Promise<ToolCallResponse> {
    const patchId = this.getStringArg(request, 'patchId');
    if (!patchId) {
      return this.missingArg(request, 'patchId');
    }

    // The patch data should be in the request args
    const patchData = request.args['patch'] as Record<string, unknown> | undefined;
    if (!patchData) {
      return this.missingArg(request, 'patch');
    }

    // Defensive deep validation of patch data from untrusted source (model gateway).
    // isToolCallRequest validates top-level shape but not nested args structure.
    if (typeof patchData.filePath !== 'string' || patchData.filePath.length === 0) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'UNKNOWN' as const,
        message: 'Invalid patch data: filePath must be a non-empty string.'
      };
    }
    if (!Array.isArray(patchData.operations)) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'UNKNOWN' as const,
        message: 'Invalid patch data: operations must be an array.'
      };
    }

    const patch: PatchSet = {
      id: patchId,
      filePath: patchData.filePath,
      baseHash: String(patchData.baseHash),
      operations: patchData.operations as PatchSet['operations'],
      author: String(patchData.author ?? 'agent'),
      riskLevel: patchData.riskLevel as PatchSet['riskLevel'],
      createdAt: Number(patchData.createdAt ?? Date.now())
    };

    // Defense-in-depth: extract file path from nested patch data and check sensitive paths.
    // Note: extractFilePath() also handles args.patch.filePath, but we validate here
    // explicitly before any write operation for clarity and defense-in-depth.
    const patchSensitiveCheck = checkSensitivePath(patch.filePath);
    if (patchSensitiveCheck.isSensitive) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'ACCESS_DENIED',
        message: `Zastosowanie patcha na wrażliwej ścieżce zabronione: ${patch.filePath}`
      };
    }

    // Extra approval for sensitive files (from top-level check, e.g. rename oldPath)
    if (sensitiveCheck?.isSensitive) {
      return {
        status: 'pending-approval',
        callId: request.callId,
        classification: {
          name: 'applyPatch',
          riskLevel: 'critical',
          requiresApproval: true,
          description: `Zastosowanie patcha na wrażliwej ścieżce: ${patch.filePath} (matched: ${sensitiveCheck.matchedPattern})`
        },
        expiresAt: Date.now() + 120_000
      };
    }

    const result = await applyPatchWithConflictCheck(patch, this.conflictBroker);

    if (!result.success && result.conflict) {
      // Log conflict event
      this.logPatchEvent({
        level: 'warn',
        message: `Konflikt patcha ${patch.id}: ${result.conflict.description}`,
        diff: '',
        filePath: patch.filePath,
        patchId: patch.id
      });

      return {
        status: 'error',
        callId: request.callId,
        code: 'WRITE_CONFLICT',
        message: result.conflict.description,
        conflict: result.conflict
      };
    }

    if (!result.success) {
      // Log error event
      this.logPatchEvent({
        level: 'error',
        message: `Błąd aplikacji patcha ${patch.id}: ${result.error ?? 'unknown'}`,
        diff: '',
        filePath: patch.filePath,
        patchId: patch.id
      });

      return {
        status: 'error',
        callId: request.callId,
        code: 'UNKNOWN' as const,
        message: result.error ?? 'Failed to apply patch'
      };
    }

    // Log successful patch application
    this.logPatchEvent({
      level: 'info',
      message: `Patch ${patch.id} zastosowany${result.autoMerged ? ' (auto-merge)' : ''} dla ${patch.filePath}`,
      diff: '',
      filePath: patch.filePath,
      patchId: patch.id
    });

    return {
      status: 'ok',
      callId: request.callId,
      result: { patchId, appliedHash: result.appliedHash }
    };
  }

  private async toolWriteFile(
    request: ToolCallRequest,
    sensitiveCheck?: { filePath: string; isSensitive: boolean; matchedPattern?: string }
  ): Promise<ToolCallResponse> {
    const filePath = this.getStringArg(request, 'filePath');
    const content = this.getStringArg(request, 'content');

    if (!filePath) return this.missingArg(request, 'filePath');
    if (content === undefined) return this.missingArg(request, 'content');

    // Extra protection for sensitive files
    if (sensitiveCheck?.isSensitive) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'ACCESS_DENIED',
        message: `Zapis na wrażliwej ścieżce zabroniony: ${filePath}`
      };
    }

    const result = await writeEditorFile(filePath, content);
    if (result.status === 'error') {
      return {
        status: 'error',
        callId: request.callId,
        code: result.code as 'UNKNOWN' | 'ACCESS_DENIED' | 'WRITE_CONFLICT' | 'TOOL_NOT_FOUND' | 'TIMEOUT',
        message: result.message
      };
    }

    return {
      status: 'ok',
      callId: request.callId,
      result: { filePath, bytesWritten: content.length }
    };
  }

  private async toolDeleteFile(
    request: ToolCallRequest,
    sensitiveCheck?: { filePath: string; isSensitive: boolean; matchedPattern?: string }
  ): Promise<ToolCallResponse> {
    const filePath = this.getStringArg(request, 'filePath');
    if (!filePath) return this.missingArg(request, 'filePath');

    // Extra protection for sensitive files
    if (sensitiveCheck?.isSensitive) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'ACCESS_DENIED',
        message: `Usuwanie wrażliwego pliku zabronione: ${filePath}`
      };
    }

    // Log binary file deletion with classifyOperationKind
    if (isBinaryFile(filePath)) {
      this.logPatchEvent({
        level: 'warn',
        message: `Usunięcie pliku binarnego: ${filePath}`,
        diff: '',
        filePath,
        patchId: request.callId
      });
      const kind = classifyOperationKind('binary');
      this.logPatchEvent({
        level: 'info',
        message: `Klasyfikacja operacji: ${kind} dla ${filePath}`,
        diff: '',
        filePath,
        patchId: request.callId
      });
    }

    const { deleteFileStandalone } = await import('./workspace-service');
    const result = await deleteFileStandalone(filePath);

    if (result.status === 'error') {
      return {
        status: 'error',
        callId: request.callId,
        code: result.code === 'ACCESS_DENIED' ? 'ACCESS_DENIED' : 'UNKNOWN',
        message: result.message
      };
    }

    return {
      status: 'ok',
      callId: request.callId,
      result: { filePath, deleted: true }
    };
  }

  private async toolRenameFile(
    request: ToolCallRequest
  ): Promise<ToolCallResponse> {
    const oldPath = this.getStringArg(request, 'oldPath');
    const newPath = this.getStringArg(request, 'newPath');

    if (!oldPath) return this.missingArg(request, 'oldPath');
    if (!newPath) return this.missingArg(request, 'newPath');

    // Check both paths for sensitivity
    const oldSensitive = checkSensitivePath(oldPath);
    if (oldSensitive.isSensitive) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'ACCESS_DENIED',
        message: `Zmiana nazwy wrażliwego pliku zabroniona: ${oldPath} (matched: ${oldSensitive.matchedPattern})`
      };
    }
    const newSensitive = checkSensitivePath(newPath);
    if (newSensitive.isSensitive) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'ACCESS_DENIED',
        message: `Nadanie wrażliwej nazwy plikowi zabronione: ${newPath} (matched: ${newSensitive.matchedPattern})`
      };
    }

    // Log binary file rename with classifyOperationKind
    if (isBinaryFile(oldPath) || isBinaryFile(newPath)) {
      this.logPatchEvent({
        level: 'warn',
        message: `Zmiana nazwy pliku binarnego: ${oldPath} → ${newPath}`,
        diff: '',
        filePath: oldPath,
        patchId: request.callId
      });
      const kind = classifyOperationKind('binary');
      this.logPatchEvent({
        level: 'info',
        message: `Klasyfikacja operacji: ${kind} dla ${oldPath}`,
        diff: '',
        filePath: oldPath,
        patchId: request.callId
      });
    }

    const { renameFileStandalone } = await import('./workspace-service');
    const result = await renameFileStandalone(oldPath, newPath);

    if (result.status === 'error') {
      return {
        status: 'error',
        callId: request.callId,
        code: result.code === 'ACCESS_DENIED' ? 'ACCESS_DENIED' : 'UNKNOWN',
        message: result.message
      };
    }

    return {
      status: 'ok',
      callId: request.callId,
      result: { oldPath, newPath }
    };
  }

  // ?? Helpers ???????????????????????????????????????????????????????????=

  private extractFilePath(request: ToolCallRequest): string | undefined {
    const args = request.args;
    const candidates = ['filePath', 'path', 'oldPath'];
    for (const key of candidates) {
      const val = args[key];
      if (typeof val === 'string') return val;
    }
    // For applyPatch, the file path is nested inside args.patch.filePath
    const patchData = args['patch'] as Record<string, unknown> | undefined;
    if (patchData && typeof patchData.filePath === 'string') {
      return patchData.filePath;
    }
    return undefined;
  }


  private async toolProposeMemoryChange(request: ToolCallRequest): Promise<ToolCallResponse> {
    if (!this.memoryService) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'UNKNOWN' as const,
        message: 'Memory service nie jest skonfigurowany.'
      };
    }

    const rawScope = request.args['scope'];
    if (rawScope !== undefined && !isMemoryScope(rawScope)) {
      return this.invalidArg(request, 'scope');
    }
    const scope = rawScope as MemoryScope | undefined;
    const filePath = this.getStringArg(request, 'filePath');
    const text = this.getStringArg(request, 'text');

    if (!filePath) return this.missingArg(request, 'filePath');
    if (text === undefined) return this.missingArg(request, 'text');
    if (scope === undefined) return this.missingArg(request, 'scope');

    const edit: MemoryEdit = { scope, filePath, text };
    const result = await this.memoryService.proposeEdit(edit);

    if (result.status === 'error') {
      return {
        status: 'error',
        callId: request.callId,
        code: 'UNKNOWN' as const,
        message: result.message
      };
    }

    if (this.eventLogService && result.proposal.diff) {
      this.eventLogService.appendPatchEvent({
        level: 'info',
        source: 'memory-service',
        message: 'Propozycja zmiany pamięci: ' + filePath,
        diff: result.proposal.diff,
        filePath,
        patchId: result.proposal.patch.id
      });
    }

    return {
      status: 'ok',
      callId: request.callId,
      result: { proposal: result.proposal }
    };
  }

  private async toolApplyMemoryChange(
    request: ToolCallRequest
  ): Promise<ToolCallResponse> {
    if (!this.memoryService) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'UNKNOWN' as const,
        message: 'Memory service nie jest skonfigurowany.'
      };
    }

    const proposalData = request.args['proposal'] as Record<string, unknown> | undefined;
    if (!proposalData) {
      return this.missingArg(request, 'proposal');
    }

    if (typeof proposalData.filePath !== 'string' || proposalData.filePath.length === 0) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'UNKNOWN' as const,
        message: 'Invalid proposal data: filePath must be a non-empty string.'
      };
    }

    const proposal: MemoryChangeProposal = {
      scope: proposalData.scope as MemoryChangeProposal['scope'],
      filePath: proposalData.filePath,
      patch: proposalData.patch as PatchSet,
      diff: proposalData.diff as string | undefined
    };

    const memSensitiveCheck = checkSensitivePath(proposal.filePath);
    if (memSensitiveCheck.isSensitive) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'ACCESS_DENIED',
        message: 'Zapis pamięci na wrażliwej ścieżce zabroniony: ' + proposal.filePath,
      };
    }

    const result = await this.memoryService.applyEdit(proposal);

    if (result.status === 'error') {
      if (result.conflict && this.eventLogService) {
        this.eventLogService.appendPatchEvent({
          level: 'warn',
          source: 'memory-service',
          message: 'Konflikt pamięci ' + result.conflict.id + ': ' + result.conflict.description,
          diff: '',
          filePath: proposal.filePath,
          patchId: proposal.patch.id
        });
      }

      const errorResponse: {
        status: 'error';
        callId: string;
        code: ResponseErrorCode;
        message: string;
        conflict?: Conflict;
      } = {
        status: 'error',
        callId: request.callId,
        code: MEMORY_CODE_TO_RESPONSE_CODE[result.code],
        message: result.message
      };
      if (result.conflict) {
        errorResponse.conflict = adaptMemoryConflictToConflict(result.conflict);
      }
      return errorResponse;
    }

    if (this.eventLogService) {
      this.eventLogService.appendPatchEvent({
        level: 'info',
        source: 'memory-service',
        message: 'Pamięć zapisana' + ('autoMerged' in result && result.autoMerged ? ' (auto-merge)' : '') + ': ' + proposal.filePath,
        diff: proposal.diff ?? '',
        filePath: proposal.filePath,
        patchId: proposal.patch.id
      });
    }

    return {
      status: 'ok',
      callId: request.callId,
      result: { entry: result.entry, autoMerged: 'autoMerged' in result ? result.autoMerged : undefined }
    };
  }
  private getStringArg(request: ToolCallRequest, name: string): string | undefined {
    const val = request.args[name];
    return typeof val === 'string' ? val : undefined;
  }

  private missingArg(request: ToolCallRequest, argName: string): ToolCallResponse {
    return {
      status: 'error',
      callId: request.callId,
      code: 'UNKNOWN' as const,
      message: `Missing required argument: ${argName}`
    };
  }

  private invalidArg(request: ToolCallRequest, argName: string): ToolCallResponse {
    return {
      status: 'error',
      callId: request.callId,
      code: 'INVALID_ARGUMENT' as const,
      message: `Invalid argument: ${argName}`
    };
  }
}