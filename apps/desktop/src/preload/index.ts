import { ipcRenderer } from 'electron';

import {
  DEFAULT_THEME_SETTINGS,
  IPC_CHANNELS,
  isDirectoryListing,
  isFsChangeEvent,
  isStartupState,
  isThemeSettings,
  isWorkspaceModel,
  isWorkspaceSelection,
  type AgentDeckPreloadApi,
  type FsChangeEvent,
  type StartupState
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
    return isWorkspaceModel(value) ? value : { status: 'error', code: 'INVALID_JSONC', message: 'Unexpected response from main process.' };
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
  versions: {
    chrome: process.versions.chrome ?? 'unknown',
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node
  }
};

// Allow runtime mock overrides for E2E testing
// Store original methods and check for mocks before each call
const _mocks: Record<string, Function> = {};
if (typeof window !== 'undefined') {
  (window as any).__setAgentDeckMock = (method: string, fn: Function) => {
    _mocks[method] = fn;
  };
}

// Wrap API methods to check for mocks
const wrappedApi = {} as any;
for (const key of Object.keys(api)) {
  if (typeof (api as any)[key] === 'function') {
    wrappedApi[key] = async (...args: any[]) => {
      if (_mocks[key]) {
        return _mocks[key](...args);
      }
      return (api as any)[key](...args);
    };
  } else {
    wrappedApi[key] = (api as any)[key];
  }
}

// Expose mock setter for E2E testing
wrappedApi.__setAgentDeckMock = (method: string, fn: Function) => {
  _mocks[method] = fn;
};

console.log('[preload] Loading preload script...');
contextBridge.exposeInMainWorld('agentDeck', wrappedApi);
console.log('[preload] agentDeck exposed successfully');
