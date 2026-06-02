import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { beforeEach, describe, expect, it } from 'vitest';

import { createWorkspaceService } from '@agentdeck/services';

describe('WorkspaceService search include/exclude globs', () => {
  let base: string;

  beforeEach(async () => {
    base = join(tmpdir(), `agentdeck-globs-${Date.now().toString()}`);
    await mkdir(base, { recursive: true });
  });

  it('respects include patterns (single glob)', async () => {
    const fileA = join(base, 'match.txt');
    const fileB = join(base, 'other.md');
    await writeFile(fileA, 'Hello match', 'utf8');
    await writeFile(fileB, 'Hello match', 'utf8');

    const svc = createWorkspaceService(base);
    const res = await svc.searchFiles({ pattern: 'hello', include: '*.txt', workspaceRoots: [base] });

    expect(res.some(r => r.file.endsWith('match.txt'))).toBe(true);
    expect(res.some(r => r.file.endsWith('other.md'))).toBe(false);
  });

  it('respects exclude patterns (directory)', async () => {
    const sub = join(base, 'subdir');
    await mkdir(sub, { recursive: true });
    const a = join(sub, 'a.txt');
    const b = join(base, 'b.txt');
    await writeFile(a, 'Hello', 'utf8');
    await writeFile(b, 'Hello', 'utf8');

    const svc = createWorkspaceService(base);
    const res = await svc.searchFiles({ pattern: 'hello', exclude: 'subdir/**', workspaceRoots: [base] });

    expect(res.some(r => r.file.endsWith('b.txt'))).toBe(true);
    expect(res.some(r => r.file.includes('subdir'))).toBe(false);
  });

  it('supports multiple include globs (comma separated)', async () => {
    const a = join(base, 'one.md');
    const b = join(base, 'two.txt');
    await writeFile(a, 'Hello', 'utf8');
    await writeFile(b, 'Hello', 'utf8');

    const svc = createWorkspaceService(base);
    const res = await svc.searchFiles({ pattern: 'hello', include: '*.md,*.txt', workspaceRoots: [base] });

    expect(res.some(r => r.file.endsWith('one.md'))).toBe(true);
    expect(res.some(r => r.file.endsWith('two.txt'))).toBe(true);
  });
});
