import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Explorer } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi, DirectoryListing, FileEntry, WorkspaceModel } from '@agentdeck/shared';

function mockAgent(overrides: Partial<AgentDeckPreloadApi> = {}): AgentDeckPreloadApi {
  return {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }),
    selectWorkspaceEntry: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    versions: { chrome: '130.0.0', electron: '42.3.0', node: '25.0.0' },
    getThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }),
    setThemeSettings: vi.fn().mockImplementation(async (s: unknown) => s),
    openWorkspace: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'Test' }),
    listDirectory: vi.fn().mockResolvedValue({ path: '/', entries: [] }),
    searchFiles: vi.fn().mockResolvedValue([]),
    getRecentWorkspaces: vi.fn().mockResolvedValue([]),
    onFsEvent: vi.fn().mockReturnValue(() => undefined),
    readFile: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'Test' }),
    writeFile: vi.fn().mockResolvedValue({ status: 'ok' }),
    markBufferDirty: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue({ status: 'ok' }),
    renameFile: vi.fn().mockResolvedValue({ status: 'ok' }),
    getEditorDiagnostics: vi.fn().mockResolvedValue([]),
    applyWorkspaceEdit: vi.fn().mockResolvedValue({ status: 'ok' }),
    showDiff: vi.fn().mockResolvedValue({ status: 'ok', diff: '' }),
    showSaveDialog: vi.fn().mockResolvedValue(null),
    toggleDevTools: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

const singleRootWorkspace: WorkspaceModel & { status: 'ok' } = {
  status: 'ok',
  filePath: '/workspace.code-workspace',
  kind: 'workspace-file',
  folders: [{ path: '/workspace', name: 'workspace' }]
};

const multiRootWorkspace: WorkspaceModel & { status: 'ok' } = {
  status: 'ok',
  filePath: '/multi.code-workspace',
  kind: 'workspace-file',
  folders: [
    { path: '/workspace-a', name: 'ProjectA' },
    { path: '/workspace-b', name: 'ProjectB' }
  ]
};

function makeEntries(items: Array<{ name: string; path: string; kind: 'file' | 'directory'; isSensitive?: boolean }>): FileEntry[] {
  return items.map(e => ({
    name: e.name,
    path: e.path,
    kind: e.kind,
    isSensitive: e.isSensitive ?? false
  }));
}

describe('Explorer', () => {
  it('renders explorer panel with aria-label', async () => {
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries: [] });
    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    expect(await screen.findByRole('region', { name: 'Explorer' })).toBeInTheDocument();
  });

  it('shows loading indicator while loading directory', async () => {
    let resolveDir: (value: DirectoryListing) => void;
    const listDirectory = vi.fn().mockImplementation(
      () => new Promise<DirectoryListing>(resolve => { resolveDir = resolve; })
    );

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    await screen.findByText('Loading.');

    resolveDir!({ path: '/workspace', entries: [] });

    await waitFor(() => {
      expect(screen.queryByText('Loading.')).not.toBeInTheDocument();
    });
  });

  it('renders file entries with names', async () => {
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' },
      { name: 'utils.ts', path: '/workspace/utils.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    expect(await screen.findByText('index.ts')).toBeInTheDocument();
    expect(screen.getByText('utils.ts')).toBeInTheDocument();
  });

  it('renders directory entries as clickable buttons', async () => {
    const entries = makeEntries([
      { name: 'src', path: '/workspace/src', kind: 'directory' }
    ]);
    const listDirectory = vi.fn()
      .mockResolvedValueOnce({ path: '/workspace', entries })
      .mockResolvedValueOnce({ path: '/workspace/src', entries: [] });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    const dirButton = await screen.findByRole('treeitem', { name: 'Open directory src' });
    expect(dirButton).toBeInTheDocument();

    await userEvent.click(dirButton);

    await waitFor(() => {
      expect(listDirectory).toHaveBeenCalledWith('/workspace/src');
    });
  });

  it('renders "Empty directory" when no entries', async () => {
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries: [] });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    expect(await screen.findByText('Empty directory')).toBeInTheDocument();
  });

  it('marks sensitive entries with sensitive class', async () => {
    const entries = makeEntries([
      { name: '.env', path: '/workspace/.env', kind: 'file', isSensitive: true }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    const item = await screen.findByRole('treeitem', { selected: false });
    expect(item.parentElement).toHaveClass('sensitive');
  });

  it('shows breadcrumb with root name at root path', async () => {
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries: [] });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    expect(await screen.findByText('workspace')).toBeInTheDocument();
  });

  it('shows ".." navigate-up button when not at root', async () => {
    const entries = makeEntries([
      { name: 'src', path: '/workspace/src', kind: 'directory' }
    ]);
    const listDirectory = vi.fn()
      .mockResolvedValueOnce({ path: '/workspace', entries })
      .mockResolvedValueOnce({ path: '/workspace/src', entries: [] });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    // Navigate into src
    const dirButton = await screen.findByRole('treeitem', { name: 'Open directory src' });
    await userEvent.click(dirButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Navigate up' })).toBeInTheDocument();
    });
  });

  it('does not show ".." navigate-up button at root path', async () => {
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries: [] });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    await screen.findByText('workspace');
    expect(screen.queryByRole('button', { name: 'Navigate up' })).not.toBeInTheDocument();
  });

  it('navigates up when ".." button is clicked', async () => {
    const entries = makeEntries([
      { name: 'src', path: '/workspace/src', kind: 'directory' }
    ]);
    const listDirectory = vi.fn()
      .mockResolvedValueOnce({ path: '/workspace', entries })
      .mockResolvedValueOnce({ path: '/workspace/src', entries: [] })
      .mockResolvedValueOnce({ path: '/workspace', entries });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    // Navigate into src
    const dirButton = await screen.findByRole('treeitem', { name: 'Open directory src' });
    await userEvent.click(dirButton);

    await waitFor(() => screen.getByRole('button', { name: 'Navigate up' }));

    // Navigate up
    await userEvent.click(screen.getByRole('button', { name: 'Navigate up' }));

    await waitFor(() => {
      expect(listDirectory).toHaveBeenCalledWith('/workspace');
    });
  });

  it('shows root select dropdown for multi-root workspace', async () => {
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace-a', entries: [] });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={multiRootWorkspace} />);

    const select = await screen.findByRole('combobox', { name: 'Workspace root' });
    expect(select).toBeInTheDocument();
    const options = within(select).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('ProjectA');
    expect(options[1]).toHaveTextContent('ProjectB');
  });

  it('does not show root select for single-root workspace', async () => {
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries: [] });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    await screen.findByText('workspace');
    expect(screen.queryByRole('combobox', { name: 'Workspace root' })).not.toBeInTheDocument();
  });

  it('switches directory when root select changes', async () => {
    const listDirectory = vi.fn()
      .mockResolvedValueOnce({ path: '/workspace-a', entries: [] })
      .mockResolvedValueOnce({ path: '/workspace-b', entries: [] });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={multiRootWorkspace} />);

    const select = await screen.findByRole('combobox', { name: 'Workspace root' });
    await userEvent.selectOptions(select, '1');

    await waitFor(() => {
      expect(listDirectory).toHaveBeenCalledWith('/workspace-b');
    });
  });

  it('shows breadcrumb with directory name when navigated into subdirectory', async () => {
    const entries = makeEntries([
      { name: 'src', path: '/workspace/src', kind: 'directory' }
    ]);
    const listDirectory = vi.fn()
      .mockResolvedValueOnce({ path: '/workspace', entries })
      .mockResolvedValueOnce({ path: '/workspace/src', entries: [] });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    const dirButton = await screen.findByRole('treeitem', { name: 'Open directory src' });
    await userEvent.click(dirButton);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
    });
  });

  it('subscribes to fs events on mount', async () => {
    const onFsEvent = vi.fn().mockReturnValue(() => undefined);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries: [] });

    render(<Explorer agent={mockAgent({ listDirectory, onFsEvent })} workspaceModel={singleRootWorkspace} />);

    await screen.findByText('workspace');
    expect(onFsEvent).toHaveBeenCalled();

    // Verify the handler is a function
    const handler = onFsEvent.mock.calls[0]?.[0];
    expect(typeof handler).toBe('function');
  });

  it('unsubscribes from fs events on unmount', async () => {
    const unsubscribe = vi.fn();
    const onFsEvent = vi.fn().mockReturnValue(unsubscribe);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries: [] });

    const { unmount } = render(
      <Explorer agent={mockAgent({ listDirectory, onFsEvent })} workspaceModel={singleRootWorkspace} />
    );

    await screen.findByText('workspace');
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it('renders file tree with tree role', async () => {
    const entries = makeEntries([
      { name: 'a.ts', path: '/workspace/a.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    expect(await screen.findByRole('tree')).toBeInTheDocument();
  });

  it('calls onFileOpen with file path when a file entry is clicked', async () => {
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });
    const onFileOpen = vi.fn();

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} onFileOpen={onFileOpen} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    await userEvent.click(fileButton);

    expect(onFileOpen).toHaveBeenCalledWith('/workspace/index.ts');
  });

  it('does not call onFileOpen when a directory entry is clicked', async () => {
    const entries = makeEntries([
      { name: 'src', path: '/workspace/src', kind: 'directory' }
    ]);
    const listDirectory = vi.fn()
      .mockResolvedValueOnce({ path: '/workspace', entries })
      .mockResolvedValueOnce({ path: '/workspace/src', entries: [] });
    const onFileOpen = vi.fn();

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} onFileOpen={onFileOpen} />);

    const dirButton = await screen.findByRole('treeitem', { name: 'Open directory src' });
    await userEvent.click(dirButton);

    expect(onFileOpen).not.toHaveBeenCalled();
  });

  it('uses path basename for breadcrumb when root has no name', async () => {
    const noNameWorkspace: WorkspaceModel & { status: 'ok' } = {
      status: 'ok',
      filePath: '/workspace.code-workspace',
      kind: 'workspace-file',
      folders: [{ path: '/my-project' }]
    };
    const listDirectory = vi.fn().mockResolvedValue({ path: '/my-project', entries: [] });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={noNameWorkspace} />);

    expect(await screen.findByText('my-project')).toBeInTheDocument();
  });

  // Context menu tests - cover line 31 (contextMenu state)
  it('opens context menu on right-click on a file entry', async () => {
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    expect(await screen.findByRole('menu', { name: 'File context menu' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy Path' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('closes context menu on Escape key', async () => {
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    expect(await screen.findByRole('menu', { name: 'File context menu' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: 'File context menu' })).not.toBeInTheDocument();
    });
  });

  // Rename dialog tests - cover line 31 (renameDialog state) and lines 341-342 (handleRenameKeyDown)
  it('opens rename dialog when Rename is clicked in context menu', async () => {
    const user = userEvent.setup();
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    const renameItem = await screen.findByRole('menuitem', { name: 'Rename' });
    await user.click(renameItem);

    expect(await screen.findByRole('dialog', { name: 'Rename index.ts' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'New name' })).toHaveValue('index.ts');
  });

  it('confirms rename on Enter key in rename dialog', async () => {
    const user = userEvent.setup();
    const renameFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    render(<Explorer agent={mockAgent({ listDirectory, renameFile: renameFileMock })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    const renameItem = await screen.findByRole('menuitem', { name: 'Rename' });
    await user.click(renameItem);

    const input = await screen.findByRole('textbox', { name: 'New name' });
    // Wait for Explorer's auto-select timeout (50ms) to fire so select()
    // doesn't race with user.type() and eat the first character
    await new Promise(r => setTimeout(r, 100));
    await user.clear(input);
    await user.type(input, 'newname.ts');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(renameFileMock).toHaveBeenCalledWith('/workspace/index.ts', '/workspace/newname.ts');
    });
  });

  it('cancels rename on Escape key in rename dialog', async () => {
    const user = userEvent.setup();
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    const renameItem = await screen.findByRole('menuitem', { name: 'Rename' });
    await user.click(renameItem);

    expect(await screen.findByRole('dialog', { name: 'Rename index.ts' })).toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: 'New name' });
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Rename index.ts' })).not.toBeInTheDocument();
    });
  });

  // Delete tests - cover line 361 (handleDelete)
  it('shows confirmation and deletes file when confirmed', async () => {
    const user = userEvent.setup();
    const deleteFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

    render(<Explorer agent={mockAgent({ listDirectory, deleteFile: deleteFileMock })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    const deleteItem = await screen.findByRole('menuitem', { name: 'Delete' });
    await user.click(deleteItem);

    await waitFor(() => {
      expect(deleteFileMock).toHaveBeenCalledWith('/workspace/index.ts');
    });

    confirmSpy.mockRestore();
  });

  it('does not delete when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const deleteFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);

    render(<Explorer agent={mockAgent({ listDirectory, deleteFile: deleteFileMock })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    const deleteItem = await screen.findByRole('menuitem', { name: 'Delete' });
    await user.click(deleteItem);

    expect(deleteFileMock).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('does not rename when value is empty', async () => {
    const user = userEvent.setup();
    const renameFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    render(<Explorer agent={mockAgent({ listDirectory, renameFile: renameFileMock })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    const renameItem = await screen.findByRole('menuitem', { name: 'Rename' });
    await user.click(renameItem);

    const input = await screen.findByRole('textbox', { name: 'New name' });
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    expect(renameFileMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Rename index.ts' })).not.toBeInTheDocument();
  });

  it('does not rename when value is unchanged', async () => {
    const user = userEvent.setup();
    const renameFileMock = vi.fn().mockResolvedValue({ status: 'ok' });
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    render(<Explorer agent={mockAgent({ listDirectory, renameFile: renameFileMock })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    const renameItem = await screen.findByRole('menuitem', { name: 'Rename' });
    await user.click(renameItem);

    // Don't change the value, just click Rename
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    expect(renameFileMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Rename index.ts' })).not.toBeInTheDocument();
  });

  it('cancels rename when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    const renameItem = await screen.findByRole('menuitem', { name: 'Rename' });
    await user.click(renameItem);

    expect(await screen.findByRole('dialog', { name: 'Rename index.ts' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Rename index.ts' })).not.toBeInTheDocument();
    });
  });

  it('copies absolute path when Copy Path is clicked', async () => {
    const user = userEvent.setup();
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    const origClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: writeTextMock }, configurable: true });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    const copyPathItem = await screen.findByRole('menuitem', { name: 'Copy Path' });
    await user.click(copyPathItem);

    expect(writeTextMock).toHaveBeenCalledWith('/workspace/index.ts');

    Object.defineProperty(navigator, 'clipboard', { value: origClipboard, configurable: true });
  });

  it('copies relative path when Copy Relative Path is clicked', async () => {
    const user = userEvent.setup();
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/src/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    const origClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: writeTextMock }, configurable: true });

    render(<Explorer agent={mockAgent({ listDirectory })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    const copyRelPathItem = await screen.findByRole('menuitem', { name: 'Copy Relative Path' });
    await user.click(copyRelPathItem);

    expect(writeTextMock).toHaveBeenCalledWith('src/index.ts');

    Object.defineProperty(navigator, 'clipboard', { value: origClipboard, configurable: true });
  });

  it('handles delete error gracefully', async () => {
    const user = userEvent.setup();
    const deleteFileMock = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const entries = makeEntries([
      { name: 'index.ts', path: '/workspace/index.ts', kind: 'file' }
    ]);
    const listDirectory = vi.fn().mockResolvedValue({ path: '/workspace', entries });

    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

    render(<Explorer agent={mockAgent({ listDirectory, deleteFile: deleteFileMock })} workspaceModel={singleRootWorkspace} />);

    const fileButton = await screen.findByRole('treeitem', { name: 'Open file index.ts' });
    fireEvent.contextMenu(fileButton);

    const deleteItem = await screen.findByRole('menuitem', { name: 'Delete' });
    await user.click(deleteItem);

    await waitFor(() => {
      expect(deleteFileMock).toHaveBeenCalledWith('/workspace/index.ts');
    });

    confirmSpy.mockRestore();
  });
});

