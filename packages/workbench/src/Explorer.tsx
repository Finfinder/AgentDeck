import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentDeckPreloadApi, DirectoryListing, WorkspaceModel } from '@agentdeck/shared';

// Resolve the parent path without node:path — works for both '/' and '\' separators.
function parentPath(p: string): string {
  const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  return idx <= 0 ? normalized : normalized.slice(0, idx);
}

// Returns the last segment of a path for breadcrumb display.
function pathBasename(p: string): string {
  const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

interface ExplorerProps {
  agent: AgentDeckPreloadApi;
  workspaceModel: WorkspaceModel & { status: 'ok' };
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

  const breadcrumbName = currentPath === rootPath
    ? (workspaceModel.folders[0] ? (workspaceModel.folders[0].name ?? pathBasename(rootPath)) : '/')
    : pathBasename(currentPath);

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

      {isLoading && <p className="explorer-loading" role="status">Loading…</p>}

      {!isLoading && (
        <ul className="file-tree" role="tree" aria-label={`Contents of ${breadcrumbName}`}>
          {listing?.entries.map(entry => (
            <li
              key={entry.path}
              className={`file-tree-item${entry.isSensitive ? ' sensitive' : ''}`}
              role="treeitem"
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
            </li>
          ))}
          {listing?.entries.length === 0 && (
            <li className="file-tree-empty" role="treeitem">
              <span>Empty directory</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
