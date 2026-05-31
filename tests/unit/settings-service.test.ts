import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSettingsService } from '@agentdeck/services';

let tempDir: string | null = null;

async function createSettingsServiceFixture() {
  tempDir = await mkdtemp(join(tmpdir(), 'agentdeck-settings-'));

  return {
    service: createSettingsService(tempDir),
    settingsFilePath: join(tempDir, 'settings.json')
  };
}

describe('SettingsService', () => {
  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('returns dark theme settings by default', async () => {
    const { service } = await createSettingsServiceFixture();

    await expect(service.readThemeSettings()).resolves.toEqual({ theme: 'dark' });
  });

  it('persists theme settings as JSON', async () => {
    const { service, settingsFilePath } = await createSettingsServiceFixture();

    await expect(service.writeThemeSettings({ theme: 'light' })).resolves.toEqual({ theme: 'light' });

    await expect(readFile(settingsFilePath, 'utf8')).resolves.toBe('{\n  "theme": "light"\n}\n');
    await expect(service.readThemeSettings()).resolves.toEqual({ theme: 'light' });
  });

  it('falls back to dark theme for invalid settings files', async () => {
    const { service, settingsFilePath } = await createSettingsServiceFixture();

    await writeFile(settingsFilePath, '{ "theme": "system" }\n', 'utf8');

    await expect(service.readThemeSettings()).resolves.toEqual({ theme: 'dark' });
  });
});