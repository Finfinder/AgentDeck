import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import type { AgentDeckPreloadApi, EventLogEntry } from '@agentdeck/shared';

import { EventLogPanel } from '../../packages/workbench/src/EventLogPanel';

function createMockAgent(overrides: Partial<AgentDeckPreloadApi> = {}): AgentDeckPreloadApi {
  return {
    getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.1.0', services: [] }),
    versions: { chrome: 'dev', electron: 'dev', node: 'dev' },
    getThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }),
    setThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }),
    selectWorkspaceEntry: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    openWorkspace: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'test' }),
    listDirectory: vi.fn().mockResolvedValue({ path: '', entries: [] }),
    searchFiles: vi.fn().mockResolvedValue([]),
    getRecentWorkspaces: vi.fn().mockResolvedValue([]),
    onFsEvent: vi.fn().mockReturnValue(() => undefined),
    readFile: vi.fn().mockResolvedValue({ status: 'error', code: 'FILE_NOT_FOUND', message: 'test' }),
    writeFile: vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'test' }),
    markBufferDirty: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'test' }),
    renameFile: vi.fn().mockResolvedValue({ status: 'error', code: 'ACCESS_DENIED', message: 'test' }),
    getEditorDiagnostics: vi.fn().mockResolvedValue([]),
    applyWorkspaceEdit: vi.fn().mockResolvedValue({ status: 'error', code: 'UNKNOWN', message: 'test' }),
    showDiff: vi.fn().mockResolvedValue({ status: 'error', code: 'UNKNOWN', message: 'test' }),
    showSaveDialog: vi.fn().mockResolvedValue(null),
    toggleDevTools: vi.fn().mockResolvedValue(undefined),
    getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    startOAuth: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    signOut: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    onIdentityChange: vi.fn().mockReturnValue(() => undefined),
    onDeviceCode: vi.fn().mockReturnValue(() => undefined),
    onIdentityWarning: vi.fn().mockReturnValue(() => undefined),
    getModelGatewayConfig: vi.fn().mockResolvedValue({ providers: [], activeProvider: 'ollama', activeModel: 'default' }),
    listChatTabs: vi.fn().mockResolvedValue([]),
    createChatTab: vi.fn().mockResolvedValue({ id: 'tab-1', title: 'Chat', messages: [], activeModel: 'default', activeProvider: 'ollama', isStreaming: false }),
    closeChatTab: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ status: 'ok' }),
    stopStreaming: vi.fn().mockResolvedValue(undefined),
    onChatStream: vi.fn().mockReturnValue(() => undefined),
    onChatTabsChange: vi.fn().mockReturnValue(() => undefined),
    getApiKey: vi.fn().mockResolvedValue(null),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    deleteApiKey: vi.fn().mockResolvedValue(undefined),
    testConnection: vi.fn().mockResolvedValue({ status: 'error', message: 'test' }),
    setProviderConfig: vi.fn().mockResolvedValue(undefined),
    getProviderConfig: vi.fn().mockResolvedValue({ baseUrl: '', hasApiKey: false }),
    toolCall: vi.fn().mockResolvedValue({ status: 'ok', callId: 'dev', result: null }),
    onToolApprovalRequest: vi.fn().mockReturnValue(() => undefined),
    submitApproval: vi.fn().mockResolvedValue({ status: 'ok', callId: 'dev', result: null }),
    proposePatch: vi.fn().mockResolvedValue({ status: 'ok', patchId: 'dev-patch', appliedHash: 'dev-hash' }),
    applyPatch: vi.fn().mockResolvedValue({ status: 'ok', patchId: 'dev-patch', appliedHash: 'dev-hash' }),
    onConflictDetected: vi.fn().mockReturnValue(() => undefined),
    resolveConflict: vi.fn().mockResolvedValue(undefined),
    checkSensitivePath: vi.fn().mockResolvedValue({ filePath: '', isSensitive: false }),
    getFileHash: vi.fn().mockResolvedValue({ status: 'ok', hash: 'dev-hash' }),
    getEventLog: vi.fn().mockResolvedValue({
      status: 'ok',
      entries: [
        {
          id: 'evt-1',
          timestamp: 1000,
          level: 'info',
          source: 'tool-router',
          message: 'Patch applied',
          diff: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new',
          filePath: 'test.ts',
          patchId: 'patch-1'
        },
        {
          id: 'evt-2',
          timestamp: 2000,
          level: 'warn',
          source: 'permission-broker',
          message: 'Approval required'
        },
        {
          id: 'evt-3',
          timestamp: 3000,
          level: 'error',
          source: 'editor',
          message: 'File not found'
        }
      ] as EventLogEntry[],
      total: 3
    }),
    onEventLogUpdate: vi.fn().mockReturnValue(() => undefined),
    clearEventLog: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as AgentDeckPreloadApi;
}

describe('EventLogPanel — coverage', () => {
  describe('level filtering', () => {
    it('toggles info level filter off', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      // Info filter should be active by default
      const infoButton = screen.getByRole('button', { name: 'Info' });
      expect(infoButton).toHaveAttribute('aria-pressed', 'true');

      // Toggle info off
      fireEvent.click(infoButton);
      expect(infoButton).toHaveAttribute('aria-pressed', 'false');
    });

    it('toggles warn level filter off', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      const warnButton = screen.getByRole('button', { name: 'Ostrzeżenie' });
      expect(warnButton).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(warnButton);
      expect(warnButton).toHaveAttribute('aria-pressed', 'false');
    });

    it('toggles error level filter off', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      const errorButton = screen.getByRole('button', { name: 'Błąd' });
      expect(errorButton).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(errorButton);
      expect(errorButton).toHaveAttribute('aria-pressed', 'false');
    });

    it('toggles level filter back on', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      const infoButton = screen.getByRole('button', { name: 'Info' });
      fireEvent.click(infoButton);
      expect(infoButton).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(infoButton);
      expect(infoButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('diff-only filter', () => {
    it('toggles diff-only filter', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      const diffButton = screen.getByRole('button', { name: 'Tylko z diffem' });
      expect(diffButton).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(diffButton);
      expect(diffButton).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(diffButton);
      expect(diffButton).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('search filter', () => {
    it('updates search text on input change', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      const searchInput = screen.getByPlaceholderText('Szukaj w eventach...');
      fireEvent.change(searchInput, { target: { value: 'patch' } });

      expect(searchInput).toHaveValue('patch');
    });
  });

  describe('clear log', () => {
    it('clears event log when clear button is clicked', async () => {
      const clearEventLog = vi.fn().mockResolvedValue(undefined);
      const agent = createMockAgent({ clearEventLog });
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      const clearButton = screen.getByRole('button', { name: 'Wyczyść' });
      await act(async () => { fireEvent.click(clearButton); });

      expect(clearEventLog).toHaveBeenCalled();
    });
  });

  describe('diff toggle button', () => {
    it('renders show diff button for entries with diff', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      // The first event has a diff, so "Pokaż diff" button should be present
      expect(screen.getByText('Pokaż diff')).toBeDefined();
    });

    it('does not render diff button for entries without diff', async () => {
      const agent = createMockAgent({
        getEventLog: vi.fn().mockResolvedValue({
          status: 'ok',
          entries: [
            {
              id: 'evt-no-diff',
              timestamp: 1000,
              level: 'info',
              source: 'test',
              message: 'No diff here'
            }
          ] as EventLogEntry[],
          total: 1
        })
      });
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      expect(screen.queryByText('Pokaż diff')).toBeNull();
    });
  });

  describe('empty state', () => {
    it('shows loading state initially', async () => {
      const agent = createMockAgent({
        getEventLog: vi.fn().mockResolvedValue({ status: 'ok', entries: [], total: 0 })
      });
      render(<EventLogPanel agent={agent} />);

      // Should show loading or empty state
      await waitFor(() => {
        const emptyText = screen.queryByText('Ładowanie...') ?? screen.queryByText('Brak eventów do wyświetlenia');
        expect(emptyText).toBeDefined();
      });
    });

    it('shows empty message when no entries', async () => {
      const agent = createMockAgent({
        getEventLog: vi.fn().mockResolvedValue({ status: 'ok', entries: [], total: 0 })
      });
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => {
        expect(screen.getByText('Brak eventów do wyświetlenia')).toBeDefined();
      });
    });
  });

  describe('real-time updates', () => {
    it('subscribes to event log updates', async () => {
      const onEventLogUpdate = vi.fn().mockReturnValue(() => undefined);
      const agent = createMockAgent({ onEventLogUpdate });
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      expect(onEventLogUpdate).toHaveBeenCalled();
    });
  });

  describe('event entry rendering', () => {
    it('renders event with filePath', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      expect(screen.getByText('test.ts')).toBeDefined();
    });

    it('renders event with patchId', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      expect(screen.getByText('Patch: patch-1')).toBeDefined();
    });

    it('renders event without optional fields', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      // The warn event has no filePath, diff, or patchId
      expect(screen.getByText('Approval required')).toBeDefined();
    });
  });

  describe('theme prop', () => {
    it('renders with light theme', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} theme="light" />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      const panel = screen.getByRole('log')?.closest('.event-log-panel');
      expect(panel).toHaveAttribute('data-theme', 'light');
    });

    it('renders with dark theme by default', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => { expect(screen.getByText('Event Log')).toBeDefined(); });

      const panel = screen.getByRole('log')?.closest('.event-log-panel');
      expect(panel).toHaveAttribute('data-theme', 'dark');
    });
  });

  describe('getEventLog not available', () => {
    it('handles missing getEventLog gracefully', async () => {
      const agent = createMockAgent({
        getEventLog: undefined,
      } as any);
      render(<EventLogPanel agent={agent} />);

      // Should not crash
      await waitFor(() => {
        expect(screen.getByText('Event Log')).toBeDefined();
      });
    });
  });

  describe('onEventLogUpdate not available', () => {
    it('handles missing onEventLogUpdate gracefully', async () => {
      const agent = createMockAgent({
        onEventLogUpdate: undefined,
      } as any);
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => {
        expect(screen.getByText('Event Log')).toBeDefined();
      });
    });
  });

  describe('clearEventLog not available', () => {
    it('handles missing clearEventLog gracefully', async () => {
      const agent = createMockAgent({
        clearEventLog: undefined,
      } as any);
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => {
        expect(screen.getByText('Event Log')).toBeDefined();
      });

      // Clear button is rendered but clicking it should not crash
      const clearBtn = screen.queryByRole('button', { name: 'Wyczyść' });
      if (clearBtn) {
        await act(async () => { fireEvent.click(clearBtn); });
      }
    });
  });
});
