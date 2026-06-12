import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ConflictBroker,
  computeFileHash,
  checkPatchConflict,
  classifyPatchRisk,
  generatePatchId,
  applyPatchWithConflictCheck,
  tryAutoMerge,
  rangesOverlap
} from '@agentdeck/services';

describe('ConflictBroker', () => {
  let broker: ConflictBroker;

  beforeEach(() => {
    broker = new ConflictBroker();
  });

  describe('registerConflict / getConflict', () => {
    it('should register and retrieve a conflict', () => {
      const conflict = {
        id: 'c1',
        kind: 'patch-conflict' as const,
        patchId: 'p1',
        filePath: '/test.ts',
        description: 'File modified',
        riskLevel: 'medium' as const,
        createdAt: Date.now()
      };
      broker.registerConflict(conflict);
      expect(broker.getConflict('c1')).toEqual(conflict);
    });

    it('should return undefined for unknown conflict', () => {
      expect(broker.getConflict('nonexistent')).toBeUndefined();
    });
  });

  describe('listConflicts', () => {
    it('should return empty array initially', () => {
      expect(broker.listConflicts()).toEqual([]);
    });

    it('should list all registered conflicts', () => {
      const c1 = { id: 'c1', kind: 'patch-conflict' as const, patchId: 'p1', filePath: '/a.ts', description: 'A', riskLevel: 'low' as const, createdAt: 1 };
      const c2 = { id: 'c2', kind: 'delete' as const, patchId: 'p2', filePath: '/b.ts', description: 'B', riskLevel: 'high' as const, createdAt: 2 };
      broker.registerConflict(c1);
      broker.registerConflict(c2);
      expect(broker.listConflicts()).toHaveLength(2);
    });
  });

  describe('resolveConflict', () => {
    it('should resolve and remove conflict', () => {
      const conflict = { id: 'c1', kind: 'patch-conflict' as const, patchId: 'p1', filePath: '/a.ts', description: 'A', riskLevel: 'low' as const, createdAt: 1 };
      broker.registerConflict(conflict);
      const result = broker.resolveConflict({ conflictId: 'c1', action: 'apply' });
      expect(result).toBe(true);
      expect(broker.getConflict('c1')).toBeUndefined();
    });

    it('should return false for unknown conflict', () => {
      const result = broker.resolveConflict({ conflictId: 'nonexistent', action: 'skip' });
      expect(result).toBe(false);
    });
  });

  describe('clearConflicts', () => {
    it('should clear all conflicts', () => {
      const c = { id: 'c1', kind: 'patch-conflict' as const, patchId: 'p1', filePath: '/a.ts', description: 'A', riskLevel: 'low' as const, createdAt: 1 };
      broker.registerConflict(c);
      broker.clearConflicts();
      expect(broker.listConflicts()).toEqual([]);
    });
  });

  describe('requiresConflictReview', () => {
    it('should return true for high-risk patches', () => {
      const patch = { id: 'p1', filePath: '/a.ts', baseHash: 'abc', operations: [], author: 'agent', riskLevel: 'high' as const, createdAt: 1 };
      expect(broker.requiresConflictReview(patch)).toBe(true);
    });

    it('should return true for critical-risk patches', () => {
      const patch = { id: 'p1', filePath: '/a.ts', baseHash: 'abc', operations: [], author: 'agent', riskLevel: 'critical' as const, createdAt: 1 };
      expect(broker.requiresConflictReview(patch)).toBe(true);
    });

    it('should return false for low-risk patches', () => {
      const patch = { id: 'p1', filePath: '/a.ts', baseHash: 'abc', operations: [{ text: 'x', filePath: '/a.ts' }], author: 'agent', riskLevel: 'low' as const, createdAt: 1 };
      expect(broker.requiresConflictReview(patch)).toBe(false);
    });

    it('should return true for patches with many operations', () => {
      const ops = Array.from({ length: 11 }, (_, i) => ({ text: `op${i}`, filePath: '/a.ts' }));
      const patch = { id: 'p1', filePath: '/a.ts', baseHash: 'abc', operations: ops, author: 'agent', riskLevel: 'low' as const, createdAt: 1 };
      expect(broker.requiresConflictReview(patch)).toBe(true);
    });
  });

  describe('classifyOperationKind', () => {
    it('should classify delete operations', () => {
      expect(broker.classifyOperationKind('delete')).toBe('delete');
    });

    it('should classify rename operations', () => {
      expect(broker.classifyOperationKind('rename')).toBe('rename');
    });

    it('should classify binary operations', () => {
      expect(broker.classifyOperationKind('binary')).toBe('binary');
    });

    it('should classify multi-file operations', () => {
      expect(broker.classifyOperationKind('multi-file')).toBe('multi-file');
    });

    it('should classify patch operations as patch-conflict', () => {
      expect(broker.classifyOperationKind('patch')).toBe('patch-conflict');
    });
  });
});

describe('computeFileHash', () => {
  const tmpDir = join(process.cwd(), 'tmp-test-conflict');

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should compute hash for existing file', async () => {
    const filePath = join(tmpDir, 'test.ts');
    await writeFile(filePath, 'const x = 1;\n', 'utf8');
    const hash = await computeFileHash(filePath);
    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash!.length).toBe(16);
  });

  it('should return null for non-existent file', async () => {
    const hash = await computeFileHash(join(tmpDir, 'nonexistent.ts'));
    expect(hash).toBeNull();
  });

  it('should produce different hashes for different content', async () => {
    const file1 = join(tmpDir, 'a.ts');
    const file2 = join(tmpDir, 'b.ts');
    await writeFile(file1, 'content A', 'utf8');
    await writeFile(file2, 'content B', 'utf8');
    const hash1 = await computeFileHash(file1);
    const hash2 = await computeFileHash(file2);
    expect(hash1).not.toBe(hash2);
  });
});

describe('checkPatchConflict', () => {
  const tmpDir = join(process.cwd(), 'tmp-test-patch-conflict');

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should return no conflict when hash matches', async () => {
    const filePath = join(tmpDir, 'test.ts');
    await writeFile(filePath, 'const x = 1;\n', 'utf8');
    const hash = await computeFileHash(filePath);

    const patch = {
      id: 'p1',
      filePath,
      baseHash: hash!,
      operations: [{ text: 'const x = 2;\n', filePath }],
      author: 'agent',
      riskLevel: 'low' as const,
      createdAt: Date.now()
    };

    const result = await checkPatchConflict(patch);
    expect(result.hasConflict).toBe(false);
  });

  it('should detect conflict when file was modified', async () => {
    const filePath = join(tmpDir, 'test.ts');
    await writeFile(filePath, 'const x = 1;\n', 'utf8');
    const originalHash = await computeFileHash(filePath);

    // Modify file after hash was computed
    await writeFile(filePath, 'const x = 99;\n', 'utf8');

    const patch = {
      id: 'p1',
      filePath,
      baseHash: originalHash!,
      operations: [{ text: 'const x = 2;\n', filePath }],
      author: 'agent',
      riskLevel: 'low' as const,
      createdAt: Date.now()
    };

    const result = await checkPatchConflict(patch);
    expect(result.hasConflict).toBe(true);
    expect(result.conflict).toBeDefined();
    expect(result.conflict!.kind).toBe('patch-conflict');
  });

  it('should detect conflict when file was deleted', async () => {
    const filePath = join(tmpDir, 'deleted.ts');
    await writeFile(filePath, 'content', 'utf8');
    const hash = await computeFileHash(filePath);

    // Delete file
    await rm(filePath);

    const patch = {
      id: 'p1',
      filePath,
      baseHash: hash!,
      operations: [{ text: 'new content', filePath }],
      author: 'agent',
      riskLevel: 'low' as const,
      createdAt: Date.now()
    };

    const result = await checkPatchConflict(patch);
    expect(result.hasConflict).toBe(true);
    expect(result.conflict).toBeDefined();
    expect(result.conflict!.description).toContain('usunięty');
  });
});

describe('classifyPatchRisk', () => {
  it('should return low for empty operations', () => {
    expect(classifyPatchRisk([])).toBe('low');
  });

  it('should return low for small single-file edits', () => {
    const ops = [{ text: 'x', filePath: '/a.ts', range: { startLine: 1, startCol: 1, endLine: 1, endCol: 2 } }];
    expect(classifyPatchRisk(ops)).toBe('low');
  });

  it('should return medium for full file replacement', () => {
    const ops = [{ text: 'entire file content', filePath: '/a.ts' }];
    expect(classifyPatchRisk(ops)).toBe('medium');
  });

  it('should return high for multi-file patches', () => {
    const ops = [
      { text: 'a', filePath: '/a.ts' },
      { text: 'b', filePath: '/b.ts' },
      { text: 'c', filePath: '/c.ts' }
    ];
    expect(classifyPatchRisk(ops)).toBe('high');
  });

  it('should return critical for patches touching many files', () => {
    const ops = Array.from({ length: 5 }, (_, i) => ({ text: `content${i}`, filePath: `/file${i}.ts` }));
    expect(classifyPatchRisk(ops)).toBe('critical');
  });

  it('should return high for very large changes', () => {
    const ops = [{ text: 'x'.repeat(10_001), filePath: '/a.ts' }];
    expect(classifyPatchRisk(ops)).toBe('high');
  });
});

describe('generatePatchId', () => {
  it('should generate unique IDs', () => {
    const id1 = generatePatchId();
    const id2 = generatePatchId();
    expect(id1).not.toBe(id2);
  });

  it('should generate IDs with patch- prefix', () => {
    const id = generatePatchId();
    expect(id).toMatch(/^patch-/);
  });
});

describe('applyPatchWithConflictCheck', () => {
  const tmpDir = join(process.cwd(), 'tmp-test-apply-patch');
  let broker: ConflictBroker;

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
    broker = new ConflictBroker();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should apply patch when hash matches', async () => {
    const filePath = join(tmpDir, 'apply.ts');
    await writeFile(filePath, 'const x = 1;\n', 'utf8');
    const hash = await computeFileHash(filePath);

    const patch = {
      id: 'p-apply-1',
      filePath,
      baseHash: hash!,
      operations: [{ text: 'const x = 2;\n', filePath }],
      author: 'agent',
      riskLevel: 'low' as const,
      createdAt: Date.now()
    };

    const result = await applyPatchWithConflictCheck(patch, broker);
    expect(result.success).toBe(true);
    expect(result.appliedHash).toBeDefined();
    expect(result.conflict).toBeUndefined();
  });

  it('should return conflict when file was modified', async () => {
    const filePath = join(tmpDir, 'conflict.ts');
    await writeFile(filePath, 'const x = 1;\n', 'utf8');
    const originalHash = await computeFileHash(filePath);

    // Modify file after hash was computed
    await writeFile(filePath, 'const x = 99;\n', 'utf8');

    const patch = {
      id: 'p-conflict-1',
      filePath,
      baseHash: originalHash!,
      operations: [{ text: 'const x = 2;\n', filePath }],
      author: 'agent',
      riskLevel: 'medium' as const,
      createdAt: Date.now()
    };

    const result = await applyPatchWithConflictCheck(patch, broker);
    expect(result.success).toBe(false);
    expect(result.conflict).toBeDefined();
    expect(result.conflict!.kind).toBe('patch-conflict');
    expect(result.conflict!.filePath).toBe(filePath);

    // Conflict should be registered in broker
    expect(broker.listConflicts()).toHaveLength(1);
  });

  it('should return conflict when file was deleted', async () => {
    const filePath = join(tmpDir, 'deleted.ts');
    await writeFile(filePath, 'content', 'utf8');
    const hash = await computeFileHash(filePath);
    await rm(filePath);

    const patch = {
      id: 'p-deleted-1',
      filePath,
      baseHash: hash!,
      operations: [{ text: 'new content', filePath }],
      author: 'agent',
      riskLevel: 'low' as const,
      createdAt: Date.now()
    };

    const result = await applyPatchWithConflictCheck(patch, broker);
    expect(result.success).toBe(false);
    expect(result.conflict).toBeDefined();
    expect(result.conflict!.description).toContain('usunięty');
  });

  it('should apply range-based edit when hash matches', async () => {
    const filePath = join(tmpDir, 'range.ts');
    const original = 'line1\nline2\nline3\n';
    await writeFile(filePath, original, 'utf8');
    const hash = await computeFileHash(filePath);

    const patch = {
      id: 'p-range-1',
      filePath,
      baseHash: hash!,
      operations: [{
        text: 'LINE2',
        filePath,
        range: { startLine: 2, startCol: 1, endLine: 2, endCol: 6 }
      }],
      author: 'agent',
      riskLevel: 'low' as const,
      createdAt: Date.now()
    };

    const result = await applyPatchWithConflictCheck(patch, broker);
    expect(result.success).toBe(true);
    expect(result.appliedHash).toBeDefined();
    expect(broker.listConflicts()).toHaveLength(0);
  });

  it('should not apply patch after conflict is detected', async () => {
    const filePath = join(tmpDir, 'no-apply.ts');
    await writeFile(filePath, 'original\n', 'utf8');
    const hash = await computeFileHash(filePath);

    // Modify file
    await writeFile(filePath, 'modified externally\n', 'utf8');

    const patch = {
      id: 'p-no-apply-1',
      filePath,
      baseHash: hash!,
      operations: [{ text: 'agent change\n', filePath }],
      author: 'agent',
      riskLevel: 'low' as const,
      createdAt: Date.now()
    };

    const result = await applyPatchWithConflictCheck(patch, broker);
    expect(result.success).toBe(false);

    // File content should remain unchanged (not overwritten)
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('modified externally\n');
  });
});

describe('rangesOverlap', () => {
  it('should return false for non-overlapping ranges on different lines', () => {
    expect(rangesOverlap(
      { startLine: 1, startCol: 1, endLine: 3, endCol: 10 },
      { startLine: 5, startCol: 1, endLine: 7, endCol: 10 }
    )).toBe(false);
  });

  it('should return true for overlapping ranges', () => {
    expect(rangesOverlap(
      { startLine: 1, startCol: 1, endLine: 5, endCol: 10 },
      { startLine: 3, startCol: 1, endLine: 7, endCol: 10 }
    )).toBe(true);
  });

  it('should return true for identical ranges', () => {
    expect(rangesOverlap(
      { startLine: 2, startCol: 1, endLine: 4, endCol: 10 },
      { startLine: 2, startCol: 1, endLine: 4, endCol: 10 }
    )).toBe(true);
  });

  it('should return false for adjacent ranges (endLine + 1 === startLine)', () => {
    expect(rangesOverlap(
      { startLine: 1, startCol: 1, endLine: 3, endCol: 10 },
      { startLine: 4, startCol: 1, endLine: 6, endCol: 10 }
    )).toBe(false);
  });

  it('should return true for single-line ranges that overlap in columns', () => {
    expect(rangesOverlap(
      { startLine: 5, startCol: 1, endLine: 5, endCol: 10 },
      { startLine: 5, startCol: 5, endLine: 5, endCol: 15 }
    )).toBe(true);
  });

  it('should return false for single-line ranges that do not overlap in columns', () => {
    expect(rangesOverlap(
      { startLine: 5, startCol: 1, endLine: 5, endCol: 5 },
      { startLine: 5, startCol: 10, endLine: 5, endCol: 15 }
    )).toBe(false);
  });
});

describe('tryAutoMerge', () => {
  const tmpDir = join(process.cwd(), 'tmp-test-auto-merge');

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should auto-merge when external changes are on different lines', async () => {
    const filePath = join(tmpDir, 'merge-ok.ts');
    const baseContent = 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n';
    await writeFile(filePath, baseContent, 'utf8');
    const baseHash = await computeFileHash(filePath);

    // Agent creates a patch that modifies line 1 (no trailing newline in op.text)
    const patch = {
      id: 'p-auto-merge-1',
      filePath,
      baseHash,
      operations: [{
        text: 'const a = 100;',
        filePath,
        range: { startLine: 1, startCol: 1, endLine: 1, endCol: 13 }
      }],
      author: 'agent',
      riskLevel: 'low' as const,
      createdAt: Date.now()
    };

    // External process modifies line 3 (different line)
    const diskContent = 'const a = 1;\nconst b = 2;\nconst c = 999;\nconst d = 4;\n';

    const result = await tryAutoMerge(patch.operations, diskContent);
    expect(result.merged).toBe(true);
    expect(result.content).toBeDefined();
    // Agent's change applied to line 1, external change preserved on line 3
    expect(result.content).toBe('const a = 100;\nconst b = 2;\nconst c = 999;\nconst d = 4;\n');
  });

  it('should fail to auto-merge for full replacement patches', async () => {
    const filePath = join(tmpDir, 'merge-full.ts');
    const patch = {
      id: 'p-full-replace',
      filePath,
      baseHash: 'abc123',
      operations: [{ text: 'entire new content', filePath }],
      author: 'agent',
      riskLevel: 'medium' as const,
      createdAt: Date.now()
    };

    const result = await tryAutoMerge(patch.operations, 'some disk content');
    expect(result.merged).toBe(false);
  });

  it('should auto-merge multiple non-overlapping operations', async () => {
    const filePath = join(tmpDir, 'merge-multi.ts');
    const baseContent = 'line1\nline2\nline3\nline4\nline5\n';
    await writeFile(filePath, baseContent, 'utf8');
    const baseHash = await computeFileHash(filePath);

    // Agent modifies lines 1 and 5 (no trailing newline in op.text)
    const patch = {
      id: 'p-multi-op',
      filePath,
      baseHash,
      operations: [
        {
          text: 'LINE1',
          filePath,
          range: { startLine: 1, startCol: 1, endLine: 1, endCol: 6 }
        },
        {
          text: 'LINE5',
          filePath,
          range: { startLine: 5, startCol: 1, endLine: 5, endCol: 6 }
        }
      ],
      author: 'agent',
      riskLevel: 'low' as const,
      createdAt: Date.now()
    };

    // External modifies line 3
    const diskContent = 'line1\nline2\nLINE3\nline4\nline5\n';

    const result = await tryAutoMerge(patch.operations, diskContent);
    expect(result.merged).toBe(true);
    expect(result.content).toBe('LINE1\nline2\nLINE3\nline4\nLINE5\n');
  });
});

describe('applyPatchWithConflictCheck — auto-merge integration', () => {
  const tmpDir = join(process.cwd(), 'tmp-test-am-integration');
  let broker: ConflictBroker;

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
    broker = new ConflictBroker();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should auto-merge and write when external changes are on different lines', async () => {
    const filePath = join(tmpDir, 'am-write.ts');
    const baseContent = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
    await writeFile(filePath, baseContent, 'utf8');
    const baseHash = (await computeFileHash(filePath))!;

    // External modifies line 2 after agent read the file
    await writeFile(filePath, 'const a = 1;\nconst b = 999;\nconst c = 3;\n', 'utf8');

    // Agent patch modifies line 1 (no trailing newline in op.text)
    const patch = {
      id: 'p-am-write-1',
      filePath,
      baseHash,
      operations: [{
        text: 'const a = 100;',
        filePath,
        range: { startLine: 1, startCol: 1, endLine: 1, endCol: 13 }
      }],
      author: 'agent',
      riskLevel: 'low' as const,
      createdAt: Date.now()
    };

    const result = await applyPatchWithConflictCheck(patch, broker);
    expect(result.success).toBe(true);
    expect(result.autoMerged).toBe(true);
    expect(result.appliedHash).toBeDefined();
    expect(broker.listConflicts()).toHaveLength(0);

    // Verify file content has both changes
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('const a = 100;\nconst b = 999;\nconst c = 3;\n');
  });

  it('should register conflict when auto-merge fails (same line modified)', async () => {
    const filePath = join(tmpDir, 'am-conflict.ts');
    const baseContent = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
    await writeFile(filePath, baseContent, 'utf8');
    const baseHash = (await computeFileHash(filePath))!;

    // External modifies line 1 (same line as agent's patch)
    await writeFile(filePath, 'const a = 999;\nconst b = 2;\nconst c = 3;\n', 'utf8');

    // Agent patch also modifies line 1 (full replacement, no range)
    const patch = {
      id: 'p-am-conflict-1',
      filePath,
      baseHash,
      operations: [{
        text: 'const a = 100;\nconst b = 200;\nconst c = 300;\n',
        filePath
      }],
      author: 'agent',
      riskLevel: 'medium' as const,
      createdAt: Date.now()
    };

    const result = await applyPatchWithConflictCheck(patch, broker);
    expect(result.success).toBe(false);
    expect(result.conflict).toBeDefined();
    expect(broker.listConflicts()).toHaveLength(1);
  });

  it('should apply directly when no hash mismatch (no conflict)', async () => {
    const filePath = join(tmpDir, 'am-no-conflict.ts');
    const baseContent = 'const a = 1;\nconst b = 2;\n';
    await writeFile(filePath, baseContent, 'utf8');
    const baseHash = (await computeFileHash(filePath))!;

    // No external modification — hash matches
    const patch = {
      id: 'p-no-conflict-1',
      filePath,
      baseHash,
      operations: [{
        text: 'const a = 100;\n',
        filePath,
        range: { startLine: 1, startCol: 1, endLine: 1, endCol: 14 }
      }],
      author: 'agent',
      riskLevel: 'low' as const,
      createdAt: Date.now()
    };

    const result = await applyPatchWithConflictCheck(patch, broker);
    expect(result.success).toBe(true);
    expect(result.autoMerged).toBeUndefined(); // Not auto-merged, direct apply
    expect(broker.listConflicts()).toHaveLength(0);
  });
});
