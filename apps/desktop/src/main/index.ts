import { app, BrowserWindow, dialog, ipcMain, Menu, globalShortcut } from 'electron';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { applyWorkspaceEdit, bootstrapDesktopServices, createSettingsService, createStartupErrorState, createWorkspaceService, getDiagnostics, markBufferDirty, readEditorFile, showDiff, createIdentityService, type SettingsService, type WorkspaceService, writeEditorFile } from '@agentdeck/services';
import {
  DEFAULT_THEME_SETTINGS,
  IPC_CHANNELS,
  isDiffInput,
  isThemeSettings,
  isWorkspaceEditInput,
  isWorkspaceOpenRequest,
  type SearchQuery,
  type StartupState,
  type WorkspaceSelection
} from '@agentdeck/shared';

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

function registerIpcHandlers(settingsService: SettingsService, workspaceService: WorkspaceService, mainWindow: BrowserWindow, identityService?: any): void {
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

  ipcMain.handle(IPC_CHANNELS.markBufferDirty, (_event, filePath: unknown) => {
    if (typeof filePath === 'string') {
      markBufferDirty(filePath);
    }
  });

  ipcMain.handle(IPC_CHANNELS.deleteFile, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid file path.' };
    }
    return workspaceService.deleteFile(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.renameFile, async (_event, oldPath: unknown, newPath: unknown) => {
    if (typeof oldPath !== 'string' || typeof newPath !== 'string') {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid file paths.' };
    }
    return workspaceService.renameFile(oldPath, newPath);
  });

  ipcMain.handle(IPC_CHANNELS.getEditorDiagnostics, async () => {
    // Allow mock diagnostics via env var for E2E testing.
    const mockRaw = process.env.TEST_MOCK_DIAGNOSTICS;
    if (mockRaw) {
      try {
        return JSON.parse(mockRaw);
      } catch {
        // Fall through to real implementation.
      }
    }
    return getDiagnostics();
  });

  ipcMain.handle(IPC_CHANNELS.applyWorkspaceEdit, async (_event, edit: unknown) => {
    if (!isWorkspaceEditInput(edit)) {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid workspace edit payload.' } as const;
    }
    try {
      return await applyWorkspaceEdit(edit);
    } catch (err) {
      console.error('[main] applyWorkspaceEdit failed:', err);
      return { status: 'error', code: 'UNKNOWN', message: String(err) } as const;
    }
  });

  ipcMain.handle(IPC_CHANNELS.showDiff, async (_event, input: unknown) => {
    if (!isDiffInput(input)) {
      return { status: 'error', code: 'UNKNOWN', message: 'showDiff: invalid input - expected { original: string, modified: string }' } as const;
    }
    return showDiff(input.original, input.modified);
  });

  ipcMain.handle(IPC_CHANNELS.toggleDevTools, () => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      if (focused.webContents.isDevToolsOpened()) {
        focused.webContents.closeDevTools();
      } else {
        focused.webContents.openDevTools({ mode: 'bottom' });
      }
    }
  });

  ipcMain.handle(IPC_CHANNELS.showSaveDialog, async (_event, defaultPath: unknown) => {
    const options: Electron.SaveDialogOptions = {
      properties: ['showOverwriteConfirmation']
    };
    if (typeof defaultPath === 'string') {
      options.defaultPath = defaultPath;
    }
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result.canceled ? null : (result.filePath ?? null);
  });

  if (identityService) {
    ipcMain.handle(IPC_CHANNELS.identityGetSession, async () => {
      try {
        return await identityService.getSession();
      } catch {
        return { isLoggedIn: false };
      }
    });

    ipcMain.handle(IPC_CHANNELS.identityStartOAuth, async (_event, opts: unknown) => {
      try {
        const session = await identityService.startOAuthLoopback({ clientId: process.env.GITHUB_CLIENT_ID ?? '', clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '' });
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.identityChanged, session);
        return session;
      } catch (err) {
        console.error('[main] identityStartOAuth failed:', err);
        return { isLoggedIn: false };
      }
    });

    ipcMain.handle(IPC_CHANNELS.identitySignOut, async () => {
      try {
        await identityService.signOut();
        const session = { isLoggedIn: false };
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.identityChanged, session);
        return session;
      } catch (err) {
        console.error('[main] identitySignOut failed:', err);
        return { isLoggedIn: false };
      }
    });
  }
}

function isSearchQuery(value: unknown): value is SearchQuery {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.pattern === 'string' && Array.isArray(candidate.workspaceRoots);
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
    // Use path.join to avoid manual escaping of backslashes in Windows paths.
    const testWorkspacePath = process.env.TEST_WORKSPACE_PATH ?? join('C:', 'test');
    return {
      status: 'selected',
      kind: value.kind,
      path: value.kind === 'workspace-file' ? join(testWorkspacePath, 'test.code-workspace') : testWorkspacePath,
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

function registerDevToolsShortcut(mainWindow: BrowserWindow): void {
  globalShortcut.register('F12', () => {
    if (mainWindow.isFocused()) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'bottom' });
      }
    }
  });
  globalShortcut.register('Ctrl+Shift+I', () => {
    if (mainWindow.isFocused()) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'bottom' });
      }
    }
  });
}

async function start(): Promise<void> {
  const settingsService = createSettingsService(app.getPath('userData'));
  const workspaceService = createWorkspaceService(app.getPath('userData'));
  const identityService = createIdentityService(app.getPath('userData'));

  startupState = await resolveStartupState();
  const mainWindow = createMainWindow();
  registerIpcHandlers(settingsService, workspaceService, mainWindow, identityService);
  registerDevToolsShortcut(mainWindow);
}

async function startSafely(): Promise<void> {
  try {
    if (process.platform !== 'darwin') {
      try {
        Menu.setApplicationMenu(null);
      } catch (err) {
        console.warn('[main] Failed to remove application menu:', err);
      }
    }
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