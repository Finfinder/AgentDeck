import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSettingsService, readThemeSettings, DEFAULT_THEME_SETTINGS } from '@agentdeck/services';

let tempDir: string | null = null;

async function createSettingsServiceFixture() {
  tempDir = await mkdtemp(join(tmpdir(), 'agentdeck-settings-'));

  return {
    service: createSettingsService(tempDir),
    settingsFilePath: join(tempDir, 'settings.json'),
    themeFilePath: join(tempDir, 'theme.json')
  };
}

describe('SettingsService', () => {
  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('returns default when file is missing (ENOENT) via readThemeSettings()', async () => {
    const { themeFilePath } = await createSettingsServiceFixture();

    const result = await readThemeSettings(themeFilePath);

    expect(result).toEqual(DEFAULT_THEME_SETTINGS);
  });

  it('returns default when JSON is malformed (SyntaxError) via readThemeSettings()', async () => {
    const { themeFilePath } = await createSettingsServiceFixture();

    await writeFile(themeFilePath, '{ "theme": "dark"', 'utf8');

    const result = await readThemeSettings(themeFilePath);

    expect(result).toEqual(DEFAULT_THEME_SETTINGS);
  });

  it('parses valid settings file via readThemeSettings()', async () => {
    const { themeFilePath } = await createSettingsServiceFixture();

    await writeFile(themeFilePath, JSON.stringify({ theme: 'dark' }), 'utf8');

    const result = await readThemeSettings(themeFilePath);

    expect(result).toEqual({ theme: 'dark' });
  });

  it('persists theme settings via SettingsService.writeThemeSettings()', async () => {
    const { service, settingsFilePath } = await createSettingsServiceFixture();

    await expect(service.writeThemeSettings({ theme: 'light' })).resolves.toEqual({ theme: 'light' });

    await expect(readFile(settingsFilePath, 'utf8')).resolves.toBe('{\n  "theme": "light"\n}\n');
    await expect(service.readThemeSettings()).resolves.toEqual({ theme: 'light' });
  });
});
