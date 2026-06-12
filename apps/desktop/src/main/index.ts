import { config } from 'dotenv';
import { app, BrowserWindow, dialog, ipcMain, Menu, globalShortcut, session, shell } from 'electron';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { applyWorkspaceEdit, bootstrapDesktopServices, createSettingsService, createStartupErrorState, createWorkspaceService, getDiagnostics, markBufferDirty, readEditorFile, showDiff, createIdentityService, type IdentityService, type SettingsService, type WorkspaceService, writeEditorFile, createModelGateway, createDefaultAdapters, type ModelGateway, PermissionBroker, ConflictBroker, computeFileHash, ToolRouter, checkSensitivePath, getEventLogService, isBinaryFile } from '@agentdeck/services';
// Use the static method directly
const classifyOperationKind = ConflictBroker.classifyOperationKind;
import {
  DEFAULT_THEME_SETTINGS,
  IPC_CHANNELS,
  isApprovalDecision,
  isChatStreamEvent,
  isChatTabState,
  isDiffInput,
  isThemeSettings,
  isToolCallRequest,
  isWorkspaceEditInput,
  isWorkspaceOpenRequest,
  type EventLogFilter,
  type EventLogEntry,
  type ModelProviderId,
  type SearchQuery,
  type StartupState,
  type ToolCallRequest,
  type ToolRiskLevel,
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

// Module-level reference to the ToolRouter, set by registerToolRouterIpc.
// Used by applyWorkspaceEdit IPC handler to route multi-file edits through PermissionBroker.
let toolRouterRef: ToolRouter | null = null;

/** Check operations for sensitive paths. Returns ACCESS_DENIED result or null. */
function checkSensitivePaths(edit: { operations: readonly { filePath: string }[] }): { status: 'error'; code: 'ACCESS_DENIED'; message: string } | null {
  for (const op of edit.operations) {
    if (checkSensitivePath(op.filePath).isSensitive) {
      return { status: 'error', code: 'ACCESS_DENIED', message: `Edycja wrażliwego pliku zabroniona: ${op.filePath}` };
    }
  }
  return null;
}

/** Route a multi-file workspace edit through the ToolRouter approval flow. */
async function routeMultiFileEdit(
  edit: { operations: readonly { filePath: string }[] },
  uniqueFiles: Set<string>,
  win: BrowserWindow,
): Promise<{ status: 'ok' } | { status: 'error'; code: string; message: string }> {
  const router = toolRouterRef;
  if (!router) {
    return { status: 'error', code: 'UNKNOWN', message: 'Tool Router nie został zainicjalizowany.' };
  }
  const toolRequest: ToolCallRequest = {
    callId: `workspace-edit-${Date.now()}-${randomBytes(4).toString('hex')}`,
    toolName: 'applyPatch',
    args: { workspaceEdit: edit, fileCount: uniqueFiles.size, filePaths: Array.from(uniqueFiles) },
  };
  const response = await router.execute(toolRequest);

  if (response.status === 'pending-approval') {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.toolApprovalRequest, response);
    }
    const kind = classifyOperationKind('multi-file');
    console.warn(`[main] Multi-file edit (${uniqueFiles.size} files) pending approval, kind: ${kind}`);
    return { status: 'error', code: 'UNKNOWN', message: 'Oczekuje na zatwierdzenie — edycja wielu plików (multi-file).' };
  }

  if (response.status === 'error') {
    return { status: 'error', code: (response as { code: string }).code ?? 'UNKNOWN', message: response.message };
  }

  console.info(`[main] Multi-file edit (${uniqueFiles.size} files) applied after approval.`);
  return { status: 'ok' };
}

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
    if (checkSensitivePath(filePath).isSensitive) {
      return { status: 'error', code: 'ACCESS_DENIED', message: `Zapis na wrażliwej ścieżce zabroniony: ${filePath}` };
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
    if (checkSensitivePath(filePath).isSensitive) {
      return { status: 'error', code: 'ACCESS_DENIED', message: `Usuwanie wrażliwego pliku zabronione: ${filePath}` };
    }
    return workspaceService.deleteFile(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.renameFile, async (_event, oldPath: unknown, newPath: unknown) => {
    if (typeof oldPath !== 'string' || typeof newPath !== 'string') {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid file paths.' };
    }
    if (checkSensitivePath(oldPath).isSensitive || checkSensitivePath(newPath).isSensitive) {
      return { status: 'error', code: 'ACCESS_DENIED', message: `Zmiana nazwy wrażliwego pliku zabroniona: ${oldPath}` };
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

    const sensitiveResult = checkSensitivePaths(edit);
    if (sensitiveResult) return sensitiveResult;

    const uniqueFiles = new Set(edit.operations.map(op => op.filePath));
    if (uniqueFiles.size > 1) {
      return routeMultiFileEdit(edit, uniqueFiles, mainWindow);
    }

    // Single-file: log binary classification
    const firstOp = edit.operations[0];
    if (firstOp && isBinaryFile(firstOp.filePath)) {
      console.warn(`[main] Binary file edit detected, kind: ${classifyOperationKind('binary')}, file: ${firstOp.filePath}`);
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

  // Event Log IPC handlers
  const eventLogService = getEventLogService();

  ipcMain.handle(IPC_CHANNELS.getEventLog, (_event, filter: EventLogFilter | undefined) => {
    return eventLogService.query(filter);
  });

  ipcMain.handle(IPC_CHANNELS.clearEventLog, () => {
    eventLogService.clear();
  });

  // Forward event log updates to renderer
  eventLogService.on('update', (entry: EventLogEntry) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.eventLogUpdate, entry);
    }
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

  // Phase 7: Tool Router / Permission Broker / Conflict Broker IPC handlers
  registerToolRouterIpc(mainWindow, workspaceService, modelGateway);
}

// ?? Phase 7: Tool Router IPC handlers ??????????????????????????????????????

function registerToolRouterIpc(mainWindow: BrowserWindow, workspaceService: WorkspaceService, modelGateway?: ModelGateway): void {
  const permissionBroker = new PermissionBroker();
  const conflictBroker = new ConflictBroker();

  // Lazy-init tool router when workspace is known
  let toolRouter: ToolRouter | null = null;

  function getToolRouter(): ToolRouter {
    if (!toolRouter) {
      const roots = workspaceService.getWorkspaceRoots?.() ?? [];
      toolRouter = new ToolRouter({
        workspaceRoots: roots,
        permissionBroker,
        conflictBroker
      });
      // Wire ToolRouter into ModelGateway so agent tool calls go through approval flow
      if (modelGateway) {
        modelGateway.setToolRouter(toolRouter);
      }
      // Expose at module level so applyWorkspaceEdit handler can route multi-file edits
      toolRouterRef = toolRouter;
    }
    return toolRouter;
  }

  ipcMain.handle(IPC_CHANNELS.toolCall, async (_event, request: unknown) => {
    if (!isToolCallRequest(request)) {
      return { status: 'error', callId: 'unknown', code: 'UNKNOWN', message: 'Invalid tool call request.' };
    }

    const router = getToolRouter();
    const response = await router.execute(request);

    // If pending approval, forward to renderer
    if (response.status === 'pending-approval') {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.toolApprovalRequest, response);
      }
    }

    return response;
  });

  ipcMain.handle(IPC_CHANNELS.toolApprovalResponse, async (_event, decision: unknown) => {
    if (!isApprovalDecision(decision)) {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid approval decision.' };
    }

    const originalRequest = permissionBroker.submitApproval(decision);
    if (!originalRequest) {
      return { status: 'error', code: 'UNKNOWN', message: 'Approval expired or unknown callId.' };
    }

    // If approved, execute the tool; if denied, return denied response
    if (decision.approved) {
      const router = getToolRouter();
      const response = await router.executeApproved(originalRequest);
      return response;
    }

    return {
      status: 'error' as const,
      callId: decision.callId,
      code: 'ACCESS_DENIED' as const,
      message: 'Narzędzie odrzucone przez użytkownika.'
    };
  });

  ipcMain.handle(IPC_CHANNELS.proposePatch, async (_event, patchData: unknown) => {
    // Validate and create patch proposal
    if (typeof patchData !== 'object' || patchData === null) {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid patch data.' };
    }
    const data = patchData as Record<string, unknown>;
    const operations = Array.isArray(data.operations) ? data.operations : [];

    const { classifyPatchRisk, generatePatchId } = await import('@agentdeck/services');
    const riskLevel = classifyPatchRisk(operations);

    const patchId = generatePatchId();

    return { status: 'ok', patchId, riskLevel, operations: operations.length };
  });

  ipcMain.handle(IPC_CHANNELS.applyPatch, async (_event, request: unknown) => {
    // Validate request shape: { patchId: string, patch: PatchSet data }
    if (typeof request !== 'object' || request === null) {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid applyPatch request.' };
    }
    const req = request as Record<string, unknown>;
    if (typeof req.patchId !== 'string') {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid patch ID.' };
    }
    if (typeof req.patch !== 'object' || req.patch === null) {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid patch data.' };
    }
    const patchData = req.patch as Record<string, unknown>;

    // Build a ToolCallRequest so applyPatch goes through PermissionBroker + ConflictBroker
    const toolRequest: ToolCallRequest = {
      callId: `apply-patch-${Date.now()}-${randomBytes(4).toString('hex')}`,
      toolName: 'applyPatch',
      args: {
        patchId: req.patchId,
        patch: {
          filePath: String(patchData.filePath ?? ''),
          baseHash: String(patchData.baseHash ?? ''),
          operations: Array.isArray(patchData.operations) ? patchData.operations : [],
          author: String(patchData.author ?? 'agent'),
          riskLevel: patchData.riskLevel as ToolRiskLevel ?? 'medium',
        }
      }
    };

    const router = getToolRouter();
    const response = await router.execute(toolRequest);

    // If pending approval, forward to renderer
    if (response.status === 'pending-approval') {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.toolApprovalRequest, response);
      }
      // Return a patch-compatible result indicating pending approval
      return { status: 'error', code: 'UNKNOWN', message: 'Oczekuje na zatwierdzenie (pending-approval).' };
    }

    if (response.status === 'error') {
      // If conflict detected, push conflict event to renderer for UI handling
      const conflictData = (response as Record<string, unknown>).conflict;
      if (response.code === 'WRITE_CONFLICT' && conflictData) {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.conflictDetected, conflictData);
        }
        return { status: 'error', code: 'WRITE_CONFLICT', message: response.message };
      }
      return { status: 'error', code: response.code, message: response.message };
    }

    if (response.status === 'ok') {
      const result = (response.result as Record<string, unknown> | undefined);
      return { status: 'ok', patchId: req.patchId, appliedHash: String(result?.appliedHash ?? '') };
    }

    // Fallback for unexpected statuses
    return { status: 'error', code: 'UNKNOWN', message: `Unexpected response status: ${response.status}` };
  });

  ipcMain.handle(IPC_CHANNELS.conflictResolve, (_event, resolution: unknown) => {
    if (typeof resolution !== 'object' || resolution === null) {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid conflict resolution.' };
    }
    const res = resolution as Record<string, unknown>;
    if (typeof res.conflictId !== 'string' || typeof res.action !== 'string') {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid conflict resolution fields.' };
    }

    const { action } = res;
    if (action === 'apply' || action === 'skip') {
      const ok = conflictBroker.resolveConflict({ conflictId: res.conflictId, action });
      return ok
        ? { status: 'ok' }
        : { status: 'error', code: 'UNKNOWN', message: `Conflict not found: ${res.conflictId}` };
    }

    if (action === 'edit') {
      // For 'edit', the client provides new operations to re-apply
      const operations = Array.isArray(res.operations) ? res.operations : [];
      if (operations.length === 0) {
        return { status: 'error', code: 'UNKNOWN', message: 'Edit action requires operations.' };
      }
      // Remove the old conflict and let client re-propose with new operations
      const ok = conflictBroker.resolveConflict({ conflictId: res.conflictId, action: 'skip' });
      return ok
        ? { status: 'ok', message: 'Conflict cleared. Re-propose patch with edited operations.' }
        : { status: 'error', code: 'UNKNOWN', message: `Conflict not found: ${res.conflictId}` };
    }

    return { status: 'error', code: 'UNKNOWN', message: `Unknown conflict action: ${action}` };
  });

  ipcMain.handle(IPC_CHANNELS.checkSensitivePath, (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') {
      return { filePath: '', isSensitive: false };
    }
    return checkSensitivePath(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.getFileHash, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') {
      return { status: 'error', code: 'UNKNOWN', message: 'Invalid file path.' };
    }
    const hash = await computeFileHash(filePath);
    if (hash === null) {
      return { status: 'error', code: 'FILE_NOT_FOUND', message: `Cannot compute hash for: ${filePath}` };
    }
    return { status: 'ok', hash };
  });
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
    openUrl: (url) => shell.openExternal(url),
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