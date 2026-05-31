import type { AgentDeckPreloadApi } from '@agentdeck/shared';

declare global {
  var agentDeck: AgentDeckPreloadApi;

  interface Window {
    agentDeck: AgentDeckPreloadApi;
  }
}

export {};