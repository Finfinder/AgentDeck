import { useState, useMemo, useCallback } from 'react';
import { pathBasename } from '@agentdeck/shared';
import type { DiagnosticSeverity, EditorDiagnostic } from '@agentdeck/shared';

interface ProblemsPanelProps {
  readonly diagnostics: readonly EditorDiagnostic[];
  readonly onDiagnosticClick: (filePath: string, line: number, col: number) => void;
  readonly workspaceRoot: string | null;
}

function severityLabel(severity: DiagnosticSeverity): string {
  switch (severity) {
    case 'error': return 'Error';
    case 'warning': return 'Warning';
    case 'info': return 'Info';
    case 'hint': return 'Hint';
  }
}

function severitySymbol(severity: DiagnosticSeverity): string {
  switch (severity) {
    case 'error': return '[E]';
    case 'warning': return '[W]';
    case 'info': return '[I]';
    case 'hint': return '[H]';
  }
}

/** Compute a relative path from workspace root, or fall back to basename. */
function relativePath(filePath: string, workspaceRoot: string | null): string {
  if (workspaceRoot && filePath.startsWith(workspaceRoot)) {
    const rel = filePath.slice(workspaceRoot.length);
    return rel.startsWith('/') || rel.startsWith('\\') ? rel.slice(1) : rel;
  }
  return pathBasename(filePath);
}

interface DiagnosticGroup {
  readonly filePath: string;
  readonly relPath: string;
  readonly diagnostics: readonly EditorDiagnostic[];
}

function groupByFile(diagnostics: readonly EditorDiagnostic[], workspaceRoot: string | null): DiagnosticGroup[] {
  const map = new Map<string, EditorDiagnostic[]>();
  for (const d of diagnostics) {
    const existing = map.get(d.filePath);
    if (existing) {
      existing.push(d);
    } else {
      map.set(d.filePath, [d]);
    }
  }
  const groups: DiagnosticGroup[] = [];
  for (const [filePath, items] of map) {
    groups.push({ filePath, relPath: relativePath(filePath, workspaceRoot), diagnostics: items });
  }
  groups.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return groups;
}

export function ProblemsPanel({ diagnostics, onDiagnosticClick, workspaceRoot }: ProblemsPanelProps) {
  const total = diagnostics.length;
  const groups = useMemo(() => groupByFile(diagnostics, workspaceRoot), [diagnostics, workspaceRoot]);

  // All groups expanded by default
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggleGroup = useCallback((filePath: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  return (
    <section className="problems-panel" aria-label="Problems">
      {total === 0 ? (
        <p className="problems-empty" aria-live="polite">No problems detected.</p>
      ) : (
        <ul className="problems-group-list" aria-label={`${total} problems in ${groups.length} files`}>
          {groups.map(group => {
            const isCollapsed = collapsed.has(group.filePath);
            return (
              <li key={group.filePath} className="problems-group">
                <button
                  type="button"
                  className="problems-group-header"
                  onClick={() => toggleGroup(group.filePath)}
                  aria-expanded={!isCollapsed}
                  aria-label={`${group.relPath}, ${group.diagnostics.length} problems`}
                >
                  {/* Toggle icon: '+' when collapsed, '-' when expanded */}
                  <span
                    className={`problems-group-toggle${isCollapsed ? ' problems-group-toggle--collapsed' : ''}`}
                    aria-hidden="true"
                  >
                    {isCollapsed ? '+' : '-'}
                  </span>
                  <span className="problems-group-path">{group.relPath}</span>
                  <span className="problems-group-count">({group.diagnostics.length})</span>
                </button>
                {!isCollapsed && (
                  <ul className="problems-list">
                    {group.diagnostics.map((d, idx) => (
                      <li key={`${d.filePath}:${d.line}:${d.col}:${idx}`}>
                        <button
                          type="button"
                          className="problems-item"
                          onClick={() => { onDiagnosticClick(d.filePath, d.line, d.col); }}
                          aria-label={`${severityLabel(d.severity)}: ${d.message} in ${d.filePath} at line ${d.line}`}
                        >
                          <span className={`problems-severity problems-severity--${d.severity}`}>
                            {severitySymbol(d.severity)}
                          </span>
                          <span className="problems-message">{d.message}</span>
                          <span className="problems-source">[{d.source}]</span>
                          <span className="problems-location">
                            {d.line}:{d.col}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
