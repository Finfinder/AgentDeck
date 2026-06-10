import { config } from 'dotenv';
import { app, BrowserWindow, dialog, ipcMain, Menu, globalShortcut, session } from 'electron';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { applyWorkspaceEdit, bootstrapDesktopServices, createSettingsService, createStartupErrorState, createWorkspaceService, getDiagnostics, markBufferDirty, readEditorFile, showDiff, createIdentityService, type IdentityService, type SettingsService, type WorkspaceService, writeEditorFile, createModelGateway, createDefaultAdapters, type ModelGateway } from '@agentdeck/services';
import {
  DEFAULT_THEME_SETTINGS,
  IPC_CHANNELS,
  isChatStreamEvent,
  isChatTabState,
  isDiffInput,
  isThemeSettings,
  isWorkspaceEditInput,
  isWorkspaceOpenRequest,
  type ModelProviderId,
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

// Load .env file from project root
config({ path: join(rootDir, '.env') });

let startupState: StartupState = {
  status: 'error',
  appVersion: app.getVersion(),
  code: 'DESKTOP_SERVICES_UNAVAILABLE',
  message: 'Application services have not been initialized yet.'
};

function registerIpcHandlers(settingsService: SettingsService, workspaceService: WorkspaceService, mainWindow: BrowserWindow, identityService?: IdentityService, modelGateway?: ModelGateway): void {
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
        // Explicit demo mode: only when GITHUB_OVERRIDE_DEMO=1 (opt-in, never silent fallback)
        const demoOverride = process.env.GITHUB_OVERRIDE_DEMO === '1';
        const clientId = process.env.GITHUB_CLIENT_ID;

        if (demoOverride && !clientId) {
          console.log('[Identity] GITHUB_OVERRIDE_DEMO=1. Using explicit demo mode.');
          const demoSession = {
            isLoggedIn: true,
            provider: 'github' as const,
            profile: {
              login: 'demo-user',
              id: 0,
              avatar_url: '',
              name: 'Demo Mode',
              email: 'demo@agentdeck.local'
            }
          };
          if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.identityChanged, demoSession);
          return demoSession;
        }

        // Require GITHUB_CLIENT_ID for real OAuth. Missing config = explicit error, never silent demo.
        if (!clientId) {
          console.error('[Identity] GITHUB_CLIENT_ID not set. Cannot start OAuth. Set GITHUB_CLIENT_ID in .env or use GITHUB_OVERRIDE_DEMO=1 for demo.');
          const errorSession = {
            isLoggedIn: false,
            error: 'Missing GITHUB_CLIENT_ID. Set it in .env for real GitHub OAuth, or set GITHUB_OVERRIDE_DEMO=1 for demo mode.'
          };
          if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.identityChanged, errorSession);
          return errorSession;
        }

        // Real GitHub OAuth - device flow (no localhost needed)
        console.log('[Identity] GITHUB_CLIENT_ID found. Using device flow (no localhost required).');
        
        const option = (opts as Record<string, unknown> | undefined) ?? undefined;
        const scopes = option && typeof option === 'object' && 'scopes' in option 
          ? (option as { scopes?: string[] }).scopes
          : undefined;

        // Callback to send device code to renderer UI
        const onDeviceCode = (userCode: string, verificationUri: string, verificationUriComplete?: string) => {
          if (!mainWindow?.isDestroyed()) {
            mainWindow.webContents.send(IPC_CHANNELS.identityDeviceCode, {
              userCode,
              verificationUri,
              verificationUriComplete
            });
          }
        };

        const session = await identityService.startDeviceFlow({ 
          clientId, 
          scopes: scopes ?? ['read:user', 'user:email'],
          onDeviceCode
        });

        if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.identityChanged, session);
        return session;
      } catch (err) {
        console.error('[main] identityStartOAuth failed:', err);
        return { 
          isLoggedIn: false, 
          error: `OAuth failed: ${err instanceof Error ? err.message : String(err)}` 
        };
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

  // Model Gateway IPC handlers
  if (modelGateway) {
    ipcMain.handle(IPC_CHANNELS.getModelGatewayConfig, () => modelGateway.getConfig());
    ipcMain.handle(IPC_CHANNELS.listChatTabs, () => modelGateway.listChatTabs());
    ipcMain.handle(IPC_CHANNELS.createChatTab, (_event, title: unknown) => {
      return modelGateway.createChatTab(typeof title === 'string' ? title : undefined);
    });
    ipcMain.handle(IPC_CHANNELS.closeChatTab, (_event, tabId: unknown) => {
      if (typeof tabId === 'string') modelGateway.closeChatTab(tabId);
    });
    ipcMain.handle(IPC_CHANNELS.sendMessage, async (_event, tabId: unknown, message: unknown) => {
      if (typeof tabId !== 'string' || typeof message !== 'string') {
        return { status: 'error', code: 'UNKNOWN', message: 'Invalid arguments.' };
      }
      return modelGateway.sendMessage(tabId, message);
    });
    ipcMain.handle(IPC_CHANNELS.stopStreaming, (_event, tabId: unknown) => {
      if (typeof tabId === 'string') modelGateway.stopStreaming(tabId);
    });
    ipcMain.handle(IPC_CHANNELS.chatSetActiveModel, (_event, tabId: unknown, modelId: unknown) => {
      if (typeof tabId === 'string' && typeof modelId === 'string') modelGateway.setTabActiveModel(tabId, modelId);
    });
    ipcMain.handle(IPC_CHANNELS.chatSetActiveProvider, (_event, tabId: unknown, providerId: unknown) => {
      if (typeof tabId === 'string' && typeof providerId === 'string') modelGateway.setTabActiveProvider(tabId, providerId as ModelProviderId);
    });

    // Forward Model Gateway events to renderer (validate before sending)
    modelGateway.on('chat-stream', (tabId: string, event: unknown) => {
      if (!mainWindow.isDestroyed() && isChatStreamEvent(event)) {
        mainWindow.webContents.send(IPC_CHANNELS.chatStreamEvent, tabId, event);
      }
    });
    modelGateway.on('chat-tabs-changed', (tabs: unknown) => {
      if (!mainWindow.isDestroyed() && Array.isArray(tabs) && tabs.every(isChatTabState)) {
        mainWindow.webContents.send(IPC_CHANNELS.chatTabsChanged, tabs);
      }
    });

    // Model Gateway secure config handlers
    ipcMain.handle(IPC_CHANNELS.modelGatewayGetApiKey, async (_event, providerId: unknown) => {
      if (typeof providerId !== 'string') return null;
      try {
        const keytar = await import('keytar');
        return await keytar.getPassword('agentdeck', `api-key-${providerId}`);
      } catch {
        return null;
      }
    });

    ipcMain.handle(IPC_CHANNELS.modelGatewaySetApiKey, async (_event, providerId: unknown, apiKey: unknown) => {
      if (typeof providerId !== 'string' || typeof apiKey !== 'string') return;
      try {
        const keytar = await import('keytar');
        await keytar.setPassword('agentdeck', `api-key-${providerId}`, apiKey);
      } catch {
        // keytar unavailable — silently fail
      }
    });

    ipcMain.handle(IPC_CHANNELS.modelGatewayDeleteApiKey, async (_event, providerId: unknown) => {
      if (typeof providerId !== 'string') return;
      try {
        const keytar = await import('keytar');
        await keytar.deletePassword('agentdeck', `api-key-${providerId}`);
      } catch {
        // keytar unavailable — silently fail
      }
    });

    ipcMain.handle(IPC_CHANNELS.modelGatewayTestConnection, async (_event, providerId: unknown, baseUrl: unknown) => {
      if (typeof providerId !== 'string' || typeof baseUrl !== 'string') {
        return { status: 'error', message: 'Invalid provider ID or base URL.' };
      }
      try {
        const adapter = modelGateway.getAdapter(providerId as Parameters<typeof modelGateway.getAdapter>[0]);
        if (!adapter) {
          return { status: 'error', message: `No adapter registered for provider: ${providerId}` };
        }
        const healthy = await adapter.healthCheck(baseUrl);
        if (!healthy) {
          return { status: 'error', message: 'Connection failed. Check the base URL.' };
        }
        const models = await adapter.listModels(baseUrl);
        modelGateway.updateProviderStatus(providerId as Parameters<typeof modelGateway.updateProviderStatus>[0], 'ready', models);
        return { status: 'ok', models };
      } catch (err) {
        return { status: 'error', message: err instanceof Error ? err.message : 'Unknown error' };
      }
    });

    ipcMain.handle(IPC_CHANNELS.modelGatewaySetProviderConfig, (_event, providerId: unknown, baseUrl: unknown) => {
      if (typeof providerId !== 'string' || typeof baseUrl !== 'string') return;
      modelGateway.setProviderBaseUrl(providerId as Parameters<typeof modelGateway.setProviderBaseUrl>[0], baseUrl);
    });

    ipcMain.handle(IPC_CHANNELS.modelGatewayGetProviderConfig, async (_event, providerId: unknown) => {
      if (typeof providerId !== 'string') return { baseUrl: '', hasApiKey: false };
      const config = modelGateway.getProviderConfig(providerId as Parameters<typeof modelGateway.getProviderConfig>[0]);
      let hasApiKey = false;
      try {
        const keytar = await import('keytar');
        const key = await keytar.getPassword('agentdeck', `api-key-${providerId}`);
        hasApiKey = typeof key === 'string' && key.length > 0;
      } catch {
        // keytar unavailable — hasApiKey stays false
      }
      return { baseUrl: config.baseUrl, hasApiKey };
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
  const identityService = createIdentityService(app.getPath('userData'), {
    onFallbackWarning: (warning) => {
      // Send warning to renderer so UI can display it to the user
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.identityWarning, warning);
      }
    }
  });
  const modelGateway = createModelGateway();
  // Register default provider adapters
  for (const adapter of createDefaultAdapters()) {
    modelGateway.registerAdapter(adapter);
  }

  startupState = await resolveStartupState();

  // Set frame-ancestors CSP via HTTP header (not supported in <meta> tags)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };

    // Case-insensitive lookup — Electron/Chromium returns lowercase keys
    const existingKey = Object.keys(headers).find(
      k => k.toLowerCase() === 'content-security-policy'
    );
    const existingValue = existingKey ? (headers[existingKey]?.[0] ?? '') : '';

    // Remove old key to avoid duplicate CSP headers
    if (existingKey) delete headers[existingKey];

    const newCSP = existingValue
      ? `${existingValue}; frame-ancestors 'none'`
      : "frame-ancestors 'none'";

    callback({
      responseHeaders: {
        ...headers,
        'Content-Security-Policy': [newCSP],
      },
    });
  });

  const mainWindow = createMainWindow();
  registerIpcHandlers(settingsService, workspaceService, mainWindow, identityService, modelGateway);
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