import { config } from 'dotenv';
import { app, BrowserWindow, dialog, ipcMain, Menu, globalShortcut, session, shell } from 'electron';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';

import { applyWorkspaceEdit, bootstrapDesktopServices, createEditorFile, createSettingsService, createStartupErrorState, createWorkspaceService, getDiagnostics, markBufferDirty, readEditorFile, showDiff, createIdentityService, type IdentityService, type SettingsService, type WorkspaceService, writeEditorFile, createModelGateway, createDefaultAdapters, type ModelGateway, type ToolExecutionContext } from '@agentdeck/services';
import { createPermissionBroker } from '@agentdeck/permission-broker';
import { checkSensitivePath } from '@agentdeck/services';
import type { PermissionDecision } from '@agentdeck/permission-broker';
import { createLocalStore, createMemoryService } from '@agentdeck/memory-service';
import { createCodeIndexer } from '@agentdeck/code-indexer';
import type Electron from 'electron';
import {
  DEFAULT_THEME_SETTINGS,
  IPC_CHANNELS,
  isAgentRuntimeResumeOptions,
  isAgentRuntimeSessionState,
  isAgentRuntimeStartSubagentOptions,
  isAgentRuntimeStartWorkerOptions,
  isAgentRuntimeTaskState,
  isAgentRuntimeWorkerState,
  isChatStreamEvent,
  isChatTabState,
  isPermissionApprovalInput,
  isRetrievalQuery,
  isThemeSettings,
  isWorkspaceEditInput,
  isWorkspaceOpenRequest,
  isMemoryConflictResolution,
  isMemoryScope,
  type MemoryChangeProposal,
  type MemoryScope,
  type ModelProviderId,
  type SearchQuery,
  type StartupState,
  type ToolCall,
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

const permissionBroker = createPermissionBroker();

function registerIpcHandlers(settingsService: SettingsService, workspaceService: WorkspaceService, mainWindow: BrowserWindow, identityService?: IdentityService, modelGateway?: ModelGateway): void {
  ipcMain.handle(IPC_CHANNELS.getStartupState, () => startupState);
  ipcMain.handle(IPC_CHANNELS.getThemeSettings, () => settingsService.readThemeSettings());
  ipcMain.handle(IPC_CHANNELS.setThemeSettings, (_event, value: unknown) => {
    return isThemeSettings(value) ? settingsService.writeThemeSettings(value) : DEFAULT_THEME_SETTINGS;
  });
  ipcMain.handle(IPC_CHANNELS.selectWorkspaceEntry, (_event, value: unknown) => selectWorkspaceEntry(value, mainWindow));

  ipcMain.handle(IPC_CHANNELS.openWorkspace, (_event, path: unknown, kind: unknown) => {
    if (typeof path !== 'string' || (kind !== 'folder' && kind !== 'workspace-file')) {
      throw new Error('Invalid workspace open request.');
    }
    return workspaceService.openWorkspace(path, kind);
  });

  ipcMain.handle(IPC_CHANNELS.listDirectory, (_event, path: unknown) => {
    if (typeof path !== 'string') throw new Error('Invalid path.');
    return workspaceService.listDirectory(path);
  });

  ipcMain.handle(IPC_CHANNELS.searchFiles, (_event, value: unknown) => {
    if (!isSearchQuery(value)) throw new Error('Invalid search query.');
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
      throw new Error('Invalid file path.');
    }
    return readEditorFile(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.writeFile, async (_event, filePath: unknown, content: unknown) => {
    if (typeof filePath !== 'string' || typeof content !== 'string') {
      throw new Error('Invalid arguments.');
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
      throw new Error('Invalid file path.');
    }
    return workspaceService.deleteFile(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.renameFile, async (_event, oldPath: unknown, newPath: unknown) => {
    if (typeof oldPath !== 'string' || typeof newPath !== 'string') {
      throw new Error('Invalid file paths.');
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
      throw new Error('Invalid workspace edit payload.');
    }
    return applyWorkspaceEdit(edit);
  });

  ipcMain.handle(IPC_CHANNELS.showDiff, async (_event, input: unknown) => {
    if (!isDiffInput(input)) {
      throw new Error('showDiff: invalid input - expected { original: string, modified: string }');
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

  // Permission Broker IPC handlers
  ipcMain.handle(IPC_CHANNELS.permissionBrokerGetState, () => permissionBroker.getState());
  ipcMain.handle(IPC_CHANNELS.permissionBrokerApproveDecision, (_event, input: unknown) => {
    if (!isPermissionApprovalInput(input)) {
      return { status: 'error', code: 'INVALID_SCOPE', message: 'Invalid approval input.' };
    }
    return permissionBroker.approve(input);
  });

  // Forward permission decisions to renderer
  permissionBroker.onDecision((decision: PermissionDecision) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.permissionBrokerDecisionChanged, decision);
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
    ipcMain.handle(IPC_CHANNELS.agentRuntimeListSessions, () => modelGateway.listAgentRuntimeSessions());
    ipcMain.handle(IPC_CHANNELS.agentRuntimeGetSession, (_event, sessionId: unknown) => {
      if (typeof sessionId !== 'string') return undefined;
      return modelGateway.getAgentRuntimeSession(sessionId);
    });
    ipcMain.handle(IPC_CHANNELS.agentRuntimeListWorkers, (_event, sessionId: unknown) => {
      if (sessionId !== undefined && typeof sessionId !== 'string') return [];
      return modelGateway.listAgentRuntimeWorkers(sessionId ?? undefined);
    });
    ipcMain.handle(IPC_CHANNELS.agentRuntimeGetWorker, (_event, workerId: unknown) => {
      if (typeof workerId !== 'string') return undefined;
      return modelGateway.getAgentRuntimeWorker(workerId);
    });
    ipcMain.handle(IPC_CHANNELS.agentRuntimeListTasks, (_event, sessionId: unknown) => {
      if (sessionId !== undefined && typeof sessionId !== 'string') return [];
      return modelGateway.listAgentRuntimeTasks(sessionId ?? undefined);
    });
    ipcMain.handle(IPC_CHANNELS.agentRuntimeGetTask, (_event, taskId: unknown) => {
      if (typeof taskId !== 'string') return undefined;
      return modelGateway.getAgentRuntimeTask(taskId);
    });
    ipcMain.handle(IPC_CHANNELS.agentRuntimeStartWorker, (_event, options: unknown) => {
      if (!isAgentRuntimeStartWorkerOptions(options)) {
        return { status: 'error' as const, code: 'UNKNOWN' as const, message: 'Invalid runtime worker start options.' };
      }
      return modelGateway.startAgentRuntimeWorker(options);
    });
    ipcMain.handle(IPC_CHANNELS.agentRuntimeStartSubagent, (_event, options: unknown) => {
      if (!isAgentRuntimeStartSubagentOptions(options)) {
        return { status: 'error' as const, code: 'UNKNOWN' as const, message: 'Invalid runtime subagent start options.' };
      }
      return modelGateway.startAgentRuntimeSubagent(options);
    });
    ipcMain.handle(IPC_CHANNELS.agentRuntimeResumeWorker, (_event, options: unknown) => {
      if (!isAgentRuntimeResumeOptions(options)) {
        return { status: 'error' as const, code: 'UNKNOWN' as const, message: 'Invalid runtime worker resume options.' };
      }
      return modelGateway.resumeAgentRuntimeWorker(options);
    });
    ipcMain.handle(IPC_CHANNELS.agentRuntimeStopWorker, (_event, workerId: unknown) => {
      if (typeof workerId !== 'string') {
        return { status: 'error' as const, code: 'UNKNOWN' as const, message: 'Invalid worker id.' };
      }
      return modelGateway.stopAgentRuntimeWorker(workerId);
    });
    ipcMain.handle(IPC_CHANNELS.agentRuntimeStopSession, (_event, sessionId: unknown) => {
      if (typeof sessionId !== 'string') {
        return { status: 'error' as const, code: 'UNKNOWN' as const, message: 'Invalid session id.' };
      }
      return modelGateway.stopAgentRuntimeSession(sessionId);
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
    modelGateway.on('agent-runtime-event', (event: unknown) => {
      if (mainWindow.isDestroyed()) return;
      if (isRecord(event) && typeof event.type === 'string') {
        const payload = event.payload;
        if (event.type === 'session-changed' && isAgentRuntimeSessionState(payload)) {
          mainWindow.webContents.send(IPC_CHANNELS.agentRuntimeSessionChanged, payload);
        } else if (event.type === 'task-changed' && isAgentRuntimeTaskState(payload)) {
          mainWindow.webContents.send(IPC_CHANNELS.agentRuntimeTaskChanged, payload);
        } else if (event.type === 'worker-changed' && isAgentRuntimeWorkerState(payload)) {
          mainWindow.webContents.send(IPC_CHANNELS.agentRuntimeWorkerChanged, payload);
        } else if (event.type === 'session-crashed' && isRecord(payload) && isAgentRuntimeSessionState(payload.session)) {
          const error = payload.error instanceof Error ? { message: payload.error.message } : { message: 'Runtime session crashed.' };
          mainWindow.webContents.send(IPC_CHANNELS.agentRuntimeSessionCrashed, payload.session, error);
        }
      }
    });

    // Model Gateway secure config handlers
    ipcMain.handle(IPC_CHANNELS.modelGatewayGetApiKey, async (_event, providerId: unknown) => {
      if (typeof providerId !== 'string') return null;
      return await identityService?.getModelApiKey(providerId as ModelProviderId) ?? null;
    });

    ipcMain.handle(IPC_CHANNELS.modelGatewaySetApiKey, async (_event, providerId: unknown, apiKey: unknown) => {
      if (typeof providerId !== 'string' || typeof apiKey !== 'string') return;
      await identityService?.setModelApiKey(providerId as ModelProviderId, apiKey);
    });

    ipcMain.handle(IPC_CHANNELS.modelGatewayDeleteApiKey, async (_event, providerId: unknown) => {
      if (typeof providerId !== 'string') return;
      await identityService?.deleteModelApiKey(providerId as ModelProviderId);
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
        // keytar unavailable ÔÇö hasApiKey stays false
      }
      return { baseUrl: config.baseUrl, hasApiKey };
    });
  }
}

function registerBuiltInTools(modelGateway: ModelGateway): void {
  modelGateway.registerTool({
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Reads a UTF-8 text file from the local workspace. Use only after the file is known to exist.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the file to read.' }
        },
        required: ['filePath'],
        additionalProperties: false
      }
    }
  });

  modelGateway.registerTool({
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Searches text across workspace roots with include/exclude glob filters.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Case-insensitive text to search for.' },
          workspaceRoots: { type: 'array', items: { type: 'string' }, description: 'Workspace root paths to search.' },
          include: { type: 'string', description: 'Optional comma-separated include globs.' },
          exclude: { type: 'string', description: 'Optional comma-separated exclude globs.' }
        },
        required: ['pattern', 'workspaceRoots'],
        additionalProperties: false
      }
    }
  });

  modelGateway.registerTool({
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Tworzy nowy plik tekstowy w workspace i zapisuje do niego zawarto┼Ť─ç. U┼╝ywaj tylko dla nowych plik├│w, nie do nadpisywania istniej─ůcych. Je┼Ťli podano tylko nazw─Ö pliku, ┼Ťcie┼╝ka zostanie rozwi─ůzana wzgl─Ödem projektu wskazanego przez inne pliki lub nazw─Ö projektu w rozmowie.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '┼Ücie┼╝ka nowego pliku. Mo┼╝e by─ç bezwzgl─Ödna, wzgl─Ödna wzgl─Ödem aktywnego workspace albo sama nazwa pliku.' },
          content: { type: 'string', description: 'Tre┼Ť─ç UTF-8 zapisywana do nowego pliku.' }
        },
        required: ['filePath'],
        additionalProperties: false
      }
    }
  });

  modelGateway.registerTool({
    type: 'function',
    function: {
      name: 'apply_patch',
      description: 'Applies a text patch to opened editor buffers. The caller must provide a valid workspace edit payload.',
      parameters: {
        type: 'object',
        properties: {
          operations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                filePath: { type: 'string' },
                text: { type: 'string' },
                range: {
                  type: 'object',
                  properties: {
                    startLine: { type: 'number' },
                    startCol: { type: 'number' },
                    endLine: { type: 'number' },
                    endCol: { type: 'number' }
                  },
                  required: ['startLine', 'startCol', 'endLine', 'endCol'],
                  additionalProperties: false
                }
              },
              required: ['filePath', 'text'],
              additionalProperties: false
            }
          }
        },
        required: ['operations'],
        additionalProperties: false
      }
    }
  });

  modelGateway.registerTool({
    type: 'function',
    function: {
      name: 'show_diff',
      description: 'Generates a unified diff between original and modified text.',
      parameters: {
        type: 'object',
        properties: {
          original: { type: 'string', description: 'Original text.' },
          modified: { type: 'string', description: 'Modified text.' }
        },
        required: ['original', 'modified'],
        additionalProperties: false
      }
    }
  });
}

function parseToolArguments(toolCall: ToolCall): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(toolCall.function.arguments);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isSearchQuery(value: unknown): value is SearchQuery {
  if (!isRecord(value)) return false;
  return typeof value.pattern === 'string' && Array.isArray(value.workspaceRoots);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function inferCreateFileContent(filePath: string): string {
  const extension = filePath.split(/[/\\]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'md' || extension === 'markdown') {
    return `# ${basename(filePath)}\n\nOpis pliku.\n`;
  }
  if (extension === 'json') {
    return '{\n  \n}\n';
  }
  if (extension === 'yaml' || extension === 'yml') {
    return '# Dodaj konfiguracj─Ö YAML.\n';
  }
  return '';
}

const FILE_EXTENSION_ALIASES = [
  '.md',
  '.markdown',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.cjs',
  '.mjs',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.py',
  '.cs',
  '.csproj',
  '.sln',
  '.ps1',
  '.psm1',
  '.psd1',
  '.txt',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.less',
  '.toml',
  '.ini',
  '.cfg',
  '.env',
  '.lock'
] as const;

function hasKnownFileExtension(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const fileName = normalized.split('/').pop()?.toLowerCase() ?? normalized.toLowerCase();
  return FILE_EXTENSION_ALIASES.some(extension => fileName.endsWith(extension));
}

function collectMessageText(contextMessages: readonly unknown[]): string {
  return contextMessages
    .filter((message): message is { content: unknown } => isRecord(message) && typeof message.content === 'string')
    .map(message => message.content)
    .join('\n');
}

function isFileNameToken(candidate: string): boolean {
  if (!candidate || candidate.includes('/') || candidate.includes('\\')) return false;
  if (!candidate.includes('.')) return false;
  if (candidate.startsWith('.') || candidate.endsWith('.')) return false;
  return hasKnownFileExtension(candidate);
}

function stripTrailingPunctuation(candidate: string): string {
  let end = candidate.length;
  while (end > 0) {
    const char = candidate[end - 1];
    if (char !== '.' && char !== ',' && char !== ';' && char !== ':') break;
    end -= 1;
  }
  return candidate.slice(0, end);
}

function inferFileNameFromMessages(contextMessages: readonly unknown[]): string | null {
  const joined = collectMessageText(contextMessages);
  const candidates = extractFileNameCandidates(joined);
  return candidates.find(candidate => hasKnownFileExtension(candidate)) ?? null;
}

export function inferTargetFileNameFromMessages(contextMessages: readonly unknown[]): string | null {
  const joined = collectMessageText(contextMessages);
  const lower = joined.toLowerCase();
  if (!hasWriteIntent(lower)) return null;

  const pathCandidates = extractPathCandidates(joined)
    .filter(candidate => hasKnownFileExtension(candidate));

  for (let index = pathCandidates.length - 1; index >= 0; index -= 1) {
    const candidate = pathCandidates[index]!;
    const candidateStart = lower.lastIndexOf(candidate.toLowerCase());
    if (candidateStart < 0) continue;

    const window = lower.slice(Math.max(0, candidateStart - 120), candidateStart + candidate.length + 40);
    if (hasTargetWriteMarker(window)) {
      return candidate;
    }
  }

  const nameCandidates = extractFileNameCandidates(joined)
    .filter(candidate => hasKnownFileExtension(candidate));

  for (let index = nameCandidates.length - 1; index >= 0; index -= 1) {
    const candidate = nameCandidates[index]!;
    const candidateStart = lower.lastIndexOf(candidate.toLowerCase());
    if (candidateStart < 0) continue;

    const window = lower.slice(Math.max(0, candidateStart - 120), candidateStart + candidate.length + 40);
    if (hasTargetWriteMarker(window)) {
      return candidate;
    }
  }

  return pathCandidates.at(-1) ?? nameCandidates.at(-1) ?? null;
}

function hasWriteIntent(lowerText: string): boolean {
  return lowerText.includes('zapisz')
    || lowerText.includes('zapisuj─Ö')
    || lowerText.includes('zapisano')
    || lowerText.includes('docelowa ┼Ťcie┼╝ka')
    || lowerText.includes('potwierd┼║')
    || lowerText.includes('potwierdzam');
}

function hasTargetWriteMarker(text: string): boolean {
  return text.includes('zapisz do pliku')
    || text.includes('zapisz do')
    || text.includes('zapisuj─Ö do')
    || text.includes('wynik zapisz do')
    || text.includes('streszczenie zapisz do')
    || text.includes('podsumowanie zapisz do')
    || text.includes('rezultat zapisz do')
    || text.includes('zapisz jako')
    || text.includes('zapisz pod')
    || text.includes('docelowa ┼Ťcie┼╝ka')
    || text.includes('lokalizacj─Ö');
}

function extractFileNameCandidates(text: string): string[] {
  const candidates: string[] = [];
  let tokenStart = -1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (tokenStart === -1) {
      if (isFileNameStart(char)) tokenStart = index;
      continue;
    }

    if (isFileNameBoundary(char)) {
      addFileNameCandidate(candidates, text, tokenStart, index);
      tokenStart = -1;
    }
  }

  if (tokenStart !== -1) {
    addFileNameCandidate(candidates, text, tokenStart, text.length);
  }

  return candidates;
}

function addFileNameCandidate(candidates: string[], text: string, start: number, end: number): void {
  const candidate = stripTrailingPunctuation(text.slice(start, end).trim());
  if (isFileNameToken(candidate)) candidates.push(candidate);
}

function isFileNameStart(char: string | undefined): boolean {
  return char !== undefined && isAsciiLetterOrDigit(char);
}

function isAsciiLetterOrDigit(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isFileNameBoundary(char: string | undefined): boolean {
  if (char === undefined) return true;
  if (isWhitespace(char) || isQuote(char)) return true;
  return char === '(' || char === ')' || char === '[' || char === ']' || char === '{' || char === '}' || char === ',' || char === ';' || char === ':' || char === '<' || char === '>' || char === '=';
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}

function isQuote(char: string | undefined): boolean {
  return char === '"' || char === "'" || char === '`';
}

function inferFilePathFromMessages(contextMessages: readonly unknown[]): string | null {
  const joined = collectMessageText(contextMessages);
  const candidates = extractPathCandidates(joined);
  return candidates.find(candidate => hasKnownFileExtension(candidate)) ?? null;
}

function extractPathCandidates(text: string): string[] {
  const candidates: string[] = [];
  let tokenStart = -1;
  let quote: string | null = null;

  for (let index = 0; index < text.length; index += 1) {
    if (tokenStart === -1) {
      const start = startPathToken(text, index);
      if (start !== null) {
        tokenStart = start.start;
        quote = start.quote;
      }
      continue;
    }

    if (isPathTokenEnd(text, index, quote)) {
      addPathCandidate(candidates, text, tokenStart, index);
      tokenStart = -1;
      quote = null;
    }
  }

  if (tokenStart !== -1) {
    addPathCandidate(candidates, text, tokenStart, text.length);
  }

  return candidates;
}

function startPathToken(text: string, index: number): { start: number; quote: string | null } | null {
  const char = text[index];
  if (char !== undefined && isQuote(char)) {
    const nextIndex = index + 1;
    if (isPathStartAt(text, nextIndex)) return { start: nextIndex, quote: char };
    return null;
  }

  if (isPathStartAt(text, index)) return { start: index, quote: null };
  return null;
}

function isPathTokenEnd(text: string, index: number, quote: string | null): boolean {
  const char = text[index];
  if (quote !== null) return char === quote;
  if (isWindowsDriveColon(text, index)) return false;
  return isPathBoundary(char);
}

function addPathCandidate(candidates: string[], text: string, start: number, end: number): void {
  const rawCandidate = stripTrailingPunctuation(text.slice(start, end).trim());
  const candidate = trimPathCandidateToKnownExtension(rawCandidate);
  if (candidate && isPathToken(candidate)) candidates.push(candidate);
}

function trimPathCandidateToKnownExtension(candidate: string): string {
  const normalized = candidate.replaceAll('`', '').trim();
  const lower = normalized.toLowerCase();

  for (const extension of FILE_EXTENSION_ALIASES) {
    const index = lower.lastIndexOf(extension);
    if (index < 0) continue;

    const nextChar = normalized[index + extension.length];
    if (nextChar !== undefined && isAsciiLetterOrDigit(nextChar)) continue;

    return normalized.slice(0, index + extension.length).trim();
  }

  return normalized;
}

function isPathStartAt(text: string, index: number): boolean {
  const char = text[index];
  const previous = index > 0 ? text[index - 1] : undefined;
  const hasWhitespaceOrQuoteBoundary = previous === undefined || isWhitespace(previous) || isQuote(previous);

  if (char === '/' || char === '\\') return hasWhitespaceOrQuoteBoundary;
  return hasWhitespaceOrQuoteBoundary && isWindowsDriveStartAt(text, index);
}

function isWindowsDriveStartAt(text: string, index: number): boolean {
  const char = text[index];
  const separator = text[index + 2];
  return char !== undefined
    && isAsciiLetterOrDigit(char)
    && text[index + 1] === ':'
    && (separator === '/' || separator === '\\');
}

function isWindowsDriveColon(text: string, index: number): boolean {
  const previous = index > 0 ? text[index - 1] : undefined;
  const next = text[index + 1];
  return previous !== undefined && isAsciiLetterOrDigit(previous) && (next === '/' || next === '\\');
}

function isPathBoundary(char: string | undefined): boolean {
  if (char === undefined) return true;
  if (isWhitespace(char)) return true;
  return char === '(' || char === ')' || char === '[' || char === ']' || char === '{' || char === '}' || char === ',' || char === ';' || char === '<' || char === '>' || char === '=';
}

function isPathToken(candidate: string): boolean {
  if (candidate.length === 0) return false;
  if (!candidate.includes('/') && !candidate.includes('\\')) return false;
  if (!hasKnownFileExtension(candidate)) return false;
  return !candidate.includes('<') && !candidate.includes('>') && !candidate.includes('|') && !candidate.includes('*') && !candidate.includes('?');
}

function inferFileNamesFromMessages(contextMessages: readonly unknown[], limit = 8): string[] {
  const joined = collectMessageText(contextMessages);
  const matches = extractFileNameCandidates(joined)
    .filter(candidate => hasKnownFileExtension(candidate));

  const uniqueNames: string[] = [];
  for (const candidate of matches) {
    if (!uniqueNames.some(name => name.toLowerCase() === candidate.toLowerCase())) {
      uniqueNames.push(candidate);
    }
    if (uniqueNames.length >= limit) break;
  }
  return uniqueNames;
}

function inferPrimaryReferencedFileName(contextMessages: readonly unknown[], targetFilePath: string): string | null {
  const targetBasename = basename(targetFilePath.replaceAll('\\', '/')).toLowerCase();
  return inferFileNamesFromMessages(contextMessages).find(name => basename(name.replaceAll('\\', '/')).toLowerCase() !== targetBasename) ?? null;
}

function buildSearchQueryForFileName(fileName: string, workspaceRoots: readonly string[]): SearchQuery {
  return {
    pattern: fileName,
    workspaceRoots: workspaceRoots.length > 0 ? [...workspaceRoots] : ['.'],
    include: `**/${fileName}`
  };
}

async function findFilesByName(fileName: string, workspaceRoots: readonly string[]): Promise<string[]> {
  const roots = workspaceRoots.length > 0 ? [...workspaceRoots] : ['.'];
  const skippedDirs = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.tox', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage']);
  const matches: string[] = [];
  const normalizedFileName = fileName.replaceAll('\\', '/').split('/').pop()?.toLowerCase() ?? fileName.toLowerCase();

  async function scanDir(dir: string): Promise<void> {
    if (matches.length >= 50) return;

    const dirents = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!dirents) return;

    for (const dirent of dirents) {
      if (matches.length >= 50) break;

      const fullPath = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (!skippedDirs.has(dirent.name)) {
          await scanDir(fullPath);
        }
        continue;
      }

      if (dirent.isFile() && dirent.name.toLowerCase() === normalizedFileName) {
        matches.push(fullPath);
      }
    }
  }

  for (const root of roots) {
    await scanDir(root);
    if (matches.length >= 50) break;
  }

  return matches;
}

function resolveCandidateAgainstWorkspaceRoots(candidate: string, workspaceRoots: readonly string[]): string | readonly string[] {
  const roots = workspaceRoots.length > 0 ? [...workspaceRoots] : ['.'];
  const candidates = roots.map(root => resolve(root, candidate));
  const existing = candidates.filter(path => existsSync(path));

  if (existing.length === 1) return existing[0]!;
  if (existing.length > 1) return existing;
  return candidates[0] ?? candidate;
}

function inferProjectNameFromMessages(contextMessages: readonly unknown[]): string | null {
  const joined = collectMessageText(contextMessages);
  const markers = ['projekt ', 'projekcie ', 'projektu ', 'project ', 'repo ', 'repozytorium '];
  const lower = joined.toLowerCase();

  for (const marker of markers) {
    const markerIndex = lower.indexOf(marker);
    if (markerIndex === -1) continue;

    const valueStart = markerIndex + marker.length;
    const value = extractQuotedOrPlainValue(joined, valueStart);
    if (value) return value;
  }

  return null;
}

function extractQuotedOrPlainValue(text: string, startIndex: number): string | null {
  const valueStart = findNonWhitespace(text, startIndex);
  if (valueStart === text.length) return null;

  const quote = getQuote(text[valueStart]);
  if (quote !== null) {
    const endQuote = text.indexOf(quote, valueStart + 1);
    const end = endQuote === -1 ? text.length : endQuote;
    return normalizeProjectName(text.slice(valueStart + 1, end));
  }

  const end = findPlainValueEnd(text, valueStart);
  return normalizeProjectName(text.slice(valueStart, end));
}

function findNonWhitespace(text: string, startIndex: number): number {
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char !== undefined && !isWhitespace(char)) return index;
  }
  return text.length;
}

function getQuote(char: string | undefined): string | null {
  if (char === '"' || char === "'" || char === '`') return char;
  return null;
}

function findPlainValueEnd(text: string, startIndex: number): number {
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\n' || char === '\r' || char === ',' || char === ';' || char === '.' || char === ':') {
      return index;
    }
  }
  return text.length;
}

function normalizeProjectName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;

  for (const char of trimmed) {
    if (!isProjectNameChar(char)) return null;
  }
  return trimmed;
}

function isProjectNameChar(char: string): boolean {
  return isAsciiLetterOrDigit(char) || char === '_' || char === ' ' || char === '.' || char === '-';
}

function preferRootsByProjectName(workspaceRoots: readonly string[], projectName: string | null): readonly string[] {
  if (!projectName) return workspaceRoots;
  const normalized = normalizeProjectNameForComparison(projectName);
  const preferred = workspaceRoots.filter(root => {
    const base = normalizeProjectNameForComparison(basename(root));
    return base.includes(normalized) || normalized.includes(base);
  });
  return preferred.length > 0 ? preferred : workspaceRoots;
}

function normalizeProjectNameForComparison(value: string): string {
  let result = '';
  for (const char of value) {
    const lower = char.toLowerCase();
    if (lower === ' ' || lower === '_' || lower === '-') continue;
    result += lower;
  }
  return result;
}

function pickBestMatch(matches: readonly string[]): string | null {
  // Preferuj plik bezpo┼Ťrednio w katalogu g┼é├│wnym projektu (najkr├│tsza ┼Ťcie┼╝ka),
  // z pomini─Öciem katalog├│w cache/build/test.
  const noisySegments = ['.pytest_cache', 'node_modules', 'tests', 'test', 'fixtures', 'dist', 'build', 'out', '.venv', 'coverage'];
  const clean = matches.filter(file => {
    const normalized = file.replaceAll('\\', '/').toLowerCase();
    return !noisySegments.some(seg => normalized.includes(`/${seg}/`));
  });
  const pool = clean.length > 0 ? clean : [...matches];
  pool.sort((a, b) => countPathSegments(a) - countPathSegments(b));
  return pool[0] ?? null;
}

function countPathSegments(path: string): number {
  let count = 0;
  let previousWasSeparator = true;

  for (const char of path) {
    if (char === '/' || char === '\\') {
      if (!previousWasSeparator) count += 1;
      previousWasSeparator = true;
    } else {
      previousWasSeparator = false;
    }
  }

  return previousWasSeparator ? count : count + 1;
}

async function resolveReadFilePath(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<string | readonly string[] | null> {
  const messages = context?.messages ?? [];
  const workspaceRoots = context?.workspaceRoots ?? [];

  if (typeof args.filePath === 'string') {
    const filePath = args.filePath.trim();
    if (!filePath) return null;
    if (isAbsolute(filePath)) return resolve(filePath);
    const projectName = inferProjectNameFromMessages(messages);
    const preferredRoots = preferRootsByProjectName(workspaceRoots, projectName);
    return resolveCandidateAgainstWorkspaceRoots(filePath, preferredRoots);
  }

  const fullPath = inferFilePathFromMessages(messages);
  if (fullPath) {
    const trimmed = fullPath.trim();
    if (isAbsolute(trimmed)) return resolve(trimmed);
    return resolveCandidateAgainstWorkspaceRoots(trimmed, workspaceRoots);
  }

  const fileName = inferFileNameFromMessages(messages);
  if (!fileName) return null;

  const projectName = inferProjectNameFromMessages(messages);
  const preferredRoots = preferRootsByProjectName(workspaceRoots, projectName);

  const matches = await findFilesByName(fileName, preferredRoots);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const best = pickBestMatch(matches);
    if (best) return best;
    return matches;
  }
  return null;
}

async function resolveReadWriteFilePath(filePath: string, context?: ToolExecutionContext): Promise<string | readonly string[] | null> {
  const workspaceRoots = context?.workspaceRoots ?? [];
  const messages = context?.messages ?? [];
  const trimmed = filePath.trim();
  if (!trimmed) return null;
  if (isAbsolute(trimmed)) return resolve(trimmed);

  const referencedFilePath = inferFilePathFromMessages(messages);
  if (referencedFilePath) {
    const preferredRoots = preferRootsByProjectName([dirname(referencedFilePath)], null);
    const roots = preferredRoots.length > 0 ? preferredRoots : workspaceRoots;
    return resolveCandidateAgainstWorkspaceRoots(trimmed, roots);
  }

  const referencedFileName = inferPrimaryReferencedFileName(messages, trimmed);
  if (referencedFileName) {
    const matches = await findFilesByName(referencedFileName, workspaceRoots);
    const best = pickBestMatch(matches);
    if (best) {
      const preferredRoots = preferRootsByProjectName([dirname(best)], null);
      const roots = preferredRoots.length > 0 ? preferredRoots : workspaceRoots;
      return resolveCandidateAgainstWorkspaceRoots(trimmed, roots);
    }
  }

  return resolveCandidateAgainstWorkspaceRoots(trimmed, workspaceRoots);
}

function resolveSearchQuery(args: Record<string, unknown>, context?: ToolExecutionContext): SearchQuery | null {
  const workspaceRoots = context?.workspaceRoots ?? [];
  const explicitRoots = Array.isArray(args.workspaceRoots) && args.workspaceRoots.length > 0
    ? args.workspaceRoots.filter((root): root is string => typeof root === 'string')
    : [];

  let roots: string[];
  if (explicitRoots.length > 0) {
    roots = explicitRoots;
  } else if (workspaceRoots.length > 0) {
    roots = [...workspaceRoots];
  } else {
    roots = ['.'];
  }

  if (typeof args.pattern === 'string' && args.pattern.trim()) {
    const pattern = args.pattern.trim();
    const include = resolveSearchInclude(pattern, args.include);
    const exclude = typeof args.exclude === 'string' ? args.exclude : undefined;
    return { pattern, include, exclude, workspaceRoots: roots };
  }

  const fileName = inferFileNameFromMessages(context?.messages ?? []);
  if (!fileName) return null;
  return buildSearchQueryForFileName(fileName, workspaceRoots);
}

function resolveSearchInclude(pattern: string, include: unknown): string {
  if (typeof include === 'string' && include.trim()) {
    return include.trim();
  }

  if (pattern.includes('/') || pattern.includes('\\')) {
    return `**/${basename(pattern.replaceAll('\\', '/'))}`;
  }
  return `**/${pattern}`;
}

function isDiffInput(value: unknown): value is { original: string; modified: string } {
  if (!isRecord(value)) return false;
  return typeof value.original === 'string' && typeof value.modified === 'string';
}

function isSingleResolvedPath(value: unknown): value is string {
  return typeof value === 'string';
}

async function executeReadFileTool(toolCall: ToolCall, context?: ToolExecutionContext): Promise<string> {
  const args = parseToolArguments(toolCall);
  const resolvedPath = await resolveReadFilePath(args, context);
  if (resolvedPath === null) {
    return JSON.stringify({ error: 'read_file: missing filePath' });
  }
  if (Array.isArray(resolvedPath)) {
    return JSON.stringify({
      status: 'error',
      code: 'AMBIGUOUS_FILE',
      message: `Znaleziono kilka plik├│w o nazwie lub ┼Ťcie┼╝ce pasuj─ůcej do ┼╝─ůdania: ${resolvedPath.join(', ')}`,
      candidates: resolvedPath
    });
  }

  const filePath = resolvedPath as string;
  const result = await readEditorFile(filePath);
  if (result.status === 'error') {
    return JSON.stringify(result);
  }
  return JSON.stringify({
    status: 'ok',
    filePath,
    content: result.content,
    encoding: result.encoding
  });
}

async function executeSearchFilesTool(toolCall: ToolCall, context: ToolExecutionContext | undefined, workspaceService: WorkspaceService): Promise<string> {
  const args = parseToolArguments(toolCall);
  const query = resolveSearchQuery(args, context);
  if (!query) {
    return JSON.stringify({ error: 'search_files: invalid query' });
  }
  const result = await workspaceService.searchFiles(query);
  if (Array.isArray(result)) {
    if (result.length === 0) {
      return handleEmptySearchResults(query, context);
    }
    return JSON.stringify({
      status: 'ok',
      query,
      results: result.map(item => ({
        file: item.file,
        line: item.line,
        col: item.col,
        snippet: item.snippet,
        isSensitive: item.isSensitive
      }))
    });
  }
  return JSON.stringify(result);
}

async function handleEmptySearchResults(query: SearchQuery, context: ToolExecutionContext | undefined): Promise<string> {
  const fileName = inferFileNameFromMessages(context?.messages ?? []);
  if (!fileName) {
    return noSearchResultsResponse(query);
  }

  const projectName = inferProjectNameFromMessages(context?.messages ?? []);
  const preferredRoots = preferRootsByProjectName(context?.workspaceRoots ?? [], projectName);
  const matches = await findFilesByName(fileName, preferredRoots);
  const best = pickBestMatch(matches);
  if (!best) {
    return noSearchResultsResponse(query);
  }

  const fileResult = await readEditorFile(best);
  if (fileResult.status === 'ok') {
    return fileSearchFallbackResponse(query, best, fileResult.content, fileResult.encoding);
  }
  return fileMatchesWithoutContentResponse(query, matches);
}

function noSearchResultsResponse(query: SearchQuery): string {
  return JSON.stringify({
    status: 'ok',
    query,
    results: [],
    message: 'Nie znaleziono wynik├│w wyszukiwania w aktywnym workspace.'
  });
}

function fileSearchFallbackResponse(query: SearchQuery, filePath: string, content: string, encoding: string): string {
  return JSON.stringify({
    status: 'ok',
    query,
    results: [],
    file: filePath,
    content,
    encoding,
    message: 'Wyszukiwanie tekstowe nie zwr├│ci┼éo wynik├│w; zwracam zawarto┼Ť─ç najlepiej pasuj─ůcego pliku.'
  });
}

function fileMatchesWithoutContentResponse(query: SearchQuery, matches: readonly string[]): string {
  return JSON.stringify({
    status: 'ok',
    query,
    results: [],
    files: matches.map(file => ({ file })),
    message: 'Znaleziono pasuj─ůce pliki, ale nie uda┼éo si─Ö odczyta─ç zawarto┼Ťci.'
  });
}

async function executeApplyPatchTool(toolCall: ToolCall): Promise<string> {
  const args = parseToolArguments(toolCall);
  if (!isWorkspaceEditInput(args)) {
    return JSON.stringify({ error: 'apply_patch: invalid patch payload' });
  }
  const result = await applyWorkspaceEdit(args);
  return JSON.stringify(result);
}

async function executeCreateFileTool(toolCall: ToolCall, context?: ToolExecutionContext): Promise<string> {
  const args = parseToolArguments(toolCall);
  const messages = context?.messages ?? [];
  let filePath = typeof args.filePath === 'string' ? args.filePath : null;
  if (!filePath) {
    filePath = inferTargetFileNameFromMessages(messages) ?? inferFileNameFromMessages(messages);
  }
  if (!filePath) {
    return JSON.stringify({ error: 'create_file: missing filePath' });
  }
  if (args.content !== undefined && typeof args.content !== 'string') {
    return JSON.stringify({ error: 'create_file: invalid content - expected string' });
  }
  const resolvedPath = await resolveReadWriteFilePath(filePath, context);
  if (resolvedPath === null) {
    return JSON.stringify({ error: 'create_file: unable to resolve filePath' });
  }
  if (!isSingleResolvedPath(resolvedPath)) {
    return JSON.stringify({
      status: 'error',
      code: 'WRITE_CONFLICT',
      message: `┼Ücie┼╝ka jest niejednoznaczna: ${resolvedPath.join(', ')}`
    });
  }
  const resolvedFilePath = resolve(resolvedPath);
  if (existsSync(resolvedFilePath)) {
    return JSON.stringify({
      status: 'error',
      code: 'WRITE_CONFLICT',
      message: `Plik ju┼╝ istnieje: ${resolvedFilePath}`
    });
  }
  await mkdir(dirname(resolvedFilePath), { recursive: true });
  const result = await createEditorFile(resolvedFilePath, typeof args.content === 'string' ? args.content : inferCreateFileContent(filePath));
  if (result.status === 'ok') {
    return JSON.stringify({ ...result, filePath: resolvedFilePath });
  }
  return JSON.stringify(result);
}

async function executeShowDiffTool(toolCall: ToolCall): Promise<string> {
  const args = parseToolArguments(toolCall);
  if (!isDiffInput(args)) {
    return JSON.stringify({ error: 'show_diff: invalid input' });
  }
  const result = showDiff(args.original, args.modified);
  return JSON.stringify(result);
}

async function resolveStartupState(): Promise<StartupState> {
  try {
    return await bootstrapDesktopServices({ appVersion: app.getVersion() });
  } catch {
    return createStartupErrorState(app.getVersion());
  }
}

function registerPhase9IpcHandlers(
  localStore: ReturnType<typeof createLocalStore>,
  memoryService: ReturnType<typeof createMemoryService>,
  codeIndexer: ReturnType<typeof createCodeIndexer>,
  getMainWindow: () => Electron.BrowserWindow | null = () => null
): void {
  const pendingMemoryProposals = new Map<string, MemoryChangeProposal>();
  ipcMain.handle(IPC_CHANNELS.listMemories, async (_event, scope: unknown) => {
    const result = await memoryService.list(scope as MemoryScope);
    if (result.status === 'ok') return result.entries;
    throw new Error(result.message ?? 'Unknown memory service error');
  });

  ipcMain.handle(IPC_CHANNELS.readMemory, async (_event, scope: unknown, filePath: unknown) => {
    if (typeof filePath !== 'string') {
      return { status: 'error' as const, code: 'UNKNOWN' as const, message: 'Invalid filePath.' };
    }
    return memoryService.read(scope as MemoryScope, filePath);
  });

  ipcMain.handle(IPC_CHANNELS.proposeMemoryChange, async (_event, edit: unknown) => {
    if (!isRecord(edit) || typeof edit.filePath !== 'string' || typeof edit.text !== 'string') {
      throw new TypeError('Invalid edit payload.');
    }
    if (!isMemoryScope(edit.scope)) {
      throw new TypeError('Invalid memory scope.');
    }
    // Defense-in-depth: validate path containment within memory directory.
    // A compromised renderer could attempt to read arbitrary files via path traversal.
    let validatedPath: string;
    try {
      validatedPath = memoryService.resolveValidatedPath(edit.filePath);
    } catch {
      return { status: 'error', code: 'FORBIDDEN', message: 'Path outside memory directory.' };
    }
    const result = await memoryService.proposeEdit({
      scope: edit.scope,
      filePath: validatedPath,
      text: edit.text
    });
    if (result.status === 'ok') return result.proposal;
    throw new Error(result.message);
  });

  ipcMain.handle(IPC_CHANNELS.applyMemoryChange, async (_event, proposal: unknown) => {
    if (!isRecord(proposal) || typeof proposal.filePath !== 'string') {
      throw new Error('Invalid proposal payload.');
    }
    // Defense-in-depth: validate path containment within memory directory.
    // A compromised renderer could attempt to overwrite arbitrary files.
    const validatedPath = memoryService.resolveValidatedPath(proposal.filePath);
    const sensitiveCheck = checkSensitivePath(validatedPath);
    if (sensitiveCheck.isSensitive) {
      return { status: 'error', code: 'ACCESS_DENIED', message: `Zapis na wrażliwej ścieżce zabroniony: ${validatedPath}` };
    }
    const result = await memoryService.applyEdit({
      scope: proposal.scope as MemoryScope,
      filePath: validatedPath,
      patch: proposal.patch as MemoryChangeProposal['patch'],
      diff: proposal.diff as string | undefined
    });
    if (result.status === 'error' && result.conflict) {
      pendingMemoryProposals.set(result.conflict.id, {
        scope: proposal.scope as MemoryScope,
        filePath: validatedPath,
        patch: proposal.patch as MemoryChangeProposal['patch'],
        diff: proposal.diff as string | undefined
      });
      const mw = getMainWindow();
      if (mw) {
        mw.webContents.send(IPC_CHANNELS.memoryConflictDetected, result.conflict);
      }
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.memoryConflictResolve, async (_event, resolution: unknown) => {
    if (!isMemoryConflictResolution(resolution)) {
      throw new Error('Invalid memory conflict resolution.');
    }
    const pending = pendingMemoryProposals.get(resolution.conflictId);
    if (!pending) {
      return { status: 'error', code: 'NOT_FOUND', message: 'Nie znaleziono konfliktu do rozwiązania.' };
    }
    pendingMemoryProposals.delete(resolution.conflictId);
    if (resolution.action === 'skip') {
      return { status: 'ok' };
    }
    if (resolution.action === 'edit') {
      const entry = await memoryService.write(pending.scope, pending.filePath, resolution.text);
      return { status: 'ok', entry };
    }
    const result = await memoryService.applyEdit(pending);
    if (result.status === 'error' && result.conflict) {
      pendingMemoryProposals.set(result.conflict.id, pending);
      const mw = getMainWindow();
      if (mw) {
        mw.webContents.send(IPC_CHANNELS.memoryConflictDetected, result.conflict);
      }
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.indexCodeFile, async (_event, filePath: unknown, scope: unknown) => {
    if (typeof filePath !== 'string') {
      throw new Error('Invalid filePath.');
    }
    return codeIndexer.indexFile(filePath, scope as MemoryScope | undefined);
  });

  ipcMain.handle(IPC_CHANNELS.retrieveCode, async (_event, query: unknown) => {
    if (!isRetrievalQuery(query)) {
      throw new TypeError('Invalid retrieval query.');
    }
    return codeIndexer.retrieve(query);
  });

  ipcMain.handle(IPC_CHANNELS.rebuildCodeIndex, async (_event, roots: unknown) => {
    const rootArray = Array.isArray(roots) ? roots as string[] : [];
    return codeIndexer.rebuildIndex(rootArray);
  });
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
    openUrl: (url) => shell.openExternal(url),
    onFallbackWarning: (warning) => {
      // Send warning to renderer so UI can display it to the user
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.identityWarning, warning);
      }
    }
  });
  const modelGateway = createModelGateway(
    async (toolCall: ToolCall, context?: ToolExecutionContext) => {
      const toolAction = classifyToolAction(toolCall.function.name);
      const workspaceRoots = workspaceService.getWorkspaceRoots();
      const permissionRequest = buildPermissionRequest(toolCall, toolAction, workspaceRoots);
      const evaluation = await permissionBroker.evaluate(permissionRequest);

      if (evaluation.decision === 'deny') {
        return JSON.stringify({ error: `Permission denied: ${evaluation.reason}` });
      }

      if (evaluation.decision === 'prompt') {
        return JSON.stringify({ error: `Permission required: ${evaluation.reason}`, permissionPrompt: true, decisionId: evaluation.decisionId });
      }

      const startedAt = Date.now();
      let outcome: 'success' | 'error' = 'success';
      let result: string;
      try {
        switch (toolCall.function.name) {
          case 'read_file':
            result = await executeReadFileTool(toolCall, context);
            break;
          case 'search_files':
            result = await executeSearchFilesTool(toolCall, context, workspaceService);
            break;
          case 'apply_patch':
            result = await executeApplyPatchTool(toolCall);
            break;
          case 'create_file':
            result = await executeCreateFileTool(toolCall, context);
            break;
          case 'show_diff':
            result = await executeShowDiffTool(toolCall);
            break;
          default:
            result = JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
        }
      } catch (err) {
        outcome = 'error';
        result = JSON.stringify({ error: String(err) });
      }

      const decision = createToolDecision(toolCall, toolAction, evaluation, startedAt);
      permissionBroker.afterToolCall(permissionRequest, decision, outcome, Date.now() - startedAt);
      return result;
    },
    () => workspaceService.getWorkspaceRoots()
  );

  registerBuiltInTools(modelGateway);

  const apiKeyProvider = async (providerId: ModelProviderId): Promise<string | null> => {
    try {
      const keytar = await import('keytar');
      return await keytar.getPassword('agentdeck', `api-key-${providerId}`);
    } catch {
      return null;
    }
  };

  // Register default provider adapters
  for (const adapter of createDefaultAdapters(apiKeyProvider)) {
    modelGateway.registerAdapter(adapter);
  }

  startupState = await resolveStartupState();

  // Set frame-ancestors CSP via HTTP header (not supported in <meta> tags)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };

    // Case-insensitive lookup ÔÇö Electron/Chromium returns lowercase keys
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
  // Phase 9: Memory Service and Code Indexer
  const phase9Store = createLocalStore(join(app.getPath('userData'), 'agentdeck-local-store.db'));
  const phase9Memory = createMemoryService({ author: 'agentdeck', baseDir: app.getPath('userData') });
  const phase9Indexer = createCodeIndexer({
    store: phase9Store,
    memoryService: phase9Memory,
    workspaceRoots: workspaceService.getWorkspaceRoots(),
    indexVersion: 'phase9-v1'
  });

  registerPhase9IpcHandlers(phase9Store, phase9Memory, phase9Indexer, () => mainWindow);

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

// ?? Permission Broker helpers ?????????????????????????????????????????????

type ToolAction = 'read' | 'write' | 'delete' | 'workspaceEdit';
type ToolRiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';
type ToolDecision = 'allow' | 'prompt' | 'deny';

function classifyToolAction(toolName: string): ToolAction {
  switch (toolName) {
    case 'read_file':
    case 'search_files':
    case 'show_diff':
      return 'read';
    case 'create_file':
    case 'apply_patch':
      return 'write';
    case 'delete_file':
      return 'delete';
    case 'rename_file':
      return 'workspaceEdit';
    default:
      return 'read';
  }
}

function buildPermissionRequest(
  toolCall: ToolCall,
  action: ToolAction,
  workspaceRoots: readonly string[]
) {
  return {
    id: `req-${crypto.randomUUID()}`,
    sessionId: 'main-session',
    taskId: `task-${toolCall.id}`,
    workerId: undefined,
    actorKind: 'agent' as const,
    kind: action,
    toolName: toolCall.function.name,
    target: extractToolTarget(toolCall),
    metadata: { arguments: toolCall.function.arguments },
    workspaceRoots,
    runtimeKind: 'parent' as const
  };
}

function extractToolTarget(toolCall: ToolCall): string {
  try {
    const args = JSON.parse(toolCall.function.arguments);
    if (typeof args.filePath === 'string') return args.filePath;
    if (typeof args.target === 'string') return args.target;
    return toolCall.function.name;
  } catch {
    return toolCall.function.name;
  }
}

function createToolDecision(
  toolCall: ToolCall,
  action: ToolAction,
  evaluation: { decision: string; risk: string; reason: string; decisionId?: string | undefined },
  startedAt: number
) {
  return {
    id: `decision-${startedAt}`,
    requestId: `req-${startedAt}`,
    sessionId: 'main-session',
    taskId: `task-${toolCall.id}`,
    workerId: undefined,
    actorKind: 'agent' as const,
    kind: action,
    toolName: toolCall.function.name,
    target: extractToolTarget(toolCall),
    runtimeKind: 'parent' as const,
    risk: evaluation.risk as ToolRiskLevel,
    decision: evaluation.decision as ToolDecision,
    reason: evaluation.reason,
    createdAt: startedAt
  };
}