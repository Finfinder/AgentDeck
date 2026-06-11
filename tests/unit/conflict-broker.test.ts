import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ConflictBroker,
  computeFileHash,
  checkPatchConflict,
  classifyPatchRisk,
  generatePatchId
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
