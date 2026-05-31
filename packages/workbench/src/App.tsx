import { useEffect, useState } from 'react';

import type { StartupState } from '@agentdeck/shared';

const STARTUP_STATE_READ_ERROR_MESSAGE = 'Unable to read startup state.';

export function App() {
  const [startupState, setStartupState] = useState<StartupState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    globalThis.agentDeck
      .getStartupState()
      .then(state => {
        if (isActive) {
          setStartupState(state);
        }
      })
      .catch(() => {
        if (!isActive) {
          return;
        }

        setLoadError(STARTUP_STATE_READ_ERROR_MESSAGE);
      });

    return () => {
      isActive = false;
    };
  }, []);

  const statusText = loadError ?? (startupState?.status === 'error' ? startupState.message : 'Ready');
  const appVersion = startupState?.appVersion ?? '0.1.0';

  return (
    <main className="startup-shell" aria-busy={startupState === null && loadError === null}>
      <section className="startup-surface" aria-labelledby="agentdeck-title">
        <div>
          <p className="eyebrow">AgentDeck</p>
          <h1 id="agentdeck-title">Workbench</h1>
        </div>
        <p className="version">v{appVersion}</p>
        <p className="startup-status" role={startupState?.status === 'error' || loadError ? 'alert' : 'status'}>
          {statusText}
        </p>
      </section>
    </main>
  );
}