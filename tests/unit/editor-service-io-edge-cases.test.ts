import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearBuffers,
  closeBuffer,
  createEditorTab,
  getBufferDirty,
  getOpenBuffers,
  markBufferDirty,
  readEditorFile,
  resolveLanguage,
  writeEditorFile
} from '@agentdeck/services';

let tempDir: string | null = null;

describe('EditorService I/O edge cases', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agentdeck-editor-'));
    clearBuffers();
  });

  afterEach(async () => {
    clearBuffers();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  describe('readEditorFile', () => {
    it('reads a valid file successfully', async () => {
      const filePath = join(tempDir!, 'test.ts');
      await writeFile(filePath, 'const x = 1;', 'utf8');

      const result = await readEditorFile(filePath);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.content).toBe('const x = 1;');
        expect(result.encoding).toBe('utf8');
      }
    });

    it('returns FILE_NOT_FOUND for missing file', async () => {
      const result = await readEditorFile(join(tempDir!, 'nonexistent.ts'));
      expect(result).toEqual({
        status: 'error',
        code: 'FILE_NOT_FOUND',
        message: `File not found: ${join(tempDir!, 'nonexistent.ts')}`
      });
    });

    it('tracks buffer after reading', async () => {
      const filePath = join(tempDir!, 'tracked.ts');
      await writeFile(filePath, 'content', 'utf8');

      await readEditorFile(filePath);
      expect(getOpenBuffers()).toContain(filePath);
      expect(getBufferDirty(filePath)).toBe(false);
    });

    it('reads empty file', async () => {
      const filePath = join(tempDir!, 'empty.ts');
      await writeFile(filePath, '', 'utf8');

      const result = await readEditorFile(filePath);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.content).toBe('');
      }
    });

    it('reads file with unicode content', async () => {
      const filePath = join(tempDir!, 'unicode.ts');
      const content = '// Komentarz po polsku: ¹æê³óœ¿Ÿ\nconst emoji = "??";';
      await writeFile(filePath, content, 'utf8');

      const result = await readEditorFile(filePath);
      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.content).toBe(content);
      }
    });
  });

  describe('writeEditorFile', () => {
    it('writes content to a new file', async () => {
      const filePath = join(tempDir!, 'output.ts');
      const result = await writeEditorFile(filePath, 'const y = 2;');
      expect(result.status).toBe('ok');

      const diskContent = await readFile(filePath, 'utf8');
      expect(diskContent).toBe('const y = 2;');
    });

    it('overwrites existing file', async () => {
      const filePath = join(tempDir!, 'overwrite.ts');
      await writeFile(filePath, 'old content', 'utf8');

      const result = await writeEditorFile(filePath, 'new content');
      expect(result.status).toBe('ok');

      const diskContent = await readFile(filePath, 'utf8');
      expect(diskContent).toBe('new content');
    });

    it('detects write conflict when file changed on disk', async () => {
      const filePath = join(tempDir!, 'conflict.ts');
      await writeFile(filePath, 'original', 'utf8');

      // Read file to populate buffer
      await readEditorFile(filePath);

      // Modify file on disk externally
      await writeFile(filePath, 'modified externally', 'utf8');

      // Try to write — should detect conflict
      const result = await writeEditorFile(filePath, 'my changes');
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('WRITE_CONFLICT');
        expect(result.message).toContain('modified on disk');
      }
    });

    it('allows write when file was deleted on disk (recreate)', async () => {
      const filePath = join(tempDir!, 'recreate.ts');
      await writeFile(filePath, 'original', 'utf8');

      // Read file to populate buffer
      await readEditorFile(filePath);

      // Delete file on disk
      await rm(filePath);

      // Write should succeed (recreate)
      const result = await writeEditorFile(filePath, 'recreated');
      expect(result.status).toBe('ok');

      const diskContent = await readFile(filePath, 'utf8');
      expect(diskContent).toBe('recreated');
    });

    it('clears dirty flag after successful write', async () => {
      const filePath = join(tempDir!, 'dirty.ts');
      await writeFile(filePath, 'original', 'utf8');

      await readEditorFile(filePath);
      markBufferDirty(filePath);
      expect(getBufferDirty(filePath)).toBe(true);

      await writeEditorFile(filePath, 'updated');
      expect(getBufferDirty(filePath)).toBe(false);
    });
  });

  describe('buffer management', () => {
    it('closeBuffer removes buffer from tracking', async () => {
      const filePath = join(tempDir!, 'close.ts');
      await writeFile(filePath, 'content', 'utf8');

      await readEditorFile(filePath);
      expect(getOpenBuffers()).toContain(filePath);

      closeBuffer(filePath);
      expect(getOpenBuffers()).not.toContain(filePath);
    });

    it('clearBuffers removes all buffers', async () => {
      const file1 = join(tempDir!, 'file1.ts');
      const file2 = join(tempDir!, 'file2.ts');
      await writeFile(file1, 'a', 'utf8');
      await writeFile(file2, 'b', 'utf8');

      await readEditorFile(file1);
      await readEditorFile(file2);
      expect(getOpenBuffers().length).toBe(2);

      clearBuffers();
      expect(getOpenBuffers().length).toBe(0);
    });

    it('markBufferDirty only affects existing buffers', () => {
      // Should not throw for unknown path
      expect(() => markBufferDirty('/nonexistent/file.ts')).not.toThrow();
      expect(getBufferDirty('/nonexistent/file.ts')).toBe(false);
    });
  });

  describe('createEditorTab edge cases', () => {
    it('creates tab with reveal properties', () => {
      const tab = createEditorTab('/src/app.ts', 42, 10, 'function');
      expect(tab.revealLine).toBe(42);
      expect(tab.revealCol).toBe(10);
      expect(tab.revealPattern).toBe('function');
    });

    it('creates tab without reveal properties', () => {
      const tab = createEditorTab('/src/app.ts');
      expect(tab.revealLine).toBeNull();
      expect(tab.revealCol).toBeNull();
      expect(tab.revealPattern).toBeNull();
      expect(tab.revealNonce).toBe(0);
    });

    it('creates tab with custom revealNonce', () => {
      const tab = createEditorTab('/src/app.ts', 1, 1, 'test', 5);
      expect(tab.revealNonce).toBe(5);
    });

    it('handles Windows-style paths', () => {
      const tab = createEditorTab('C:\\Users\\Rafal\\app.ts');
      expect(tab.fileName).toBe('app.ts');
      expect(tab.filePath).toBe('C:\\Users\\Rafal\\app.ts');
    });

    it('handles file with multiple dots', () => {
      const tab = createEditorTab('/src/app.test.ts');
      expect(tab.fileName).toBe('app.test.ts');
      expect(tab.language).toBe('typescript');
    });

    it('handles file with no extension', () => {
      const tab = createEditorTab('/src/Makefile');
      expect(tab.fileName).toBe('Makefile');
      expect(tab.language).toBe('plaintext');
    });

    it('handles dotfile', () => {
      const tab = createEditorTab('/src/.env');
      expect(tab.fileName).toBe('.env');
      expect(tab.language).toBe('plaintext');
    });
  });

  describe('resolveLanguage edge cases', () => {
    it('handles .mts and .cts extensions', () => {
      expect(resolveLanguage('file.mts')).toBe('typescript');
      expect(resolveLanguage('file.cts')).toBe('typescript');
    });

    it('handles .mjs and .cjs extensions', () => {
      expect(resolveLanguage('file.mjs')).toBe('javascript');
      expect(resolveLanguage('file.cjs')).toBe('javascript');
    });

    it('handles .yml extension', () => {
      expect(resolveLanguage('file.yml')).toBe('yaml');
    });

    it('handles .markdown extension', () => {
      expect(resolveLanguage('file.markdown')).toBe('markdown');
    });

    it('handles .psm1 and .psd1 extensions', () => {
      expect(resolveLanguage('file.psm1')).toBe('powershell');
      expect(resolveLanguage('file.psd1')).toBe('powershell');
    });

    it('returns plaintext for unknown extensions', () => {
      expect(resolveLanguage('file.rs')).toBe('plaintext');
      expect(resolveLanguage('file.go')).toBe('plaintext');
    });

    it('returns python for .py extension', () => {
      expect(resolveLanguage('file.py')).toBe('python');
    });

    it('handles mixed case extensions', () => {
      expect(resolveLanguage('file.TSX')).toBe('typescript');
      expect(resolveLanguage('file.JSX')).toBe('javascript');
      expect(resolveLanguage('file.JSON')).toBe('json');
    });

    it('handles path with no extension', () => {
      expect(resolveLanguage('/src/Makefile')).toBe('plaintext');
    });

    it('handles path with dots in directory names', () => {
      expect(resolveLanguage('/src/v2.0/file.ts')).toBe('typescript');
    });
  });

  describe('dirty state lifecycle (read ? edit ? write)', () => {
    it('tracks full lifecycle: clean ? dirty ? clean after write', async () => {
      const filePath = join(tempDir!, 'lifecycle.ts');
      await writeFile(filePath, 'const a = 1;', 'utf8');

      // Step 1: Read file — buffer should be clean
      const readResult = await readEditorFile(filePath);
      expect(readResult.status).toBe('ok');
      expect(getBufferDirty(filePath)).toBe(false);

      // Step 2: User edits — mark buffer dirty
      markBufferDirty(filePath);
      expect(getBufferDirty(filePath)).toBe(true);

      // Step 3: User saves — write clears dirty flag
      const writeResult = await writeEditorFile(filePath, 'const a = 2;');
      expect(writeResult.status).toBe('ok');
      expect(getBufferDirty(filePath)).toBe(false);

      // Verify disk content
      const diskContent = await readFile(filePath, 'utf8');
      expect(diskContent).toBe('const a = 2;');
    });

    it('preserves dirty state across multiple edits before save', async () => {
      const filePath = join(tempDir!, 'multi-edit.ts');
      await writeFile(filePath, 'original', 'utf8');

      await readEditorFile(filePath);
      expect(getBufferDirty(filePath)).toBe(false);

      // First edit
      markBufferDirty(filePath);
      expect(getBufferDirty(filePath)).toBe(true);

      // Second edit — still dirty
      markBufferDirty(filePath);
      expect(getBufferDirty(filePath)).toBe(true);

      // Save clears it
      await writeEditorFile(filePath, 'edited twice');
      expect(getBufferDirty(filePath)).toBe(false);
    });

    it('write conflict detection works with dirty buffer', async () => {
      const filePath = join(tempDir!, 'conflict-dirty.ts');
      await writeFile(filePath, 'original', 'utf8');

      await readEditorFile(filePath);
      markBufferDirty(filePath);
      expect(getBufferDirty(filePath)).toBe(true);

      // External modification
      await writeFile(filePath, 'external change', 'utf8');

      // Write should fail with conflict, dirty state preserved
      const result = await writeEditorFile(filePath, 'my edit');
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.code).toBe('WRITE_CONFLICT');
      }
      // Dirty flag should still be true after failed write
      expect(getBufferDirty(filePath)).toBe(true);
    });

    it('closeBuffer clears dirty state tracking', async () => {
      const filePath = join(tempDir!, 'close-dirty.ts');
      await writeFile(filePath, 'content', 'utf8');

      await readEditorFile(filePath);
      markBufferDirty(filePath);
      expect(getBufferDirty(filePath)).toBe(true);

      closeBuffer(filePath);
      expect(getBufferDirty(filePath)).toBe(false);
    });
  });
});
