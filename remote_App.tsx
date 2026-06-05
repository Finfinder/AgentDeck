import { useEffect, useState } from 'react';

import { DEFAULT_THEME_SETTINGS, type StartupState, type ThemePreference, type ThemeSettings, type WorkspaceSelection } from '@agentdeck/shared';

const STARTUP_STATE_READ_ERROR_MESSAGE = 'Unable to read startup state.';
const THEME_SETTINGS_READ_ERROR_MESSAGE = 'Unable to read theme settings.';
const THEME_SETTINGS_WRITE_ERROR_MESSAGE = 'Unable to save theme settings.';
const WORKSPACE_OPEN_ERROR_MESSAGE = 'Unable to open workspace picker.';

export function App() {
  const [startupState, setStartupState] = useState<StartupState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(DEFAULT_THEME_SETTINGS);
  const [settingsStatus, setSettingsStatus] = useState('Theme settings ready.');
  const [workspaceSelection, setWorkspaceSelection] = useState<WorkspaceSelection | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState('No workspace opened.');

  useEffect(() => {
    let isActive = true;

    globalThis.agentDeck
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

    globalThis.agentDeck
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
      const savedSettings = await globalThis.agentDeck.setThemeSettings(nextSettings);
      setThemeSettings(savedSettings);
      setSettingsStatus('Theme settings saved.');
    } catch {
      setSettingsStatus(THEME_SETTINGS_WRITE_ERROR_MESSAGE);
    }
  }

  async function openWorkspace(kind: 'folder' | 'workspace-file'): Promise<void> {
    try {
      const selection = await globalThis.agentDeck.selectWorkspaceEntry({ kind });
      setWorkspaceSelection(selection);
      setWorkspaceStatus(selection.status === 'selected' ? `${selection.name} selected.` : 'No workspace opened.');
    } catch {
      setWorkspaceStatus(WORKSPACE_OPEN_ERROR_MESSAGE);
    }
  }

  const statusText = loadError ?? (startupState?.status === 'error' ? startupState.message : 'Ready');
  const appVersion = startupState?.appVersion ?? '0.1.0';
  const isLoading = startupState === null && loadError === null;
  const selectedWorkspaceName = workspaceSelection?.status === 'selected' ? workspaceSelection.name : 'Untitled workspace';
  const selectedWorkspacePath = workspaceSelection?.status === 'selected' ? workspaceSelection.path : 'No active workspace';
  const selectedWorkspaceKind = workspaceSelection?.status === 'selected' ? workspaceSelection.kind : 'workspace-file';

  return (
    <main className="workbench-shell" data-theme={themeSettings.theme} aria-busy={isLoading}>
      <nav className="activity-bar" aria-label="Primary activity">
        <button className="activity-button active" type="button" aria-label="Explorer" aria-pressed="true">
          EX
        </button>
        <button className="activity-button" type="button" aria-label="Search" aria-pressed="false">
          SE
        </button>
        <button className="activity-button" type="button" aria-label="Agent chat" aria-pressed="false">
          AI
        </button>
      </nav>

      <aside className="side-bar" aria-labelledby="explorer-title">
        <header className="region-header">
          <h1 id="explorer-title">Explorer</h1>
        </header>
        <div className="workspace-actions" aria-label="Workspace actions">
          <button type="button" className="primary-action" onClick={() => void openWorkspace('workspace-file')}>
            Open workspace
          </button>
          <button type="button" className="secondary-action" onClick={() => void openWorkspace('folder')}>
            Open folder
          </button>
        </div>
        <section className="workspace-card" aria-labelledby="workspace-title">
          <p id="workspace-title" className="section-label">
            Active workspace
          </p>
          <p className="workspace-name">{selectedWorkspaceName}</p>
          <p className="workspace-path">{selectedWorkspacePath}</p>
          <p className="workspace-kind">{selectedWorkspaceKind}</p>
        </section>
      </aside>

      <section className="editor-area" aria-labelledby="editor-title">
        <div className="editor-tabs" role="tablist" aria-label="Editor tabs">
          <button className="editor-tab active" type="button" role="tab" aria-selected="true">
            Welcome
          </button>
        </div>
        <section className="editor-surface" aria-labelledby="editor-title">
          <div className="editor-gutter" aria-hidden="true">
            1
            <br />2
            <br />3
          </div>
          <div className="editor-content">
            <h2 id="editor-title">{selectedWorkspaceName}</h2>
            <p>{workspaceStatus}</p>
          </div>
        </section>
      </section>

      <section className="bottom-panel" aria-labelledby="panel-title">
        <header className="panel-tabs" role="tablist" aria-label="Panel tabs">
          <button type="button" role="tab" aria-selected="true">
            Problems
          </button>
          <button type="button" role="tab" aria-selected="false">
            Output
          </button>
        </header>
        <div className="panel-content">
          <h2 id="panel-title">Startup services</h2>
          <ul className="service-list" aria-label="Startup service states">
            {(startupState?.status === 'ready' ? startupState.services : []).map(service => (
              <li key={service.id}>
                <span>{service.label}</span>
                <span>{service.status}</span>
              </li>
            ))}
          </ul>
          <p className="startup-status" role={startupState?.status === 'error' || loadError ? 'alert' : 'status'} aria-label="Startup state">
            {statusText}
          </p>
        </div>
      </section>

      <footer className="status-bar">
        <p>v{appVersion}</p>
        <output aria-label="Theme settings">
          {settingsStatus}
        </output>
        <div className="theme-switcher" aria-label="Theme selection">
          <button type="button" aria-pressed={themeSettings.theme === 'dark'} onClick={() => void updateTheme('dark')}>
            Dark
          </button>
          <button type="button" aria-pressed={themeSettings.theme === 'light'} onClick={() => void updateTheme('light')}>
            Light
          </button>
        </div>
      </footer>
    </main>
  );
}