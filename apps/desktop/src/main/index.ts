import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootstrapDesktopServices, createSettingsService, createStartupErrorState, createWorkspaceService, type SettingsService, type WorkspaceService } from '@agentdeck/services';
import {
  DEFAULT_THEME_SETTINGS,
  IPC_CHANNELS,
  isThemeSettings,
  isWorkspaceOpenRequest,
  type SearchQuery,
  type StartupState,
  type WorkspaceSelection
} from '@agentdeck/shared';

const currentDir = dirname(fileURLToPath(import.meta.url));

let startupState: StartupState = {
  status: 'error',
  appVersion: app.getVersion(),
  code: 'DESKTOP_SERVICES_UNAVAILABLE',
  message: 'Application services have not been initialized yet.'
};

function registerIpcHandlers(settingsService: SettingsService, workspaceService: WorkspaceService, mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.getStartupState, () => startupState);
  ipcMain.handle(IPC_CHANNELS.getThemeSettings, () => settingsService.readThemeSettings());
  ipcMain.handle(IPC_CHANNELS.setThemeSettings, (_event, value: unknown) => {
    return isThemeSettings(value) ? settingsService.writeThemeSettings(value) : DEFAULT_THEME_SETTINGS;
  });
  ipcMain.handle(IPC_CHANNELS.selectWorkspaceEntry, (_event, value: unknown) => selectWorkspaceEntry(value));

  ipcMain.handle(IPC_CHANNELS.openWorkspace, (_event, path: unknown, kind: unknown) => {
    if (typeof path !== 'string' || (kind !== 'folder' && kind !== 'workspace-file')) {
      return { status: 'error', code: 'INVALID_JSONC', message: 'Invalid workspace open request.' };
    }
    return workspaceService.openWorkspace(path, kind);
  });

  ipcMain.handle(IPC_CHANNELS.listDirectory, (_event, path: unknown) => {
    if (typeof path !== 'string') return { path: '', entries: [] };
    return workspaceService.listDirectory(path);
  });

  ipcMain.handle(IPC_CHANNELS.searchFiles, (_event, value: unknown) => {
    if (!isSearchQuery(value)) return [];
    return workspaceService.searchFiles(value);
  });

  ipcMain.handle(IPC_CHANNELS.getRecentWorkspaces, () => workspaceService.getRecentWorkspaces());

  workspaceService.on('fs-event', event => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.fsEvent, event);
    }
  });
}

function isSearchQuery(value: unknown): value is SearchQuery {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).pattern === 'string' &&
    Array.isArray((value as Record<string, unknown>).workspaceRoots)
  );
}

async function resolveStartupState(): Promise<StartupState> {
  try {
    return await bootstrapDesktopServices({ appVersion: app.getVersion() });
  } catch {
    return createStartupErrorState(app.getVersion());
  }
}

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1117',
    show: false,
    title: 'AgentDeck',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(currentDir, '../preload/index.mjs'),
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(join(currentDir, '../renderer/index.html'));
  }

  return mainWindow;
}

async function selectWorkspaceEntry(value: unknown): Promise<WorkspaceSelection> {
  if (!isWorkspaceOpenRequest(value)) {
    return { status: 'cancelled' };
  }

  const result = await dialog.showOpenDialog(
    value.kind === 'folder'
      ? { properties: ['openDirectory'] }
      : {
          filters: [{ name: 'VS Code Workspace', extensions: ['code-workspace'] }],
          properties: ['openFile']
        }
  );

  if (result.canceled) {
    return { status: 'cancelled' };
  }

  const selectedPath = result.filePaths[0];
  if (!selectedPath) {
    return { status: 'cancelled' };
  }

  return {
    status: 'selected',
    kind: value.kind,
    path: selectedPath,
    name: basename(selectedPath)
  };
}

async function start(): Promise<void> {
  const settingsService = createSettingsService(app.getPath('userData'));
  const workspaceService = createWorkspaceService(app.getPath('userData'));

  startupState = await resolveStartupState();
  const mainWindow = createMainWindow();
  registerIpcHandlers(settingsService, workspaceService, mainWindow);
}

async function startSafely(): Promise<void> {
  try {
    await start();
  } catch (error) {
    console.error('[main] Failed to start AgentDeck:', error);
    startupState = createStartupErrorState(app.getVersion());
    createMainWindow();
  }
}

function startWhenReady(): void {
  if (app.isReady()) {
    setImmediate(() => {
      void startSafely();
    });
    return;
  }

  app.once('ready', () => {
    void startSafely();
  });
}

startWhenReady();

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});