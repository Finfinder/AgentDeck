import { EventEmitter } from 'node:events';

import type {
  EventLogEntry,
  EventLogFilter,
  EventLogLevel,
  EventLogResult
} from '@agentdeck/shared';

// ?? Event Log Service ???????????????????????????????????????????????????=

let eventCounter = 0;

function generateEventId(): string {
  const ts = Date.now().toString(36);
  const counter = (++eventCounter).toString(36);
  return `evt-${ts}-${counter}`;
}

export class EventLogService extends EventEmitter {
  private readonly entries: EventLogEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    super();
    this.maxEntries = maxEntries;
  }

  /**
   * Append a new event log entry.
   * Emits 'update' with the new entry for real-time UI notifications.
   */
  append(entry: Omit<EventLogEntry, 'id' | 'timestamp'>): EventLogEntry {
    const fullEntry: EventLogEntry = {
      ...entry,
      id: generateEventId(),
      timestamp: Date.now()
    };

    this.entries.push(fullEntry);

    // Trim old entries if exceeding max
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    this.emit('update', fullEntry);
    return fullEntry;
  }

  /**
   * Append a patch-related event with diff data.
   * The diff is sanitized to strip potential secrets before storage.
   */
  appendPatchEvent(params: {
    level: EventLogLevel;
    source: string;
    message: string;
    diff: string;
    filePath: string;
    patchId: string;
  }): EventLogEntry {
    return this.append({
      level: params.level,
      source: params.source,
      message: params.message,
      diff: sanitizeDiff(params.diff),
      filePath: params.filePath,
      patchId: params.patchId
    });
  }

  /**
   * Query entries with optional filtering.
   */
  query(filter?: EventLogFilter): EventLogResult {
    let filtered = [...this.entries];

    if (filter) {
      if (filter.levels !== undefined) {
        const levelSet = new Set(filter.levels);
        filtered = filtered.filter(e => levelSet.has(e.level));
      }

      if (filter.sources !== undefined) {
        const sourceSet = new Set(filter.sources);
        filtered = filtered.filter(e => sourceSet.has(e.source));
      }

      if (filter.searchText) {
        const search = filter.searchText.toLowerCase();
        filtered = filtered.filter(
          e =>
            e.message.toLowerCase().includes(search) ||
            e.source.toLowerCase().includes(search) ||
            (e.filePath !== undefined && e.filePath.toLowerCase().includes(search))
        );
      }

      if (filter.hasDiffOnly) {
        filtered = filtered.filter(e => e.diff !== undefined && e.diff.length > 0);
      }

      if (filter.since !== undefined) {
        filtered = filtered.filter(e => e.timestamp >= filter.since!);
      }

      if (filter.until !== undefined) {
        filtered = filtered.filter(e => e.timestamp <= filter.until!);
      }
    }

    // Return newest first
    filtered.reverse();

    return { status: 'ok', entries: filtered, total: filtered.length };
  }

  /**
   * Get all unique sources for filter UI.
   */
  getSources(): readonly string[] {
    const sources = new Set<string>();
    for (const entry of this.entries) {
      sources.add(entry.source);
    }
    return Array.from(sources).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries.length = 0;
    this.emit('clear');
  }

  /**
   * Get total entry count.
   */
  get count(): number {
    return this.entries.length;
  }
}

/**
 * Sanitize a diff string by redacting lines that may contain secrets.
 * Lines matching common secret patterns (API keys, passwords, tokens, etc.)
 * are replaced with a placeholder to prevent secret leakage into the event log.
 */
function sanitizeDiff(diff: string): string {
  // Patterns that match KEY=VALUE or KEY: VALUE pairs
  const keyValuePatterns = [
    /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/gi,
    /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
    /(?:secret|token|access[_-]?token)\s*[:=]\s*\S+/gi,
    /(?:authorization|bearer)\s+\S+/gi,
    /(?:private[_-]?key|secret[_-]?key)\s*[:=]\s*\S+/gi,
  ];

  // Patterns that match standalone secret values (no key prefix)
  const standalonePatterns: Array<{ pattern: RegExp; prefix: string }> = [
    { pattern: /AKIA[0-9A-Z]{16}/g, prefix: 'AWS_ACCESS_KEY_ID' }, // AWS access key ID
    { pattern: /ghp_[A-Za-z0-9]{36}/g, prefix: 'GitHub PAT' }, // GitHub PAT
    { pattern: /sk-[A-Za-z0-9]{48}/g, prefix: 'API key' }, // OpenAI API key
  ];

  return diff
    .split('\n')
    .map(line => {
      let sanitized = line;
      // Handle KEY=VALUE patterns
      for (const pattern of keyValuePatterns) {
        sanitized = sanitized.replace(pattern, (match) => {
          const keyPart = match.split(/[:=]/)[0];
          return `${keyPart}=[REDACTED]`;
        });
      }
      // Handle standalone secret patterns (replace entire match)
      for (const { pattern } of standalonePatterns) {
        sanitized = sanitized.replace(pattern, '[REDACTED]');
      }
      return sanitized;
    })
    .join('\n');
}

// Singleton instance for the main process
let instance: EventLogService | null = null;

export function getEventLogService(): EventLogService {
  if (!instance) {
    instance = new EventLogService();
  }
  return instance;
}
