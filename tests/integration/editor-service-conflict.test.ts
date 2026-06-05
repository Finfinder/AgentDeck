import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readEditorFile,
  writeEditorFile,
  clearBuffers,
  closeBuffer,
  getBufferDirty,
  markBufferDirty
} from '@agentdeck/services';

describe('editor-service write conflict detection', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `agentdeck-int-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    filePath = join(tempDir, 'test.ts');
    await writeFile(filePath, 'original content', 'utf8');
    clearBuffers();
  });

  afterEach(async () => {
    clearBuffers();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns WRITE_CONFLICT when file was modified externally after read', async () => {
    // Read file — populates buffer with hash
    const readResult = await readEditorFile(filePath);
    expect(readResult.status).toBe('ok');

    // External modification
    await writeFile(filePath, 'external modification', 'utf8');

    // Write should detect conflict
    const writeResult = await writeEditorFile(filePath, 'my content');
    expect(writeResult.status).toBe('error');
    if (writeResult.status === 'error') {
      expect(writeResult.code).toBe('WRITE_CONFLICT');
      expect(writeResult.message).toContain('modified on disk');
    }
  });

  it('allows write when file was not modified externally', async () => {
    await readEditorFile(filePath);

    const writeResult = await writeEditorFile(filePath, 'new content');
    expect(writeResult.status).toBe('ok');

    const diskContent = await readFile(filePath, 'utf8');
    expect(diskContent).toBe('new content');
  });

  it('allows write when file was deleted on disk (recreate)', async () => {
    await readEditorFile(filePath);
    await rm(filePath);

    const writeResult = await writeEditorFile(filePath, 'recreated');
    expect(writeResult.status).toBe('ok');

    const diskContent = await readFile(filePath, 'utf8');
    expect(diskContent).toBe('recreated');
  });

  it('WRITE_CONFLICT preserves dirty state — buffer hash unchanged', async () => {
    await readEditorFile(filePath);
    markBufferDirty(filePath);
    expect(getBufferDirty(filePath)).toBe(true);

    // External modification
    await writeFile(filePath, 'external', 'utf8');

    // Write fails with conflict
    await writeEditorFile(filePath, 'my edit');

    // Buffer should still be dirty and hash should be from original read
    expect(getBufferDirty(filePath)).toBe(true);

    // Second write attempt should still detect conflict (hash still stale)
    const secondAttempt = await writeEditorFile(filePath, 'my edit again');
    expect(secondAttempt.status).toBe('error');
    if (secondAttempt.status === 'error') {
      expect(secondAttempt.code).toBe('WRITE_CONFLICT');
    }
  });

  it('re-reading after conflict updates hash and allows subsequent write', async () => {
    await readEditorFile(filePath);

    // External modification
    await writeFile(filePath, 'external v2', 'utf8');

    // Write fails
    const conflict = await writeEditorFile(filePath, 'my content');
    expect(conflict.status).toBe('error');

    // Re-read to update buffer hash
    const reRead = await readEditorFile(filePath);
    expect(reRead.status).toBe('ok');
    if (reRead.status === 'ok') {
      expect(reRead.content).toBe('external v2');
    }

    // Now write should succeed
    const success = await writeEditorFile(filePath, 'merged content');
    expect(success.status).toBe('ok');

    const diskContent = await readFile(filePath, 'utf8');
    expect(diskContent).toBe('merged content');
  });

  it('write without prior read does not check for conflicts', async () => {
    // No readEditorFile call — buffer is empty
    const writeResult = await writeEditorFile(filePath, 'blind write');
    expect(writeResult.status).toBe('ok');

    const diskContent = await readFile(filePath, 'utf8');
    expect(diskContent).toBe('blind write');
  });

  it('closeBuffer clears conflict detection state', async () => {
    await readEditorFile(filePath);

    // External modification
    await writeFile(filePath, 'external', 'utf8');

    // Conflict detected
    const conflict = await writeEditorFile(filePath, 'my content');
    expect(conflict.status).toBe('error');

    // Close buffer
    closeBuffer(filePath);

    // Write without read — no conflict check (buffer cleared)
    const writeResult = await writeEditorFile(filePath, 'after close');
    expect(writeResult.status).toBe('ok');
  });

  it('multiple files tracked independently — conflict in one does not block other', async () => {
    const filePath2 = join(tempDir, 'other.ts');
    await writeFile(filePath2, 'other original', 'utf8');

    await readEditorFile(filePath);
    await readEditorFile(filePath2);

    // Modify only first file externally
    await writeFile(filePath, 'external change', 'utf8');

    // First file: conflict
    const conflict = await writeEditorFile(filePath, 'my edit');
    expect(conflict.status).toBe('error');
    if (conflict.status === 'error') {
      expect(conflict.code).toBe('WRITE_CONFLICT');
    }

    // Second file: no conflict
    const success = await writeEditorFile(filePath2, 'other edit');
    expect(success.status).toBe('ok');
  });
});
