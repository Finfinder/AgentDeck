import { useEffect, useMemo, useState } from 'react';

import { DEFAULT_THEME_SETTINGS, type AgentDeckPreloadApi, type StartupState, type ThemePreference, type ThemeSettings, type WorkspaceOpenKind, type WorkspaceSelection } from '@agentdeck/shared';

const STARTUP_STATE_READ_ERROR_MESSAGE = 'Unable to read startup state.';
const THEME_SETTINGS_READ_ERROR_MESSAGE = 'Unable to read theme settings.';
const THEME_SETTINGS_WRITE_ERROR_MESSAGE = 'Unable to save theme settings.';
const WORKSPACE_OPEN_ERROR_MESSAGE = 'Unable to open workspace picker.';

const DEV_PRELOAD_API: AgentDeckPreloadApi = {
  getStartupState: async () => ({ status: 'ready', appVersion: '0.1.0', services: [] }),
  versions: { chrome: 'dev', electron: 'dev', node: 'dev' },
  getThemeSettings: async () => DEFAULT_THEME_SETTINGS,
  setThemeSettings: async settings => settings,
  selectWorkspaceEntry: async () => ({ status: 'cancelled' })
};

function getPreloadApi(): AgentDeckPreloadApi {
  return (globalThis as unknown as { agentDeck?: AgentDeckPreloadApi }).agentDeck ?? DEV_PRELOAD_API;
}

export function App() {
  const agent = useMemo(getPreloadApi, []);
  const [startupState, setStartupState] = useState<StartupState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Render with a dark-first flash to avoid a white flash in dark-mode workflows
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>({ theme: 'dark' });
  const [settingsStatus, setSettingsStatus] = useState('Theme settings ready.');

  const [workspaceSelection, setWorkspaceSelection] = useState<WorkspaceSelection | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState('No workspace opened.');

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
  }, [agent]);

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
  }, [agent]);

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

  async function openWorkspace(kind: WorkspaceOpenKind): Promise<void> {
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
    <main className="startup-shell" aria-busy={startupState === null && loadError === null} data-theme={themeSettings.theme} role="main">
      <section className="startup-surface" aria-labelledby="agentdeck-title">
        <div>
          <p className="eyebrow">AgentDeck</p>
          <h1 id="agentdeck-title">Workbench</h1>
        </div>

        <p className="version">v{appVersion}</p>

        <p className="theme">Theme: {themeSettings.theme}</p>

        <output className="settings-status" aria-label="Theme settings">{settingsStatus}</output>

        <output className="workspace-status" aria-label="Workspace status">{workspaceStatus}</output>

        <p className="startup-status" role={startupState?.status === 'error' || loadError ? 'alert' : 'status'} aria-label="Startup state">
          {statusText}
        </p>

        <nav aria-label="Primary activity">
          <button onClick={() => openWorkspace('workspace-file')}>Open workspace</button>
          <button onClick={() => openWorkspace('folder')}>Open folder</button>
        </nav>

        <section aria-label="Explorer">
          <h2>Explorer</h2>
          {workspaceSelection?.status === 'selected' ? <h3>{workspaceSelection.name}</h3> : null}
        </section>

        <div className="theme-controls">
          <button onClick={() => updateTheme('dark')}>Dark</button>
          <button onClick={() => updateTheme('light')}>Light</button>
        </div>
      </section>
    </main>
  );
}

export default App;
