import { useCallback, useState } from 'react';

import type { AgentDeckPreloadApi } from '@agentdeck/shared';

import { EditorTabs } from './EditorTabs';
import { MonacoEditorSurface } from './MonacoEditorSurface';
import { useEditorStore } from './useEditorStore';

interface EditorSurfaceProps {
  readonly agent: AgentDeckPreloadApi;
}

// In-memory content store for dirty editors.
type ContentMap = Record<string, string>;

export function EditorSurface({ agent }: EditorSurfaceProps) {
  const store = useEditorStore();
  const [, setContentMap] = useState<ContentMap>({});

  const activeTab = store.tabs.find(tab => tab.id === store.activeTabId) ?? null;

  const handleContentChange = useCallback((tabId: string, content: string) => {
    setContentMap(prev => ({ ...prev, [tabId]: content }));
  }, []);

  const handleClose = useCallback(
    (tabId: string) => {
      const tab = store.tabs.find(t => t.id === tabId);
      if (tab?.isDirty) {
        // In a full implementation, this would show a confirmation dialog.
        // For MVP, we close and let the user rely on dirty indicator.
      }
      store.closeTab(tabId);
      setContentMap(prev => {
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
    },
    [store]
  );

  return (
    <section className="editor-area" aria-label="Editor">
      <EditorTabs
        tabs={store.tabs}
        activeTabId={store.activeTabId}
        onSelect={store.setActiveTab}
        onClose={handleClose}
      />

      <div className="editor-surface" role="tabpanel" aria-label={activeTab ? activeTab.fileName : 'Editor'}>
        {activeTab ? (
          <MonacoEditorSurface
            agent={agent}
            tab={activeTab}
            onDirtyChange={store.setTabDirty}
            onContentChange={handleContentChange}
          />
        ) : (
          <div className="editor-welcome">
            <p className="eyebrow">AgentDeck</p>
            <h2>Editor</h2>
            <p>Open a file from the Explorer to start editing.</p>
          </div>
        )}
      </div>


    </section>
  );
}
