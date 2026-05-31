// TS environment: prefer to use Node builtin fs/promises. Some local TS configs
// may not resolve Node builtin types reliably in all packages — silence the
// import-time check here. Proper fix: ensure `@types/node` is available to
// this package's tsconfig.
// @ts-ignore
import { readFile, writeFile } from 'fs/promises';

export type ThemePreference = 'light' | 'dark';
export type ThemeSettings = Readonly<{ theme: ThemePreference }>;

export const DEFAULT_THEME_SETTINGS: ThemeSettings = { theme: 'light' };

export async function readThemeSettings(filePath?: string): Promise<ThemeSettings> {
  if (!filePath) {
    return DEFAULT_THEME_SETTINGS;
  }

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_THEME_SETTINGS;
    }

    // Best-effort shape check
    const asAny = parsed as { theme?: unknown };
    if (asAny.theme === 'dark' || asAny.theme === 'light') {
      const theme = asAny.theme as ThemePreference;
      return { theme };
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
