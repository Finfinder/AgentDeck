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

type StartupGlobal = typeof globalThis & Readonly<{ AGENTDECK_FAIL_BOOTSTRAP?: string }>;

export async function bootstrapDesktopServices(options: BootstrapDesktopServicesOptions): Promise<StartupState> {
  // Avoid direct reference to `process` in environments without Node typings.
  // Use a global flag if present, or the explicit option to force failure.
  const startupGlobal = globalThis as StartupGlobal;
  const shouldFail = options.forceFailure ?? startupGlobal.AGENTDECK_FAIL_BOOTSTRAP === '1';
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

export { readThemeSettings, writeThemeSettings, DEFAULT_THEME_SETTINGS } from './settings';
export type { ThemeSettings } from './settings';
export { createWorkspaceService, isSensitivePath, parseCodeWorkspace, stripJsoncComments, WorkspaceService } from './workspace-service';
export {
  applyWorkspaceEdit,
  clearBuffers,
  closeBuffer,
  createEditorFile,
  createEditorTab,
  createTabId,
  getBufferDirty,
  getDiagnostics,
  getOpenBuffers,
  markBufferDirty,
  readEditorFile,
  resolveLanguage,
  showDiff,
  writeEditorFile
} from './editor-service';
export { createIdentityService, IdentityService } from './identity-service';
export type { SecureStore, SecureStoreWarning, IdentityServiceOptions } from './identity-service';
export type { IdentitySession } from '@agentdeck/shared';
export { ModelGateway, createModelGateway, getModelGateway } from './model-gateway';
export { createAgentRuntime } from '@agentdeck/agent-runtime';
export type {
  AgentRuntime,
  AgentRuntimeEventEntry,
  AgentRuntimePermissionScope,
  AgentRuntimeResult,
  AgentRuntimeSessionState,
  AgentRuntimeStartSessionOptions,
  AgentRuntimeStartWorkerOptions,
  AgentRuntimeStartSubagentOptions,
  AgentRuntimeResumeOptions,
  AgentRuntimeTaskState,
  AgentRuntimeWorkerDefinition,
  AgentRuntimeWorkerInput,
  AgentRuntimeWorkerOutput,
  AgentRuntimeWorkerState
} from '@agentdeck/agent-runtime';
export type { ModelProviderAdapter, ToolDefinition, ToolExecutor, ToolExecutionContext, WorkspaceRootProvider, RetryPolicy } from './model-gateway';
export { OpenRouterAdapter, OllamaAdapter, LmStudioAdapter, OpenAiCompatibleAdapter, createDefaultAdapters, STREAM_HEARTBEAT_TIMEOUT_MS } from './model-providers';
export { classifyError } from './model-errors';