import type { EditorTab } from '@agentdeck/shared';

interface EditorTabsProps {
  readonly tabs: readonly EditorTab[];
  readonly activeTabId: string | null;
  readonly onSelect: (tabId: string) => void;
  readonly onClose: (tabId: string) => void;
}

function dirtyIndicator(isDirty: boolean): string {
  return isDirty ? ' *' : '';
}

export function EditorTabs({ tabs, activeTabId, onSelect, onClose }: EditorTabsProps) {
  if (tabs.length === 0) {
    return (
      <div className="editor-tabs" role="tablist" aria-label="Open editors">
        <span className="editor-tab-empty">No open editors</span>
      </div>
    );
  }

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open editors">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`editor-tab ${isActive ? 'active' : ''} ${tab.isPinned ? 'pinned' : ''}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`editor-panel-${tab.id}`}
              title={tab.filePath}
              onClick={() => onSelect(tab.id)}
              className="editor-tab-button"
            >
              <span className="editor-tab-name">{tab.fileName}{dirtyIndicator(tab.isDirty)}</span>
            </button>
            <button
              type="button"
              className="editor-tab-close"
              aria-label={`Close ${tab.fileName}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <span aria-hidden="true" style={{ pointerEvents: 'none' }}>✕</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
