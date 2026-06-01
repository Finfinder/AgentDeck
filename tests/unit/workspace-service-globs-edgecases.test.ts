import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { beforeEach, describe, expect, it } from 'vitest';

import { createWorkspaceService } from '@agentdeck/services';

describe('WorkspaceService glob edge-cases', () => {
  let base: string;

  beforeEach(async () => {
    base = join(tmpdir(), `agentdeck-globs-ec-${Date.now().toString()}`);
    await mkdir(base, { recursive: true });
  });

  it('accepts patterns with leading ./ and / equivalently', async () => {
    const one = join(base, 'one.md');
    const two = join(base, 'two.txt');
    await writeFile(one, 'Hello', 'utf8');
    await writeFile(two, 'Hello', 'utf8');

    const svc = createWorkspaceService(base);
    const r1 = await svc.searchFiles({ pattern: 'hello', include: './one.md', workspaceRoots: [base] });
    const r2 = await svc.searchFiles({ pattern: 'hello', include: '/two.txt', workspaceRoots: [base] });

    expect(r1.some(x => x.file.endsWith('one.md'))).toBe(true);
    expect(r2.some(x => x.file.endsWith('two.txt'))).toBe(true);
  });

  it('supports ? wildcard for single-character matches', async () => {
    const a1 = join(base, 'a1.txt');
    const ab = join(base, 'ab.txt');
    await writeFile(a1, 'Hello', 'utf8');
    await writeFile(ab, 'Hello', 'utf8');

    const svc = createWorkspaceService(base);
    const res = await svc.searchFiles({ pattern: 'hello', include: '?1.txt', workspaceRoots: [base] });

    expect(res.some(x => x.file.endsWith('a1.txt'))).toBe(true);
    expect(res.some(x => x.file.endsWith('ab.txt'))).toBe(false);
  });

  it('excludes files even if include matches (exclude precedence)', async () => {
    const keep = join(base, 'keep.txt');
    const ign = join(base, 'ignore.txt');
    await writeFile(keep, 'Hey', 'utf8');
    await writeFile(ign, 'Hey', 'utf8');

    const svc = createWorkspaceService(base);
    const res = await svc.searchFiles({ pattern: 'hey', include: '*.txt', exclude: 'ignore.txt', workspaceRoots: [base] });

    expect(res.some(x => x.file.endsWith('keep.txt'))).toBe(true);
    expect(res.some(x => x.file.endsWith('ignore.txt'))).toBe(false);
  });

  it('treats literal special characters in patterns literally (escaped)', async () => {
    const special = join(base, 'file[1].txt');
    await writeFile(special, 'Hi', 'utf8');

    const svc = createWorkspaceService(base);
    const res = await svc.searchFiles({ pattern: 'hi', include: 'file[1].txt', workspaceRoots: [base] });

    expect(res.some(x => x.file.endsWith('file[1].txt'))).toBe(true);
  });
});
