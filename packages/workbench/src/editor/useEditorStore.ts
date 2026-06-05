import { useCallback, useState } from 'react';

import { createEditorTab, createTabId } from '@agentdeck/services';
import type { EditorTab, EditorTabInput } from '@agentdeck/shared';

export type EditorStore = {
  readonly tabs: readonly EditorTab[];
  readonly activeTabId: string | null;
  readonly openTab: (input: EditorTabInput) => void;
  readonly closeTab: (tabId: string) => void;
  readonly setActiveTab: (tabId: string) => void;
  readonly setTabDirty: (tabId: string, isDirty: boolean) => void;
  readonly setTabPinned: (tabId: string, isPinned: boolean) => void;
  readonly getTabByPath: (filePath: string) => EditorTab | undefined;
};

export function useEditorStore(): EditorStore {
  const [tabs, setTabs] = useState<readonly EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const getTabByPath = useCallback(
    (filePath: string): EditorTab | undefined => {
      const id = createTabId(filePath);
      return tabs.find(tab => tab.id === id);
    },
    [tabs]
  );

  const openTab = useCallback(
    (input: EditorTabInput) => {
      const id = createTabId(input.filePath);
      const existing = tabs.find(tab => tab.id === id);

      if (existing) {
        // Always update reveal position, pattern, and nonce when provided
        // (nonce ensures the same line can be re-revealed on repeated clicks)
        if (input.line !== undefined || input.col !== undefined || input.pattern !== undefined || input.revealNonce !== undefined) {
          setTabs(prev =>
            prev.map(tab =>
              tab.id === id
                ? {
                    ...tab,
                    revealLine: input.line ?? tab.revealLine,
                    revealCol: input.col ?? tab.revealCol,
                    revealPattern: input.pattern ?? tab.revealPattern,
                    revealNonce: input.revealNonce ?? tab.revealNonce
                  }
                : tab
            )
          );
        }
        setActiveTabId(id);
        return;
      }

      const newTab = createEditorTab(input.filePath, input.line, input.col, input.pattern, input.revealNonce);
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(id);
    },
    [tabs]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs(prev => {
        const closedIndex = prev.findIndex(tab => tab.id === tabId);
        const next = prev.filter(tab => tab.id !== tabId);

        // If the closed tab was active, switch to the previous tab (or the last one)
        if (next.length > 0) {
          const newActiveIndex = Math.min(closedIndex, next.length - 1);
          const fallbackTab = next[newActiveIndex];
          if (fallbackTab) {
            setActiveTabId(fallbackTab.id);
          }
        } else {
          setActiveTabId(null);
        }

        return next;
      });
    },
    []
  );

  const setTabDirty = useCallback(
    (tabId: string, isDirty: boolean) => {
      setTabs(prev =>
        prev.map(tab => (tab.id === tabId ? { ...tab, isDirty } : tab))
      );
    },
    []
  );

  const setTabPinned = useCallback(
    (tabId: string, isPinned: boolean) => {
      setTabs(prev =>
        prev.map(tab => (tab.id === tabId ? { ...tab, isPinned } : tab))
      );
    },
    []
  );

  return {
    tabs,
    activeTabId,
    openTab,
    closeTab,
    setActiveTab: setActiveTabId,
    setTabDirty,
    setTabPinned,
    getTabByPath
  };
}
