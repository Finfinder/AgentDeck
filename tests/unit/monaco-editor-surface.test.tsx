import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { MonacoEditorSurface } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi, EditorTab } from '@agentdeck/shared';

function createMockTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 'tab-1',
    filePath: '/src/app.ts',
    fileName: 'app.ts',
    language: 'typescript',
    isDirty: false,
    isPinned: false,
    revealLine: null,
    revealCol: null,
    revealPattern: null,
    revealNonce: 0,
    ...overrides
  };
}

function createMockAgent(overrides: Partial<AgentDeckPreloadApi> = {}): AgentDeckPreloadApi {
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
    readFile: vi.fn().mockResolvedValue({ status: 'ok', content: 'const x = 1;', encoding: 'utf8' }),
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

describe('MonacoEditorSurface', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows loading state initially', () => {
    const agent = createMockAgent();
    const tab = createMockTab();
    render(
      <MonacoEditorSurface
        agent={agent}
        tab={tab}
        onDirtyChange={vi.fn()}
        onContentChange={vi.fn()}
        theme="dark"
      />
    );
    expect(screen.getByText('Loading app.ts')).toBeDefined();
  });

  it('renders editor after successful file load', async () => {
    const agent = createMockAgent({
      readFile: vi.fn().mockResolvedValue({ status: 'ok', content: 'const x = 1;', encoding: 'utf8' })
    });
    const tab = createMockTab();
    render(
      <MonacoEditorSurface
        agent={agent}
        tab={tab}
        onDirtyChange={vi.fn()}
        onContentChange={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText('Loading app.ts')).toBeNull();
    });
  });

  it('shows error state when file read fails', async () => {
    const agent = createMockAgent({
      readFile: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'File not found: /src/app.ts' })
    });
    const tab = createMockTab();
    render(
      <MonacoEditorSurface
        agent={agent}
        tab={tab}
        onDirtyChange={vi.fn()}
        onContentChange={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText('Error loading app.ts')).toBeDefined();
      expect(screen.getByText('File not found: /src/app.ts')).toBeDefined();
    });
  });

  it('shows error state when readFile rejects', async () => {
    const agent = createMockAgent({
      readFile: vi.fn().mockRejectedValue(new Error('Network error'))
    });
    const tab = createMockTab();
    render(
      <MonacoEditorSurface
        agent={agent}
        tab={tab}
        onDirtyChange={vi.fn()}
        onContentChange={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText('Error loading app.ts')).toBeDefined();
      expect(screen.getByText('Network error')).toBeDefined();
    });
  });

  it('shows generic error for non-Error rejection', async () => {
    const agent = createMockAgent({
      readFile: vi.fn().mockRejectedValue('string error')
    });
    const tab = createMockTab();
    render(
      <MonacoEditorSurface
        agent={agent}
        tab={tab}
        onDirtyChange={vi.fn()}
        onContentChange={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText('Failed to load file.')).toBeDefined();
    });
  });

  it('calls readFile with the tab file path', async () => {
    const readFileMock = vi.fn().mockResolvedValue({ status: 'ok', content: '', encoding: 'utf8' });
    const agent = createMockAgent({ readFile: readFileMock });
    const tab = createMockTab({ filePath: '/src/components/Header.tsx' });
    render(
      <MonacoEditorSurface
        agent={agent}
        tab={tab}
        onDirtyChange={vi.fn()}
        onContentChange={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(readFileMock).toHaveBeenCalledWith('/src/components/Header.tsx');
    });
  });

  it('reloads content when tab file path changes', async () => {
    const readFileMock = vi.fn().mockResolvedValue({ status: 'ok', content: 'const x = 1;', encoding: 'utf8' });
    const agent = createMockAgent({ readFile: readFileMock });
    const tab = createMockTab({ filePath: '/src/app.ts' });

    const { rerender } = render(
      <MonacoEditorSurface
        agent={agent}
        tab={tab}
        onDirtyChange={vi.fn()}
        onContentChange={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(readFileMock).toHaveBeenCalledTimes(1);
    });

    // Change tab to a different file
    const newTab = createMockTab({ id: 'tab-2', filePath: '/src/main.ts', fileName: 'main.ts' });
    rerender(
      <MonacoEditorSurface
        agent={agent}
        tab={newTab}
        onDirtyChange={vi.fn()}
        onContentChange={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(readFileMock).toHaveBeenCalledTimes(2);
      expect(readFileMock).toHaveBeenLastCalledWith('/src/main.ts');
    });
  });

  it('has accessible loading label', () => {
    const agent = createMockAgent();
    const tab = createMockTab();
    const { container } = render(
      <MonacoEditorSurface
        agent={agent}
        tab={tab}
        onDirtyChange={vi.fn()}
        onContentChange={vi.fn()}
        theme="dark"
      />
    );
    const loadingOutput = container.querySelector('output.editor-surface-loading');
    expect(loadingOutput).not.toBeNull();
    expect(loadingOutput!.getAttribute('aria-live')!).toBe('polite');
    expect(loadingOutput!.getAttribute('aria-label')!).toBe('Loading app.ts');
  });

  it('shows loading for different file names', () => {
    const agent = createMockAgent();
    const tab = createMockTab({ fileName: 'README.md' });
    render(
      <MonacoEditorSurface
        agent={agent}
        tab={tab}
        onDirtyChange={vi.fn()}
        onContentChange={vi.fn()}
        theme="dark"
      />
    );
    expect(screen.getByText('Loading README.md')).toBeDefined();
  });

  it('calls markBufferDirty when content changes to dirty', async () => {
    const markBufferDirtyMock = vi.fn().mockResolvedValue(undefined);
    const agent = createMockAgent({ markBufferDirty: markBufferDirtyMock });
    const tab = createMockTab();
    render(
      <MonacoEditorSurface
        agent={agent}
        tab={tab}
        onDirtyChange={vi.fn()}
        onContentChange={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText('Loading app.ts')).toBeNull();
    });

    // Simulate editor content change via the hidden textarea in the mock.
    // The textarea's onChange is wired to the Monaco Editor's onChange prop,
    // which triggers handleEditorChange in the component.
    const editor = await screen.findByRole('textbox', { name: 'Editor' });
    fireEvent.change(editor, { target: { value: '// modified content' } });

    await waitFor(() => {
      expect(markBufferDirtyMock).toHaveBeenCalledWith('/src/app.ts');
    });
  });

  it('does not call markBufferDirty when content is unchanged', async () => {
    const markBufferDirtyMock = vi.fn().mockResolvedValue(undefined);
    const agent = createMockAgent({ markBufferDirty: markBufferDirtyMock });
    const tab = createMockTab();
    render(
      <MonacoEditorSurface
        agent={agent}
        tab={tab}
        onDirtyChange={vi.fn()}
        onContentChange={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(screen.queryByText('Loading app.ts')).toBeNull();
    });

    // No content change � markBufferDirty should not be called.
    expect(markBufferDirtyMock).not.toHaveBeenCalled();
  });
});

