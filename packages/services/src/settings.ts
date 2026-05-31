// Prefer explicit Node builtin import. Keep a targeted ts-ignore for
// developer setups that don't have @types/node installed yet.
// @ts-ignore
import { readFile, writeFile } from 'node:fs/promises';

export type ThemePreference = 'light' | 'dark';
export type ThemeSettings = Readonly<{ theme: ThemePreference }>;

export const DEFAULT_THEME_SETTINGS: ThemeSettings = { theme: 'light' };

export async function readThemeSettings(filePath?: string): Promise<ThemeSettings> {
  if (!filePath) {
    return DEFAULT_THEME_SETTINGS;
  }

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_THEME_SETTINGS;
    }

    // Best-effort shape check without unnecessary assertions
    const themeCandidate = (parsed as Record<string, unknown>)['theme'];
    if (themeCandidate === 'dark' || themeCandidate === 'light') {
      return { theme: themeCandidate };
    }

    return DEFAULT_THEME_SETTINGS;
  } catch (err: unknown) {
    // Treat missing file and JSON parse errors as safe fallback to defaults
    const maybe = err as { code?: string; name?: string };
    if (maybe?.code === 'ENOENT' || maybe?.name === 'SyntaxError') {
      return DEFAULT_THEME_SETTINGS;
    }

    throw err;
  }
}

export async function writeThemeSettings(filePath: string, settings: ThemeSettings): Promise<void> {
  await writeFile(filePath, JSON.stringify(settings, null, 2), 'utf8');
}
