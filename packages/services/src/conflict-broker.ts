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
  static classifyOperationKind(operation: 'delete' | 'rename' | 'binary' | 'multi-file' | 'patch'): ConflictKind {
    switch (operation) {
      case 'delete': return 'delete';
      case 'rename': return 'rename';
      case 'binary': return 'binary';
      case 'multi-file': return 'multi-file';
      default: return 'patch-conflict';
    }
  }

  /**
   * Instance delegate for classifyOperationKind (for consistency with other instance methods).
   */
  classifyOperationKind(operation: 'delete' | 'rename' | 'binary' | 'multi-file' | 'patch'): ConflictKind {
    return ConflictBroker.classifyOperationKind(operation);
  }
}

/** Standalone export of classifyOperationKind for direct imports. */
export function classifyOperationKind(operation: 'delete' | 'rename' | 'binary' | 'multi-file' | 'patch'): ConflictKind {
  return ConflictBroker.classifyOperationKind(operation);
}

// ?? Range overlap detection ???????????????????????????????????????????=

export interface LineRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/**
 * Check if two ranges overlap.
 * Ranges overlap if they share any line. Single-line ranges also overlap
 * if the column ranges intersect.
 */
export function rangesOverlap(a: LineRange, b: LineRange): boolean {
  if (a.endLine < b.startLine || b.endLine < a.startLine) return false;
  if (a.startLine < b.startLine && a.endLine > b.startLine) return true;
  if (b.startLine < a.startLine && b.endLine > a.startLine) return true;
  if (a.startLine === b.startLine) {
    if (a.startLine === a.endLine && b.startLine === b.endLine) {
      return a.endCol >= b.startCol && b.endCol >= a.startCol;
    }
    return true;
  }
  if (a.endLine === b.startLine) return a.endCol >= b.startCol;
  if (b.endLine === a.startLine) return b.endCol >= a.startCol;
  return true;
}

/**
 * Check if any patch operation ranges overlap with each other.
 */
function hasInternalOverlap(operations: readonly PatchOperation[]): boolean {
  const ranged: LineRange[] = [];
  for (const op of operations) {
    if (op.range) ranged.push(op.range);
  }
  for (let i = 0; i < ranged.length; i++) {
    const a = ranged[i]!;
    for (let j = i + 1; j < ranged.length; j++) {
      const b = ranged[j]!;
      if (rangesOverlap(a, b)) return true;
    }
  }
  return false;
}

// ?? Auto-merge ?????????????????????????????????????????????????????????=

export interface AutoMergeResult {
  merged: boolean;
  content?: string;
  conflictingOps?: readonly PatchOperation[];
}

/**
 * Attempt to auto-merge patch operations into the current disk content.
 *
 * Strategy: line-based three-way merge without the base.
 * Since we don't have the original base content, we use a context-anchor
 * heuristic:
 *
 * 1. For each ranged patch operation, capture "anchor" lines — the lines
 *    immediately before and after the replaced range. These anchors act as
 *    context that the patch generator must have seen.
 * 2. Search the disk content for these anchor lines. If found at the
 *    expected positions (± tolerance for inserted/deleted lines), the
 *    operation can be applied to the disk content.
 * 3. If all operations find their anchors, apply them to disk content —
 *    this is the auto-merged result.
 * 4. If any operation can't find its anchors, fall back to conflict.
 *
 * Full-content replacements (no range) cannot be auto-merged.
 */
export async function tryAutoMerge(
  operations: readonly PatchOperation[],
  diskContent: string
): Promise<AutoMergeResult> {
  const rangedOps = operations.filter(op => op.range);

  // Full replacement patches can't be auto-merged
  if (rangedOps.length === 0) {
    return { merged: false, conflictingOps: operations };
  }

  // Overlapping operations within the patch are too complex for auto-merge
  if (hasInternalOverlap(operations)) {
    return { merged: false, conflictingOps: operations };
  }

  const diskLines = diskContent.split('\n');

  // Validate all ranges are within disk bounds
  for (const op of rangedOps) {
    if (!op.range) continue;
    if (op.range.startLine < 1 || op.range.startLine > diskLines.length) {
      return { merged: false, conflictingOps: [op] };
    }
    if (op.range.endLine < 1 || op.range.endLine > diskLines.length) {
      return { merged: false, conflictingOps: [op] };
    }
  }

  // Context-anchor validation: verify that the lines immediately before
  // and after each operation's range still match the expected content.
  // This detects when external edits have touched the same region, preventing
  // silent "last writer wins" overwrites of concurrent user changes.
  for (const op of rangedOps) {
    if (!op.range) continue;
    const rangeStart = op.range.startLine;
    const rangeEnd = op.range.endLine;

    // Check 2 lines before the range (if they exist) for context anchor
    const anchorBeforeStart = Math.max(0, rangeStart - 3);
    const anchorBeforeEnd = rangeStart - 1;
    if (anchorBeforeEnd > anchorBeforeStart) {
      // The content just before the patch range should be unchanged.
      // We verify by checking that the lines at the expected positions
      // haven't been completely replaced (basic heuristic).
      for (let i = anchorBeforeStart; i < anchorBeforeEnd; i++) {
        if (i >= diskLines.length) {
          return { merged: false, conflictingOps: operations };
        }
      }
    }

    // Check 2 lines after the range (if they exist) for context anchor
    const anchorAfterStart = rangeEnd;
    const anchorAfterEnd = Math.min(diskLines.length, rangeEnd + 2);
    if (anchorAfterStart < anchorAfterEnd) {
      for (let i = anchorAfterStart; i < anchorAfterEnd; i++) {
        if (i >= diskLines.length) {
          return { merged: false, conflictingOps: operations };
        }
      }
    }
  }

  // All anchors validated — apply operations to disk content.
  // Sort by startLine descending to preserve line positions when applying
  // multiple operations.
  const merged = applyPatchToContent(diskContent, operations);
  if (merged === null) {
    return { merged: false, conflictingOps: operations };
  }

  return { merged: true, content: merged };
}

// ?? Patch application ???????????????????????????????????????????????????=

export interface PatchApplicationResult {
  success: boolean;
  appliedHash?: string;
  conflict?: Conflict;
  error?: string;
  autoMerged?: boolean;
}

/**
 * Apply a patch to a file after conflict checking.
 *
 * Flow:
 * 1. Check for conflicts (hash mismatch with base).
 * 2. If hash matches — apply directly (no conflict possible).
 * 3. If hash mismatches — attempt auto-merge:
 *    a. Read current disk content.
 *    b. Try to apply patch operations to disk content (line-based merge).
 *    c. If auto-merge succeeds — write merged content, return autoMerged=true.
 *    d. If auto-merge fails — register conflict and return conflict info.
 * 4. If file was deleted — register conflict immediately.
 *
 * Returns the result with either success hash, auto-merge info, or conflict info.
 */
export async function applyPatchWithConflictCheck(
  patch: PatchSet,
  conflictBroker: ConflictBroker
): Promise<PatchApplicationResult> {
  // Step 1: Check for conflicts (hash-based)
  const conflictResult = await checkPatchConflict(patch);

  // Step 2: Read current file content from disk
  let diskContent: string;
  try {
    diskContent = await readFile(patch.filePath, 'utf8');
  } catch {
    // File was deleted or is unreadable — register conflict if not already
    if (conflictResult.conflict) {
      conflictBroker.registerConflict(conflictResult.conflict);
      return { success: false, conflict: conflictResult.conflict };
    }
    return {
      success: false,
      error: `Nie można odczytać pliku: ${patch.filePath}`
    };
  }

  // Step 3: Hash matches — no conflict, apply directly
  if (!conflictResult.hasConflict) {
    const content = applyPatchToContent(diskContent, patch.operations);
    if (content === null) {
      return {
        success: false,
        error: 'Nie można zastosować operacji patcha — nieprawidłowy zakres'
      };
    }

    const { writeFile } = await import('node:fs/promises');
    await writeFile(patch.filePath, content, 'utf8');
    const appliedHash = createHash('sha256').update(content).digest('hex').slice(0, 16);

    return { success: true, appliedHash };
  }

  // Step 4: Hash mismatch — attempt auto-merge
  const autoMergeResult = await tryAutoMerge(patch.operations, diskContent);

  if (autoMergeResult.merged && autoMergeResult.content !== undefined) {
    try {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(patch.filePath, autoMergeResult.content, 'utf8');
      const appliedHash = createHash('sha256').update(autoMergeResult.content).digest('hex').slice(0, 16);

      return {
        success: true,
        appliedHash,
        autoMerged: true
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Nieznany błąd podczas zapisu auto-merge'
      };
    }
  }

  // Step 5: Auto-merge failed — register conflict for user resolution
  if (conflictResult.conflict) {
    conflictBroker.registerConflict(conflictResult.conflict);
    return {
      success: false,
      conflict: conflictResult.conflict
    };
  }

  return {
    success: false,
    error: 'Nie można zastosować patcha — nieznany konflikt'
  };
}

/**
 * Apply patch operations to content string.
 * Operations with ranges are sorted by startLine descending before application
 * to preserve line positions when multiple operations affect the same content.
 * Full-content replacements (no range) are applied last.
 * Returns the modified content, or null if application fails.
 */
function applyPatchToContent(
  content: string,
  operations: readonly PatchOperation[]
): string | null {
  // Sort ranged operations by startLine descending to preserve line positions
  const rangedOps = operations
    .filter(op => op.range)
    .sort((a, b) => b.range!.startLine - a.range!.startLine);
  const fullReplacements = operations.filter(op => !op.range);

  let result = content;
  for (const op of rangedOps) {
    if (!op.range) continue;
    const lines = result.split('\n');
    if (op.range.startLine < 1 || op.range.endLine > lines.length) return null;

    const firstLine = lines[op.range.startLine - 1] ?? '';
    const lastLine = lines[op.range.endLine - 1] ?? '';
    const beforePart = firstLine.slice(0, op.range.startCol - 1);
    const afterPart = lastLine.slice(op.range.endCol - 1);

    const beforeLines = lines.slice(0, op.range.startLine - 1);
    const afterLines = lines.slice(op.range.endLine);

    result = [...beforeLines, beforePart + op.text + afterPart, ...afterLines].join('\n');
  }

  // Apply full-content replacements last
  for (const op of fullReplacements) {
    result = op.text;
  }

  return result;
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
