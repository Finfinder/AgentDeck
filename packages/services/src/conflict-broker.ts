import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type {
  Conflict,
  ConflictKind,
  ConflictResolution,
  PatchOperation,
  PatchSet,
  ToolRiskLevel
} from '@agentdeck/shared';

// ?? Patch ID generation ???????????????????????????????????????????????????

let patchCounter = 0;

export function generatePatchId(): string {
  const ts = Date.now().toString(36);
  const counter = (++patchCounter).toString(36);
  return `patch-${ts}-${counter}`;
}

// ?? File hash computation ???????????????????????????????????????????????=

export async function computeFileHash(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, 'utf8');
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

// ?? Conflict detection ???????????????????????????????????????????????????

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflict?: Conflict;
}

/**
 * Check if a patch can be applied without conflict.
 * Compares the baseHash from the patch with the current file hash on disk.
 */
export async function checkPatchConflict(patch: PatchSet): Promise<ConflictCheckResult> {
  const currentHash = await computeFileHash(patch.filePath);

  // File was deleted since patch was created
  if (currentHash === null) {
    return {
      hasConflict: true,
      conflict: {
        id: `conflict-${generatePatchId()}`,
        kind: 'patch-conflict',
        patchId: patch.id,
        filePath: patch.filePath,
        description: `Plik ${patch.filePath} został usunięty z dysku od momentu utworzenia patcha.`,
        riskLevel: patch.riskLevel,
        createdAt: Date.now()
      }
    };
  }

  // Hash mismatch means file was modified
  if (currentHash !== patch.baseHash) {
    return {
      hasConflict: true,
      conflict: {
        id: `conflict-${generatePatchId()}`,
        kind: 'patch-conflict',
        patchId: patch.id,
        filePath: patch.filePath,
        description: `Plik ${patch.filePath} został zmodyfikowany na dysku od momentu utworzenia patcha (hash mismatch).`,
        riskLevel: patch.riskLevel,
        createdAt: Date.now()
      }
    };
  }

  return { hasConflict: false };
}

// ?? Conflict Broker ?????????????????????????????????????????????????????=

export class ConflictBroker {
  private readonly conflicts = new Map<string, Conflict>();

  /**
   * Register a conflict for tracking.
   */
  registerConflict(conflict: Conflict): void {
    this.conflicts.set(conflict.id, conflict);
  }

  /**
   * Get a conflict by ID.
   */
  getConflict(id: string): Conflict | undefined {
    return this.conflicts.get(id);
  }

  /**
   * List all unresolved conflicts.
   */
  listConflicts(): readonly Conflict[] {
    return Array.from(this.conflicts.values());
  }

  /**
   * Resolve a conflict with the given action.
   * Returns true if the conflict was found and resolved.
   */
  resolveConflict(resolution: ConflictResolution): boolean {
    const conflict = this.conflicts.get(resolution.conflictId);
    if (!conflict) return false;

    this.conflicts.delete(resolution.conflictId);
    return true;
  }

  /**
   * Clear all conflicts.
   */
  clearConflicts(): void {
    this.conflicts.clear();
  }

  /**
   * Check if a patch set requires conflict review based on risk level.
   * High-risk and critical patches always go through conflict review.
   */
  requiresConflictReview(patch: PatchSet): boolean {
    if (patch.riskLevel === 'high' || patch.riskLevel === 'critical') return true;
    if (patch.operations.length > 10) return true; // Large patches
    return false;
  }

  /**
   * Determine the conflict kind for an operation type.
   */
  classifyOperationKind(operation: 'delete' | 'rename' | 'binary' | 'multi-file' | 'patch'): ConflictKind {
    switch (operation) {
      case 'delete': return 'delete';
      case 'rename': return 'rename';
      case 'binary': return 'binary';
      case 'multi-file': return 'multi-file';
      default: return 'patch-conflict';
    }
  }
}

// ?? Patch application ???????????????????????????????????????????????????=

export interface PatchApplicationResult {
  success: boolean;
  appliedHash?: string;
  conflict?: Conflict;
  error?: string;
}

/**
 * Apply a patch to a file after conflict checking.
 * Returns the result with either success hash or conflict info.
 */
export async function applyPatchWithConflictCheck(
  patch: PatchSet,
  conflictBroker: ConflictBroker
): Promise<PatchApplicationResult> {
  // Step 1: Check for conflicts
  const conflictResult = await checkPatchConflict(patch);

  if (conflictResult.hasConflict && conflictResult.conflict) {
    conflictBroker.registerConflict(conflictResult.conflict);
    return {
      success: false,
      conflict: conflictResult.conflict
    };
  }

  // Step 2: Apply operations atomically
  try {
    // Read current file content
    let content: string;
    try {
      content = await readFile(patch.filePath, 'utf8');
    } catch {
      return {
        success: false,
        error: `Nie można odczytać pliku: ${patch.filePath}`
      };
    }

    // Apply each operation
    for (const op of patch.operations) {
      if (op.range) {
        const lines = content.split('\n');
        const beforeLines = lines.slice(0, op.range.startLine - 1);
        const afterLines = lines.slice(op.range.endLine);

        // Handle partial first line
        const firstLine = lines[op.range.startLine - 1] ?? '';
        const beforePart = firstLine.slice(0, op.range.startCol - 1);

        // Handle partial last line
        const lastLine = lines[op.range.endLine - 1] ?? '';
        const afterPart = lastLine.slice(op.range.endCol - 1);

        const newLines = [
          ...beforeLines,
          beforePart + op.text + afterPart,
          ...afterLines
        ];
        content = newLines.join('\n');
      } else {
        // Replace entire content
        content = op.text;
      }
    }

    // Write back
    const { writeFile } = await import('node:fs/promises');
    await writeFile(patch.filePath, content, 'utf8');

    const appliedHash = createHash('sha256').update(content).digest('hex').slice(0, 16);

    return {
      success: true,
      appliedHash
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nieznany błąd podczas aplikowania patcha'
    };
  }
}

// ?? Risk classification helpers ??????????????????????????????????????????

export function classifyPatchRisk(operations: readonly PatchOperation[]): ToolRiskLevel {
  if (operations.length === 0) return 'low';

  // Multiple files = high risk
  const uniqueFiles = new Set(operations.map(op => op.filePath));
  if (uniqueFiles.size > 3) return 'critical';
  if (uniqueFiles.size > 1) return 'high';

  // Large changes
  const totalTextSize = operations.reduce((sum, op) => sum + op.text.length, 0);
  if (totalTextSize > 10_000) return 'high';

  // Full file replacements (no range) are riskier
  const hasFullReplacement = operations.some(op => !op.range);
  if (hasFullReplacement) return 'medium';

  return 'low';
}
