import { useCallback, useEffect, useRef, useState } from 'react';

import { pathBasename, normalizePathStr } from '@agentdeck/shared';
import type { AgentDeckPreloadApi, DirectoryListing, FileEntry, WorkspaceModel } from '@agentdeck/shared';

// Resolve the parent path without node:path - works for both '/' and '\\' separators.
function parentPath(p: string): string {
  const normalized = normalizePathStr(p);
  const idx = normalized.lastIndexOf('/');
  return idx <= 0 ? normalized : normalized.slice(0, idx);
}

interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly entry: FileEntry;
}

interface RenameDialogState {
  readonly entry: FileEntry;
  readonly value: string;
}

interface ExplorerProps {
  readonly agent: AgentDeckPreloadApi;
  readonly workspaceModel: WorkspaceModel & { status: 'ok' };
  readonly onFileOpen?: (filePath: string) => void;
}

export function Explorer({ agent, workspaceModel, onFileOpen }: ExplorerProps) {
  const roots = workspaceModel.folders;
  const [selectedRootIndex, setSelectedRootIndex] = useState(0);
  const rootPath = roots[selectedRootIndex]?.path ?? '';
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [contextMenuStyle, setContextMenuStyle] = useState<React.CSSProperties | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

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
    loadDir(currentPath).catch(err => console.error('[Explorer] loadDir error:', err));
  }, [currentPath, loadDir]);

  const handleFsEvent = useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadDir(currentPath).catch(err => console.error('[Explorer] loadDir error:', err));
    }, 300);
  }, [currentPath, loadDir]);

  // Subscribe to fs events and debounce refresh.
  useEffect(() => {
    const unsubscribe = agent.onFsEvent(handleFsEvent);
    return () => {
      unsubscribe();
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [agent, handleFsEvent]);

  // When the selected root changes, reset currentPath to the new root
  useEffect(() => {
    setCurrentPath(rootPath);
  }, [rootPath]);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (contextMenu === null) return;

    function handleClickOutside(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setContextMenu(null);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  // Compute context menu position when it's opened or moved
  const computeMenuPosition = useCallback(() => {
    const el = contextMenuRef.current;
    if (!el || !contextMenu) return;

    const rect = el.getBoundingClientRect();
    const menuW = rect.width || 160;
    const menuH = rect.height || 120;
    const margin = 8;
    const winW = globalThis.innerWidth;
    const winH = globalThis.innerHeight;

    let top = contextMenu.y;
    let left = contextMenu.x;
    let maxHeight: number | undefined;

    // Vertical positioning / flip
    if (top + menuH > winH - margin) {
      const spaceAbove = top - margin;
      const spaceBelow = winH - top - margin;
      if (spaceAbove >= menuH) {
        top = top - menuH;
      } else if (spaceBelow >= spaceAbove) {
        maxHeight = Math.max(0, spaceBelow);
      } else {
        top = margin;
        maxHeight = Math.max(0, spaceAbove);
      }
    }

    // Horizontal positioning / avoid right overflow
    if (left + menuW > winW - margin) {
      const spaceLeft = left - margin;
      left = spaceLeft >= menuW ? left - menuW : Math.max(winW - menuW - margin, margin);
    }

    const style: React.CSSProperties = { top: `${top}px`, left: `${left}px` };
    if (maxHeight !== undefined) style.maxHeight = `${maxHeight}px`;
    setContextMenuStyle(style);
  }, [contextMenu]);

  // Adjust context menu position to avoid viewport overflow (flip or clamp)
  useEffect(() => {
    if (contextMenu === null) {
      setContextMenuStyle(null);
      return;
    }

    const id = setTimeout(computeMenuPosition, 0);
    return () => clearTimeout(id);
  }, [contextMenu, computeMenuPosition]);

  // Prevent underlying explorer from scrolling while interacting with the context menu.
  // If the menu can scroll in the wheel direction, allow the menu to scroll but stop
  // propagation to ancestors. If the menu cannot scroll further in that direction,
  // preventDefault so the viewport won't scroll behind the menu.
  useEffect(() => {
    if (contextMenu === null) return;
    const el = contextMenuRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // deltaY > 0 means scrolling down; < 0 means scrolling up
      const deltaY = e.deltaY;
      const scrollTop = el.scrollTop;
      const clientH = el.clientHeight;
      const scrollH = el.scrollHeight;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientH >= scrollH - 1;

      if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) {
        // menu can scroll in this direction — allow default scrolling on the menu
        e.stopPropagation();
      } else {
        // menu cannot scroll further — prevent viewport from scrolling
        e.preventDefault();
        e.stopPropagation();
      }
    };

    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
      const touches = e.touches;
      let first: Touch | undefined;
      if (touches) {
        first = touches.item ? touches.item(0) ?? undefined : touches[0];
      }
      if (first) touchStartY = first.clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      const touches = e.touches;
      let first: Touch | undefined;
      if (touches) {
        first = touches.item ? touches.item(0) ?? undefined : touches[0];
      }
      if (!first) return;
      const touchY = first.clientY;
      const deltaY = touchStartY - touchY; // positive when swiping up
      const scrollTop = el.scrollTop;
      const clientH = el.clientHeight;
      const scrollH = el.scrollHeight;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientH >= scrollH - 1;

      if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) {
        e.stopPropagation();
      } else {
        e.preventDefault();
        e.stopPropagation();
      }
      touchStartY = touchY;
    };

    el.addEventListener('wheel', onWheel as EventListener, { passive: false });
    el.addEventListener('touchstart', onTouchStart as EventListener, { passive: true });
    el.addEventListener('touchmove', onTouchMove as EventListener, { passive: false });

    // Also add capture-phase global listeners so wheel/touch gestures that start
    // outside the menu while it's open cannot scroll the underlying explorer.
    const globalWheel = (ev: Event) => {
      const e = ev as WheelEvent;
      const target = ev.target as Node | null;
      const menu = contextMenuRef.current;
      if (menu && target && menu.contains(target)) {
        // let the local handlers manage scrolling inside the menu
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };

    const globalTouchMove = (ev: Event) => {
      const e = ev as TouchEvent;
      const target = ev.target as Node | null;
      const menu = contextMenuRef.current;
      if (menu && target && menu.contains(target)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };

    globalThis.addEventListener('wheel', globalWheel, { passive: false, capture: true });
    globalThis.addEventListener('touchmove', globalTouchMove, { passive: false, capture: true });

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      globalThis.removeEventListener('wheel', globalWheel, { capture: true });
      globalThis.removeEventListener('touchmove', globalTouchMove, { capture: true });
    };
  }, [contextMenu]);

  const canNavigateUp = currentPath !== rootPath && parentPath(currentPath) !== currentPath;

  let breadcrumbName: string;
  if (currentPath === rootPath) {
    const selected = roots[selectedRootIndex];
    breadcrumbName = selected === undefined ? '/' : (selected.name ?? pathBasename(rootPath));
  } else {
    breadcrumbName = pathBasename(currentPath);
  }

  // Compute relative path from the workspace root
  const getRelativePath = useCallback((filePath: string): string => {
    const normalizedRoot = normalizePathStr(rootPath);
    const normalizedFile = normalizePathStr(filePath);
    if (normalizedFile.startsWith(normalizedRoot + '/')) {
      return normalizedFile.slice(normalizedRoot.length + 1);
    }
    return filePath;
  }, [rootPath]);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleCopyPath = useCallback(async () => {
    if (contextMenu === null) return;
    try {
      await navigator.clipboard.writeText(contextMenu.entry.path);
    } catch {
      // Best-effort clipboard write
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleCopyRelativePath = useCallback(async () => {
    if (contextMenu === null) return;
    try {
      await navigator.clipboard.writeText(getRelativePath(contextMenu.entry.path));
    } catch {
      // Best-effort clipboard write
    }
    setContextMenu(null);
  }, [contextMenu, getRelativePath]);

  const handleRename = useCallback(() => {
    if (contextMenu === null) return;
    setRenameDialog({ entry: contextMenu.entry, value: contextMenu.entry.name });
    setContextMenu(null);
  }, [contextMenu]);

  // Focus the input when rename dialog opens (track entry path to avoid re-triggering on value change)
  const renameEntryPath = renameDialog?.entry.path ?? null;
  useEffect(() => {
    if (renameEntryPath !== null) {
      // Small delay to ensure the input is rendered
      const timer = setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [renameEntryPath]);

  const handleRenameConfirm = useCallback(() => {
    if (renameDialog === null) return;
    const { entry, value } = renameDialog;
    if (value === '' || value === entry.name) {
      setRenameDialog(null);
      return;
    }
    const dir = parentPath(entry.path);
    const newPath = dir + '/' + value;
    agent.renameFile(entry.path, newPath).then(() => {
      loadDir(currentPath).catch(err => console.error('[Explorer] loadDir error:', err));
    }).catch(err => console.error('[Explorer] renameFile error:', err));
    setRenameDialog(null);
  }, [renameDialog, agent, currentPath, loadDir]);

  const handleRenameCancel = useCallback(() => {
    setRenameDialog(null);
  }, []);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleRenameCancel();
    }
  }, [handleRenameConfirm, handleRenameCancel]);

  const handleDelete = useCallback(() => {
    if (contextMenu === null) return;
    const entry = contextMenu.entry;
    const confirmed = globalThis.confirm(
      `Are you sure you want to delete "${entry.name}"? This action cannot be undone.`
    );
    if (!confirmed) {
      setContextMenu(null);
      return;
    }
    agent.deleteFile(entry.path).then(() => {
      loadDir(currentPath).catch(err => console.error('[Explorer] loadDir error:', err));
    }).catch(err => console.error('[Explorer] deleteFile error:', err));
    setContextMenu(null);
  }, [contextMenu, agent, currentPath, loadDir]);

  return (
    <section className="explorer-panel" aria-label="Explorer">
      <div className="explorer-breadcrumb">
          {roots.length > 1 && (
            <select
              aria-label="Workspace root"
              className="explorer-root-select"
              value={selectedRootIndex}
              onChange={e => { setSelectedRootIndex(Number(e.target.value)); }}
            >
              {roots.map((r, idx) => (
                <option key={r.path} value={idx} title={r.path}>{r.name ?? pathBasename(r.path)}</option>
              ))}
            </select>
          )}
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

      {isLoading && <output className="explorer-loading">Loading.</output>}

      {!isLoading && (
        <div className="file-tree" role="tree" aria-label={`Contents of ${breadcrumbName}`}>
          {listing?.entries.map(entry => {
            const itemClass = `file-tree-item${entry.isSensitive ? ' sensitive' : ''}`;
            if (entry.kind === 'directory') {
              return (
                <div key={entry.path} className={itemClass}>
                  <button
                    role="treeitem"
                    tabIndex={0}
                    aria-selected={false}
                    aria-expanded={false}
                    onClick={() => { setCurrentPath(entry.path); }}
                    onContextMenu={e => { handleContextMenu(e, entry); }}
                    title={entry.path}
                    aria-label={`Open directory ${entry.name}`}
                  >
                    <span className="file-tree-icon" aria-hidden="true">📁</span>
                    <span className="file-tree-name">{entry.name}</span>
                  </button>
                </div>
              );
            }

            return (
              <div key={entry.path} className={itemClass}>
                <button
                  role="treeitem"
                  tabIndex={0}
                  aria-selected={false}
                  className="file-tree-file-button"
                  data-testid={`file-${entry.name}`}
                  onClick={() => { onFileOpen?.(entry.path); }}
                  onContextMenu={e => { handleContextMenu(e, entry); }}
                  title={entry.path}
                  aria-label={`Open file ${entry.name}`}
                >
                  <span className="file-tree-icon" aria-hidden="true">📄</span>
                  <span className="file-tree-name">{entry.name}</span>
                </button>
              </div>
            );
          })}
          {listing?.entries.length === 0 && (
            <div className="file-tree-empty">
              <span>Empty directory</span>
            </div>
          )}
        </div>
      )}

      {renameDialog !== null && (
        <dialog className="dialog-overlay" open aria-label={`Rename ${renameDialog.entry.name}`}>
          <div className="dialog">
            <h3 className="dialog-title">Rename "{renameDialog.entry.name}"</h3>
            <input
              ref={renameInputRef}
              className="dialog-input"
              type="text"
              value={renameDialog.value}
              onChange={e => { setRenameDialog(prev => prev ? { ...prev, value: e.target.value } : prev); }}
              onKeyDown={handleRenameKeyDown}
              aria-label="New name"
            />
            <div className="dialog-actions">
              <button className="dialog-button" onClick={handleRenameCancel}>Cancel</button>
              <button className="dialog-button primary" onClick={handleRenameConfirm}>Rename</button>
            </div>
          </div>
        </dialog>
      )}

      {contextMenu !== null && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={contextMenuStyle ?? { top: contextMenu.y, left: contextMenu.x }}
          role="menu"
          aria-label="File context menu"
        >
          <button className="context-menu-item" role="menuitem" onClick={handleCopyPath}>
            Copy Path
          </button>
          <button className="context-menu-item" role="menuitem" onClick={handleCopyRelativePath}>
            Copy Relative Path
          </button>
          <div className="context-menu-separator" />
          <button className="context-menu-item" role="menuitem" onClick={handleRename}>
            Rename
          </button>
          <button className="context-menu-item context-menu-item-danger" role="menuitem" onClick={handleDelete}>
            Delete
          </button>
        </div>
      )}
    </section>
  );
}

