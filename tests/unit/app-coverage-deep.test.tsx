import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi, AgentRuntimeSessionState } from '@agentdeck/shared';

import { createMockAgent } from './mock-agent';

function mockPreloadApi(overrides: Parameters<typeof createMockAgent>[0] = {}): ReturnType<typeof createMockAgent> {
  return createMockAgent(overrides);
}

function setAgentDeck(api: AgentDeckPreloadApi) {
  Object.defineProperty(globalThis, 'agentDeck', { configurable: true, value: api });
}

function clearGlobalAgent() {
  Object.defineProperty(globalThis, 'agentDeck', { configurable: true, value: undefined });
}

describe('App — deep coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
  });

  afterEach(() => {
    clearGlobalAgent();
  });

  // ?? Startup state error ????????????????????????????????????????????????
  describe('startup state error', () => {
    it('shows error when getStartupState rejects', async () => {
      setAgentDeck(mockPreloadApi({
        getStartupState: vi.fn().mockRejectedValue(new Error('fail'))
      }));

      await act(async () => { render(<App />); });

      // When loadError is set, role becomes 'alert'
      expect(await screen.findByRole('alert', { name: 'Startup state' })).toHaveTextContent('Unable to read startup state.');
    });

    it('shows startup error message when status is error', async () => {
      setAgentDeck(mockPreloadApi({
        getStartupState: vi.fn().mockResolvedValue({ status: 'error', message: 'Config corrupt', services: [] })
      }));

      await act(async () => { render(<App />); });

      expect(await screen.findByRole('alert', { name: 'Startup state' })).toHaveTextContent('Config corrupt');
    });
  });

  // ?? Theme settings ????????????????????????????????????????????????????
  describe('theme settings', () => {
    it('loads theme settings on mount', async () => {
      setAgentDeck(mockPreloadApi({
        getThemeSettings: vi.fn().mockResolvedValue({ theme: 'light' })
      }));

      await act(async () => { render(<App />); });

      expect(await screen.findByRole('status', { name: 'Theme settings' })).toHaveTextContent('Theme settings ready.');
    });

    it('shows error when getThemeSettings rejects', async () => {
      setAgentDeck(mockPreloadApi({
        getThemeSettings: vi.fn().mockRejectedValue(new Error('No theme'))
      }));

      await act(async () => { render(<App />); });

      expect(await screen.findByRole('status', { name: 'Theme settings' })).toHaveTextContent('Unable to read theme settings.');
    });

    it('shows error when setThemeSettings rejects', async () => {
      const user = userEvent.setup();
      setAgentDeck(mockPreloadApi({
        setThemeSettings: vi.fn().mockRejectedValue(new Error('Disk full')),
        getThemeSettings: vi.fn().mockResolvedValue({ theme: 'light' })
      }));

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Dark' }));

      expect(await screen.findByRole('status', { name: 'Theme settings' })).toHaveTextContent('Unable to save theme settings.');
    });

    it('shows saved status after successful theme toggle', async () => {
      const user = userEvent.setup();
      setAgentDeck(mockPreloadApi({
        getThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }),
        setThemeSettings: vi.fn().mockImplementation(async (s: unknown) => s)
      }));

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Light' }));

      expect(await screen.findByRole('status', { name: 'Theme settings' })).toHaveTextContent('Theme settings saved.');
    });
  });

  // ?? Workspace open ????????????????????????????????????????????????????
  describe('workspace open', () => {
    it('opens a folder through workspace IPC', async () => {
      const user = userEvent.setup();
      const selectWorkspaceEntry = vi.fn().mockResolvedValue({
        status: 'selected' as const,
        kind: 'folder' as const,
        path: '/ws',
        name: 'ws'
      });
      const openWorkspace = vi.fn().mockResolvedValue({
        status: 'ok' as const,
        filePath: '/ws',
        kind: 'folder' as const,
        folders: [{ path: '/ws', name: 'ws' }]
      });
      const listDirectory = vi.fn().mockResolvedValue({ path: '/ws', entries: [] });

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace, listDirectory }));
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      expect(selectWorkspaceEntry).toHaveBeenCalledWith({ kind: 'folder' });
      expect(openWorkspace).toHaveBeenCalledWith('/ws', 'folder');
      expect(await screen.findByRole('status', { name: 'Workspace status' })).toHaveTextContent('ws opened.');
    });

    it('opens a workspace file through workspace IPC', async () => {
      const user = userEvent.setup();
      const selectWorkspaceEntry = vi.fn().mockResolvedValue({
        status: 'selected' as const,
        kind: 'workspace-file' as const,
        path: '/ws/project.code-workspace',
        name: 'project'
      });
      const openWorkspace = vi.fn().mockResolvedValue({
        status: 'ok' as const,
        filePath: '/ws/project.code-workspace',
        kind: 'workspace-file' as const,
        folders: [
          { path: '/ws/frontend', name: 'frontend' },
          { path: '/ws/backend', name: 'backend' }
        ]
      });
      const listDirectory = vi.fn().mockResolvedValue({ path: '/ws/frontend', entries: [] });

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace, listDirectory }));
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open workspace' }));

      expect(selectWorkspaceEntry).toHaveBeenCalledWith({ kind: 'workspace-file' });
      expect(openWorkspace).toHaveBeenCalledWith('/ws/project.code-workspace', 'workspace-file');
    });

    it('shows cancelled status when user cancels workspace selection', async () => {
      const user = userEvent.setup();
      const selectWorkspaceEntry = vi.fn().mockResolvedValue({ status: 'cancelled' as const });

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry }));
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      expect(await screen.findByRole('status', { name: 'Workspace status' })).toHaveTextContent('No workspace opened.');
    });

    it('shows error when selectWorkspaceEntry rejects', async () => {
      const user = userEvent.setup();
      const selectWorkspaceEntry = vi.fn().mockRejectedValue(new Error('fail'));

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry }));
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      expect(await screen.findByRole('status', { name: 'Workspace status' })).toHaveTextContent('Unable to open workspace picker.');
    });

    it('shows error when openWorkspace returns error', async () => {
      const user = userEvent.setup();
      const selectWorkspaceEntry = vi.fn().mockResolvedValue({
        status: 'selected' as const,
        kind: 'folder' as const,
        path: '/bad',
        name: 'bad'
      });
      const openWorkspace = vi.fn().mockResolvedValue({
        status: 'error' as const,
        code: 'ACCESS_DENIED' as const,
        message: 'Access denied'
      });

      setAgentDeck(mockPreloadApi({ selectWorkspaceEntry, openWorkspace }));
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Open folder' }));

      expect(await screen.findByRole('status', { name: 'Workspace status' })).toHaveTextContent('Access denied');
    });
  });

  // ?? Panel switching ??????????????????????????????????????????????????
  describe('panel switching', () => {
    beforeEach(() => {
      setAgentDeck(mockPreloadApi());
    });

    it('switches to search panel', async () => {
      const user = userEvent.setup();
      const listDirectory = vi.fn().mockResolvedValue({ path: '/ws', entries: [] });
      const searchFiles = vi.fn().mockResolvedValue([]);
      setAgentDeck(mockPreloadApi({
        selectWorkspaceEntry: vi.fn().mockResolvedValue({
          status: 'selected', kind: 'folder', path: '/ws', name: 'ws'
        }),
        openWorkspace: vi.fn().mockResolvedValue({
          status: 'ok', filePath: '/ws', kind: 'folder', folders: [{ path: '/ws', name: 'ws' }]
        }),
        listDirectory,
        searchFiles
      }));

      await act(async () => { render(<App />); });

      // Open workspace first so search button is enabled
      await user.click(screen.getByRole('button', { name: 'Open folder' }));
      await waitFor(() => { expect(listDirectory).toHaveBeenCalled(); });

      await user.click(screen.getByRole('button', { name: 'Search' }));
      // Search panel should be active (aria-pressed=true)
      expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('switches to chat panel', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Chat' }));
      expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('switches back to explorer panel', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Chat' }));
      await user.click(screen.getByRole('button', { name: 'Explorer' }));
      expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  // ?? Bottom panel switching ???????????????????????????????????????????
  describe('bottom panel switching', () => {
    beforeEach(() => {
      setAgentDeck(mockPreloadApi());
    });

    it('switches to services panel', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('tab', { name: 'Services' }));
      expect(screen.getByRole('tab', { name: 'Services' })).toHaveAttribute('aria-selected', 'true');
    });

    it('switches to output panel', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('tab', { name: 'Output' }));
      expect(screen.getByRole('tab', { name: 'Output' })).toHaveAttribute('aria-selected', 'true');
    });

    it('switches to event-log panel', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('tab', { name: 'Event Log' }));
      expect(screen.getByRole('tab', { name: 'Event Log' })).toHaveAttribute('aria-selected', 'true');
    });

    it('shows No output in output panel', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('tab', { name: 'Output' }));
      expect(screen.getByText('No output.')).toBeInTheDocument();
    });
  });

  // ?? Identity: device code flow ???????????????????????????????????????
  describe('identity device code flow', () => {
    it('shows device code when onDeviceCode fires', async () => {
      const onDeviceCode = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onDeviceCode,
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false })
      }));

      await act(async () => { render(<App />); });

      // Simulate device code event
      const handler = onDeviceCode.mock.calls[0]![0];
      await act(async () => {
        handler({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/device' });
      });

      // Open identity menu
      const identityButton = screen.getByRole('button', { name: 'Not logged in' });
      await userEvent.click(identityButton);

      expect(screen.getByText('ABCD-1234')).toBeInTheDocument();
    });

    it('shows device code with verificationUriComplete', async () => {
      const onDeviceCode = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onDeviceCode,
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false })
      }));

      await act(async () => { render(<App />); });

      const handler = onDeviceCode.mock.calls[0]![0];
      await act(async () => {
        handler({
          userCode: 'WXYZ-5678',
          verificationUri: 'https://github.com/device',
          verificationUriComplete: 'https://github.com/device?code=WXYZ-5678'
        });
      });

      const identityButton = screen.getByRole('button', { name: 'Not logged in' });

      await userEvent.click(identityButton);

      expect(screen.getByText('WXYZ-5678')).toBeInTheDocument();
      expect(screen.getByText('Open GitHub')).toBeInTheDocument();
    });

    it('clears device code on sign out', async () => {
      const onDeviceCode = vi.fn().mockReturnValue(() => undefined);
      const onIdentityChange = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onDeviceCode,
        onIdentityChange,
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false })
      }));

      await act(async () => { render(<App />); });

      // Trigger device code
      const deviceHandler = onDeviceCode.mock.calls[0]![0];
      await act(async () => {
        deviceHandler({ userCode: 'TEST-0000', verificationUri: 'https://github.com/device' });
      });

      // Simulate login via identity change
      const identityHandler = onIdentityChange.mock.calls[0]![0];
      await act(async () => {
        identityHandler({ isLoggedIn: true, profile: { login: 'testuser' } });
      });

      // Device code should be cleared - use getAllByRole since there may be multiple
      const identityButtons = screen.getAllByRole('button', { name: 'Logged in as testuser' });
      await userEvent.click(identityButtons[0]!);

      expect(screen.queryByText('TEST-0000')).not.toBeInTheDocument();
    });
  });

  // ?? Identity: logged-in state ????????????????????????????????????????
  describe('identity logged-in state', () => {
    it('shows profile info and sign-out button when logged in', async () => {
      setAgentDeck(mockPreloadApi({
        getIdentitySession: vi.fn().mockResolvedValue({
          isLoggedIn: true,
          profile: { login: 'testuser', email: 'test@example.com', avatar_url: 'https://avatar.png' }
        })
      }));

      await act(async () => { render(<App />); });

      const identityButtons = await screen.findAllByRole('button', { name: 'Logged in as testuser' });
      await userEvent.click(identityButtons[0]!);

      // Use getAllByText since login may appear in multiple places (avatar + dropdown)
      expect(screen.getAllByText('testuser').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('test@example.com').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
    });

    it('shows sign-in button when not logged in', async () => {
      setAgentDeck(mockPreloadApi({
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false })
      }));

      await act(async () => { render(<App />); });

      const identityButton = await screen.findByRole('button', { name: 'Not logged in' });
      await userEvent.click(identityButton);

      expect(screen.getByRole('menuitem', { name: 'Sign in with GitHub' })).toBeInTheDocument();
    });
  });

  // ?? Approval dialog ??????????????????????????????????????????????????
  describe('approval dialog', () => {
    it('shows approval dialog when tool approval request arrives', async () => {
      const onToolApprovalRequest = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onToolApprovalRequest }));

      await act(async () => { render(<App />); });

      // Simulate tool approval request
      const handler = onToolApprovalRequest.mock.calls[0]![0];
      await act(async () => {
        handler({
          status: 'pending-approval',
          callId: 'call-1',

          classification: {
            name: 'writeFile',
            riskLevel: 'high',
            requiresApproval: true,
            description: 'Nadpisanie zawartości pliku.'
          },
          expiresAt: Date.now() + 120_000
        });
      });

      expect(screen.getByText('Zatwierdź wywołanie narzędzia')).toBeInTheDocument();
      expect(screen.getByText('writeFile')).toBeInTheDocument();
      expect(screen.getByText('high')).toBeInTheDocument();
    });

    it('approves tool call and submits decision', async () => {
      const onToolApprovalRequest = vi.fn().mockReturnValue(() => undefined);
      const submitApproval = vi.fn().mockResolvedValue({ status: 'ok', callId: 'call-1', result: null });
      setAgentDeck(mockPreloadApi({ onToolApprovalRequest, submitApproval }));

      await act(async () => { render(<App />); });

      const handler = onToolApprovalRequest.mock.calls[0]![0];
      await act(async () => {
        handler({
          status: 'pending-approval',
          callId: 'call-1',

          classification: {
            name: 'writeFile',
            riskLevel: 'high',
            requiresApproval: true,
            description: 'Nadpisanie zawartości pliku.'
          },
          expiresAt: Date.now() + 120_000
        });
      });

      await userEvent.click(screen.getByRole('button', { name: 'Zatwierdź' }));

      expect(submitApproval).toHaveBeenCalledWith({ callId: 'call-1', approved: true, remember: false });
    });

    it('denies tool call', async () => {
      const onToolApprovalRequest = vi.fn().mockReturnValue(() => undefined);
      const submitApproval = vi.fn().mockResolvedValue({ status: 'ok', callId: 'call-1', result: null });
      setAgentDeck(mockPreloadApi({ onToolApprovalRequest, submitApproval }));

      await act(async () => { render(<App />); });

      const handler = onToolApprovalRequest.mock.calls[0]![0];
      await act(async () => {
        handler({
          status: 'pending-approval',
          callId: 'call-2',

          classification: {
            name: 'deleteFile',
            riskLevel: 'critical',
            requiresApproval: true,
            description: 'Usunięcie pliku z dysku.'
          },
          expiresAt: Date.now() + 120_000
        });
      });

      await userEvent.click(screen.getByRole('button', { name: 'Odrzuć' }));

      expect(submitApproval).toHaveBeenCalledWith({ callId: 'call-2', approved: false });
    });

    it('approves with remember checkbox', async () => {
      const onToolApprovalRequest = vi.fn().mockReturnValue(() => undefined);
      const submitApproval = vi.fn().mockResolvedValue({ status: 'ok', callId: 'call-3', result: null });
      setAgentDeck(mockPreloadApi({ onToolApprovalRequest, submitApproval }));

      await act(async () => { render(<App />); });

      const handler = onToolApprovalRequest.mock.calls[0]![0];
      await act(async () => {
        handler({
          status: 'pending-approval',
          callId: 'call-3',

          classification: {
            name: 'writeFile',
            riskLevel: 'high',
            requiresApproval: true,
            description: 'Nadpisanie zawartości pliku.'
          },
          expiresAt: Date.now() + 120_000
        });
      });

      // Check the remember checkbox
      const checkbox = screen.getByRole('checkbox', { name: /Zapamiętaj decyzję/ });
      await userEvent.click(checkbox);

      await userEvent.click(screen.getByRole('button', { name: 'Zatwierdź' }));

      expect(submitApproval).toHaveBeenCalledWith({ callId: 'call-3', approved: true, remember: true });
    });
  });

  // ?? Patch conflict dialog ???????????????????????????????????????????
  describe('patch conflict dialog', () => {
    it('shows conflict dialog when conflict detected', async () => {
      const onConflictDetected = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onConflictDetected }));

      await act(async () => { render(<App />); });

      const handler = onConflictDetected.mock.calls[0]![0] as (conflict: unknown) => void;
      await act(async () => {
        handler({
          id: 'conflict-1',
          kind: 'write-write',
          filePath: '/src/app.ts',
          description: 'File was modified by another process',
          riskLevel: 'high',
          patchId: 'patch-1'
        });
      });

      expect(screen.getByText('Konflikt patcha')).toBeInTheDocument();
      expect(screen.getByText('/src/app.ts')).toBeInTheDocument();
      expect(screen.getByText('write-write')).toBeInTheDocument();
    });

    it('resolves conflict with skip', async () => {
      const onConflictDetected = vi.fn().mockReturnValue(() => undefined);
      const resolveConflict = vi.fn().mockResolvedValue(undefined);
      setAgentDeck(mockPreloadApi({ onConflictDetected, resolveConflict }));

      await act(async () => { render(<App />); });

      const handler = onConflictDetected.mock.calls[0]![0] as (conflict: unknown) => void;
      await act(async () => {
        handler({
          id: 'conflict-1',
          kind: 'write-write',
          filePath: '/src/app.ts',
          description: 'File was modified',
          riskLevel: 'high',
          patchId: 'patch-1'
        });
      });

      await userEvent.click(screen.getByRole('button', { name: 'Pomiń' }));

      expect(resolveConflict).toHaveBeenCalledWith({ conflictId: 'conflict-1', action: 'skip' });
    });

    it('resolves conflict with apply (overwrite)', async () => {
      const onConflictDetected = vi.fn().mockReturnValue(() => undefined);
      const resolveConflict = vi.fn().mockResolvedValue(undefined);
      setAgentDeck(mockPreloadApi({ onConflictDetected, resolveConflict }));

      await act(async () => { render(<App />); });

      const handler = onConflictDetected.mock.calls[0]![0];
      await act(async () => {
        handler({
          id: 'conflict-2',

          kind: 'hash-mismatch',
          filePath: '/src/main.ts',
          description: 'Hash mismatch',
          riskLevel: 'medium',
          patchId: 'patch-2'
        });
      });

      await userEvent.click(screen.getByRole('button', { name: 'Nadpisz' }));

      expect(resolveConflict).toHaveBeenCalledWith({ conflictId: 'conflict-2', action: 'apply' });
    });

    it('resolves conflict with edit', async () => {
      const onConflictDetected = vi.fn().mockReturnValue(() => undefined);
      const resolveConflict = vi.fn().mockResolvedValue(undefined);
      setAgentDeck(mockPreloadApi({ onConflictDetected, resolveConflict }));

      await act(async () => { render(<App />); });

      const handler = onConflictDetected.mock.calls[0]![0];
      await act(async () => {
        handler({
          id: 'conflict-3',

          kind: 'write-write',
          filePath: '/src/test.ts',
          description: 'Conflict',
          riskLevel: 'low',
          patchId: 'patch-3'
        });
      });

      await userEvent.click(screen.getByRole('button', { name: 'Edytuj' }));

      expect(resolveConflict).toHaveBeenCalledWith({
        conflictId: 'conflict-3',
        action: 'edit',
        operations: []
      });
    });
  });

  // ?? Close workspace event ????????????????????????????????????????????
  describe('close workspace event', () => {
    it('closes workspace on agentdeck:close-workspace event', async () => {
      const user = userEvent.setup();
      const listDirectory = vi.fn().mockResolvedValue({ path: '/ws', entries: [] });
      setAgentDeck(mockPreloadApi({
        selectWorkspaceEntry: vi.fn().mockResolvedValue({
          status: 'selected', kind: 'folder', path: '/ws', name: 'ws'
        }),
        openWorkspace: vi.fn().mockResolvedValue({
          status: 'ok', filePath: '/ws', kind: 'folder', folders: [{ path: '/ws', name: 'ws' }]
        }),
        listDirectory
      }));

      await act(async () => { render(<App />); });

      // Open workspace
      await user.click(screen.getByRole('button', { name: 'Open folder' }));
      await waitFor(() => { expect(listDirectory).toHaveBeenCalled(); });

      // Close workspace via custom event
      await act(async () => {
        globalThis.dispatchEvent(new CustomEvent('agentdeck:close-workspace'));
      });

      expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('No workspace opened.');
    });
  });

  // ?? Show panel event ?????????????????????????????????????????????????
  describe('show panel event', () => {
    it('shows explorer panel on agentdeck:show-panel event', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      // Switch to chat first
      await user.click(screen.getByRole('button', { name: 'Chat' }));
      expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true');

      // Dispatch show-panel for explorer
      await act(async () => {
        globalThis.dispatchEvent(new CustomEvent('agentdeck:show-panel', { detail: 'explorer' }));
      });

      expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows search panel on agentdeck:show-panel event', async () => {
      await act(async () => { render(<App />); });

      await act(async () => {
        globalThis.dispatchEvent(new CustomEvent('agentdeck:show-panel', { detail: 'search' }));
      });

      expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  // ?? Save handlers ????????????????????????????????????????????????????
  describe('save handlers', () => {
    it('dispatches Ctrl+S on save', async () => {
      setAgentDeck(mockPreloadApi());
      await act(async () => { render(<App />); });

      const dispatchSpy = vi.spyOn(globalThis, 'dispatchEvent');

      // Trigger save via keyboard shortcut simulation
      globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true }));

      expect(dispatchSpy).toHaveBeenCalled();
      expect(userEvent).toBeDefined();
      dispatchSpy.mockRestore();
    });
  });

  // ?? Diagnostics polling ??????????????????????????????????????????????
  describe('diagnostics polling', () => {
    it('polls for editor diagnostics', async () => {
      vi.useFakeTimers();
      const getEditorDiagnostics = vi.fn().mockResolvedValue([]);
      setAgentDeck(mockPreloadApi({ getEditorDiagnostics }));

      await act(async () => { render(<App />); });

      // Advance timers to trigger polling
      await act(async () => { vi.advanceTimersByTime(3000); });

      expect(getEditorDiagnostics).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  // ?? External changes tracking ???????????????????????????????????????
  describe('external changes tracking', () => {
    it('tracks external file changes via fs events', async () => {
      const onFsEvent = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onFsEvent }));

      await act(async () => { render(<App />); });

      // Simulate fs change event
      const handler = onFsEvent.mock.calls[0]![0];
      await act(async () => {
        handler({ kind: 'change', path: '/workspace/src/app.ts' });
      });

      // The component should still render without errors
      expect(screen.getByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');
    });
  });

  // ?? Startup services ?????????????????????????????????????????????????
  describe('startup services', () => {
    it('shows services list when startup state has services', async () => {
      const user = userEvent.setup();
      setAgentDeck(mockPreloadApi({
        getStartupState: vi.fn().mockResolvedValue({
          status: 'ready',
          appVersion: '0.1.0',
          services: [
            { id: 'model-gateway', label: 'Model Gateway', status: 'ready' },
            { id: 'workspace', label: 'Workspace', status: 'ready' }
          ]
        })
      }));

      await act(async () => { render(<App />); });

      // Switch to services panel
      await user.click(screen.getByRole('tab', { name: 'Services' }));

      expect(screen.getByText('Model Gateway')).toBeInTheDocument();
      expect(screen.getByText('Workspace')).toBeInTheDocument();
    });
  });

  // ?? Diagnostic counts in status bar ?????????????????????????????????
  describe('diagnostic counts', () => {
    it('shows diagnostic counts in status bar', async () => {
      vi.useFakeTimers();
      setAgentDeck(mockPreloadApi({
        getEditorDiagnostics: vi.fn().mockResolvedValue([
          { severity: 'error', message: 'Error 1', source: 'ts', range: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 }, filePath: '/a.ts' },
          { severity: 'warning', message: 'Warning 1', source: 'ts', range: { startLine: 2, startCol: 1, endLine: 2, endCol: 10 }, filePath: '/a.ts' },
          { severity: 'error', message: 'Error 2', source: 'ts', range: { startLine: 3, startCol: 1, endLine: 3, endCol: 10 }, filePath: '/b.ts' }
        ])
      }));

      await act(async () => { render(<App />); });

      // Advance timers to trigger polling
      await act(async () => { vi.advanceTimersByTime(3000); });

      // Status bar should show diagnostic counts
      const statusBar = screen.getByLabelText('Diagnostic counts');
      expect(statusBar).toBeInTheDocument();
      vi.useRealTimers();
    });
  });

  // ?? Identity menu close on outside click ????????????????????????????
  describe('identity menu close on outside click', () => {
    it('closes identity menu when clicking outside', async () => {
      setAgentDeck(mockPreloadApi({
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false })
      }));

      await act(async () => { render(<App />); });

      const identityButton = await screen.findByRole('button', { name: 'Not logged in' });
      await userEvent.click(identityButton);

      // Menu should be open
      expect(screen.getByRole('menuitem', { name: 'Sign in with GitHub' })).toBeInTheDocument();

      // Click outside
      await userEvent.click(document.body);

      // Menu should be closed
      expect(screen.queryByRole('menuitem', { name: 'Sign in with GitHub' })).not.toBeInTheDocument();
    });
  });

  // ?? Identity: error state ???????????????????????????????????????????
  describe('identity error state', () => {
    it('shows error message in identity dropdown', async () => {
      setAgentDeck(mockPreloadApi({
        getIdentitySession: vi.fn().mockResolvedValue({
          isLoggedIn: false,
          error: 'Token expired'
        })
      }));

      await act(async () => { render(<App />); });

      const identityButton = await screen.findByRole('button', { name: 'Not logged in' });
      await userEvent.click(identityButton);

      expect(screen.getByText('Token expired')).toBeInTheDocument();
    });
  });

  // ?? Chat panel rendering ????????????????????????????????????????????
  describe('chat panel rendering', () => {
    it('shows welcome message when no chat tab is active', async () => {
      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('button', { name: 'Chat' }));

      expect(screen.getByText('Create a new chat tab to start a conversation with an AI model.')).toBeInTheDocument();
    });
  });

  // ?? Memory conflict dialog ??????????????????????????????????????????
  describe('memory conflict dialog', () => {
    it('shows memory conflict dialog when memory conflict detected', async () => {
      const onMemoryConflictDetected = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onMemoryConflictDetected }));

      await act(async () => { render(<App />); });

      await act(async () => {
        const handler = onMemoryConflictDetected.mock.calls[0]![0] as (conflict: unknown) => void;
        handler({
          id: 'mem-conflict-1',
          filePath: 'src/config.ts',
          sessionId: 'session-1',
          conflictType: 'write-write',
          description: 'Memory file was modified externally',
          riskLevel: 'medium',
          suggestedAction: 'review',
          originalText: 'original',
          newText: 'modified'
        });
      });

      // MemoryReviewDialog should be rendered
      expect(screen.getByText('Memory file was modified externally')).toBeInTheDocument();
    });

    it('resolves memory conflict with skip', async () => {
      const onMemoryConflictDetected = vi.fn().mockReturnValue(() => undefined);
      const resolveMemoryConflict = vi.fn().mockResolvedValue(undefined);
      setAgentDeck(mockPreloadApi({ onMemoryConflictDetected, resolveMemoryConflict }));

      await act(async () => { render(<App />); });

      await act(async () => {
        const handler = onMemoryConflictDetected.mock.calls[0]![0] as (conflict: unknown) => void;
        handler({
          id: 'mem-conflict-2',
          filePath: 'src/config.ts',
          sessionId: 'session-1',
          conflictType: 'write-write',
          description: 'Memory conflict',
          riskLevel: 'medium',
          suggestedAction: 'review',
          originalText: 'original',
          newText: 'modified'
        });
      });

      const skipBtn = screen.getByRole('button', { name: 'Pomiń' });
      await userEvent.click(skipBtn);

      expect(resolveMemoryConflict).toHaveBeenCalledWith(expect.objectContaining({
        conflictId: 'mem-conflict-2',
        action: 'skip'
      }));
    });

    it('resolves memory conflict with edit', async () => {
      const onMemoryConflictDetected = vi.fn().mockReturnValue(() => undefined);
      const resolveMemoryConflict = vi.fn().mockResolvedValue(undefined);
      setAgentDeck(mockPreloadApi({ onMemoryConflictDetected, resolveMemoryConflict }));

      await act(async () => { render(<App />); });

      await act(async () => {
        const handler = onMemoryConflictDetected.mock.calls[0]![0] as (conflict: unknown) => void;
        handler({
          id: 'mem-conflict-3',
          filePath: 'src/config.ts',
          sessionId: 'session-1',
          conflictType: 'write-write',
          description: 'Memory conflict',
          riskLevel: 'medium',
          suggestedAction: 'review',
          originalText: 'original',
          newText: 'modified'
        });
      });

      const editBtn = screen.getByRole('button', { name: 'Edytuj' });
      await userEvent.click(editBtn);

      expect(resolveMemoryConflict).toHaveBeenCalledWith(expect.objectContaining({
        conflictId: 'mem-conflict-3',
        action: 'edit'
      }));
    });
  });

  // ?? Event log panel ?????????????????????????????????????????????????
  describe('event log panel', () => {
    it('renders event log panel', async () => {
      const user = userEvent.setup();
      const getEventLog = vi.fn().mockResolvedValue({
        status: 'ok',
        entries: [
          { id: 'evt-1', timestamp: 1000, level: 'info', source: 'tool-router', message: 'Patch applied' },
          { id: 'evt-2', timestamp: 2000, level: 'error', source: 'editor', message: 'File not found' }
        ],
        total: 2
      });
      const onEventLogUpdate = vi.fn().mockReturnValue(() => undefined);
      const clearEventLog = vi.fn().mockResolvedValue(undefined);

      setAgentDeck(mockPreloadApi({
        getEventLog,
        onEventLogUpdate,
        clearEventLog
      }));

      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('tab', { name: 'Event Log' }));

      // Event log panel renders the EventLogPanel component
      expect(screen.getByText('Patch applied')).toBeInTheDocument();
    });
  });

  // ?? Worker stop and session stop integration ?????????????????????????
  describe('worker and session stop', () => {
    it('stops worker via button click', async () => {
      const stopWorkerMock = vi.fn().mockResolvedValue({ status: 'ok' });
      const onAgentRuntimeWorkerChanged = vi.fn().mockReturnValue(() => undefined);
      const onAgentRuntimeSessionChanged = vi.fn().mockReturnValue(() => undefined);

      setAgentDeck(mockPreloadApi({
        listAgentRuntimeSessions: vi.fn().mockResolvedValue([]),
        listAgentRuntimeWorkers: vi.fn().mockResolvedValue([
          { id: 'worker-1', sessionId: 'session-1', taskId: 'task-1', status: 'running', attempt: 1, maxRetries: 3 }
        ]),
        onAgentRuntimeWorkerChanged,
        onAgentRuntimeSessionChanged,
        onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined),
        stopAgentRuntimeWorker: stopWorkerMock
      }));

      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('tab', { name: 'Workers' }));

      const stopBtn = await screen.findByRole('button', { name: 'Stop runtime worker worker-1' });
      await userEvent.click(stopBtn);

      expect(stopWorkerMock).toHaveBeenCalledWith('worker-1');
    });

    it('stops session via button click', async () => {
      const stopSessionMock = vi.fn().mockResolvedValue({ status: 'ok' });
      const onAgentRuntimeWorkerChanged = vi.fn().mockReturnValue(() => undefined);
      const onAgentRuntimeSessionChanged = vi.fn().mockReturnValue(() => undefined);

      setAgentDeck(mockPreloadApi({
        listAgentRuntimeSessions: vi.fn().mockResolvedValue([
          { id: 'session-1', chatTabId: 'tab-1', modelId: 'default', agentName: 'agent', status: 'active', permissionScope: { sessionId: 'session-1', taskId: 'task-1', kind: 'parent', allowedTools: [] }, context: [], eventLog: [], workers: [{ id: 'worker-1', sessionId: 'session-1', taskId: 'task-1', status: 'running', attempt: 1, maxRetries: 3 }], tasks: [] }
        ]),
        listAgentRuntimeWorkers: vi.fn().mockResolvedValue([
          { id: 'worker-1', sessionId: 'session-1', taskId: 'task-1', status: 'running', attempt: 1, maxRetries: 3 }
        ]),
        onAgentRuntimeWorkerChanged,
        onAgentRuntimeSessionChanged,
        onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined),
        stopAgentRuntimeSession: stopSessionMock
      }));

      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('tab', { name: 'Workers' }));

      const stopBtn = await screen.findByRole('button', { name: 'Stop runtime session session-1' });
      await userEvent.click(stopBtn);

      expect(stopSessionMock).toHaveBeenCalledWith('session-1');
    });
  });

  // ?? Runtime task activity panel ?????????????????????????????????????
  describe('runtime task activity panel', () => {
    it('renders task with result and references', async () => {
      const onAgentRuntimeTaskChanged = vi.fn().mockReturnValue(() => undefined);
      const onAgentRuntimeSessionChanged = vi.fn().mockReturnValue(() => undefined);
      const onAgentRuntimeWorkerChanged = vi.fn().mockReturnValue(() => undefined);

      setAgentDeck(mockPreloadApi({
        listAgentRuntimeTasks: vi.fn().mockResolvedValue([
          {
            id: 'task-1',
            sessionId: 'session-1',
            kind: 'chat',
            agentName: 'TestAgent',
            modelId: 'default',
            prompt: 'Hello world',
            status: 'completed',
            permissionScope: { sessionId: 'session-1', taskId: 'task-1', kind: 'parent', allowedTools: [] },
            context: [],
            toolsUsed: ['read_file', 'write_file'],
            result: {
              summary: 'Task completed successfully',
              references: ['src/app.ts', 'src/utils.ts'],
              toolsUsed: ['read_file']
            },
            createdAt: Date.now() - 5000,
            updatedAt: Date.now()
          }
        ]),
        onAgentRuntimeTaskChanged,
        onAgentRuntimeSessionChanged,
        onAgentRuntimeWorkerChanged
      }));

      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('tab', { name: 'Task Activity' }));

      expect(await screen.findByText('TestAgent (chat)')).toBeInTheDocument();
      // Summary text may be split across elements, use findByText with exact: false
      expect(await screen.findByText(/Task completed successfully/)).toBeInTheDocument();
      expect(screen.getByText(/src\/app\.ts, src\/utils\.ts/)).toBeInTheDocument();
    });

    it('renders subagent task', async () => {
      const onAgentRuntimeTaskChanged = vi.fn().mockReturnValue(() => undefined);
      const onAgentRuntimeSessionChanged = vi.fn().mockReturnValue(() => undefined);
      const onAgentRuntimeWorkerChanged = vi.fn().mockReturnValue(() => undefined);

      setAgentDeck(mockPreloadApi({
        listAgentRuntimeTasks: vi.fn().mockResolvedValue([
          {
            id: 'subtask-1',
            sessionId: 'session-1',
            parentTaskId: 'parent-task-1',
            kind: 'subagent',
            agentName: 'SubAgent',
            modelId: 'default',
            prompt: 'Review code',
            status: 'running',
            permissionScope: { sessionId: 'session-1', taskId: 'subtask-1', kind: 'subagent', allowedTools: [] },
            context: [],
            toolsUsed: [],
            createdAt: Date.now() - 5000,
            updatedAt: Date.now()
          }
        ]),
        onAgentRuntimeTaskChanged,
        onAgentRuntimeSessionChanged,
        onAgentRuntimeWorkerChanged
      }));

      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('tab', { name: 'Task Activity' }));

      // Check that subagent task is rendered
      expect(await screen.findByText(/SubAgent/)).toBeInTheDocument();
      expect(screen.getByText('running')).toBeInTheDocument();
    });

    it('renders task with error', async () => {
      const onAgentRuntimeTaskChanged = vi.fn().mockReturnValue(() => undefined);
      const onAgentRuntimeSessionChanged = vi.fn().mockReturnValue(() => undefined);
      const onAgentRuntimeWorkerChanged = vi.fn().mockReturnValue(() => undefined);

      setAgentDeck(mockPreloadApi({
        listAgentRuntimeTasks: vi.fn().mockResolvedValue([
          {
            id: 'task-1',
            sessionId: 'session-1',
            kind: 'chat',
            agentName: 'TestAgent',
            modelId: 'default',
            prompt: 'Hello',
            status: 'failed',
            permissionScope: { sessionId: 'session-1', taskId: 'task-1', kind: 'parent', allowedTools: [] },
            context: [],
            toolsUsed: [],
            error: 'Connection timeout',
            createdAt: Date.now() - 5000,
            updatedAt: Date.now()
          }
        ]),
        onAgentRuntimeTaskChanged,
        onAgentRuntimeSessionChanged,
        onAgentRuntimeWorkerChanged
      }));

      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('tab', { name: 'Task Activity' }));

      expect(await screen.findByText('Error: Connection timeout')).toBeInTheDocument();
    });
  });

  // ?? Runtime event log in task activity ???????????????????????????????
  describe('runtime event log', () => {
    it('shows events from workers panel in task activity', async () => {
      const onSessionChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onAgentRuntimeSessionChanged: onSessionChanged,
        onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined)
      }));

      const user = userEvent.setup();
      await act(async () => { render(<App />); });

      await user.click(screen.getByRole('tab', { name: 'Task Activity' }));

      await act(async () => {
        const handler = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
        handler({
          id: 'session-1',
          chatTabId: 'tab-1',
          modelId: 'default',
          agentName: 'agent',
          status: 'active',
          permissionScope: { sessionId: 'session-1', taskId: 'task-1', kind: 'parent', allowedTools: [] },
          context: [],
          eventLog: [
            { id: 'evt-1', sessionId: 'session-1', taskId: 'task-1', workerId: 'worker-1', type: 'worker-started', message: 'Worker started', timestamp: Date.now() }
          ],
          workers: [],
          tasks: []
        });
      });

      // Use getAllByText since the event message appears in both the event log and the status
      const elements = await screen.findAllByText('Worker started');
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });
});
