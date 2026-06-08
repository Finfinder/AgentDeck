import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AgentDeckPreloadApi, EditorTab, RecentWorkspace, WorkspaceOpenKind } from '@agentdeck/shared';

import { editorRedo, editorSelectAll, editorUndo } from './editor/editor-registry';

interface MenuItem {
  readonly label?: string;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly role?: 'separator';
  readonly action?: () => void;
}

interface MenuBarProps {
  readonly agent: AgentDeckPreloadApi;
  readonly editorTabs: readonly EditorTab[];
  readonly onOpenWorkspace: (kind: WorkspaceOpenKind) => void;
  readonly onOpenWorkspaceDirect: (path: string, kind: WorkspaceOpenKind) => void;
  readonly onSave: () => void;
  readonly onSaveAs: () => void;
  readonly onSaveAll: () => void;
}

const DEV_PRELOAD_API: AgentDeckPreloadApi = {
  getStartupState: async () => ({ status: 'ready', appVersion: '0.1.0', services: [] }),
  versions: { chrome: 'dev', electron: 'dev', node: 'dev' },
  getThemeSettings: async () => ({ theme: 'dark' as const }),
  setThemeSettings: async () => ({} as never),
  selectWorkspaceEntry: async () => ({ status: 'cancelled' as const }),
  openWorkspace: async () => ({ status: 'error' as const, code: 'FILE_NOT_FOUND' as const, message: 'Dev mode' }),
  listDirectory: async () => ({ path: '', entries: [] }),
  searchFiles: async () => [],
  getRecentWorkspaces: async () => [],
  onFsEvent: () => () => undefined,
  readFile: async () => ({ status: 'error' as const, code: 'FILE_NOT_FOUND' as const, message: 'Dev mode' }),
  writeFile: async () => ({ status: 'error' as const, code: 'ACCESS_DENIED' as const, message: 'Dev mode' }),
  markBufferDirty: async () => undefined,
  deleteFile: async () => ({ status: 'error' as const, code: 'ACCESS_DENIED' as const, message: 'Dev mode' }),
  renameFile: async () => ({ status: 'error' as const, code: 'ACCESS_DENIED' as const, message: 'Dev mode' }),
  getEditorDiagnostics: async () => [],
  applyWorkspaceEdit: async () => ({ status: 'error' as const, code: 'UNKNOWN' as const, message: 'Dev mode' }),
  showDiff: async () => ({ status: 'error' as const, code: 'UNKNOWN' as const, message: 'Dev mode' }),
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
  const preloadApi = (globalThis as unknown as { agentDeck?: AgentDeckPreloadApi }).agentDeck;
  return preloadApi ?? DEV_PRELOAD_API;
}

function MenuDropdown({ items, onClose }: { readonly items: readonly MenuItem[]; readonly onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="menu-dropdown" role="menu" ref={ref}>
      {items.map((item, idx) => {
        const key = `${item.label ?? item.role ?? 'item'}-${idx}`;
        if (item.role === 'separator') {
          return <hr key={key} className="menu-separator" aria-hidden="true" />;
        }

        const disabled = Boolean(item.disabled);
        return (
          <button
            key={key}
            type="button"
            role="menuitem"
            className={`menu-dropdown-item ${disabled ? 'disabled' : ''}`}
            onClick={() => {
              if (disabled || !item.action) return;
              item.action();
              onClose();
            }}
            aria-disabled={disabled}
          >
            <span className="menu-item-label">{item.label ?? ''}</span>
            {item.shortcut && <span className="menu-item-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

function toggleFullScreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

function MenuButton({ label, items }: { readonly label: string; readonly items: readonly MenuItem[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen(v => !v), []);
  return (
    <div className="menu-bar-item">
      <button type="button" role="menuitem" className={`menu-bar-button ${isOpen ? 'active' : ''}`} onClick={toggle} aria-haspopup="true" aria-expanded={isOpen}>
        {label}
      </button>
      {isOpen && <MenuDropdown items={items} onClose={() => setIsOpen(false)} />}
    </div>
  );
}

export function MenuBar({ agent, editorTabs, onOpenWorkspace, onOpenWorkspaceDirect, onSave, onSaveAs, onSaveAll }: MenuBarProps) {
  const preloadApi = useMemo(() => agent ?? getPreloadApi(), [agent]);
  const [recentWorkspaces, setRecentWorkspaces] = useState<readonly RecentWorkspace[]>([]);

  const refreshRecents = useCallback(() => {
    if (typeof preloadApi.getRecentWorkspaces === 'function') {
      preloadApi.getRecentWorkspaces().then(setRecentWorkspaces).catch(() => {});
    }
  }, [preloadApi]);

  const hasDirtyTabs = editorTabs.some(t => t.isDirty);
  const hasActiveTab = editorTabs.length > 0;

  useEffect(() => {
    refreshRecents();
  }, [refreshRecents]);

  const fileMenuItems: MenuItem[] = [
    { label: 'Open Folder...', shortcut: 'Ctrl+K Ctrl+O', action: () => onOpenWorkspace('folder') },
    { label: 'Open Workspace...', shortcut: 'Ctrl+K Ctrl+W', action: () => onOpenWorkspace('workspace-file') },
    { label: 'Add Folder to Workspace...', disabled: true },
    { role: 'separator' },
    { label: 'Save Workspace As...', disabled: true },
    { label: 'Close Workspace', action: () => globalThis.dispatchEvent(new CustomEvent('agentdeck:close-workspace')) },
    { role: 'separator' },
    { label: 'Open Recent', disabled: recentWorkspaces.length === 0 },
    ...recentWorkspaces.slice(0, 5).map(rw => ({ label: rw.name, action: () => onOpenWorkspaceDirect(rw.path, rw.kind) })),
    ...(recentWorkspaces.length > 0 ? [{ role: 'separator' as const }] : []),
    { label: 'Save', shortcut: 'Ctrl+S', disabled: !hasActiveTab, action: onSave },
    { label: 'Save As...', shortcut: 'Ctrl+Shift+S', disabled: !hasActiveTab, action: onSaveAs },
    { label: 'Save All', disabled: !hasDirtyTabs, action: onSaveAll }
  ];

  const editMenuItems: MenuItem[] = [
    { label: 'Undo', shortcut: 'Ctrl+Z', action: () => editorUndo() },
    { label: 'Redo', shortcut: 'Ctrl+Y', action: () => editorRedo() },
    { label: 'Select All', shortcut: 'Ctrl+A', action: () => editorSelectAll() }
  ];

  const viewMenuItems: MenuItem[] = [
    { label: 'Explorer', shortcut: 'Ctrl+Shift+E', action: () => globalThis.dispatchEvent(new CustomEvent('agentdeck:show-panel', { detail: 'explorer' })) },
    { label: 'Search', shortcut: 'Ctrl+Shift+F', action: () => globalThis.dispatchEvent(new CustomEvent('agentdeck:show-panel', { detail: 'search' })) },
    { role: 'separator' },
    { label: 'Command Palette...', shortcut: 'Ctrl+Shift+P', disabled: true },
    { role: 'separator' },
    { label: 'Toggle Developer Tools', shortcut: 'F12', action: () => { preloadApi.toggleDevTools().catch(() => {}); } }
  ];

  const windowMenuItems: MenuItem[] = [
    {
      label: 'Toggle Full Screen',
      shortcut: 'F11',
      action: toggleFullScreen
    }
  ];

  return (
    <div className="menu-bar" role="menubar" aria-label="Application menu">
      <MenuButton label="File" items={fileMenuItems} />
      <MenuButton label="Edit" items={editMenuItems} />
      <MenuButton label="View" items={viewMenuItems} />
      <MenuButton label="Window" items={windowMenuItems} />
    </div>
  );
}
