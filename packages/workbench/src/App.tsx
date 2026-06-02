import { useEffect, useMemo, useState } from 'react';

import { DEFAULT_THEME_SETTINGS, type AgentDeckPreloadApi, type StartupState, type ThemePreference, type ThemeSettings, type WorkspaceModel, type WorkspaceOpenKind, type WorkspaceSelection } from '@agentdeck/shared';

import { Explorer } from './Explorer';
import { SearchPanel } from './SearchPanel';

const STARTUP_STATE_READ_ERROR_MESSAGE = 'Unable to read startup state.';
const THEME_SETTINGS_READ_ERROR_MESSAGE = 'Unable to read theme settings.';
const THEME_SETTINGS_WRITE_ERROR_MESSAGE = 'Unable to save theme settings.';
const WORKSPACE_OPEN_ERROR_MESSAGE = 'Unable to open workspace picker.';

const DEV_PRELOAD_API: AgentDeckPreloadApi = {
  getStartupState: async () => ({ status: 'ready', appVersion: '0.1.0', services: [] }),
  versions: { chrome: 'dev', electron: 'dev', node: 'dev' },
  getThemeSettings: async () => DEFAULT_THEME_SETTINGS,
  setThemeSettings: async settings => settings,
  selectWorkspaceEntry: async () => ({ status: 'cancelled' }),
  openWorkspace: async () => ({ status: 'error', code: 'FILE_NOT_FOUND', message: 'Dev mode - no workspace.' }),
  listDirectory: async path => ({ path, entries: [] }),
  searchFiles: async () => [],
  getRecentWorkspaces: async () => [],
  onFsEvent: () => () => undefined
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
  const [workspaceModel, setWorkspaceModel] = useState<WorkspaceModel | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState('No workspace opened.');
  const [activePanel, setActivePanel] = useState<'explorer' | 'search'>('explorer');

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
      if (selection.status === 'selected') {
        const model = await agent.openWorkspace(selection.path, selection.kind);
        setWorkspaceModel(model);
        setWorkspaceStatus(model.status === 'ok' ? `${selection.name} opened.` : model.message);
      } else {
        setWorkspaceStatus('No workspace opened.');
      }
    } catch {
      setWorkspaceStatus(WORKSPACE_OPEN_ERROR_MESSAGE);
    }
  }

  const statusText = loadError ?? (startupState?.status === 'error' ? startupState.message : 'Ready');
  const appVersion = startupState?.appVersion ?? '0.1.0';
  const startupServices = startupState?.status === 'ready' ? startupState.services : [];

  return (
    <main className="workbench-shell" aria-busy={startupState === null && loadError === null} data-theme={themeSettings.theme} role="main">
      <nav className="activity-bar" aria-label="Primary activity">
        <button className="activity-button" type="button" aria-label="Explorer" aria-pressed={activePanel === 'explorer'} title="Explorer" onClick={() => { setActivePanel('explorer'); }}>
          EX
        </button>
        <button className="activity-button" type="button" aria-label="Search" title="Search" aria-pressed={activePanel === 'search'} disabled={workspaceModel?.status !== 'ok'} onClick={() => { setActivePanel('search'); }}>
          SR
        </button>
        <button className="activity-button" type="button" aria-label="Source control" title="Source control" disabled>
          SC
        </button>
      </nav>

      <aside className="side-bar" aria-label={activePanel === 'search' ? 'Search' : 'Explorer'}>
        <header className="region-header">
          <p className="eyebrow">AgentDeck</p>
          <h1 id="agentdeck-title">Workbench</h1>
          <p className="version">v{appVersion}</p>
        </header>

        <div className="workspace-actions" aria-label="Workspace actions">
          <button className="primary-action" type="button" onClick={() => { void openWorkspace('workspace-file'); }}>
            Open workspace
          </button>
          <button className="secondary-action" type="button" onClick={() => { void openWorkspace('folder'); }}>
            Open folder
          </button>
        </div>

        {workspaceModel?.status === 'ok' && activePanel === 'explorer' && (
          <Explorer agent={agent} workspaceModel={workspaceModel} />
        )}
        {workspaceModel?.status === 'ok' && activePanel === 'search' && (
          <SearchPanel agent={agent} workspaceModel={workspaceModel} />
        )}
        {workspaceModel?.status !== 'ok' && (
          <section className="workspace-card" aria-labelledby="explorer-title">
            <p className="section-label">Explorer</p>
            <h2 id="explorer-title">Explorer</h2>
            {workspaceSelection?.status === 'selected' && workspaceModel?.status === 'error' ? (
              <p className="workspace-path" role="alert">{workspaceModel.message}</p>
            ) : (
              <p className="workspace-path">No workspace opened.</p>
            )}
          </section>
        )}
      </aside>

      <section className="editor-area" aria-labelledby="agentdeck-title">
        <div className="editor-tabs" role="tablist" aria-label="Open editors">
          <button className="editor-tab active" type="button" role="tab" aria-selected="true">
            Welcome
          </button>
        </div>

        <section className="editor-surface" aria-label="Editor">
          <div className="editor-gutter" aria-hidden="true">
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
          </div>
          <div className="editor-content">
            <p className="eyebrow">AgentDeck</p>
            <h2>Workbench</h2>
            <p>{workspaceSelection?.status === 'selected' ? workspaceSelection.path : 'No workspace opened.'}</p>
            <p>{statusText}</p>
          </div>
        </section>
      </section>

      <section className="bottom-panel" aria-label="Panel">
        <div className="panel-tabs" role="tablist" aria-label="Panel views">
          <button type="button" role="tab" aria-selected="true">
            Services
          </button>
          <button type="button" role="tab" aria-selected="false">
            Output
          </button>
        </div>

        <div className="panel-content">
          <p className="startup-status" role={startupState?.status === 'error' || loadError ? 'alert' : 'status'} aria-label="Startup state">
            {statusText}
          </p>
          {startupServices.length > 0 ? (
            <ul className="service-list" aria-label="Startup services">
              {startupServices.map(service => (
                <li key={service.id}>
                  <span>{service.label}</span>
                  <span>{service.status}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <footer className="status-bar">
        <output aria-label="Workspace status">{workspaceStatus}</output>
        <output aria-label="Theme settings">{settingsStatus}</output>
        <div className="theme-switcher" aria-label="Theme">
          <button type="button" onClick={() => updateTheme('dark')} aria-pressed={themeSettings.theme === 'dark'}>
            Dark
          </button>
          <button type="button" onClick={() => updateTheme('light')} aria-pressed={themeSettings.theme === 'light'}>
            Light
          </button>
        </div>
      </footer>
    </main>
  );
}

export default App;
