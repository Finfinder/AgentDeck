import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { DEFAULT_THEME_SETTINGS, isThemeSettings, type StartupServiceDescriptor, type StartupState, type ThemeSettings } from '@agentdeck/shared';

export type BootstrapDesktopServicesOptions = Readonly<{
  appVersion: string;
  forceFailure?: boolean;
}>;

export class StartupServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartupServiceError';
  }
}

const REQUIRED_SERVICES = [
  { id: 'workspace-service', label: 'Workspace Service', status: 'ready' },
  { id: 'agent-runtime', label: 'Agent Runtime', status: 'ready' },
  { id: 'settings-service', label: 'Settings Service', status: 'ready' }
] as const satisfies readonly StartupServiceDescriptor[];

const SAFE_STARTUP_ERROR_MESSAGE = 'Required desktop services failed to start.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

export class SettingsService {
  constructor(private readonly settingsFilePath: string) {}

  async readThemeSettings(): Promise<ThemeSettings> {
    try {
      const content = await readFile(this.settingsFilePath, 'utf8');
      const value: unknown = JSON.parse(content);

      return isThemeSettings(value) ? value : DEFAULT_THEME_SETTINGS;
    } catch (error) {
      if (isMissingFileError(error) || error instanceof SyntaxError) {
        return DEFAULT_THEME_SETTINGS;
      }

      return DEFAULT_THEME_SETTINGS;
    }
  }

  async writeThemeSettings(settings: ThemeSettings): Promise<ThemeSettings> {
    await mkdir(dirname(this.settingsFilePath), { recursive: true });
    await writeFile(this.settingsFilePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

    return settings;
  }
}

export function createSettingsService(userDataPath: string): SettingsService {
  return new SettingsService(join(userDataPath, 'settings.json'));
}

export async function bootstrapDesktopServices(options: BootstrapDesktopServicesOptions): Promise<StartupState> {
  const shouldFail = options.forceFailure ?? process.env.AGENTDECK_FAIL_BOOTSTRAP === '1';
  if (shouldFail) {
    throw new StartupServiceError('Required desktop services failed to start.');
  }

  return {
    status: 'ready',
    appVersion: options.appVersion,
    services: REQUIRED_SERVICES
  };
}

export function createStartupErrorState(appVersion: string): StartupState {
  return {
    status: 'error',
    appVersion,
    code: 'DESKTOP_SERVICES_UNAVAILABLE',
    message: SAFE_STARTUP_ERROR_MESSAGE
  };
}