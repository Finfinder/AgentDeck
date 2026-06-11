import { readFile } from 'node:fs/promises';

import type {
  PatchSet,
  ToolCallRequest,
  ToolCallResponse
} from '@agentdeck/shared';

import { checkSensitivePath, type PermissionBroker } from './permission-broker';
import {
  applyPatchWithConflictCheck,
  classifyPatchRisk,
  type ConflictBroker,
  generatePatchId
} from './conflict-broker';
import { readEditorFile, writeEditorFile } from './editor-service';
import { searchFilesStandalone as workspaceSearch } from './workspace-service';

// ?? Tool execution context ?????????????????????????????????????????????????

export interface ToolRouterOptions {
  workspaceRoots: readonly string[];
  permissionBroker: PermissionBroker;
  conflictBroker: ConflictBroker;
}

// ?? Tool Router ???????????????????????????????????????????????????????????=

export class ToolRouter {
  private readonly workspaceRoots: readonly string[];
  private readonly permissionBroker: PermissionBroker;
  private readonly conflictBroker: ConflictBroker;

  constructor(options: ToolRouterOptions) {
    this.workspaceRoots = options.workspaceRoots;
    this.permissionBroker = options.permissionBroker;
    this.conflictBroker = options.conflictBroker;
  }

  /**
   * Execute a tool call request through the permission broker.
   * Returns a response indicating success, pending approval, or error.
   */
  async execute(request: ToolCallRequest): Promise<ToolCallResponse> {
    // Check sensitive paths for file-operating tools
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
    const sensitiveCheck = filePath ? checkSensitivePath(filePath) : undefined;
    return this.runTool(request, sensitiveCheck);
  }

  // ?? Tool implementations ???????????????????????????????????????????????=

  private async runTool(
    request: ToolCallRequest,
    sensitiveCheck?: { filePath: string; isSensitive: boolean; matchedPattern?: string }
  ): Promise<ToolCallResponse> {
    try {
      switch (request.toolName) {
        case 'readFile':
          return this.toolReadFile(request);
        case 'searchFiles':
          return this.toolSearchFiles(request);
        case 'listDirectory':
          return this.toolListDirectory(request);
        case 'proposePatch':
          return this.toolProposePatch(request);
        case 'applyPatch':
          return this.toolApplyPatch(request, sensitiveCheck);
        case 'writeFile':
          return this.toolWriteFile(request, sensitiveCheck);
        case 'deleteFile':
          return this.toolDeleteFile(request, sensitiveCheck);
        case 'renameFile':
          return this.toolRenameFile(request, sensitiveCheck);
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
        code: 'UNKNOWN',
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
        code: 'UNKNOWN',
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
        code: 'UNKNOWN',
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
    let diffResult;
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
      diffResult = { status: 'error', code: 'UNKNOWN', message: 'Failed to generate diff' };
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

    const patch: PatchSet = {
      id: patchId,
      filePath: String(patchData.filePath),
      baseHash: String(patchData.baseHash),
      operations: patchData.operations as PatchSet['operations'],
      author: String(patchData.author ?? 'agent'),
      riskLevel: patchData.riskLevel as PatchSet['riskLevel'],
      createdAt: Number(patchData.createdAt ?? Date.now())
    };

    // Extra approval for sensitive files
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
      return {
        status: 'error',
        callId: request.callId,
        code: 'UNKNOWN',
        message: result.conflict.description
      };
    }

    if (!result.success) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'UNKNOWN',
        message: result.error ?? 'Failed to apply patch'
      };
    }

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
        code: result.code === 'WRITE_CONFLICT' ? 'UNKNOWN' : result.code,
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
    request: ToolCallRequest,
    sensitiveCheck?: { filePath: string; isSensitive: boolean; matchedPattern?: string }
  ): Promise<ToolCallResponse> {
    const oldPath = this.getStringArg(request, 'oldPath');
    const newPath = this.getStringArg(request, 'newPath');

    if (!oldPath) return this.missingArg(request, 'oldPath');
    if (!newPath) return this.missingArg(request, 'newPath');

    // Check both paths for sensitivity
    if (sensitiveCheck?.isSensitive) {
      return {
        status: 'error',
        callId: request.callId,
        code: 'ACCESS_DENIED',
        message: `Zmiana nazwy wrażliwego pliku zabroniona: ${oldPath}`
      };
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
    return undefined;
  }

  private getStringArg(request: ToolCallRequest, name: string): string | undefined {
    const val = request.args[name];
    return typeof val === 'string' ? val : undefined;
  }

  private missingArg(request: ToolCallRequest, argName: string): ToolCallResponse {
    return {
      status: 'error',
      callId: request.callId,
      code: 'UNKNOWN',
      message: `Missing required argument: ${argName}`
    };
  }
}
