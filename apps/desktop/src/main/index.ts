import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootstrapDesktopServices, createSettingsService, createStartupErrorState, type SettingsService } from '@agentdeck/services';
import {
  DEFAULT_THEME_SETTINGS,
  IPC_CHANNELS,
  isThemeSettings,
  isWorkspaceOpenRequest,
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

function registerIpcHandlers(settingsService: SettingsService): void {
  ipcMain.handle(IPC_CHANNELS.getStartupState, () => startupState);
  ipcMain.handle(IPC_CHANNELS.getThemeSettings, () => settingsService.readThemeSettings());
  ipcMain.handle(IPC_CHANNELS.setThemeSettings, (_event, value: unknown) => {
    return isThemeSettings(value) ? settingsService.writeThemeSettings(value) : DEFAULT_THEME_SETTINGS;
  });
  ipcMain.handle(IPC_CHANNELS.selectWorkspaceEntry, (_event, value: unknown) => selectWorkspaceEntry(value));
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

  startupState = await resolveStartupState();
  registerIpcHandlers(settingsService);
  createMainWindow();
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