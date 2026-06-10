import { useCallback, useEffect, useState } from 'react';

import type {
  AgentDeckPreloadApi,
  ChatTabState
} from '@agentdeck/shared';

export type ChatStore = {
  readonly tabs: readonly ChatTabState[];
  readonly activeTabId: string | null;
  readonly setActiveTabId: (tabId: string | null) => void;
  readonly createTab: (title?: string) => Promise<void>;
  readonly closeTab: (tabId: string) => Promise<void>;
  readonly sendMessage: (tabId: string, content: string) => Promise<void>;
  readonly stopStreaming: (tabId: string) => Promise<void>;
};

function resolveActiveTabId(
  prev: string | null,
  newTabs: readonly ChatTabState[]
): string | null {
  const tabStillExists = newTabs.some(t => t.id === prev);
  if (prev && !tabStillExists) {
    return newTabs.length > 0 ? newTabs[0]!.id : null;
  }
  return prev;
}

export function useChatStore(agent: AgentDeckPreloadApi): ChatStore {
  const [tabs, setTabs] = useState<readonly ChatTabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Subscribe to tab changes and fetch initial state
  useEffect(() => {
    let disposed = false;

    // Initial fetch
    agent.listChatTabs().then(initialTabs => {
      if (!disposed) {
        setTabs(initialTabs);
        if (initialTabs.length > 0) {
          setActiveTabId(prev => prev ?? initialTabs[0]!.id);
        }
      }
    }).catch(() => { /* noop */ });

    // Subscribe to changes
    let unsub: (() => void) | undefined;
    if (agent.onChatTabsChange) {
      unsub = agent.onChatTabsChange((newTabs) => {
        if (disposed) return;
        setTabs(newTabs);
        setActiveTabId(prev => resolveActiveTabId(prev, newTabs));
      });
    }

    return () => {
      disposed = true;
      if (unsub) unsub();
    };
  }, [agent]);

  const createTab = useCallback(
    async (title?: string) => {
      const newTab = await agent.createChatTab(title);
      const updatedTabs = await agent.listChatTabs();
      setTabs(updatedTabs);
      setActiveTabId(newTab.id);
    },
    [agent]
  );

  const closeTab = useCallback(
    async (tabId: string) => {
      await agent.closeChatTab(tabId);
      const updatedTabs = await agent.listChatTabs();
      setTabs(updatedTabs);
      setActiveTabId(prev => {
        if (prev === tabId) {
          return updatedTabs.length > 0 ? updatedTabs[0]!.id : null;
        }
        return prev;
      });
    },
    [agent]
  );

  const sendMessage = useCallback(
    async (tabId: string, content: string) => {
      await agent.sendMessage(tabId, content);
    },
    [agent]
  );

  const stopStreaming = useCallback(
    async (tabId: string) => {
      await agent.stopStreaming(tabId);
    },
    [agent]
  );

  return {
    tabs,
    activeTabId,
    setActiveTabId,
    createTab,
    closeTab,
    sendMessage,
    stopStreaming
  };
}
