import { useCallback, useEffect, useState } from 'react';

import type { AgentDeckPreloadApi, EditorDiagnostic } from '@agentdeck/shared';
import type { EditorStore } from './useEditorStore';

import { EditorTabs } from './EditorTabs';
import { MonacoEditorSurface } from './MonacoEditorSurface';

interface EditorSurfaceProps {
  readonly agent: AgentDeckPreloadApi;
  readonly store: EditorStore;
  readonly externalChanges: ReadonlySet<string>;
  readonly onExternalChangeAck: (path: string) => void;
  readonly onDiagnosticsChange: (diagnostics: readonly EditorDiagnostic[]) => void;
  readonly theme: 'dark' | 'light';
}

// In-memory content store for dirty editors.
type ContentMap = Record<string, string>;

type SaveResult = 'ok' | 'conflict' | 'error';

export function EditorSurface({ agent, store, externalChanges, onExternalChangeAck, onDiagnosticsChange, theme }: EditorSurfaceProps) {
  const [contentMap, setContentMap] = useState<ContentMap>({});
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [pendingConflictTabId, setPendingConflictTabId] = useState<string | null>(null);
  const [externalConflictTabId, setExternalConflictTabId] = useState<string | null>(null);

  const activeTab = store.tabs.find(tab => tab.id === store.activeTabId) ?? null;
  const pendingCloseTab = store.tabs.find(tab => tab.id === pendingCloseTabId) ?? null;
  const pendingConflictTab = store.tabs.find(tab => tab.id === pendingConflictTabId) ?? null;
  const externalConflictTab = store.tabs.find(tab => tab.id === externalConflictTabId) ?? null;

  const handleContentChange = useCallback((tabId: string, content: string) => {
    setContentMap(prev => ({ ...prev, [tabId]: content }));
  }, []);

  const handleDiagnosticsChange = useCallback((next: readonly EditorDiagnostic[]) => {
    onDiagnosticsChange(next);
  }, [onDiagnosticsChange]);

  const doSave = useCallback(async (tabId: string): Promise<SaveResult> => {
    const tab = store.tabs.find(t => t.id === tabId);
    if (tab) {
      const content = contentMap[tabId] ?? '';
      try {
        const result = await agent.writeFile(tab.filePath, content);
        if (result.status === 'ok') {
          store.setTabDirty(tabId, false);
          return 'ok';
        }
        if (result.status === 'error' && result.code === 'WRITE_CONFLICT') {
          return 'conflict';
        }
        console.error('[EditorSurface] Save failed:', result.message);
        return 'error';
      } catch (err) {
        console.error('[EditorSurface] Save error:', err);
        return 'error';
      }
    }
    return 'error';
  }, [contentMap, agent, store]);

  const doCloseTab = useCallback((tabId: string) => {
    store.closeTab(tabId);
    setContentMap(prev => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setPendingCloseTabId(null);
  }, [store]);

  const handleSave = useCallback(async () => {
    if (activeTab?.isDirty) {
      await doSave(activeTab.id);
    }
  }, [activeTab, doSave]);

  // Register Ctrl+S / Cmd+S keyboard shortcut.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave().catch(err => console.error('[EditorSurface] Save error:', err));
      }
    };
    globalThis.addEventListener('keydown', handler);
    return () => globalThis.removeEventListener('keydown', handler);
  }, [handleSave]);

  // Listen for Save All event from MenuBar.
  useEffect(() => {
    async function handleSaveAll() {
      const dirtyTabs = store.tabs.filter(t => t.isDirty);
      for (const tab of dirtyTabs) {
        await doSave(tab.id);
      }
    }
    globalThis.addEventListener('agentdeck:save-all', handleSaveAll);
    return () => globalThis.removeEventListener('agentdeck:save-all', handleSaveAll);
  }, [store, doSave]);

  // Listen for Save As event from MenuBar.
  useEffect(() => {
    async function handleSaveAs(e: Event) {
      const { tabId } = (e as CustomEvent).detail;
      const tab = store.tabs.find(t => t.id === tabId);
      if (!tab) return;
      const content = contentMap[tabId];
      if (content === undefined) return;
      try {
        const newPath = await agent.showSaveDialog(tab.filePath);
        if (!newPath) return;
        const result = await agent.writeFile(newPath, content);
        if (result.status === 'ok') {
          store.closeTab(tabId);
          store.openTab({ filePath: newPath });
        }
      } catch {
        // Best-effort
      }
    }
    globalThis.addEventListener('agentdeck:save-as', handleSaveAs);
    return () => globalThis.removeEventListener('agentdeck:save-as', handleSaveAs);
  }, [agent, store, contentMap]);

  const handleClose = useCallback(
    (tabId: string) => {
      const tab = store.tabs.find(t => t.id === tabId);
      if (tab?.isDirty) {
        setPendingCloseTabId(tabId);
        return;
      }
      doCloseTab(tabId);
    },
    [store, doCloseTab]
  );

  const handleSaveAndClose = useCallback(async () => {
    if (pendingCloseTabId) {
      const saveResult = await doSave(pendingCloseTabId);
      if (saveResult === 'conflict') {
        setPendingConflictTabId(pendingCloseTabId);
        return;
      }
      doCloseTab(pendingCloseTabId);
    }
  }, [pendingCloseTabId, doSave, doCloseTab]);

  const handleCloseWithoutSave = useCallback(() => {
    if (pendingCloseTabId) {
      doCloseTab(pendingCloseTabId);
    }
  }, [pendingCloseTabId, doCloseTab]);

  const handleCancelClose = useCallback(() => {
    setPendingCloseTabId(null);
  }, []);

  const handleConflictOverwrite = useCallback(async () => {
    if (pendingConflictTabId) {
      const tab = store.tabs.find(t => t.id === pendingConflictTabId);
      if (tab) {
        const content = contentMap[pendingConflictTabId] ?? '';
        try {
          await agent.writeFile(tab.filePath, content);
          store.setTabDirty(pendingConflictTabId, false);
        } catch (err) {
          console.error('[EditorSurface] Overwrite error:', err);
        }
      }
      setPendingConflictTabId(null);
      doCloseTab(pendingConflictTabId);
    }
  }, [pendingConflictTabId, contentMap, agent, store, doCloseTab]);

  const handleConflictReload = useCallback(async () => {
    if (pendingConflictTabId) {
      const tab = store.tabs.find(t => t.id === pendingConflictTabId);
      if (tab) {
        try {
          const result = await agent.readFile(tab.filePath);
          if (result.status === 'ok') {
            setContentMap(prev => ({ ...prev, [pendingConflictTabId]: result.content }));
            store.setTabDirty(pendingConflictTabId, false);
          }
        } catch (err) {
          console.error('[EditorSurface] Reload error:', err);
        }
      }
      setPendingConflictTabId(null);
      setPendingCloseTabId(null);
    }
  }, [pendingConflictTabId, agent, store]);

  const handleConflictCancel = useCallback(() => {
    setPendingConflictTabId(null);
    setPendingCloseTabId(null);
  }, []);

  // ?? External file change watcher ???????????????????????????????????
  // When a file is modified on disk (via fs-event), check if it's open.
  // If the buffer is dirty → show conflict dialog.
  // If the buffer is clean → silently reload from disk.
  useEffect(() => {
    if (!activeTab) return;
    if (!externalChanges.has(activeTab.filePath)) return;

    // Remove from external changes to avoid re-triggering
    onExternalChangeAck(activeTab.filePath);

    if (activeTab.isDirty) {
      // User has unsaved changes — show conflict dialog
      setExternalConflictTabId(activeTab.id);
    } else {
      // No unsaved changes — reload from disk
      agent.readFile(activeTab.filePath).then(result => {
        if (result.status === 'ok') {
          setContentMap(prev => ({ ...prev, [activeTab.id]: result.content }));
        }
      }).catch(err => {
        console.error('[EditorSurface] External reload error:', err);
      });
    }
  }, [activeTab, externalChanges, agent, onExternalChangeAck]);

  const handleExternalConflictOverwrite = useCallback(async () => {
    if (externalConflictTabId) {
      const tab = store.tabs.find(t => t.id === externalConflictTabId);
      if (tab) {
        const content = contentMap[externalConflictTabId] ?? '';
        try {
          await agent.writeFile(tab.filePath, content);
          store.setTabDirty(externalConflictTabId, false);
        } catch (err) {
          console.error('[EditorSurface] External conflict overwrite error:', err);
        }
      }
      setExternalConflictTabId(null);
    }
  }, [externalConflictTabId, contentMap, agent, store]);

  const handleExternalConflictReload = useCallback(async () => {
    if (externalConflictTabId) {
      const tab = store.tabs.find(t => t.id === externalConflictTabId);
      if (tab) {
        try {
          const result = await agent.readFile(tab.filePath);
          if (result.status === 'ok') {
            setContentMap(prev => ({ ...prev, [externalConflictTabId]: result.content }));
            store.setTabDirty(externalConflictTabId, false);
          }
        } catch (err) {
          console.error('[EditorSurface] External conflict reload error:', err);
        }
      }
      setExternalConflictTabId(null);
    }
  }, [externalConflictTabId, agent, store]);

  const handleExternalConflictCancel = useCallback(() => {
    setExternalConflictTabId(null);
  }, []);

  return (
    <section className="editor-area" aria-label="Editor">
      <EditorTabs
        tabs={store.tabs}
        activeTabId={store.activeTabId}
        onSelect={store.setActiveTab}
        onClose={handleClose}
      />

      <div className="editor-surface" role="tabpanel" aria-label={activeTab?.fileName ?? 'Editor'}>
        {activeTab ? (
          <MonacoEditorSurface
            key={activeTab.id}
            agent={agent}
            tab={activeTab}
            onDirtyChange={store.setTabDirty}
            onContentChange={handleContentChange}
            onDiagnosticsChange={handleDiagnosticsChange}
            theme={theme}
          />
        ) : (
          <div className="editor-welcome">
            <h2>Editor</h2>
            <p>Open a file from the Explorer to start editing.</p>
          </div>
        )}
      </div>

      {pendingCloseTab && !pendingConflictTab && (
        <dialog className="dialog-overlay" open aria-label="Save changes">
          <div className="dialog">
            <p className="dialog-title">Save changes to <strong>{pendingCloseTab.fileName}</strong>?</p>
            <div className="dialog-actions">
              <button className="dialog-button primary" type="button" onClick={() => { handleSaveAndClose().catch(err => console.error(String.raw`[EditorSurface] SaveAndClose error:`, err)); }}>
                Save
              </button>
              <button className="dialog-button" type="button" onClick={handleCloseWithoutSave}>
                Don't Save
              </button>
              <button className="dialog-button" type="button" onClick={handleCancelClose}>
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      )}

      {pendingConflictTab && (
        <dialog className="dialog-overlay" open aria-label="File conflict">
          <div className="dialog dialog-conflict">
            <div className="dialog-conflict-icon" aria-hidden="true">⚠</div>
            <p className="dialog-title">File conflict detected</p>
            <p className="dialog-body">
              <strong>{pendingConflictTab.fileName}</strong> has been modified on disk since it was opened.
              Your changes could overwrite the external modifications.
            </p>
            <div className="dialog-actions">
              <button className="dialog-button primary" type="button" onClick={() => { handleConflictOverwrite().catch(err => console.error(String.raw`[EditorSurface] ConflictOverwrite error:`, err)); }}>
                Overwrite
              </button>
              <button className="dialog-button" type="button" onClick={() => { handleConflictReload().catch(err => console.error(String.raw`[EditorSurface] ConflictReload error:`, err)); }}>
                Reload from disk
              </button>
              <button className="dialog-button" type="button" onClick={handleConflictCancel}>
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      )}

      {externalConflictTab && (
        <dialog className="dialog-overlay" open aria-label="External file change">
          <div className="dialog dialog-conflict">
            <div className="dialog-conflict-icon" aria-hidden="true">⚠</div>
            <p className="dialog-title">File changed on disk</p>
            <p className="dialog-body">
              <strong>{externalConflictTab.fileName}</strong> has been modified externally since it was opened.
              Your changes could overwrite the external modifications.
            </p>
            <div className="dialog-actions">
              <button className="dialog-button primary" type="button" onClick={() => { handleExternalConflictOverwrite().catch(err => console.error(String.raw`[EditorSurface] ExternalConflictOverwrite error:`, err)); }}>
                Overwrite
              </button>
              <button className="dialog-button" type="button" onClick={() => { handleExternalConflictReload().catch(err => console.error(String.raw`[EditorSurface] ExternalConflictReload error:`, err)); }}>
                Reload from disk
              </button>
              <button className="dialog-button" type="button" onClick={handleExternalConflictCancel}>
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      )}

    </section>
  );
}
