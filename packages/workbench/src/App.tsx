import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_THEME_SETTINGS, isIdentitySession, type IdentitySession, type AgentDeckPreloadApi, type EditorDiagnostic, type FsChangeEvent, type StartupState, type ThemePreference, type ThemeSettings, type WorkspaceModel, type WorkspaceOpenKind, type WorkspaceSelection } from '@agentdeck/shared';

import { EditorSurface } from './editor';
import { useEditorStore } from './editor/useEditorStore';
import { Explorer } from './Explorer';
import { MenuBar } from './MenuBar';
import { ProblemsPanel } from './ProblemsPanel';
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
  onFsEvent: () => () => undefined,
  readFile: async () => ({ status: 'error', code: 'FILE_NOT_FOUND', message: 'Dev mode - no file access.' }),
  writeFile: async () => ({ status: 'error', code: 'ACCESS_DENIED', message: 'Dev mode - no file write.' }),
  markBufferDirty: async () => undefined,
  deleteFile: async () => ({ status: 'error', code: 'ACCESS_DENIED', message: 'Dev mode - no file delete.' }),
  renameFile: async () => ({ status: 'error', code: 'ACCESS_DENIED', message: 'Dev mode - no file rename.' }),
  getEditorDiagnostics: async () => [],
  applyWorkspaceEdit: async () => ({ status: 'error', code: 'UNKNOWN', message: 'Dev mode - no workspace edit.' }),
  showDiff: async () => ({ status: 'error', code: 'UNKNOWN', message: 'Dev mode - no diff.' }),
  showSaveDialog: async () => null,
  toggleDevTools: async () => undefined
  ,
  // Identity dev stubs
  getIdentitySession: async () => ({ isLoggedIn: false }),
  startOAuth: async () => ({ isLoggedIn: false }),
  signOut: async () => ({ isLoggedIn: false }),
  onIdentityChange: () => () => undefined,
  onDeviceCode: () => () => undefined
};

function getPreloadApi(): AgentDeckPreloadApi {
  return (globalThis as unknown as { agentDeck?: AgentDeckPreloadApi }).agentDeck ?? DEV_PRELOAD_API;
}

interface IdentityMenuProps {
  identity: IdentitySession;
  agent: AgentDeckPreloadApi;
  menuRef: React.RefObject<HTMLDivElement | null>;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
  readonly deviceCode: { userCode: string; verificationUri: string; verificationUriComplete?: string } | null;
  readonly onClearDeviceCode: () => void;
}

function IdentityMenu({ identity, agent, menuRef, isOpen, onToggle, onClose, deviceCode, onClearDeviceCode }: Readonly<IdentityMenuProps>) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopyCode = useCallback(async () => {
    if (!deviceCode?.userCode) return;
    try {
      await navigator.clipboard.writeText(deviceCode.userCode);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard write failed - silently ignore
    }
  }, [deviceCode?.userCode]);

  useEffect(() => {
    return () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current); };
  }, []);
  
  // Determine dropdown content based on state
  let dropdownContent: React.ReactNode;
  
  if (identity.error) {
    dropdownContent = <div className="identity-dropdown-error">{identity.error}</div>;
  } else if (deviceCode) {
    dropdownContent = (
      <>
        <div className="identity-dropdown-header">
          <div className="identity-dropdown-info">
            <span className="identity-dropdown-login">Device Authorization</span>
            <span className="identity-dropdown-email">Enter this code at GitHub:</span>
          </div>
        </div>
        <div className="identity-dropdown-divider" />
        <div className="identity-device-code" style={{ 
          padding: '12px', 
          textAlign: 'center',
          fontFamily: 'monospace',
          fontSize: '24px',
          fontWeight: 'bold',
          letterSpacing: '2px',
          backgroundColor: '#1e1e1e',
          borderRadius: '4px',
          margin: '8px'
        }}>
          {deviceCode.userCode}
        </div>
        <div style={{ display: 'flex', gap: '8px', padding: '0 12px 8px', justifyContent: 'center' }}>
          <button
            className="identity-dropdown-item"
            role="menuitem"
            onClick={handleCopyCode}
            style={{ fontSize: '12px', padding: '4px 12px' }}
          >
            {copied ? '✓ Copied!' : '📋 Copy code'}
          </button>
        </div>
        <div style={{ padding: '0 12px 12px', fontSize: '12px', color: '#888' }}>
          Or visit: <a href={deviceCode.verificationUriComplete || deviceCode.verificationUri} target="_blank" rel="noreferrer">{deviceCode.verificationUriComplete ? 'Open GitHub' : deviceCode.verificationUri}</a>
        </div>
        <button
          className="identity-dropdown-item"
          role="menuitem"
          onClick={() => { 
            if (onClearDeviceCode) onClearDeviceCode();
            onClose(); 
          }}
        >
          Cancel
        </button>
      </>
    );
  } else if (identity.isLoggedIn) {
    dropdownContent = (
      <>
        <div className="identity-dropdown-header">
          {identity.profile?.avatar_url && (
            <img className="identity-dropdown-avatar" src={identity.profile.avatar_url} alt="" width={32} height={32} />
          )}
          <div className="identity-dropdown-info">
            <span className="identity-dropdown-login">{identity.profile?.login}</span>
            {identity.profile?.email && (
              <span className="identity-dropdown-email">{identity.profile.email}</span>
            )}
          </div>
        </div>
        <div className="identity-dropdown-divider" />
        <button
          className="identity-dropdown-item"
          role="menuitem"
          onClick={async () => { try { await agent.signOut(); onClose(); } catch { /* noop */ } }}
        >
          Sign out
        </button>
      </>
    );
  } else {
    dropdownContent = (
      <button
        className="identity-dropdown-item"
        role="menuitem"
        onClick={async () => { try { await agent.startOAuth(); onClose(); } catch { /* noop */ } }}
      >
        Sign in with GitHub
      </button>
    );
  }

  return (
    <div className="activity-identity" ref={menuRef}>
      <button
        className={`activity-button activity-identity-button ${isOpen ? 'active' : ''}`}
        type="button"
        aria-label={identity.isLoggedIn ? `Logged in as ${identity.profile?.login}` : 'Not logged in'}
        title={identity.isLoggedIn ? `Logged in as ${identity.profile?.login}` : 'Sign in'}
        onClick={onToggle}
      >
        {identity.isLoggedIn && identity.profile?.avatar_url ? (
          <img className="activity-avatar" src={identity.profile.avatar_url} alt="" width={20} height={20} />
        ) : (
          <svg className="activity-identity-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle cx="8" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
      </button>
      {isOpen && (
        <div className="identity-dropdown" role="menu">
          {dropdownContent}
        </div>
      )}
    </div>
  );
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
  const [activeBottomPanel, setActiveBottomPanel] = useState<'problems' | 'services' | 'output'>('problems');
  const [externalChanges, setExternalChanges] = useState<ReadonlySet<string>>(new Set());
  const editorStore = useEditorStore();
  const [diagnostics, setDiagnostics] = useState<readonly EditorDiagnostic[]>([]);
  const [ipcDiagnostics, setIpcDiagnostics] = useState<readonly EditorDiagnostic[]>([]);
  const [identity, setIdentity] = useState<IdentitySession>({ isLoggedIn: false });
  const [deviceCode, setDeviceCode] = useState<{ userCode: string; verificationUri: string; verificationUriComplete?: string } | null>(null);
  const [identityMenuOpen, setIdentityMenuOpen] = useState(false);
  const identityMenuRef = useRef<HTMLDivElement | null>(null);

  const allDiagnostics = useMemo(
    () => [...ipcDiagnostics, ...diagnostics],
    [ipcDiagnostics, diagnostics]
  );

  const diagCounts = useMemo(() => {
    let errors = 0, warnings = 0, infos = 0, hints = 0;
    for (const d of allDiagnostics) {
      switch (d.severity) {
        case 'error': errors++; break;
        case 'warning': warnings++; break;
        case 'info': infos++; break;
        case 'hint': hints++; break;
      }
    }
    return { errors, warnings, infos, hints };
  }, [allDiagnostics]);

  const handleDiagnosticsChange = useCallback((next: readonly EditorDiagnostic[]) => {
    setDiagnostics(next);
  }, []);

  // Poll IPC for workspace-level diagnostics (supports E2E mocks and future LSP integration)
  useEffect(() => {
    let isActive = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const result = await agent.getEditorDiagnostics('');
        if (isActive) setIpcDiagnostics(result);
      } catch { /* non-critical */ }
      if (isActive) timer = setTimeout(poll, 3000);
    };

    poll();
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [agent]);

  // Identity: initial fetch + subscribe to changes
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        if (typeof agent.getIdentitySession === 'function') {
          const sess = await agent.getIdentitySession();
          if (active && isIdentitySession(sess)) setIdentity(sess);
        }
      } catch {
        // ignore
      }
    })();

    let dispose: (() => void) | undefined;
    if (typeof agent.onIdentityChange === 'function') {
      dispose = agent.onIdentityChange((s) => {
        if (isIdentitySession(s)) {
          setIdentity(s);
          // Clear device code when user logs in
          if (s.isLoggedIn) setDeviceCode(null);
        }
      });
    }

    return () => { active = false; if (dispose) dispose(); };
  }, [agent]);

  // Device flow: subscribe to device code events
  useEffect(() => {
    let active = true;

    if (typeof agent.onDeviceCode === 'function') {
      const dispose = agent.onDeviceCode((data) => {
        if (active && data?.userCode) {
          // exactOptionalPropertyTypes: true � don't set property if null/undefined
          if (data.verificationUriComplete == null) {
            setDeviceCode({
              userCode: data.userCode,
              verificationUri: data.verificationUri
            });
          } else {
            setDeviceCode({
              userCode: data.userCode,
              verificationUri: data.verificationUri,
              verificationUriComplete: data.verificationUriComplete
            });
          }
        }
      });

      return () => { active = false; if (dispose) dispose(); };
    }
  }, [agent]);

  // Close identity menu when clicking outside
  useEffect(() => {
    if (!identityMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (identityMenuRef.current && !identityMenuRef.current.contains(e.target as Node)) {
        setIdentityMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [identityMenuOpen]);

  // ?? File system watcher - track external changes ????????????????
  useEffect(() => {
    const dispose = agent.onFsEvent((event: FsChangeEvent) => {
      if (event.kind === 'change') {
        setExternalChanges(prev => {
          const next = new Set(prev);
          next.add(event.path);
          return next;
        });
      }
    });
    return dispose;
  }, [agent]);

  // ?? Close workspace event (from File menu) ??????????????????????????
  useEffect(() => {
    function handleCloseWorkspace() {
      setWorkspaceModel(null);
      setWorkspaceSelection(null);
      setWorkspaceStatus('No workspace opened.');
    }
    globalThis.addEventListener('agentdeck:close-workspace', handleCloseWorkspace);
    return () => globalThis.removeEventListener('agentdeck:close-workspace', handleCloseWorkspace);
  }, []);

  // ?? Show panel event (from View menu) ??????????????????????????????
  useEffect(() => {
    function handleShowPanel(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail === 'explorer' || detail === 'search') {
        setActivePanel(detail);
      }
    }
    globalThis.addEventListener('agentdeck:show-panel', handleShowPanel);
    return () => globalThis.removeEventListener('agentdeck:show-panel', handleShowPanel);
  }, []);

  // ?? Save / Save All handlers ???????????????????????????????????????
  // EditorSurface owns the content map and already listens for Ctrl+S.
  // We dispatch keyboard events to trigger the same save path.
  const handleSave = useCallback(() => {
    globalThis.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 's',
        code: 'KeyS',
        ctrlKey: true,
        bubbles: true
      })
    );
  }, []);

  const handleSaveAll = useCallback(() => {
    // Save all dirty tabs: dispatch Ctrl+S for each dirty tab.
    // EditorSurface handles one active tab at a time via Ctrl+S.
    // For Save All, we dispatch a custom event that EditorSurface can intercept.
    globalThis.dispatchEvent(new CustomEvent('agentdeck:save-all'));
  }, []);

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
          if (isActive) {
            setLoadError(STARTUP_STATE_READ_ERROR_MESSAGE);
          }
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
          if (isActive) {
            setSettingsStatus(THEME_SETTINGS_READ_ERROR_MESSAGE);
          }
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

  async function openWorkspaceByPath(path: string, kind: WorkspaceOpenKind): Promise<void> {
    try {
      setWorkspaceSelection({ status: 'selected', kind, path, name: path.split(/[/\\]/).pop() ?? path });
      const model = await agent.openWorkspace(path, kind);
      setWorkspaceModel(model);
      setWorkspaceStatus(model.status === 'ok' ? `${path.split(/[/\\]/).pop() ?? path} opened.` : model.message);
    } catch {
      setWorkspaceStatus(WORKSPACE_OPEN_ERROR_MESSAGE);
    }
  }

  const handleDiagnosticClick = useCallback(
    (filePath: string, line: number, col: number) => {
      editorStore.openTab({ filePath, line, col });
    },
    [editorStore]
  );

  const handleSaveAs = useCallback(() => {
    const activeTab = editorStore.tabs.find(t => t.id === editorStore.activeTabId);
    if (activeTab) {
      // EditorSurface owns the content map and the save dialog integration.
      // Dispatch an event with the tabId; EditorSurface will handle the rest.
      globalThis.dispatchEvent(new CustomEvent('agentdeck:save-as', { detail: { tabId: activeTab.id } }));
    }
  }, [editorStore]);

  const statusText = loadError ?? (startupState?.status === 'error' ? startupState.message : 'Ready');
  const startupServices = startupState?.status === 'ready' ? startupState.services : [];

  return (
    <main className="workbench-shell" aria-busy={startupState === null && loadError === null} data-theme={themeSettings.theme} role="main">
      <MenuBar
        agent={agent}
        editorTabs={editorStore.tabs}
        onOpenWorkspace={(kind) => { openWorkspace(kind); }}
        onOpenWorkspaceDirect={(path, kind) => { openWorkspaceByPath(path, kind); }}
        onSave={() => { handleSave(); }}
        onSaveAs={() => { handleSaveAs(); }}
        onSaveAll={() => { handleSaveAll(); }}
      />
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
        <div className="activity-bar-spacer" />
        <IdentityMenu
          identity={identity}
          agent={agent}
          menuRef={identityMenuRef}
          isOpen={identityMenuOpen}
          onToggle={() => setIdentityMenuOpen(v => !v)}
          onClose={() => setIdentityMenuOpen(false)}
          deviceCode={deviceCode}
          onClearDeviceCode={() => setDeviceCode(null)}
        />
      </nav>

      <aside className="side-bar" aria-label={activePanel === 'search' ? 'Search' : 'Explorer'}>

        <div className="workspace-actions" aria-label="Workspace actions">
          <button className="primary-action" type="button" onClick={() => { openWorkspace('workspace-file'); }}>
            Open workspace
          </button>
          <button className="secondary-action" type="button" onClick={() => { openWorkspace('folder'); }}>
            Open folder
          </button>
        </div>

        {workspaceModel?.status === 'ok' && activePanel === 'explorer' && (
          <Explorer agent={agent} workspaceModel={workspaceModel} onFileOpen={(filePath) => { editorStore.openTab({ filePath }); }} />
        )}
        {workspaceModel?.status === 'ok' && activePanel === 'search' && (
          <SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={(filePath, line, col, pattern, revealNonce) => { editorStore.openTab({ filePath, line, col, ...(pattern == null ? {} : { pattern }), ...(revealNonce == null ? {} : { revealNonce }) }); }} />
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

      <EditorSurface agent={agent} store={editorStore} externalChanges={externalChanges} onExternalChangeAck={(path) => { setExternalChanges(prev => { const next = new Set(prev); next.delete(path); return next; }); }} onDiagnosticsChange={handleDiagnosticsChange} theme={themeSettings.theme} />

      <section className="bottom-panel" aria-label="Panel">
        <div className="panel-tabs" role="tablist" aria-label="Panel views">
          <button type="button" role="tab" aria-selected={activeBottomPanel === 'problems'} onClick={() => { setActiveBottomPanel('problems'); }}>
            Problems
          </button>
          <button type="button" role="tab" aria-selected={activeBottomPanel === 'services'} onClick={() => { setActiveBottomPanel('services'); }}>
            Services
          </button>
          <button type="button" role="tab" aria-selected={activeBottomPanel === 'output'} onClick={() => { setActiveBottomPanel('output'); }}>
            Output
          </button>
        </div>

        <div className="panel-content">
          {activeBottomPanel === 'problems' && (
            <ProblemsPanel diagnostics={allDiagnostics} onDiagnosticClick={handleDiagnosticClick} workspaceRoot={workspaceModel?.status === 'ok' ? workspaceModel.folders[0]?.path ?? null : null} />
          )}
          {/* Render startup status/alert regardless of active panel so tests can locate it by role and name */}
          <p className="startup-status" role={startupState?.status === 'error' || loadError ? 'alert' : 'status'} aria-label="Startup state">
            {statusText}
          </p>
          {activeBottomPanel === 'services' && (
            <>
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
            </>
          )}
          {activeBottomPanel === 'output' && (
            <p className="output-empty" aria-live="polite">No output.</p>
          )}
        </div>
      </section>

      <footer className="status-bar">
        <output aria-label="Workspace status">{workspaceStatus}</output>
        <output aria-label="Theme settings">{settingsStatus}</output>
        <div className="status-bar-diagnostics" aria-label="Diagnostic counts">
          <span className="status-bar-diag status-bar-diag--error" aria-label={`${diagCounts.errors} errors`}>
            <svg className="status-bar-diag-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="4.5" y1="4.5" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="11.5" y1="4.5" x2="4.5" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            {diagCounts.errors}
          </span>
          <span className="status-bar-diag status-bar-diag--warning" aria-label={`${diagCounts.warnings} warnings`}>
            <svg className="status-bar-diag-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <polygon points="8,1 15,14 1,14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              <line x1="8" y1="6" x2="8" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="8" cy="12" r="0.8" fill="currentColor"/>
            </svg>
            {diagCounts.warnings}
          </span>
          <span className="status-bar-diag status-bar-diag--info" aria-label={`${diagCounts.infos} infos`}>
            <svg className="status-bar-diag-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="8" cy="5" r="1" fill="currentColor"/>
              <line x1="8" y1="7.5" x2="8" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            {diagCounts.infos}
          </span>
          <span className="status-bar-diag status-bar-diag--hint" aria-label={`${diagCounts.hints} hints`}>
            <svg className="status-bar-diag-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5"/>
              <text x="8" y="12" textAnchor="middle" fontSize="10" fontWeight="bold" fill="currentColor">?</text>
            </svg>
            {diagCounts.hints}
          </span>
        </div>
        <div className="theme-switcher" aria-label="Theme">
          <button type="button" onClick={() => updateTheme('dark')} aria-pressed={themeSettings.theme === 'dark'}>
            Dark
          </button>
          <button type="button" onClick={() => updateTheme('light')} aria-pressed={themeSettings.theme === 'light'}>
            Light
          </button>
        </div>
        <div className="identity-area" aria-label="Identity">
          {identity.isLoggedIn ? (
            <button
              type="button"
              className="identity-status logged-in"
              onClick={() => setIdentityMenuOpen(v => !v)}
              aria-label={`Logged in as ${identity.profile?.login}`}
            >
              {identity.profile?.avatar_url ? (
                <img className="avatar" src={identity.profile.avatar_url} alt={`${identity.profile.login} avatar`} width={18} height={18} />
              ) : null}
              <span className="login">{identity.profile?.login ?? 'user'}</span>
            </button>
          ) : (
            <button
              type="button"
              className="identity-status logged-out"
              onClick={() => setIdentityMenuOpen(v => !v)}
              aria-label="Sign in"
            >
              <svg className="identity-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <circle cx="8" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span>Sign in</span>
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}

export default App;
