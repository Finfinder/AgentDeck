import type { AgentDeckPreloadApi } from '@agentdeck/shared';

declare global {
  interface Window {
    agentDeck: AgentDeckPreloadApi;
  }
}

export {};