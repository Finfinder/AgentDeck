import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AgentDeckPreloadApi,
  EventLogEntry,
  EventLogFilter,
  EventLogLevel
} from '@agentdeck/shared';

import { MonacoDiffPanel } from './editor/MonacoDiffPanel';

// ?? Types ???????????????????????????????????????????????????????????????????

interface EventLogPanelProps {
  readonly agent: AgentDeckPreloadApi;
  readonly theme?: 'dark' | 'light';
}

type FilterState = {
  levels: Set<EventLogLevel>;
  hasDiffOnly: boolean;
  searchText: string;
};

const LEVEL_LABELS: Record<EventLogLevel, string> = {
  info: 'Info',
  warn: 'Ostrzeżenie',
  error: 'Błąd'
};

const LEVEL_COLORS: Record<EventLogLevel, string> = {
  info: 'var(--color-accent)',
  warn: 'var(--color-warning)',
  error: 'var(--color-danger)'
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('pl-PL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// ?? Components ?????????????????????????????????????????????????????????????

function DiffDetail({
  diff,
  filePath,
  theme
}: Readonly<{
  diff: string;
  filePath: string | undefined;
  theme: 'dark' | 'light';
}>) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        className="event-log-diff-toggle"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
      >
        Pokaż diff
      </button>
    );
  }

  // Parse unified diff into original/modified for Monaco diff editor
  const { original, modified } = parseUnifiedDiff(diff);

  return (
    <div className="event-log-diff-detail">
      <button
        className="event-log-diff-toggle"
        onClick={() => setExpanded(false)}
        aria-expanded={true}
      >
        Ukryj diff
      </button>
      <div className="event-log-diff-viewer">
        <MonacoDiffPanel
          original={original}
          modified={modified}
          filePath={filePath}
          language={undefined}
          theme={theme}
        />
      </div>
    </div>
  );
}

/**
 * Parse a unified diff string back into original and modified content.
 * Simple parser that handles +, -, and context lines.
 */
function parseUnifiedDiff(diff: string): { original: string; modified: string } {
  const lines = diff.split('\n');
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];

  for (const line of lines) {
    // Skip diff headers
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('-')) {
      originalLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      modifiedLines.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      // Context line — present in both
      originalLines.push(line.slice(1));
      modifiedLines.push(line.slice(1));
    } else if (line.length > 0) {
      // Unmarked line — treat as context
      originalLines.push(line);
      modifiedLines.push(line);
    }
  }

  return {
    original: originalLines.join('\n'),
    modified: modifiedLines.join('\n')
  };
}

function EventLogEntryCard({
  entry,
  theme
}: Readonly<{
  entry: EventLogEntry;
  theme: 'dark' | 'light';
}> ) {
  const color = LEVEL_COLORS[entry.level];

  return (
    <div className="event-log-entry" data-level={entry.level}>
      <div className="event-log-entry-header">
        <span
          className="event-log-level-badge"
          style={{ borderColor: color, color }}
        >
          {LEVEL_LABELS[entry.level]}
        </span>
        <span className="event-log-source">{entry.source}</span>
        <span className="event-log-timestamp">{formatTimestamp(entry.timestamp)}</span>
      </div>
      <div className="event-log-entry-body">
        <p className="event-log-message">{entry.message}</p>
        {entry.filePath && (
          <span className="event-log-filepath">{entry.filePath}</span>
        )}
        {entry.patchId && (
          <span className="event-log-patch-id">Patch: {entry.patchId}</span>
        )}
        {entry.diff && entry.diff.length > 0 && (
          <DiffDetail diff={entry.diff} filePath={entry.filePath ?? undefined} theme={theme} />
        )}
      </div>
    </div>
  );
}

// ?? Main Panel ?????????????????????????????????????????????????????????????

export function EventLogPanel({ agent, theme = 'dark' }: Readonly<EventLogPanelProps>) {
  const [entries, setEntries] = useState<readonly EventLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<FilterState>({
    levels: new Set(['info', 'warn', 'error']),
    hasDiffOnly: false,
    searchText: ''
  });
  const [isLoading, setIsLoading] = useState(true);

  // Load entries from event log service
  const loadEntries = useCallback(async () => {
    if (!agent.getEventLog) return;
    try {
      setIsLoading(true);
      const eventFilter: EventLogFilter = {
        levels: Array.from(filter.levels),
        hasDiffOnly: filter.hasDiffOnly,
        ...(filter.searchText ? { searchText: filter.searchText } : {})
      };
      const result = await agent.getEventLog(eventFilter);
      if (result.status === 'ok') {
        setEntries(result.entries);
        setTotal(result.total);
      }
    } catch {
      // Silently fail — event log is best-effort
    } finally {
      setIsLoading(false);
    }
  }, [agent, filter]);

  // Initial load and real-time updates
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // Subscribe to real-time event log updates
  useEffect(() => {
    if (!agent.onEventLogUpdate) return;
    const unsubscribe = agent.onEventLogUpdate(() => {
      loadEntries();
    });
    return unsubscribe;
  }, [agent, loadEntries]);

  const toggleLevel = useCallback((level: EventLogLevel) => {
    setFilter(prev => {
      const next = new Set(prev.levels);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return { ...prev, levels: next };
    });
  }, []);

  const toggleDiffOnly = useCallback(() => {
    setFilter(prev => ({ ...prev, hasDiffOnly: !prev.hasDiffOnly }));
  }, []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(prev => ({ ...prev, searchText: e.target.value }));
  }, []);

  const handleClearLog = useCallback(async () => {
    if (!agent.clearEventLog) return;
    try {
      await agent.clearEventLog();
      setEntries([]);
      setTotal(0);
    } catch {
      // Silently fail
    }
  }, [agent]);

  const filteredEntries = useMemo(() => entries, [entries]);

  return (
    <div className="event-log-panel" data-theme={theme}>
      {/* Header */}
      <div className="event-log-header">
        <h3 className="event-log-title">Event Log</h3>
        <span className="event-log-count">{total} eventów</span>
      </div>

      {/* Filters */}
      <div className="event-log-filters">
        <div className="event-log-filter-row">
          <input
            type="text"
            className="event-log-search"
            placeholder="Szukaj w eventach..."
            value={filter.searchText}
            onChange={handleSearchChange}
            aria-label="Szukaj w eventach"
          />
        </div>
        <div className="event-log-filter-row">
          <span className="event-log-filter-label">Poziomy:</span>
          {(['info', 'warn', 'error'] as const).map(level => (
            <button
              key={level}
              className={`event-log-level-filter ${filter.levels.has(level) ? 'active' : ''}`}
              style={{
                '--level-color': LEVEL_COLORS[level]
              } as React.CSSProperties}
              onClick={() => toggleLevel(level)}
              aria-pressed={filter.levels.has(level)}
            >
              {LEVEL_LABELS[level]}
            </button>
          ))}
          <button
            className={`event-log-diff-filter ${filter.hasDiffOnly ? 'active' : ''}`}
            onClick={toggleDiffOnly}
            aria-pressed={filter.hasDiffOnly}
          >
            Tylko z diffem
          </button>
          <button
            className="event-log-clear-btn"
            onClick={handleClearLog}
            title="Wyczyść event log"
          >
            Wyczyść
          </button>
        </div>
      </div>

      {/* Entries list */}
      <div className="event-log-entries" role="log" aria-live="polite">
        {isLoading && entries.length === 0 && (
          <div className="event-log-empty">Ładowanie...</div>
        )}
        {!isLoading && filteredEntries.length === 0 && (
          <div className="event-log-empty">Brak eventów do wyświetlenia</div>
        )}
        {filteredEntries.map(entry => (
          <EventLogEntryCard
            key={entry.id}
            entry={entry}
            theme={theme}
          />
        ))}
      </div>
    </div>
  );
}
