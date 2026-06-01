import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { beforeEach, describe, expect, it } from 'vitest';

import { createWorkspaceService } from '@agentdeck/services';

describe('WorkspaceService Windows path quirks and nested excludes', () => {
  let base: string;

  beforeEach(async () => {
    base = join(tmpdir(), `agentdeck-globs-win-${Date.now().toString()}`);
    await mkdir(base, { recursive: true });
  });

  it('matches patterns using backslashes and is case-insensitive', async () => {
    const sub = join(base, 'SubDir');
    await mkdir(sub, { recursive: true });
    const file = join(sub, 'WiN.TXT');
    await writeFile(file, 'win content', 'utf8');

    const svc = createWorkspaceService(base);
    const r1 = await svc.searchFiles({ pattern: 'win', include: 'SubDir\\WiN.TXT', workspaceRoots: [base] });
    const r2 = await svc.searchFiles({ pattern: 'win', include: 'subdir/win.txt', workspaceRoots: [base] });

    expect(r1.some(x => x.file.endsWith('WiN.TXT'))).toBe(true);
    expect(r2.some(x => x.file.endsWith('WiN.TXT'))).toBe(true);
  });

  it('supports nested exclude patterns to only exclude deep folders', async () => {
    const a = join(base, 'a');
    const b = join(a, 'b');
    const c = join(b, 'c');
    await mkdir(c, { recursive: true });
    const keep = join(a, 'keep.txt');
    const bfile = join(b, 'bfile.txt');
    const cfile = join(c, 'cfile.txt');
    await writeFile(keep, 'keep content', 'utf8');
    await writeFile(bfile, 'b content', 'utf8');
    await writeFile(cfile, 'c content', 'utf8');

    const svc = createWorkspaceService(base);
    const res = await svc.searchFiles({ pattern: 'content', include: 'a/*.txt,a/**/*.txt', exclude: 'a/**/c/**', workspaceRoots: [base] });

    expect(res.some(x => x.file.endsWith('keep.txt'))).toBe(true);
    expect(res.some(x => x.file.endsWith('bfile.txt'))).toBe(true);
    expect(res.some(x => x.file.endsWith('cfile.txt'))).toBe(false);
  });
});
