import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createWorkspaceService, isSensitivePath, parseCodeWorkspace, stripJsoncComments } from '@agentdeck/services';

// ??? stripJsoncComments ??????????????????????????????????????

describe('stripJsoncComments', () => {
  it('leaves plain JSON unchanged', () => {
    const input = '{"a": 1, "b": "hello"}';
    expect(stripJsoncComments(input)).toBe(input);
  });

  it('strips single-line comments', () => {
    const input = '{\n  // a comment\n  "key": "value"\n}';
    const result = stripJsoncComments(input);
    expect(result).not.toContain('// a comment');
    expect(result).toContain('"key": "value"');
  });

  it('strips block comments', () => {
    const input = '{ /* block comment */ "key": 1 }';
    const result = stripJsoncComments(input);
    expect(result).not.toContain('block comment');
    expect(result).toContain('"key": 1');
  });

  it('does not strip // inside a string value', () => {
    const input = '{"url": "https://example.com"}';
    expect(stripJsoncComments(input)).toBe(input);
  });

  it('removes trailing commas before }', () => {
    const input = '{"a": 1,}';
    const result = stripJsoncComments(input);
    expect(result).toBe('{"a": 1}');
  });

  it('removes trailing commas before ]', () => {
    const input = '[1, 2, 3,]';
    expect(stripJsoncComments(input)).toBe('[1, 2, 3]');
  });

  it('handles escape sequences inside strings', () => {
    const input = '{"path": "C:\\\\Users\\\\test"}';
    expect(stripJsoncComments(input)).toBe(input);
  });
});

// ??? parseCodeWorkspace ??????????????????????????????????????

describe('parseCodeWorkspace', () => {
  it('parses a minimal valid .code-workspace', () => {
    const text = `{
  "folders": [
    { "path": "./src" }
  ]
}`;
    const model = parseCodeWorkspace(text, '/projects/my.code-workspace');
    expect(model.status).toBe('ok');
    if (model.status !== 'ok') return;
    expect(model.kind).toBe('workspace-file');
    expect(model.folders).toHaveLength(1);
    // path should be resolved relative to the workspace file directory
    expect(model.folders[0]?.path).toContain('src');
  });

  it('parses JSONC with comments', () => {
    const text = `{
  // Main folders
  "folders": [
    { "path": "." /* root */ }
  ]
}`;
    const model = parseCodeWorkspace(text, '/projects/my.code-workspace');
    expect(model.status).toBe('ok');
  });

  it('preserves the optional name field', () => {
    const text = `{"folders": [{"path": ".", "name": "MyRoot"}]}`;
    const model = parseCodeWorkspace(text, '/projects/my.code-workspace');
    expect(model.status).toBe('ok');
    if (model.status !== 'ok') return;
    expect(model.folders[0]?.name).toBe('MyRoot');
  });

  it('returns INVALID_JSONC for malformed JSON', () => {
    const model = parseCodeWorkspace('{ broken json', '/projects/x.code-workspace');
    expect(model.status).toBe('error');
    if (model.status !== 'error') return;
    expect(model.code).toBe('INVALID_JSONC');
  });

  it('returns EMPTY_WORKSPACE when folders array is missing', () => {
    const model = parseCodeWorkspace('{"settings": {}}', '/projects/x.code-workspace');
    expect(model.status).toBe('error');
    if (model.status !== 'error') return;
    expect(model.code).toBe('EMPTY_WORKSPACE');
  });

  it('returns EMPTY_WORKSPACE when folders array is empty', () => {
    const model = parseCodeWorkspace('{"folders": []}', '/projects/x.code-workspace');
    expect(model.status).toBe('error');
    if (model.status !== 'error') return;
    expect(model.code).toBe('EMPTY_WORKSPACE');
  });

  it('resolves relative paths correctly', () => {
    const model = parseCodeWorkspace('{"folders": [{"path": "../sibling"}]}', '/home/user/proj/my.code-workspace');
    expect(model.status).toBe('ok');
    if (model.status !== 'ok') return;
    expect(model.folders[0]?.path).toContain('sibling');
    expect(model.folders[0]?.path).not.toContain('..');
  });
});

// ??? isSensitivePath ?????????????????????????????????????????

describe('isSensitivePath', () => {
  it('marks .env as sensitive', () => {
    expect(isSensitivePath('/project/.env')).toBe(true);
  });

  it('marks .env.local as sensitive', () => {
    expect(isSensitivePath('/project/.env.local')).toBe(true);
  });

  it('marks *.key as sensitive', () => {
    expect(isSensitivePath('/certs/server.key')).toBe(true);
  });

  it('marks *.pem as sensitive', () => {
    expect(isSensitivePath('/certs/server.pem')).toBe(true);
  });

  it('marks .ssh/id_rsa as sensitive', () => {
    expect(isSensitivePath('/home/user/.ssh/id_rsa')).toBe(true);
  });

  it('marks .aws/ paths as sensitive', () => {
    expect(isSensitivePath('/home/user/.aws/credentials')).toBe(true);
  });

  it('does not mark a normal source file as sensitive', () => {
    expect(isSensitivePath('/project/src/index.ts')).toBe(false);
  });

  it('does not mark a README as sensitive', () => {
    expect(isSensitivePath('/project/README.md')).toBe(false);
  });
});

// ??? WorkspaceService ????????????????????????????????????????

describe('WorkspaceService', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `agentdeck-test-${Date.now().toString()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('getRecentWorkspaces', () => {
    it('returns an empty array when no recent file exists', async () => {
      const service = createWorkspaceService(tmpDir);
      const recents = await service.getRecentWorkspaces();
      expect(recents).toEqual([]);
    });

    it('saves and retrieves a recent workspace entry', async () => {
      const workspacePath = join(tmpDir, 'my.code-workspace');
      await writeFile(
        workspacePath,
        JSON.stringify({ folders: [{ path: '.' }] }),
        'utf8'
      );

      const service = createWorkspaceService(tmpDir);
      await service.openWorkspace(workspacePath, 'workspace-file');

      const recents = await service.getRecentWorkspaces();
      expect(recents.length).toBeGreaterThan(0);
      expect(recents[0]?.path).toBe(workspacePath);
      expect(recents[0]?.kind).toBe('workspace-file');
    });
  });

  describe('listDirectory', () => {
    it('returns directory entries sorted dirs first', async () => {
      const subDir = join(tmpDir, 'subdir');
      await mkdir(subDir);
      await writeFile(join(tmpDir, 'file.txt'), 'hello', 'utf8');

      const service = createWorkspaceService(tmpDir);
      const listing = await service.listDirectory(tmpDir);

      expect(listing.path).toBe(tmpDir);
      expect(listing.entries.length).toBeGreaterThanOrEqual(2);

      const dirs = listing.entries.filter(e => e.kind === 'directory');
      const files = listing.entries.filter(e => e.kind === 'file');
      expect(dirs.length).toBeGreaterThan(0);
      expect(files.length).toBeGreaterThan(0);

      // directories come before files
      const firstFileIdx = listing.entries.findIndex(e => e.kind === 'file');
      const lastDirIdx = listing.entries.map(e => e.kind).lastIndexOf('directory');
      if (firstFileIdx !== -1 && lastDirIdx !== -1) {
        expect(lastDirIdx).toBeLessThan(firstFileIdx);
      }
    });

    it('returns an empty array for an empty directory', async () => {
      const empty = join(tmpDir, 'empty');
      await mkdir(empty);
      const service = createWorkspaceService(tmpDir);
      const listing = await service.listDirectory(empty);
      expect(listing.entries).toEqual([]);
    });

    it('returns empty entries for a nonexistent path', async () => {
      const service = createWorkspaceService(tmpDir);
      const listing = await service.listDirectory(join(tmpDir, 'nonexistent'));
      expect(listing.entries).toEqual([]);
    });

    it('marks sensitive files correctly', async () => {
      await writeFile(join(tmpDir, '.env'), 'SECRET=123', 'utf8');
      const service = createWorkspaceService(tmpDir);
      const listing = await service.listDirectory(tmpDir);
      const envEntry = listing.entries.find(e => e.name === '.env');
      expect(envEntry?.isSensitive).toBe(true);
    });
  });

  describe('openWorkspace', () => {
    it('returns ok model for a valid workspace file', async () => {
      const workspacePath = join(tmpDir, 'test.code-workspace');
      await writeFile(workspacePath, '{"folders": [{"path": "."}]}', 'utf8');

      const service = createWorkspaceService(tmpDir);
      const model = await service.openWorkspace(workspacePath, 'workspace-file');

      expect(model.status).toBe('ok');
      service.closeWorkspace();
    });

    it('returns FILE_NOT_FOUND for missing workspace file', async () => {
      const service = createWorkspaceService(tmpDir);
      const model = await service.openWorkspace(join(tmpDir, 'missing.code-workspace'), 'workspace-file');

      expect(model.status).toBe('error');
      if (model.status !== 'error') return;
      expect(model.code).toBe('FILE_NOT_FOUND');
    });

    it('returns ok model for a folder workspace', async () => {
      const service = createWorkspaceService(tmpDir);
      const model = await service.openWorkspace(tmpDir, 'folder');

      expect(model.status).toBe('ok');
      if (model.status !== 'ok') return;
      expect(model.kind).toBe('folder');
      expect(model.folders[0]?.path).toBe(tmpDir);
      service.closeWorkspace();
    });
  });

  describe('searchFiles', () => {
    it('finds a pattern in a file', async () => {
      await writeFile(join(tmpDir, 'hello.txt'), 'Hello, World!\nAnother line', 'utf8');

      const service = createWorkspaceService(tmpDir);
      const results = await service.searchFiles({ pattern: 'hello', workspaceRoots: [tmpDir] });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.file).toContain('hello.txt');
      expect(results[0]?.line).toBe(1);
    });

    it('returns empty array when no match', async () => {
      await writeFile(join(tmpDir, 'nope.txt'), 'Nothing here', 'utf8');

      const service = createWorkspaceService(tmpDir);
      const results = await service.searchFiles({ pattern: 'xyzzy', workspaceRoots: [tmpDir] });

      expect(results).toEqual([]);
    });
  });
});
