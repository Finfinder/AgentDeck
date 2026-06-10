import { useCallback, useState } from 'react';

import type { ChatTabState } from '@agentdeck/shared';

interface ChatTabsProps {
  readonly tabs: readonly ChatTabState[];
  readonly activeTabId: string | null;
  readonly onSelect: (tabId: string) => void;
  readonly onClose: (tabId: string) => void;
  readonly onCreate: () => void;
}

export function ChatTabs({ tabs, activeTabId, onSelect, onClose, onCreate }: ChatTabsProps) {
  const [closedTabTitle, setClosedTabTitle] = useState<string | null>(null);

  const handleClose = useCallback((tabId: string, title: string) => {
    setClosedTabTitle(title);
    onClose(tabId);
  }, [onClose]);

  return (
    <div className="chat-tabs" role="tablist" aria-label="Chat tabs">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`chat-tab ${isActive ? 'chat-tab-active' : ''}`}
          >
            <button
              className="chat-tab-button"
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`chat-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              title={tab.title}
            >
              {tab.isStreaming && <span className="chat-tab-streaming-indicator" aria-label="Streaming">●</span>}
              <span className="chat-tab-title">{tab.title}</span>
            </button>
            <button
              className="chat-tab-close"
              type="button"
              onClick={(e) => { e.stopPropagation(); handleClose(tab.id, tab.title); }}
              aria-label={`Close ${tab.title}`}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        className="chat-tab-new"
        type="button"
        onClick={onCreate}
        aria-label="New chat tab"
        title="New chat"
      >
        +
      </button>
      {closedTabTitle && (
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          Chat tab "{closedTabTitle}" closed
        </span>
      )}
    </div>
  );
}
