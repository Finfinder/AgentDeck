import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, writeFile as fsWriteFile, readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  clearBuffers,
  readEditorFile,
  writeEditorFile,
  createEditorFile,
  applyWorkspaceEdit,
  showDiff,
  getDiagnostics,
  resolveLanguage,
  createEditorTab,
  markBufferDirty,
  getBufferDirty,
  closeBuffer,
  getOpenBuffers
} from '@agentdeck/services';

let tmp: string;

describe('EditorService I/O operations', () => {
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'agentdeck-editor-'));
    clearBuffers();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
    clearBuffers();
  });

  describe('readEditorFile', () => {
    it('reads a file and stores it in the buffer', async () => {
      const filePath = join(tmp, 'test.ts');
      await fsWriteFile(filePath, 'const x = 1;\n', 'utf8');

      const result = await readEditorFile(filePath);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.content).toBe('const x = 1;\n');
        expect(result.encoding).toBe('utf8');
      }
    });

    it('returns FILE_NOT_FOUND for non-existent file', async () => {
      const result = await readEditorFile(join(tmp, 'nonexistent.ts'));
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('FILE_NOT_FOUND');
        expect(result.message).toContain('File not found');
      }
    });

    it('tracks open buffers after reading a file', async () => {
      const filePath = join(tmp, 'tracked.ts');
      await fsWriteFile(filePath, 'content', 'utf8');

      await readEditorFile(filePath);
      const buffers = getOpenBuffers();
      expect(buffers).toContain(filePath);
    });

    it('updates buffer on subsequent reads', async () => {
      const filePath = join(tmp, 'update.ts');
      await fsWriteFile(filePath, 'v1', 'utf8');
      await readEditorFile(filePath);

      await fsWriteFile(filePath, 'v2', 'utf8');
      const result = await readEditorFile(filePath);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.content).toBe('v2');
      }
    });
  });

  describe('writeEditorFile', () => {
    it('writes content to an existing file', async () => {
      const filePath = join(tmp, 'write-target.ts');
      await fsWriteFile(filePath, 'original', 'utf8');
      await readEditorFile(filePath);

      const result = await writeEditorFile(filePath, 'modified');
      expect(result.status).toBe('ok');

      const diskContent = await fsReadFile(filePath, 'utf8');
      expect(diskContent).toBe('modified');
    });

    it('returns WRITE_CONFLICT when file changed on disk', async () => {
      const filePath = join(tmp, 'conflict.ts');
      await fsWriteFile(filePath, 'original', 'utf8');
      await readEditorFile(filePath);

      // Another process modifies the file
      await fsWriteFile(filePath, 'external-change', 'utf8');

      const result = await writeEditorFile(filePath, 'my-change');
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('WRITE_CONFLICT');
        expect(result.message).toContain('modified on disk');
      }
    });

    it('allows write when file was deleted on disk after read', async () => {
      const filePath = join(tmp, 'deleted.ts');
      await fsWriteFile(filePath, 'original', 'utf8');
      await readEditorFile(filePath);

      // Delete the file externally
      await rm(filePath);

      // Should allow write (recreate)
      const result = await writeEditorFile(filePath, 'recreated');
      expect(result.status).toBe('ok');
    });

    it('clears dirty flag after successful write', async () => {
      const filePath = join(tmp, 'dirty-clear.ts');
      await fsWriteFile(filePath, 'original', 'utf8');
      await readEditorFile(filePath);
      markBufferDirty(filePath);

      expect(getBufferDirty(filePath)).toBe(true);

      await writeEditorFile(filePath, 'new content');
      expect(getBufferDirty(filePath)).toBe(false);
    });
  });

  describe('createEditorFile', () => {
    it('creates a new file with content', async () => {
      const filePath = join(tmp, 'new-file.ts');
      const result = await createEditorFile(filePath, 'new content');
      expect(result.status).toBe('ok');

      const diskContent = await fsReadFile(filePath, 'utf8');
      expect(diskContent).toBe('new content');
    });

    it('returns WRITE_CONFLICT when file already exists', async () => {
      const filePath = join(tmp, 'existing.ts');
      await fsWriteFile(filePath, 'already here', 'utf8');

      const result = await createEditorFile(filePath, 'new content');
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('WRITE_CONFLICT');
        expect(result.message).toContain('already exists');
      }
    });

    it('stores buffer after creating file', async () => {
      const filePath = join(tmp, 'buffered-new.ts');
      await createEditorFile(filePath, 'hello');

      const buffers = getOpenBuffers();
      expect(buffers).toContain(filePath);
    });
  });

  describe('applyWorkspaceEdit with range', () => {
    it('applies a range edit to a loaded buffer', async () => {
      const filePath = join(tmp, 'range-edit.ts');
      await fsWriteFile(filePath, 'line1\nline2\nline3\n', 'utf8');
      await readEditorFile(filePath);

      const result = await applyWorkspaceEdit({
        operations: [{
          filePath,
          text: 'LINE2',
          range: { startLine: 2, startCol: 1, endLine: 2, endCol: 6 }
        }]
      });

      expect(result.status).toBe('ok');
      const diskContent = await fsReadFile(filePath, 'utf8');
      expect(diskContent).toBe('line1\nLINE2\nline3\n');
    });

    it('replaces entire file when no range specified', async () => {
      const filePath = join(tmp, 'full-replace.ts');
      await fsWriteFile(filePath, 'old content', 'utf8');
      await readEditorFile(filePath);

      const result = await applyWorkspaceEdit({
        operations: [{ filePath, text: 'completely new' }]
      });

      expect(result.status).toBe('ok');
      const diskContent = await fsReadFile(filePath, 'utf8');
      expect(diskContent).toBe('completely new');
    });

    it('returns WRITE_CONFLICT when file changed on disk during edit', async () => {
      const filePath = join(tmp, 'edit-conflict.ts');
      await fsWriteFile(filePath, 'original', 'utf8');
      await readEditorFile(filePath);

      // External modification
      await fsWriteFile(filePath, 'changed externally', 'utf8');

      const result = await applyWorkspaceEdit({
        operations: [{ filePath, text: 'my edit' }]
      });

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('WRITE_CONFLICT');
      }
    });

    it('allows edit when file was deleted on disk', async () => {
      const filePath = join(tmp, 'edit-deleted.ts');
      await fsWriteFile(filePath, 'original', 'utf8');
      await readEditorFile(filePath);

      await rm(filePath);

      const result = await applyWorkspaceEdit({
        operations: [{ filePath, text: 'recreated content' }]
      });

      expect(result.status).toBe('ok');
    });

    it('applies multiple operations in sequence', async () => {
      const file1 = join(tmp, 'multi1.ts');
      const file2 = join(tmp, 'multi2.ts');
      await fsWriteFile(file1, 'file1 content', 'utf8');
      await fsWriteFile(file2, 'file2 content', 'utf8');
      await readEditorFile(file1);
      await readEditorFile(file2);

      const result = await applyWorkspaceEdit({
        operations: [
          { filePath: file1, text: 'updated file1' },
          { filePath: file2, text: 'updated file2' }
        ]
      });

      expect(result.status).toBe('ok');
      expect(await fsReadFile(file1, 'utf8')).toBe('updated file1');
      expect(await fsReadFile(file2, 'utf8')).toBe('updated file2');
    });
  });

  describe('showDiff edge cases', () => {
    it('generates diff with additions only', () => {
      const result = showDiff('line1\nline3', 'line1\nline2\nline3');
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.diff).toContain('+line2');
      }
    });

    it('generates diff with deletions only', () => {
      const result = showDiff('line1\nline2\nline3', 'line1\nline3');
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.diff).toContain('-line2');
      }
    });

    it('generates diff with both additions and deletions', () => {
      const result = showDiff('a\nb\nc', 'a\nx\nc');
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.diff).toContain('-b');
        expect(result.diff).toContain('+x');
      }
    });

    it('handles empty original content', () => {
      const result = showDiff('', 'new content');
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.diff).toContain('+new content');
      }
    });

    it('handles empty modified content', () => {
      const result = showDiff('old content', '');
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.diff).toContain('-old content');
      }
    });

    it('handles completely different content', () => {
      const result = showDiff('aaa\nbbb', 'xxx\nyyy\nzzz');
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.diff).toContain('--- original');
        expect(result.diff).toContain('+++ modified');
      }
    });
  });

  describe('getDiagnostics', () => {
    it('returns empty array (stub)', async () => {
      const result = await getDiagnostics();
      expect(result).toEqual([]);
    });
  });

  describe('resolveLanguage edge cases', () => {
    it('resolves Dockerfile by exact name', () => {
      expect(resolveLanguage('Dockerfile')).toBe('dockerfile');
      expect(resolveLanguage('dockerfile')).toBe('dockerfile');
    });

    it('resolves Makefile by exact name', () => {
      expect(resolveLanguage('Makefile')).toBe('plaintext');
      expect(resolveLanguage('makefile')).toBe('plaintext');
      expect(resolveLanguage('GNUmakefile')).toBe('plaintext');
    });

    it('resolves Dockerfile in a path', () => {
      expect(resolveLanguage('/project/Dockerfile')).toBe('dockerfile');
    });

    it('resolves .py to python', () => {
      expect(resolveLanguage('script.py')).toBe('python');
    });

    it('resolves .cs to csharp', () => {
      expect(resolveLanguage('Program.cs')).toBe('csharp');
    });

    it('resolves .html to html', () => {
      expect(resolveLanguage('index.html')).toBe('html');
    });

    it('resolves .css to css', () => {
      expect(resolveLanguage('styles.css')).toBe('css');
    });

    it('resolves .scss to scss', () => {
      expect(resolveLanguage('styles.scss')).toBe('scss');
    });

    it('resolves .cpp to cpp', () => {
      expect(resolveLanguage('main.cpp')).toBe('cpp');
    });

    it('resolves .h to c', () => {
      expect(resolveLanguage('header.h')).toBe('c');
    });

    it('resolves .jsonc to json', () => {
      expect(resolveLanguage('config.jsonc')).toBe('json');
    });

    it('resolves .ipynb to json', () => {
      expect(resolveLanguage('notebook.ipynb')).toBe('json');
    });

    it('handles mixed case extensions', () => {
      expect(resolveLanguage('file.PY')).toBe('python');
      expect(resolveLanguage('file.CS')).toBe('csharp');
    });
  });

  describe('createEditorTab with reveal params', () => {
    it('creates tab with reveal line and col', () => {
      const tab = createEditorTab('/src/app.ts', 10, 5);
      expect(tab.revealLine).toBe(10);
      expect(tab.revealCol).toBe(5);
    });

    it('creates tab with reveal pattern', () => {
      const tab = createEditorTab('/src/app.ts', undefined, undefined, 'function');
      expect(tab.revealPattern).toBe('function');
    });

    it('creates tab with reveal nonce', () => {
      const tab = createEditorTab('/src/app.ts', undefined, undefined, undefined, 42);
      expect(tab.revealNonce).toBe(42);
    });

    it('creates tab with null reveal defaults', () => {
      const tab = createEditorTab('/src/app.ts');
      expect(tab.revealLine).toBeNull();
      expect(tab.revealCol).toBeNull();
      expect(tab.revealPattern).toBeNull();
      expect(tab.revealNonce).toBe(0);
    });
  });

  describe('buffer lifecycle', () => {
    it('closeBuffer removes buffer from open list', async () => {
      const filePath = join(tmp, 'close-me.ts');
      await fsWriteFile(filePath, 'content', 'utf8');
      await readEditorFile(filePath);

      expect(getOpenBuffers()).toContain(filePath);
      closeBuffer(filePath);
      expect(getOpenBuffers()).not.toContain(filePath);
    });

    it('markBufferDirty sets dirty flag on existing buffer', async () => {
      const filePath = join(tmp, 'dirty.ts');
      await fsWriteFile(filePath, 'content', 'utf8');
      await readEditorFile(filePath);

      markBufferDirty(filePath);
      expect(getBufferDirty(filePath)).toBe(true);
    });

    it('markBufferDirty is no-op for unknown buffer', () => {
      markBufferDirty('/unknown/path.ts');
      expect(getBufferDirty('/unknown/path.ts')).toBe(false);
    });

    it('clearBuffers removes all buffers', async () => {
      const f1 = join(tmp, 'f1.ts');
      const f2 = join(tmp, 'f2.ts');
      await fsWriteFile(f1, 'a', 'utf8');
      await fsWriteFile(f2, 'b', 'utf8');
      await readEditorFile(f1);
      await readEditorFile(f2);

      expect(getOpenBuffers().length).toBe(2);
      clearBuffers();
      expect(getOpenBuffers().length).toBe(0);
    });
  });
});
