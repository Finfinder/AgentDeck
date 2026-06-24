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
   * The message and filePath are sanitized to strip potential secrets before storage.
   * Emits 'update' with the new entry for real-time UI notifications.
   */
  append(entry: Omit<EventLogEntry, 'id' | 'timestamp'>): EventLogEntry {
    const base = {
      ...entry,
      message: sanitizeMessage(entry.message),
      id: generateEventId(),
      timestamp: Date.now()
    };
    const fullEntry: EventLogEntry = entry.filePath === undefined
      ? base
      : { ...base, filePath: sanitizeFilePath(entry.filePath) };

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
   * The diff, message, and filePath are sanitized to strip potential secrets before storage.
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
            e.filePath?.toLowerCase().includes(search)
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
 * Set of regex patterns for detecting secrets in text.
 * Each pattern has a description for auditability.
 */
const SECRET_PATTERNS = {
  // KEY=VALUE or KEY: VALUE pairs — redact the value portion
  keyValue: [
    /(api[_-]?key|apikey)\s*[:=]\s*\S+/gi,
    /(password|passwd|pwd)\s*[:=]\s*\S+/gi,
    /(secret|client[_-]?secret|app[_-]?secret)\s*[:=]\s*\S+/gi,
    /(token|access[_-]?token|refresh[_-]?token|id[_-]?token)\s*[:=]\s*\S+/gi,
    /(authorization|bearer)\s+\S+/gi,
    /(private[_-]?key|secret[_-]?key|signing[_-]?key)\s*[:=]\s*\S+/gi,
    /(connection[_-]?string|conn[_-]?str)\s*[:=]\s*\S+/gi,
    /(account[_-]?key|storage[_-]?key)\s*[:=]\s*\S+/gi,
  ],
  // Standalone secret values (no key prefix) — replace entire match
  standalone: [
    // AWS Access Key ID
    /AKIA[0-9A-Z]{16}/g,
    // GitHub PAT (classic)
    /ghp_[A-Za-z0-9]{36}/g,
    // GitHub PAT (fine-grained)
    /github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}/g,
    // OpenAI API key
    /sk-[A-Za-z0-9]{48}/g,
    // Generic API key prefix
    /sk-proj-[A-Za-z0-9]{48,}/g,
    // JWT (three base64url segments separated by dots)
    /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    // Azure GUID-style keys (32 hex chars, often with Base64 padding)
    /[A-Za-z0-9+/]{32,}={0,2}/g,
    // Google service account private key header marker
    /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    // Generic high-entropy hex strings (40+ chars — likely secrets)
    /\b[0-9a-f]{40,}\b/gi,
  ],
};

/**
 * Sanitize a diff string by redacting lines that may contain secrets.
 * Lines matching common secret patterns (API keys, passwords, tokens, JWT,
 * Azure keys, Google keys, connection strings, etc.) are replaced with
 * a placeholder to prevent secret leakage into the event log.
 */
function sanitizeDiff(diff: string): string {
  return diff
    .split('\n')
    .map(line => {
      let sanitized = line;
      // Handle KEY=VALUE patterns — preserve key, redact value
      for (const pattern of SECRET_PATTERNS.keyValue) {
        sanitized = sanitized.replace(pattern, (_match, key) => {
          return `${key}=[REDACTED]`;
        });
      }
      // Handle standalone secret patterns — replace entire match
      for (const pattern of SECRET_PATTERNS.standalone) {
        sanitized = sanitized.replace(pattern, '[REDACTED]');
      }
      return sanitized;
    })
    .join('\n');
}

/**
 * Sanitize a message string by redacting embedded secrets.
 * Unlike sanitizeDiff which operates on diff lines, this handles
 * secrets that may appear inline within arbitrary message text.
 */
function sanitizeMessage(message: string): string {
  let sanitized = message;
  // Apply all standalone patterns (JWT, AWS keys, GitHub tokens, etc.)
  for (const pattern of SECRET_PATTERNS.standalone) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  // Apply key-value patterns for inline mentions like "token=abc123"
  for (const pattern of SECRET_PATTERNS.keyValue) {
    sanitized = sanitized.replace(pattern, (_match, key) => {
      return `${key}=[REDACTED]`;
    });
  }
  return sanitized;
}

/**
 * Sanitize a file path by redacting usernames and sensitive directory names.
 * Replaces home directory paths and usernames with placeholders.
 */
function sanitizeFilePath(filePath: string): string {
  // Replace Windows user profile paths: C:\\Users\\Username\\... → C:\\Users\\[USER]\\...
  let sanitized = filePath.replace(
    /([A-Z]:\\)Users\\[^\\]+\\/gi,
    '$1Users\\[USER]\\'
  );
  // Replace Unix home paths: /home/username/... → /home/[USER]/...
  sanitized = sanitized.replace(
    /\/home\/[^/]+\//g,
    '/home/[USER]/'
  );
  // Replace Unix home paths: /Users/username/... (macOS) → /Users/[USER]/...
  sanitized = sanitized.replace(
    /\/Users\/[^/]+\//g,
    '/Users/[USER]/'
  );
  // Replace ~ expansion: ~/... → ~[USER]/...
  sanitized = sanitized.replace(
    /~[^/]*\//g,
    '~[USER]/'
  );
  return sanitized;
}

// Singleton instance for the main process
let instance: EventLogService | null = null;

export function getEventLogService(): EventLogService {
  instance ??= new EventLogService();
  return instance;
}
