import { contextBridge, ipcRenderer } from 'electron';

import {
  DEFAULT_THEME_SETTINGS,
  IPC_CHANNELS,
  isDirectoryListing,
  isDiffResult,
  isFileOperationResult,
  isFileReadResult,
  isFileWriteResult,
  isFsChangeEvent,
  isIdentitySession,
  isIdentitySessionWarning,
  isStartupState,
  isThemeSettings,
  isWorkspaceEditResult,
  type IdentitySession,
  type IdentitySessionWarning,
  isWorkspaceModel,
  isWorkspaceSelection,
  type AgentDeckPreloadApi,
  type DiffInput,
  type EditorDiagnostic,
  type FsChangeEvent,
  type StartupState,
  type WorkspaceEditInput
} from '@agentdeck/shared';

const invalidStartupState: StartupState = {
  status: 'error',
  appVersion: '0.1.0',
  code: 'INVALID_STARTUP_STATE',
  message: 'The main process returned an invalid startup state.'
};

const api: AgentDeckPreloadApi = {
  getStartupState: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.getStartupState);
    return isStartupState(value) ? value : invalidStartupState;
  },
  getThemeSettings: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.getThemeSettings);
    return isThemeSettings(value) ? value : DEFAULT_THEME_SETTINGS;
  },
  getIdentitySession: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.identityGetSession);
    // Validate shape before returning to renderer
    return isIdentitySession(value) ? value : { isLoggedIn: false };
  },
  startOAuth: async (opts?: unknown) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.identityStartOAuth, opts);
    return isIdentitySession(value) ? value : { isLoggedIn: false };
  },
  signOut: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.identitySignOut);
    return isIdentitySession(value) ? value : { isLoggedIn: false };
  },
  setThemeSettings: async settings => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.setThemeSettings, settings);
    return isThemeSettings(value) ? value : DEFAULT_THEME_SETTINGS;
  },
  selectWorkspaceEntry: async request => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.selectWorkspaceEntry, request);
    return isWorkspaceSelection(value) ? value : { status: 'cancelled' };
  },
  openWorkspace: async (path, kind) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.openWorkspace, path, kind);
    if (!isWorkspaceModel(value)) {
      return { status: 'error', code: 'INVALID_JSONC', message: 'Unexpected response from main process.' };
    }
    return value;
  },
  listDirectory: async path => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.listDirectory, path);
    return isDirectoryListing(value) ? value : { path, entries: [] };
  },
  searchFiles: async query => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.searchFiles, query);
    return Array.isArray(value) ? value : [];
  },
  getRecentWorkspaces: async () => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.getRecentWorkspaces);
    return Array.isArray(value) ? value : [];
  },
  onFsEvent: (handler: (event: FsChangeEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isFsChangeEvent(value)) handler(value);
    };
    ipcRenderer.on(IPC_CHANNELS.fsEvent, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.fsEvent, listener); };
  },
  onIdentityChange: (handler: (session: IdentitySession) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isIdentitySession(value)) handler(value);
    };
    ipcRenderer.on(IPC_CHANNELS.identityChanged, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.identityChanged, listener); };
  },
  onDeviceCode: (handler: (data: { userCode: string; verificationUri: string; verificationUriComplete?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
      if (data && typeof data === 'object' && 'userCode' in data && 'verificationUri' in data) {
        handler(data as { userCode: string; verificationUri: string; verificationUriComplete?: string });
      }
    };
    ipcRenderer.on(IPC_CHANNELS.identityDeviceCode, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.identityDeviceCode, listener); };
  },
  onIdentityWarning: (handler: (warning: IdentitySessionWarning) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isIdentitySessionWarning(value)) handler(value);
    };
    ipcRenderer.on(IPC_CHANNELS.identityWarning, listener);
    return () => { ipcRenderer.off(IPC_CHANNELS.identityWarning, listener); };
  },
  readFile: async (filePath: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.readFile, filePath);
    return isFileReadResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  writeFile: async (filePath: string, content: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.writeFile, filePath, content);
    return isFileWriteResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  markBufferDirty: async (filePath: string) => {
    await ipcRenderer.invoke(IPC_CHANNELS.markBufferDirty, filePath);
  },
  deleteFile: async (filePath: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.deleteFile, filePath);
    return isFileOperationResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  renameFile: async (oldPath: string, newPath: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.renameFile, oldPath, newPath);
    return isFileOperationResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  getEditorDiagnostics: async (filePath: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.getEditorDiagnostics, filePath);
    return Array.isArray(value) ? value as EditorDiagnostic[] : [];
  },
  applyWorkspaceEdit: async (edit: WorkspaceEditInput) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.applyWorkspaceEdit, edit);
    return isWorkspaceEditResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  showDiff: async (input: DiffInput) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.showDiff, input);
    return isDiffResult(value) ? value : { status: 'error', code: 'UNKNOWN', message: 'Unexpected response from main process.' };
  },
  showSaveDialog: async (defaultPath?: string) => {
    const value: unknown = await ipcRenderer.invoke(IPC_CHANNELS.showSaveDialog, defaultPath);
    return typeof value === 'string' ? value : null;
  },
  toggleDevTools: async () => {
    await ipcRenderer.invoke(IPC_CHANNELS.toggleDevTools);
  },
  versions: {
    chrome: process.versions.chrome ?? 'unknown',
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node
  }
};

contextBridge.exposeInMainWorld('agentDeck', api);
