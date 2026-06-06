import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SearchPanel } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi, SearchResult, WorkspaceModel } from '@agentdeck/shared';

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

const workspaceModel: WorkspaceModel & { status: 'ok' } = {
  status: 'ok',
  filePath: '/workspace.code-workspace',
  kind: 'workspace-file',
  folders: [{ path: '/workspace', name: 'workspace' }]
};

const mockOnFileOpen = vi.fn();

describe('SearchPanel', () => {
  it('renders search form with input and button', () => {
    render(<SearchPanel agent={mockAgent()} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search pattern' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run search' })).toBeInTheDocument();
  });

  it('disables search button when pattern is empty', () => {
    render(<SearchPanel agent={mockAgent()} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    expect(screen.getByRole('button', { name: 'Run search' })).toBeDisabled();
  });

  it('enables search button when pattern has content', async () => {
    const user = userEvent.setup();
    render(<SearchPanel agent={mockAgent()} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'test');

    expect(screen.getByRole('button', { name: 'Run search' })).toBeEnabled();
  });

  it('calls agent.searchFiles with pattern and workspace roots on submit', async () => {
    const user = userEvent.setup();
    const searchFiles = vi.fn().mockResolvedValue([]);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'hello');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    await waitFor(() => {
      expect(searchFiles).toHaveBeenCalledWith({
        pattern: 'hello',
        workspaceRoots: ['/workspace']
      });
    });
  });

  it('renders search results with file basename, location and snippet', async () => {
    const user = userEvent.setup();
    const results: SearchResult[] = [
      { id: '/workspace/src/index.ts:10:5', file: '/workspace/src/index.ts', line: 10, col: 5, snippet: 'const x = 1;', isSensitive: false },
      { id: '/workspace/src/utils.ts:3:1', file: '/workspace/src/utils.ts', line: 3, col: 1, snippet: 'export function', isSensitive: false }
    ];
    const searchFiles = vi.fn().mockResolvedValue(results);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'const');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    expect(await screen.findByRole('list', { name: '2 search results' })).toBeInTheDocument();
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.getByText(':10:5')).toBeInTheDocument();
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    expect(screen.getByText('utils.ts')).toBeInTheDocument();
  });

  it('marks sensitive results with sensitive class', async () => {
    const user = userEvent.setup();
    const results: SearchResult[] = [
      { id: '/workspace/.env:1:1', file: '/workspace/.env', line: 1, col: 1, snippet: 'SECRET=abc', isSensitive: true }
    ];
    const searchFiles = vi.fn().mockResolvedValue(results);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'SECRET');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    const item = (await screen.findByText('SECRET=abc')).closest('.search-result-item')!;
    expect(item).toHaveClass('sensitive');
  });

  it('renders "No results found" when search returns empty', async () => {
    const user = userEvent.setup();
    const searchFiles = vi.fn().mockResolvedValue([]);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'nothing');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    expect(await screen.findByText('No results found.')).toBeInTheDocument();
  });

  it('renders error message when search throws', async () => {
    const user = userEvent.setup();
    const searchFiles = vi.fn().mockRejectedValue(new Error('Search service unavailable'));
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'fail');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Search service unavailable');
  });

  it('shows "Searching." label on button while searching', async () => {
    const user = userEvent.setup();
    // Create a promise that we control
    let resolveSearch: (value: SearchResult[]) => void;
    const searchFiles = vi.fn().mockImplementation(
      () => new Promise<SearchResult[]>(resolve => { resolveSearch = resolve; })
    );
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'slow');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    expect(await screen.findByRole('button', { name: 'Run search' })).toHaveTextContent('Searching.');

    // Resolve the search
    resolveSearch!([]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run search' })).toHaveTextContent('Search');
    });
  });

  it('disables input while searching', async () => {
    const user = userEvent.setup();
    let resolveSearch: (value: SearchResult[]) => void;
    const searchFiles = vi.fn().mockImplementation(
      () => new Promise<SearchResult[]>(resolve => { resolveSearch = resolve; })
    );
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'slow');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    expect(await screen.findByRole('searchbox', { name: 'Search pattern' })).toBeDisabled();

    resolveSearch!([]);

    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: 'Search pattern' })).toBeEnabled();
    });
  });

  it('does not call searchFiles for whitespace-only pattern', async () => {
    const user = userEvent.setup();
    const searchFiles = vi.fn().mockResolvedValue([]);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), '   ');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    expect(searchFiles).not.toHaveBeenCalled();
  });

  it('does not call searchFiles for empty pattern', async () => {
    const searchFiles = vi.fn().mockResolvedValue([]);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    // Submit form with empty input (button should be disabled, but test the function directly)
    const form = screen.getByRole('search');
    fireEvent.submit(form);

    expect(searchFiles).not.toHaveBeenCalled();
  });

  it('trims whitespace from pattern before searching', async () => {
    const user = userEvent.setup();
    const searchFiles = vi.fn().mockResolvedValue([]);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), '  hello  ');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    await waitFor(() => {
      expect(searchFiles).toHaveBeenCalledWith({
        pattern: 'hello',
        workspaceRoots: ['/workspace']
      });
    });
  });

  it('clears previous error when starting a new search', async () => {
    const user = userEvent.setup();
    const searchFiles = vi.fn()
      .mockRejectedValueOnce(new Error('First search failed'))
      .mockResolvedValueOnce([]);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    // First search - should fail
    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'fail');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('First search failed');

    // Second search - should clear error
    await user.clear(screen.getByRole('searchbox', { name: 'Search pattern' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'ok');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('shows hasSearched state after first search', async () => {
    const user = userEvent.setup();
    const searchFiles = vi.fn().mockResolvedValue([]);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'test');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    await waitFor(() => {
      expect(screen.getByText('No results found.')).toBeInTheDocument();
    });
  });

  it('completes full search cycle including finally block', async () => {
    const user = userEvent.setup();
    const results: SearchResult[] = [
      { id: '/workspace/a.ts:1:1', file: '/workspace/a.ts', line: 1, col: 1, snippet: 'test', isSensitive: false }
    ];
    const searchFiles = vi.fn().mockResolvedValue(results);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'test');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    // Wait for search to complete (isSearching goes back to false)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run search' })).toHaveTextContent('Search');
    });

    // Verify results are displayed
    expect(await screen.findByRole('list', { name: '1 search results' })).toBeInTheDocument();
  });

  it('submits search via form submit event', async () => {
    const searchFiles = vi.fn().mockResolvedValue([]);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    const input = screen.getByRole('searchbox', { name: 'Search pattern' });
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.submit(screen.getByRole('search'));

    await waitFor(() => {
      expect(searchFiles).toHaveBeenCalledWith({
        pattern: 'test',
        workspaceRoots: ['/workspace']
      });
    });
  });

  it('calls searchFiles and sets results on successful search', async () => {
    const user = userEvent.setup();
    const results: SearchResult[] = [
      { id: '/workspace/a.ts:1:1', file: '/workspace/a.ts', line: 1, col: 1, snippet: 'test', isSensitive: false }
    ];
    const searchFiles = vi.fn().mockResolvedValue(results);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'test');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    await waitFor(() => {
      expect(searchFiles).toHaveBeenCalledWith({
        pattern: 'test',
        workspaceRoots: ['/workspace']
      });
    });

    expect(await screen.findByRole('list', { name: '1 search results' })).toBeInTheDocument();
  });

  it('renders search results with correct aria-label count', async () => {
    const user = userEvent.setup();
    const results: SearchResult[] = [
      { id: '/workspace/a.ts:1:1', file: '/workspace/a.ts', line: 1, col: 1, snippet: 'test', isSensitive: false },
      { id: '/workspace/b.ts:2:1', file: '/workspace/b.ts', line: 2, col: 1, snippet: 'test', isSensitive: false },
      { id: '/workspace/c.ts:3:1', file: '/workspace/c.ts', line: 3, col: 1, snippet: 'test', isSensitive: false }
    ];
    const searchFiles = vi.fn().mockResolvedValue(results);
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'test');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    expect(await screen.findByRole('list', { name: '3 search results' })).toBeInTheDocument();
  });

  it('uses multiple workspace roots when workspace has multiple folders', async () => {
    const user = userEvent.setup();
    const searchFiles = vi.fn().mockResolvedValue([]);
    const agent = mockAgent({ searchFiles });

    const multiRootWorkspace: WorkspaceModel & { status: 'ok' } = {
      status: 'ok',
      filePath: '/multi.code-workspace',
      kind: 'workspace-file',
      folders: [
        { path: '/workspace-a', name: 'A' },
        { path: '/workspace-b', name: 'B' }
      ]
    };

    render(<SearchPanel agent={agent} workspaceModel={multiRootWorkspace} onFileOpen={mockOnFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'test');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    await waitFor(() => {
      expect(searchFiles).toHaveBeenCalledWith({
        pattern: 'test',
        workspaceRoots: ['/workspace-a', '/workspace-b']
      });
    });
  });

  it('calls onFileOpen when search result is clicked', async () => {
    const user = userEvent.setup();
    const results: SearchResult[] = [
      { id: '/workspace/src/index.ts:10:5', file: '/workspace/src/index.ts', line: 10, col: 5, snippet: 'const x = 1;', isSensitive: false }
    ];
    const searchFiles = vi.fn().mockResolvedValue(results);
    const onFileOpen = vi.fn();
    const agent = mockAgent({ searchFiles });

    render(<SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={onFileOpen} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search pattern' }), 'const');
    await user.click(screen.getByRole('button', { name: 'Run search' }));

    await waitFor(() => {
      expect(screen.getByRole('list', { name: '1 search results' })).toBeInTheDocument();
    });

    // Click on the search result button - use fireEvent for the button inside list item
    const listItem = screen.getByRole('listitem');
    const resultButton = listItem.querySelector('button')!;
    fireEvent.click(resultButton);

    expect(onFileOpen).toHaveBeenCalledWith('/workspace/src/index.ts', 10, 5, 'const', expect.any(Number));
  });
});

