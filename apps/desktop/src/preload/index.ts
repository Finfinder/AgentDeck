import { contextBridge, ipcRenderer } from 'electron';

import {
  DEFAULT_THEME_SETTINGS,
  IPC_CHANNELS,
  isStartupState,
  isThemeSettings,
  isWorkspaceSelection,
  type AgentDeckPreloadApi,
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
  versions: {
    chrome: process.versions.chrome ?? 'unknown',
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node
  }
};

contextBridge.exposeInMainWorld('agentDeck', api);