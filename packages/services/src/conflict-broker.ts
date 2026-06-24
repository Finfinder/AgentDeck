import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type {
  Conflict,
  ConflictKind,
  ConflictResolution,
  PatchOperation,
  PatchSet,
  ToolRiskLevel
} from '@agentdeck/shared';

// ?? Helpers ?????????????????????????????????????????????????????????????

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ?? Patch ID generation ???????????????????????????????????????????????????

export function generatePatchId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString('hex');
  return `patch-${ts}-${rand}`;
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

export interface ResolvedConflict {
  resolution: ConflictResolution;
  resolvedAt: number;
}

export class ConflictBroker {
  private readonly conflicts = new Map<string, Conflict>();
  private readonly resolvedConflicts = new Map<string, ResolvedConflict>();

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
    this.resolvedConflicts.set(resolution.conflictId, {
      resolution,
      resolvedAt: Date.now()
    });
    return true;
  }

  /**
   * Get the resolution for a previously resolved conflict.
   */
  getResolvedConflict(conflictId: string): ResolvedConflict | undefined {
    return this.resolvedConflicts.get(conflictId);
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
  classifyOperationKind(operation: string): ConflictKind {
    return ConflictBroker.classifyOperationKind(operation);
  }

  /**
   * Static version of classifyOperationKind for direct use.
   */
  static classifyOperationKind(operation: string): ConflictKind {
    switch (operation) {
      case 'delete': return 'delete';
      case 'rename': return 'rename';
      case 'binary': return 'binary';
      case 'multi-file': return 'multi-file';
      default: return 'patch-conflict';
    }
  }
}

/**
 * Standalone function to determine the conflict kind for an operation type.
 * Use this for direct imports without instantiating ConflictBroker.
 */
export function classifyOperationKind(operation: string): ConflictKind {
  switch (operation) {
    case 'delete': return 'delete';
    case 'rename': return 'rename';
    case 'binary': return 'binary';
    case 'multi-file': return 'multi-file';
    default: return 'patch-conflict';
  }
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
  // No overlap if one range ends before the other starts
  if (a.endLine < b.startLine || b.endLine < a.startLine) return false;

  // One range fully contains the other's start
  if (a.startLine < b.startLine && a.endLine > b.startLine) return true;
  if (b.startLine < a.startLine && b.endLine > a.startLine) return true;

  // Ranges share at least one line
  if (a.startLine === b.startLine) {
    const isSingleLine = a.startLine === a.endLine && b.startLine === b.endLine;
    return isSingleLine
      ? a.endCol >= b.startCol && b.endCol >= a.startCol
      : true;
  }

  // Adjacent lines — check column overlap
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

function validateOperationRanges(
  operations: readonly PatchOperation[],
  diskLines: readonly string[]
): readonly PatchOperation[] | null {
  for (const op of operations) {
    if (!op.range) continue;
    if (op.range.startLine < 1 || op.range.startLine > diskLines.length) return [op];
    if (op.range.endLine < 1 || op.range.endLine > diskLines.length) return [op];
    if (op.range.startCol < 1 || op.range.endCol < 1) return [op];
  }

  return null;
}

function validateContextAnchors(
  operations: readonly PatchOperation[],
  diskLines: readonly string[]
): boolean {
  for (const op of operations) {
    if (!op.range) continue;
    if (!contextBeforeMatches(op, diskLines)) return false;
    if (!contextAfterMatches(op, diskLines)) return false;
  }

  return true;
}

function contextBeforeMatches(op: PatchOperation, diskLines: readonly string[]): boolean {
  if (!op.range || !op.contextBefore || op.contextBefore.length === 0) return true;

  const startIndex = Math.max(0, op.range.startLine - 1 - op.contextBefore.length);
  const actualBefore = diskLines.slice(startIndex, op.range.startLine - 1);
  if (actualBefore.length !== op.contextBefore.length) return false;
  return arraysEqual(actualBefore, op.contextBefore);
}

function contextAfterMatches(op: PatchOperation, diskLines: readonly string[]): boolean {
  if (!op.range || !op.contextAfter || op.contextAfter.length === 0) return true;

  const actualAfter = diskLines.slice(
    op.range.endLine,
    op.range.endLine + op.contextAfter.length
  );
  return arraysEqual(actualAfter, op.contextAfter);
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

  if (rangedOps.length === 0) {
    return { merged: false, conflictingOps: operations };
  }

  if (hasInternalOverlap(operations)) {
    return { merged: false, conflictingOps: operations };
  }

  const diskLines = diskContent.split('\n');
  const invalidRangeOps = validateOperationRanges(rangedOps, diskLines);
  if (invalidRangeOps) {
    return { merged: false, conflictingOps: invalidRangeOps };
  }

  if (!validateContextAnchors(rangedOps, diskLines)) {
    return { merged: false, conflictingOps: operations };
  }

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
function applyRangedOperation(content: string, op: PatchOperation): string | null {
  if (!op.range) return content;
  const lines = content.split('\n');
  if (op.range.startLine < 1 || op.range.endLine > lines.length) return null;

  const firstLine = lines[op.range.startLine - 1] ?? '';
  const lastLine = lines[op.range.endLine - 1] ?? '';
  const beforePart = firstLine.slice(0, op.range.startCol - 1);
  const afterPart = lastLine.slice(op.range.endCol - 1);
  const beforeLines = lines.slice(0, op.range.startLine - 1);
  const afterLines = lines.slice(op.range.endLine);

  return [...beforeLines, beforePart + op.text + afterPart, ...afterLines].join('\n');
}

function applyPatchToContent(
  content: string,
  operations: readonly PatchOperation[]
): string | null {
  const rangedOps = operations
    .filter(op => op.range)
    .sort((a, b) => b.range!.startLine - a.range!.startLine);
  const fullReplacements = operations.filter(op => !op.range);

  let result = content;
  for (const op of rangedOps) {
    const applied = applyRangedOperation(result, op);
    if (applied === null) return null;
    result = applied;
  }

  return fullReplacements.length > 0 ? fullReplacements[fullReplacements.length - 1]!.text : result;
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
