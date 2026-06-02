import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootstrapDesktopServices, createSettingsService, createStartupErrorState, createWorkspaceService, getDiagnostics, readEditorFile, type SettingsService, type WorkspaceService, writeEditorFile } from '@agentdeck/services';
import {
  DEFAULT_THEME_SETTINGS,
  IPC_CHANNELS,
  isThemeSettings,
  isWorkspaceOpenRequest,
  type SearchQuery,
  type StartupState,
  type WorkspaceSelection
} from '@agentdeck/shared';

import { existsSync } from 'node:fs';

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}
const rootDir = findProjectRoot(dirname(fileURLToPath(import.meta.url)));

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
  ipcMain.handle(IPC_CHANNELS.selectWorkspaceEntry, (_event, value: unknown) => selectWorkspaceEntry(value, mainWindow));

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

  ipcMain.handle(IPC_CHANNELS.readFile, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid file path.' };
    }
    return readEditorFile(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.writeFile, async (_event, filePath: unknown, content: unknown) => {
    if (typeof filePath !== 'string' || typeof content !== 'string') {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid arguments.' };
    }
    return writeEditorFile(filePath, content);
  });

  ipcMain.handle(IPC_CHANNELS.getEditorDiagnostics, async () => {
    return getDiagnostics();
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
      contextIsolation: process.env.NODE_ENV !== 'test',
      nodeIntegration: false,
      preload: resolve(rootDir, 'out/preload/index.mjs'),
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(join(rootDir, 'out/renderer/index.html'));
  }

  return mainWindow;
}

async function selectWorkspaceEntry(value: unknown, mainWindow: BrowserWindow): Promise<WorkspaceSelection> {
  if (!isWorkspaceOpenRequest(value)) {
    return { status: 'cancelled' };
  }

  // In test mode, return a mock path instead of showing dialog
  if (process.env.NODE_ENV === 'test') {
    const testWorkspacePath = process.env.TEST_WORKSPACE_PATH || 'C:\\test';
    return {
      status: 'selected',
      kind: value.kind,
      path: value.kind === 'workspace-file' ? testWorkspacePath + '\\test.code-workspace' : testWorkspacePath,
      name: value.kind === 'workspace-file' ? 'test.code-workspace' : 'test-folder',
    };
  }

  // Ensure the window is visible before showing the dialog
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();

  const dialogOptions = value.kind === 'folder'
    ? { properties: ['openDirectory' as const] }
    : {
        filters: [{ name: 'VS Code Workspace', extensions: ['code-workspace'] }],
        properties: ['openFile' as const]
      };

  const result = await dialog.showOpenDialog(mainWindow, dialogOptions);

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
    const settingsService = createSettingsService(app.getPath('userData'));
    const workspaceService = createWorkspaceService(app.getPath('userData'));
    const mainWindow = createMainWindow();
    registerIpcHandlers(settingsService, workspaceService, mainWindow);
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