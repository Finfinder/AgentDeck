import { useEffect, useState } from 'react';

import type { StartupState, AgentDeckPreloadApi } from '@agentdeck/shared';
import { DEFAULT_THEME_SETTINGS, type ThemeSettings } from '@agentdeck/services';

const STARTUP_STATE_READ_ERROR_MESSAGE = 'Unable to read startup state.';
const THEME_SETTINGS_READ_ERROR_MESSAGE = 'Unable to read theme settings.';
const THEME_SETTINGS_WRITE_ERROR_MESSAGE = 'Unable to save theme settings.';
const WORKSPACE_OPEN_ERROR_MESSAGE = 'Unable to open workspace picker.';

type ThemePreference = 'light' | 'dark';

export function App() {
  const [startupState, setStartupState] = useState<StartupState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(DEFAULT_THEME_SETTINGS);
  const [settingsStatus, setSettingsStatus] = useState('Theme settings ready.');

  type WorkspaceSelection = { status: 'selected' | 'cancelled'; name?: string } | null;
  const [, setWorkspaceSelection] = useState<WorkspaceSelection>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState('No workspace opened.');

  // Defensive agent API: when running the Vite dev server in a browser
  // (not inside Electron) `globalThis.agentDeck` may be undefined. Provide
  // a minimal dev fallback so the UI doesn't crash during development.
  type PreloadApi = AgentDeckPreloadApi & {
    getThemeSettings: () => Promise<ThemeSettings>;
    setThemeSettings: (s: ThemeSettings) => Promise<ThemeSettings>;
    selectWorkspaceEntry: (opts?: { kind?: 'folder' | 'workspace-file' }) => Promise<{ status: 'selected' | 'cancelled'; name?: string }>;
  };

  const globalAgent = (globalThis as unknown as { agentDeck?: PreloadApi } | undefined)?.agentDeck;
  const agent: PreloadApi =
    globalAgent ?? {
      getStartupState: async () => ({ status: 'ready', appVersion: '0.1.0', services: [] }),
      versions: { chrome: 'dev', electron: 'dev', node: 'dev' },
      getThemeSettings: async () => DEFAULT_THEME_SETTINGS,
      setThemeSettings: async (settings: ThemeSettings) => settings,
      selectWorkspaceEntry: async () => ({ status: 'cancelled' })
    };

  useEffect(() => {
    let isActive = true;

    agent
      .getStartupState()
      .then(state => {
        if (isActive) {
          setStartupState(state);
        }
      })
      .catch(() => {
        if (!isActive) {
          return;
        }

        setLoadError(STARTUP_STATE_READ_ERROR_MESSAGE);
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    agent
      .getThemeSettings()
      .then(settings => {
        if (isActive) {
          setThemeSettings(settings);
        }
      })
      .catch(() => {
        if (!isActive) {
          return;
        }

        setSettingsStatus(THEME_SETTINGS_READ_ERROR_MESSAGE);
      });

    return () => {
      isActive = false;
    };
  }, []);

  async function updateTheme(theme: ThemePreference): Promise<void> {
    const nextSettings = { theme } satisfies ThemeSettings;

    setThemeSettings(nextSettings);

    try {
      const savedSettings = await agent.setThemeSettings(nextSettings);
      setThemeSettings(savedSettings);
      setSettingsStatus('Theme settings saved.');
    } catch {
      setSettingsStatus(THEME_SETTINGS_WRITE_ERROR_MESSAGE);
    }
  }

  async function openWorkspace(kind: 'folder' | 'workspace-file'): Promise<void> {
    try {
      const selection = await agent.selectWorkspaceEntry({ kind });
      setWorkspaceSelection(selection);
      setWorkspaceStatus(selection.status === 'selected' ? `${selection.name} selected.` : 'No workspace opened.');
    } catch {
      setWorkspaceStatus(WORKSPACE_OPEN_ERROR_MESSAGE);
    }
  }

  const statusText = loadError ?? (startupState?.status === 'error' ? startupState.message : 'Ready');
  const appVersion = startupState?.appVersion ?? '0.1.0';

  return (
    <main className="startup-shell" aria-busy={startupState === null && loadError === null}>
      <section className="startup-surface" aria-labelledby="agentdeck-title">
        <div>
          <p className="eyebrow">AgentDeck</p>
          <h1 id="agentdeck-title">Workbench</h1>
        </div>
        <p className="version">v{appVersion}</p>
        <p className="theme">Theme: {themeSettings.theme}</p>
        <p className="settings-status">{settingsStatus}</p>
        <p className="workspace-status">{workspaceStatus}</p>
        <p className="startup-status" role={startupState?.status === 'error' || loadError ? 'alert' : 'status'}>
          {statusText}
        </p>
      </section>
    </main>
  );
}
