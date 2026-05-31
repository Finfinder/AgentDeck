import type { StartupServiceDescriptor, StartupState } from '@agentdeck/shared';

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