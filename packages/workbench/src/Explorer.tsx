import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentDeckPreloadApi, DirectoryListing, WorkspaceModel } from '@agentdeck/shared';

// Normalise path separators and remove trailing slashes without a ReDoS-prone regex.
function normalizePathStr(p: string): string {
  const s = p.replaceAll('\\', '/');
  let end = s.length;
  while (end > 1 && s[end - 1] === '/') end--;
  return s.slice(0, end);
}

// Resolve the parent path without node:path — works for both '/' and '\' separators.
function parentPath(p: string): string {
  const normalized = normalizePathStr(p);
  const idx = normalized.lastIndexOf('/');
  return idx <= 0 ? normalized : normalized.slice(0, idx);
}

// Returns the last segment of a path for breadcrumb display.
function pathBasename(p: string): string {
  const normalized = normalizePathStr(p);
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

interface ExplorerProps {
  readonly agent: AgentDeckPreloadApi;
  readonly workspaceModel: WorkspaceModel & { status: 'ok' };
}

export function Explorer({ agent, workspaceModel }: ExplorerProps) {
  const rootPath = workspaceModel.folders[0]?.path ?? '';
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDir = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      const result = await agent.listDirectory(path);
      setListing(result);
    } finally {
      setIsLoading(false);
    }
  }, [agent]);

  useEffect(() => {
    void loadDir(currentPath);
  }, [currentPath, loadDir]);

  // Subscribe to fs events and debounce refresh.
  useEffect(() => {
    const unsubscribe = agent.onFsEvent(() => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { void loadDir(currentPath); }, 300);
    });
    return () => {
      unsubscribe();
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [agent, currentPath, loadDir]);

  const canNavigateUp = currentPath !== rootPath && parentPath(currentPath) !== currentPath;

  let breadcrumbName: string;
  if (currentPath === rootPath) {
    const first = workspaceModel.folders[0];
    breadcrumbName = first === undefined ? '/' : (first.name ?? pathBasename(rootPath));
  } else {
    breadcrumbName = pathBasename(currentPath);
  }

  return (
    <section className="explorer-panel" aria-label="Explorer">
      <div className="explorer-breadcrumb">
        {canNavigateUp && (
          <button
            className="explorer-breadcrumb-up"
            onClick={() => { setCurrentPath(parentPath(currentPath)); }}
            aria-label="Navigate up"
            title="Go up"
          >
            ..
          </button>
        )}
        <span className="explorer-breadcrumb-name" title={currentPath}>{breadcrumbName}</span>
      </div>

      {isLoading && <output className="explorer-loading">Loading…</output>}

      {!isLoading && (
        <div className="file-tree" role="tree" aria-label={`Contents of ${breadcrumbName}`}>
          {listing?.entries.map(entry => (
            <div
              key={entry.path}
              className={`file-tree-item${entry.isSensitive ? ' sensitive' : ''}`}
              role="treeitem"
              aria-selected={false}
              aria-expanded={entry.kind === 'directory' ? false : undefined}
            >
              {entry.kind === 'directory' ? (
                <button
                  onClick={() => { setCurrentPath(entry.path); }}
                  title={entry.path}
                  aria-label={`Open directory ${entry.name}`}
                >
                  <span className="file-tree-icon" aria-hidden="true">??</span>
                  <span className="file-tree-name">{entry.name}</span>
                </button>
              ) : (
                <span title={entry.path}>
                  <span className="file-tree-icon" aria-hidden="true">??</span>
                  <span className="file-tree-name">{entry.name}</span>
                </span>
              )}
            </div>
          ))}
          {listing?.entries.length === 0 && (
            <div className="file-tree-empty" role="treeitem" aria-selected={false}>
              <span>Empty directory</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
