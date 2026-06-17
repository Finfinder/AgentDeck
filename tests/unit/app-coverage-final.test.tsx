import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@agentdeck/workbench';
import type {
  AgentDeckPreloadApi,
  AgentRuntimeEventEntry,
  AgentRuntimeSessionState,
  AgentRuntimeTaskState,
  Conflict
} from '@agentdeck/shared';

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

function makeSession(overrides: Partial<AgentRuntimeSessionState> = {}): AgentRuntimeSessionState {
  return {
    id: 'session-1', chatTabId: 'tab-1', modelId: 'default', agentName: 'TestAgent',
    status: 'active', permissionScope: { sessionId: 'session-1', taskId: 'task-1', kind: 'parent', allowedTools: [] }, context: [], eventLog: [],
    workers: [], tasks: [], ...overrides
  };
}

function makeRuntimeEvent(overrides: Partial<AgentRuntimeEventEntry> = {}): AgentRuntimeEventEntry {
  return {
    id: 'evt-1', sessionId: 'session-1', taskId: 'task-1', workerId: 'worker-1',
    type: 'worker-started', message: 'Worker started', timestamp: Date.now(), ...overrides
  };
}

function makeTask(overrides: Partial<AgentRuntimeTaskState> = {}): AgentRuntimeTaskState {
  return {
    id: 'task-1', sessionId: 'session-1', kind: 'chat', agentName: 'TestAgent',
    modelId: 'default', prompt: 'Hello world', status: 'running',
    permissionScope: { sessionId: 'session-1', taskId: 'task-1', kind: 'parent', allowedTools: [] }, context: [], toolsUsed: ['read_file', 'write_file'],
    createdAt: Date.now() - 5000, updatedAt: Date.now(), ...overrides
  };
}

function makeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: 'conflict-1', patchId: 'patch-1', filePath: 'src/app.ts',
    kind: 'patch-conflict', description: 'File was modified externally',
    riskLevel: 'medium', createdAt: Date.now(), ...overrides
  };
}

describe('App — final coverage push', () => {
  beforeEach(() => { vi.clearAllMocks(); clearGlobalAgent(); });
  afterEach(() => { clearGlobalAgent(); });

  describe('Workers panel', () => {
    it('renders empty worker list', async () => {
      setAgentDeck(mockPreloadApi({
        listAgentRuntimeSessions: vi.fn().mockResolvedValue([]),
        listAgentRuntimeWorkers: vi.fn().mockResolvedValue([]),
        onAgentRuntimeWorkerChanged: vi.fn().mockReturnValue(() => undefined),
        onAgentRuntimeSessionChanged: vi.fn().mockReturnValue(() => undefined),
        onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Workers' }));
      expect(await screen.findByText('No runtime workers are active.')).toBeInTheDocument();
    });

    it('shows API not available', async () => {
      setAgentDeck(mockPreloadApi({
        listAgentRuntimeWorkers: undefined, listAgentRuntimeSessions: undefined,
        onAgentRuntimeWorkerChanged: undefined, onAgentRuntimeSessionChanged: undefined,
        onAgentRuntimeSessionCrashed: undefined
      } as unknown as AgentDeckPreloadApi));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Workers' }));
      expect(await screen.findByText('Agent Runtime worker API is not available.')).toBeInTheDocument();
    });

    it('handles refresh failure', async () => {
      setAgentDeck(mockPreloadApi({
        listAgentRuntimeSessions: vi.fn().mockRejectedValue(new Error('fail')),
        listAgentRuntimeWorkers: vi.fn().mockResolvedValue([])
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Workers' }));
      await waitFor(() => { expect(screen.getByText('Unable to refresh runtime workers.')).toBeInTheDocument(); });
    });
  });

  describe('Tasks panel', () => {
    it('renders empty task list', async () => {
      setAgentDeck(mockPreloadApi({ listAgentRuntimeTasks: vi.fn().mockResolvedValue([]) }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
      expect(await screen.findByText('No runtime task activity yet.')).toBeInTheDocument();
    });

    it('shows API not available', async () => {
      setAgentDeck(mockPreloadApi({
        listAgentRuntimeTasks: undefined, onAgentRuntimeTaskChanged: undefined,
        onAgentRuntimeSessionChanged: undefined, onAgentRuntimeWorkerChanged: undefined
      } as unknown as AgentDeckPreloadApi));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
      expect(await screen.findByText('Agent Runtime task API is not available.')).toBeInTheDocument();
    });

    it('handles refresh failure', async () => {
      setAgentDeck(mockPreloadApi({
        listAgentRuntimeTasks: vi.fn().mockRejectedValue(new Error('fail')),
        onAgentRuntimeTaskChanged: vi.fn().mockReturnValue(() => undefined),
        onAgentRuntimeSessionChanged: vi.fn().mockReturnValue(() => undefined),
        onAgentRuntimeWorkerChanged: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
      await waitFor(() => { expect(screen.getByText('Unable to refresh runtime tasks.')).toBeInTheDocument(); });
    });
  });

  describe('Event log', () => {
    it('accumulates events from session changed', async () => {
      const onSessionChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onAgentRuntimeSessionChanged: onSessionChanged,
        onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));

      await act(async () => {
        const h = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
        h(makeSession({ eventLog: [makeRuntimeEvent({ id: 'evt-1', message: 'Alpha event' })] }));
      });
      expect(await screen.findByText('Alpha event')).toBeInTheDocument();

      await act(async () => {
        const h = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
        h(makeSession({ eventLog: [makeRuntimeEvent({ id: 'evt-2', message: 'Beta event' })] }));
      });
      expect(screen.getByText('Beta event')).toBeInTheDocument();
    });

    it('does not duplicate events with same id', async () => {
      const onSessionChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onAgentRuntimeSessionChanged: onSessionChanged,
        onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));

      await act(async () => {
        const h = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
        h(makeSession({ eventLog: [makeRuntimeEvent({ id: 'evt-1', message: 'Unique' })] }));
      });
      await act(async () => {
        const h = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
        h(makeSession({ eventLog: [makeRuntimeEvent({ id: 'evt-1', message: 'Dup' })] }));
      });
      expect(screen.getAllByText('Unique')).toHaveLength(1);
    });

    it('handles invalid timestamps', async () => {
      const onSessionChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onAgentRuntimeSessionChanged: onSessionChanged,
        onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));

      await act(async () => {
        const h = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
        h(makeSession({ eventLog: [makeRuntimeEvent({ id: 'evt-0', timestamp: 0 })] }));
      });
      expect(await screen.findByText('Unknown time')).toBeInTheDocument();
    });
  });

  describe('Crash notification', () => {
    it('shows crash in workers panel', async () => {
      const onSessionCrashed = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onAgentRuntimeSessionCrashed: onSessionCrashed,
        onAgentRuntimeSessionChanged: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Workers' }));

      await act(async () => {
        const h = onSessionCrashed.mock.calls[0]![0] as (s: AgentRuntimeSessionState, e: { message: string }) => void;
        h(makeSession({ status: 'crashed' }), { message: 'Out of memory' });
      });
      expect(await screen.findByText('Agent Runtime worker crashed.')).toBeInTheDocument();
      expect(screen.getByText('Out of memory')).toBeInTheDocument();
    });

    it('shows crash with workerId', async () => {
      const onSessionCrashed = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onAgentRuntimeSessionCrashed: onSessionCrashed,
        onAgentRuntimeSessionChanged: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Workers' }));

      await act(async () => {
        const h = onSessionCrashed.mock.calls[0]![0] as (s: AgentRuntimeSessionState, e: { message: string }) => void;
        h(makeSession({ status: 'crashed', workers: [{ id: 'w1', sessionId: 's1', taskId: 't1', status: 'crashed', attempt: 1, maxRetries: 3, lastError: 'OOM' }] }), { message: 'Crash' });
      });
      expect(await screen.findByText('Worker: w1')).toBeInTheDocument();
    });

    it('dismisses crash notification', async () => {
      const onSessionCrashed = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onAgentRuntimeSessionCrashed: onSessionCrashed,
        onAgentRuntimeSessionChanged: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Workers' }));

      await act(async () => {
        const h = onSessionCrashed.mock.calls[0]![0] as (s: AgentRuntimeSessionState, e: { message: string }) => void;
        h(makeSession({ status: 'crashed' }), { message: 'Crash' });
      });
      expect(await screen.findByText('Agent Runtime worker crashed.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Dismiss crash notification' }));
      await waitFor(() => { expect(screen.queryByText('Agent Runtime worker crashed.')).not.toBeInTheDocument(); });
    });

    it('shows crash from session changed', async () => {
      const onSessionChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined),
        onAgentRuntimeSessionChanged: onSessionChanged
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Workers' }));

      await act(async () => {
        const h = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
        h(makeSession({ status: 'crashed', workers: [{ id: 'w1', sessionId: 's1', taskId: 't1', status: 'crashed', attempt: 1, maxRetries: 3, lastError: 'OOM' }], eventLog: [] }));
      });
      expect(await screen.findByText('Agent Runtime worker crashed.')).toBeInTheDocument();
    });

    it('no crash for active sessions', async () => {
      const onSessionChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined),
        onAgentRuntimeSessionChanged: onSessionChanged
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Workers' }));

      await act(async () => {
        const h = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
        h(makeSession({ status: 'active' }));
      });
      expect(screen.queryByText('Agent Runtime worker crashed.')).not.toBeInTheDocument();
    });

    it('falls back to worker lastError', async () => {
      const onSessionCrashed = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onAgentRuntimeSessionCrashed: onSessionCrashed,
        onAgentRuntimeSessionChanged: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Workers' }));

      await act(async () => {
        const h = onSessionCrashed.mock.calls[0]![0] as (s: AgentRuntimeSessionState, e: { message: string }) => void;
        h(makeSession({ status: 'crashed', workers: [{ id: 'w1', sessionId: 's1', taskId: 't1', status: 'crashed', attempt: 1, maxRetries: 3, lastError: 'Worker OOM' }], eventLog: [] }), { message: 'Generic' });
      });
      expect(await screen.findByText('Worker OOM')).toBeInTheDocument();
    });

    it('omits workerId when no crashed worker', async () => {
      const onSessionCrashed = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({
        onAgentRuntimeSessionCrashed: onSessionCrashed,
        onAgentRuntimeSessionChanged: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Workers' }));

      await act(async () => {
        const h = onSessionCrashed.mock.calls[0]![0] as (s: AgentRuntimeSessionState, e: { message: string }) => void;
        h(makeSession({ status: 'crashed', workers: [{ id: 'w1', sessionId: 's1', taskId: 't1', status: 'stopped', attempt: 1, maxRetries: 3 }], eventLog: [] }), { message: 'Crash' });
      });
      expect(await screen.findByText('Session: session-1')).toBeInTheDocument();
      expect(screen.queryByText(/Worker:/)).not.toBeInTheDocument();
    });
  });

  describe('IdentityMenu', () => {
    it('shows logged-in profile with avatar', async () => {
      setAgentDeck(mockPreloadApi({
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: true, profile: { login: 'testuser', email: 'test@example.com', avatar_url: 'https://example.com/avatar.png' } }),
        onIdentityChange: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      const identityBtns = await screen.findAllByRole('button', { name: 'Logged in as testuser' });
      await userEvent.click(identityBtns[0]!);
      const dropdown = await screen.findByRole('menu');
      expect(within(dropdown).getByText('testuser')).toBeInTheDocument();
      expect(within(dropdown).getByText('test@example.com')).toBeInTheDocument();
      expect(within(dropdown).getByAltText('')).toHaveAttribute('src', 'https://example.com/avatar.png');
    });

    it('shows sign-out button when logged in', async () => {
      const signOutMock = vi.fn().mockResolvedValue({ isLoggedIn: false });
      setAgentDeck(mockPreloadApi({
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: true, profile: { login: 'testuser' } }),
        signOut: signOutMock, onIdentityChange: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      const identityBtns = await screen.findAllByRole('button', { name: 'Logged in as testuser' });
      await userEvent.click(identityBtns[0]!);
      const signOutBtn = await screen.findByRole('menuitem', { name: 'Sign out' });
      await userEvent.click(signOutBtn);
      expect(signOutMock).toHaveBeenCalled();
    });

    it('shows logged-in without email', async () => {
      setAgentDeck(mockPreloadApi({
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: true, profile: { login: 'testuser' } }),
        onIdentityChange: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      const identityBtns = await screen.findAllByRole('button', { name: 'Logged in as testuser' });
      await userEvent.click(identityBtns[0]!);
      const dropdown = await screen.findByRole('menu');
      expect(within(dropdown).getByText('testuser')).toBeInTheDocument();
    });

    it('shows logged-in without avatar', async () => {
      setAgentDeck(mockPreloadApi({
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: true, profile: { login: 'testuser' } }),
        onIdentityChange: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      const identityBtns = await screen.findAllByRole('button', { name: 'Logged in as testuser' });
      expect(identityBtns.length).toBeGreaterThanOrEqual(1);
    });

    it('shows sign-in when not logged in', async () => {
      setAgentDeck(mockPreloadApi({ onIdentityChange: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      const identityBtn = await screen.findByRole('button', { name: 'Not logged in' });
      await userEvent.click(identityBtn);
      expect(await screen.findByRole('menuitem', { name: 'Sign in with GitHub' })).toBeInTheDocument();
    });

    it('starts OAuth on sign-in', async () => {
      const startOAuthMock = vi.fn().mockResolvedValue({ isLoggedIn: false });
      setAgentDeck(mockPreloadApi({ startOAuth: startOAuthMock, onIdentityChange: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      const identityBtn = await screen.findByRole('button', { name: 'Not logged in' });
      await userEvent.click(identityBtn);
      const signInBtn = await screen.findByRole('menuitem', { name: 'Sign in with GitHub' });
      await userEvent.click(signInBtn);
      expect(startOAuthMock).toHaveBeenCalled();
    });

    it('shows error in identity dropdown', async () => {
      setAgentDeck(mockPreloadApi({
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false, error: 'Token expired' }),
        onIdentityChange: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      const identityBtn = await screen.findByRole('button', { name: 'Not logged in' });
      await userEvent.click(identityBtn);
      const dropdown = await screen.findByRole('menu');
      expect(within(dropdown).getByText('Token expired')).toBeInTheDocument();
    });

    it('shows device code', async () => {
      setAgentDeck(mockPreloadApi({
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
        onDeviceCode: vi.fn().mockImplementation((handler) => { handler({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/device' }); return () => undefined; }),
        onIdentityChange: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      const identityBtn = await screen.findByRole('button', { name: 'Not logged in' });
      await userEvent.click(identityBtn);
      const dropdown = await screen.findByRole('menu');
      expect(await within(dropdown).findByText('ABCD-1234')).toBeInTheDocument();
      expect(within(dropdown).getByText('Device Authorization')).toBeInTheDocument();
    });

    it('shows device code with verificationUriComplete', async () => {
      setAgentDeck(mockPreloadApi({
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
        onDeviceCode: vi.fn().mockImplementation((handler) => { handler({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/device', verificationUriComplete: 'https://github.com/device?code=ABCD-1234' }); return () => undefined; }),
        onIdentityChange: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      const identityBtn = await screen.findByRole('button', { name: 'Not logged in' });
      await userEvent.click(identityBtn);
      const dropdown = await screen.findByRole('menu');
      const link = within(dropdown).getByText('Open GitHub');
      expect(link).toHaveAttribute('href', 'https://github.com/device?code=ABCD-1234');
    });

    it('cancels device code flow', async () => {
      setAgentDeck(mockPreloadApi({
        getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
        onDeviceCode: vi.fn().mockImplementation((handler) => { handler({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/device' }); return () => undefined; }),
        onIdentityChange: vi.fn().mockReturnValue(() => undefined)
      }));
      await act(async () => { render(<App />); });
      const identityBtn = await screen.findByRole('button', { name: 'Not logged in' });
      await userEvent.click(identityBtn);
      const cancelBtn = await screen.findByRole('menuitem', { name: 'Cancel' });
      await userEvent.click(cancelBtn);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('Permission prompts', () => {
    it('renders permission prompts', async () => {
      const onPermissionDecision = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onPermissionDecision }));
      await act(async () => { render(<App />); });
      await act(async () => {
        const h = onPermissionDecision.mock.calls[0]![0] as (d: unknown) => void;
        h({ id: 'perm-1', requestId: 'req-1', sessionId: 'session-1', taskId: 'task-1', actorKind: 'agent', kind: 'write', target: '/etc/passwd', risk: 'high', decision: 'prompt', toolName: 'write_file', reason: 'Sensitive file', createdAt: Date.now() });
      });
      expect(await screen.findByText('Permission Requests')).toBeInTheDocument();
      expect(screen.getByText('write_file')).toBeInTheDocument();
      expect(screen.getByText('high')).toBeInTheDocument();
      expect(screen.getByText('/etc/passwd')).toBeInTheDocument();
      expect(screen.getByText('Sensitive file')).toBeInTheDocument();
      expect(screen.getByText('1 pending')).toBeInTheDocument();
    });

    it('approves permission', async () => {
      const onPermissionDecision = vi.fn().mockReturnValue(() => undefined);
      const approveMock = vi.fn().mockResolvedValue({ status: 'ok' });
      setAgentDeck(mockPreloadApi({ onPermissionDecision, approvePermissionDecision: approveMock }));
      await act(async () => { render(<App />); });
      await act(async () => {
        const h = onPermissionDecision.mock.calls[0]![0] as (d: unknown) => void;
        h({ id: 'perm-1', requestId: 'req-1', sessionId: 'session-1', taskId: 'task-1', actorKind: 'agent', kind: 'write', target: '/etc/passwd', risk: 'high', decision: 'prompt', toolName: 'write_file', reason: 'Sensitive file', createdAt: Date.now() });
      });
      const allowBtn = await screen.findByRole('button', { name: 'Allow write_file' });
      await userEvent.click(allowBtn);
      expect(approveMock).toHaveBeenCalledWith(expect.objectContaining({ decisionId: 'perm-1', decision: 'allow', duration: 'session' }));
    });

    it('denies permission', async () => {
      const onPermissionDecision = vi.fn().mockReturnValue(() => undefined);
      const denyMock = vi.fn().mockResolvedValue({ status: 'ok' });
      setAgentDeck(mockPreloadApi({ onPermissionDecision, approvePermissionDecision: denyMock }));
      await act(async () => { render(<App />); });
      await act(async () => {
        const h = onPermissionDecision.mock.calls[0]![0] as (d: unknown) => void;
        h({ id: 'perm-1', requestId: 'req-1', sessionId: 'session-1', taskId: 'task-1', actorKind: 'agent', kind: 'write', target: '/etc/passwd', risk: 'high', decision: 'prompt', toolName: 'write_file', reason: 'Sensitive file', createdAt: Date.now() });
      });
      const denyBtn = await screen.findByRole('button', { name: 'Deny write_file' });
      await userEvent.click(denyBtn);
      expect(denyMock).toHaveBeenCalledWith(expect.objectContaining({ decisionId: 'perm-1', decision: 'deny', duration: 'once' }));
    });

    it('does not show non-prompt decisions', async () => {
      const onPermissionDecision = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onPermissionDecision }));
      await act(async () => { render(<App />); });
      await act(async () => {
        const h = onPermissionDecision.mock.calls[0]![0] as (d: unknown) => void;
        h({ id: 'perm-1', requestId: 'req-1', sessionId: 'session-1', taskId: 'task-1', actorKind: 'agent', kind: 'write', target: '/etc/passwd', risk: 'high', decision: 'allow', reason: 'Auto-approved', createdAt: Date.now() });
      });
      expect(screen.queryByText('Permission Requests')).not.toBeInTheDocument();
    });
  });

  describe('ApprovalDialog', () => {
    for (const risk of ['critical', 'high', 'medium', 'low'] as const) {
      it(`shows approval dialog with ${risk} risk`, async () => {
        const onToolApprovalRequest = vi.fn().mockReturnValue(() => undefined);
        setAgentDeck(mockPreloadApi({ onToolApprovalRequest }));
        await act(async () => { render(<App />); });
        await act(async () => {
          const h = onToolApprovalRequest.mock.calls[0]![0] as (r: unknown) => void;
          h({ callId: `call-${risk}`, status: 'pending-approval', classification: { name: 'test_tool', description: 'Test', riskLevel: risk }, expiresAt: Date.now() + 30000 });
        });
        expect(await screen.findByText(risk)).toBeInTheDocument();
      });
    }

    it('approves tool call', async () => {
      const onToolApprovalRequest = vi.fn().mockReturnValue(() => undefined);
      const submitApprovalMock = vi.fn().mockResolvedValue({ status: 'ok' });
      setAgentDeck(mockPreloadApi({ onToolApprovalRequest, submitApproval: submitApprovalMock }));
      await act(async () => { render(<App />); });
      await act(async () => {
        const h = onToolApprovalRequest.mock.calls[0]![0] as (r: unknown) => void;
        h({ callId: 'call-1', status: 'pending-approval', classification: { name: 'write_file', description: 'Write', riskLevel: 'medium' }, expiresAt: Date.now() + 30000 });
      });
      // Find the approve button by its class since Polish chars are tricky
      const approveBtn = document.querySelector('.approval-btn--approve') as HTMLButtonElement;
      expect(approveBtn).toBeTruthy();
      await userEvent.click(approveBtn);
      expect(submitApprovalMock).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', approved: true, remember: false }));
    });
  });

  describe('PatchConflictDialog', () => {
    it('shows conflict dialog', async () => {
      const onConflictDetected = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onConflictDetected }));
      await act(async () => { render(<App />); });
      await act(async () => {
        const h = onConflictDetected.mock.calls[0]![0] as (c: Conflict) => void;
        h(makeConflict());
      });
      expect(await screen.findByText('Konflikt patcha')).toBeInTheDocument();
      expect(screen.getByText('src/app.ts')).toBeInTheDocument();
      expect(screen.getByText('File was modified externally')).toBeInTheDocument();
    });

    it('shows critical risk', async () => {
      const onConflictDetected = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onConflictDetected }));
      await act(async () => { render(<App />); });
      await act(async () => {
        const h = onConflictDetected.mock.calls[0]![0] as (c: Conflict) => void;
        h(makeConflict({ riskLevel: 'critical', kind: 'high-risk' }));
      });
      // The badge shows conflictData.kind, not riskLevel
      expect(await screen.findByText('high-risk')).toBeInTheDocument();
    });

    it('resolves with skip', async () => {
      const onConflictDetected = vi.fn().mockReturnValue(() => undefined);
      const resolveMock = vi.fn().mockResolvedValue(undefined);
      setAgentDeck(mockPreloadApi({ onConflictDetected, resolveConflict: resolveMock }));
      await act(async () => { render(<App />); });
      await act(async () => {
        const h = onConflictDetected.mock.calls[0]![0] as (c: Conflict) => void;
        h(makeConflict());
      });
      // Find skip button by class since Polish chars are tricky
      const skipBtn = document.querySelector('.approval-btn--deny') as HTMLButtonElement;
      expect(skipBtn).toBeTruthy();
      await userEvent.click(skipBtn);
      expect(resolveMock).toHaveBeenCalledWith(expect.objectContaining({ conflictId: 'conflict-1', action: 'skip' }));
    });

    it('handles conflict without filePath', async () => {
      const onConflictDetected = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onConflictDetected }));
      await act(async () => { render(<App />); });
      await act(async () => {
        const h = onConflictDetected.mock.calls[0]![0] as (c: Conflict) => void;
        h(makeConflict({ filePath: '' }));
      });
      expect(await screen.findByText('Konflikt patcha')).toBeInTheDocument();
    });
  });

  describe('Startup services', () => {
    it('shows services in services panel', async () => {
      setAgentDeck(mockPreloadApi({
        getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.2.0', services: [{ id: 'svc-1', label: 'Editor Service', status: 'running' }, { id: 'svc-2', label: 'Chat Service', status: 'starting' }] })
      }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Services' }));
      expect(await screen.findByText('Editor Service')).toBeInTheDocument();
      expect(screen.getByText('running')).toBeInTheDocument();
      expect(screen.getByText('Chat Service')).toBeInTheDocument();
      expect(screen.getByText('starting')).toBeInTheDocument();
    });

    it('shows empty services panel', async () => {
      setAgentDeck(mockPreloadApi({ getStartupState: vi.fn().mockResolvedValue({ status: 'ready', appVersion: '0.2.0', services: [] }) }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Services' }));
      expect(screen.queryByRole('list', { name: 'Startup services' })).not.toBeInTheDocument();
    });
  });

  describe('Diagnostics polling', () => {
    it('updates diagnostic counts', async () => {
      setAgentDeck(mockPreloadApi({ getEditorDiagnostics: vi.fn().mockResolvedValue([{ filePath: 'test.ts', line: 1, col: 1, severity: 'error', message: 'E' }, { filePath: 'test.ts', line: 2, col: 1, severity: 'warning', message: 'W' }, { filePath: 'test.ts', line: 3, col: 1, severity: 'info', message: 'I' }, { filePath: 'test.ts', line: 4, col: 1, severity: 'hint', message: 'H' }]) }));
      await act(async () => { render(<App />); });
      await waitFor(() => {
        expect(screen.getByLabelText('1 errors')).toBeInTheDocument();
        expect(screen.getByLabelText('1 warnings')).toBeInTheDocument();
        expect(screen.getByLabelText('1 infos')).toBeInTheDocument();
        expect(screen.getByLabelText('1 hints')).toBeInTheDocument();
      });
    });
  });

  describe('Theme switcher', () => {
    it('switches to light', async () => {
      const user = userEvent.setup();
      setAgentDeck(mockPreloadApi({ getThemeSettings: vi.fn().mockResolvedValue({ theme: 'dark' }), setThemeSettings: vi.fn().mockImplementation(async (s: unknown) => s) }));
      await act(async () => { render(<App />); });
      await user.click(screen.getByRole('button', { name: 'Light' }));
    });

    it('switches to dark', async () => {
      const user = userEvent.setup();
      setAgentDeck(mockPreloadApi({ getThemeSettings: vi.fn().mockResolvedValue({ theme: 'light' }), setThemeSettings: vi.fn().mockImplementation(async (s: unknown) => s) }));
      await act(async () => { render(<App />); });
      await user.click(screen.getByRole('button', { name: 'Dark' }));
    });
  });

  describe('Activity bar', () => {
    it('switches to chat', async () => {
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('button', { name: 'Chat' }));
      expect(await screen.findByText('Create a new chat tab to start a conversation with an AI model.')).toBeInTheDocument();
    });

    it('disables search without workspace', async () => {
      await act(async () => { render(<App />); });
      expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    });
  });

  describe('Status bar', () => {
    it('shows workspace status', async () => {
      await act(async () => { render(<App />); });
      expect(screen.getByRole('status', { name: 'Workspace status' })).toHaveTextContent('No workspace opened.');
    });

    it('shows theme status', async () => {
      await act(async () => { render(<App />); });
      expect(screen.getByRole('status', { name: 'Theme settings' })).toHaveTextContent('Theme settings ready.');
    });

    it('shows identity when logged in', async () => {
      setAgentDeck(mockPreloadApi({ getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: true, profile: { login: 'testuser', avatar_url: 'https://example.com/avatar.png' } }), onIdentityChange: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      expect(await screen.findAllByRole('button', { name: 'Logged in as testuser' })).toHaveLength(2);
    });

    it('shows identity when logged out', async () => {
      await act(async () => { render(<App />); });
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    });
  });

  describe('Event log panel', () => {
    it('renders when selected', async () => {
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Event Log' }));
      expect(screen.getByRole('tab', { name: 'Event Log' })).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('External changes', () => {
    it('tracks fs events', async () => {
      setAgentDeck(mockPreloadApi({ onFsEvent: vi.fn().mockImplementation((handler) => { handler({ kind: 'change', path: '/ws/file.ts' }); return () => undefined; }) }));
      await act(async () => { render(<App />); });
      expect(screen.getByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');
    });
  });

  describe('Identity menu close', () => {
    it('closes on outside click', async () => {
      setAgentDeck(mockPreloadApi({ getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }), onIdentityChange: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      const identityBtn = await screen.findByRole('button', { name: 'Not logged in' });
      await userEvent.click(identityBtn);
      expect(screen.getByRole('menu')).toBeInTheDocument();
      await userEvent.click(document.body);
      await waitFor(() => { expect(screen.queryByRole('menu')).not.toBeInTheDocument(); });
    });
  });

  describe('App subscriptions', () => {
    it('subscribes to session crashed', async () => {
      const fn = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onAgentRuntimeSessionCrashed: fn }));
      await act(async () => { render(<App />); });
      expect(fn).toHaveBeenCalled();
    });

    it('subscribes to session changed', async () => {
      const fn = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onAgentRuntimeSessionChanged: fn }));
      await act(async () => { render(<App />); });
      expect(fn).toHaveBeenCalled();
    });

    it('subscribes to permission decisions', async () => {
      const fn = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onPermissionDecision: fn }));
      await act(async () => { render(<App />); });
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('Task changed', () => {
    it('updates tasks on task changed event', async () => {
      const onTaskChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ listAgentRuntimeTasks: vi.fn().mockResolvedValue([]), onAgentRuntimeTaskChanged: onTaskChanged, onAgentRuntimeSessionChanged: vi.fn().mockReturnValue(() => undefined), onAgentRuntimeWorkerChanged: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
      await act(async () => {
        const h = onTaskChanged.mock.calls[0]![0] as (t: AgentRuntimeTaskState) => void;
        h(makeTask({ id: 'task-new', prompt: 'New task' }));
      });
      expect(await screen.findByText(/Prompt: New task/)).toBeInTheDocument();
    });
  });

  describe('Event type formatting', () => {
    const eventTypes: Array<{ type: AgentRuntimeEventEntry['type']; label: string }> = [
      { type: 'session-created', label: 'Session created' },
      { type: 'session-stopped', label: 'Session stopped' },
      { type: 'worker-started', label: 'Worker started' },
      { type: 'worker-stopped', label: 'Worker stopped' },
      { type: 'worker-crashed', label: 'Worker crashed' },
      { type: 'worker-resumed', label: 'Worker resumed' },
      { type: 'task-created', label: 'Task created' },
      { type: 'task-updated', label: 'Task updated' },
      { type: 'task-completed', label: 'Task completed' },
      { type: 'task-failed', label: 'Task failed' },
      { type: 'task-cancelled', label: 'Task cancelled' }
    ];

    for (const { type, label } of eventTypes) {
      it(`formats ${type}`, async () => {
        const onSessionChanged = vi.fn().mockReturnValue(() => undefined);
        setAgentDeck(mockPreloadApi({ onAgentRuntimeSessionChanged: onSessionChanged, onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined) }));
        await act(async () => { render(<App />); });
        await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
        const uniqueMsg = `MSG-${type}`;
        await act(async () => {
          const h = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
          h(makeSession({ eventLog: [makeRuntimeEvent({ id: `evt-${type}`, type, message: uniqueMsg })] }));
        });
        const list = screen.getByRole('list', { name: 'Agent Runtime event log' });
        expect(within(list).getByText(label)).toBeInTheDocument();
        expect(within(list).getByText(uniqueMsg)).toBeInTheDocument();
      });
    }
  });

  describe('Task title formatting', () => {
    it('formats chat task', async () => {
      const onTaskChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ listAgentRuntimeTasks: vi.fn().mockResolvedValue([]), onAgentRuntimeTaskChanged: onTaskChanged, onAgentRuntimeSessionChanged: vi.fn().mockReturnValue(() => undefined), onAgentRuntimeWorkerChanged: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
      await act(async () => {
        const h = onTaskChanged.mock.calls[0]![0] as (t: AgentRuntimeTaskState) => void;
        h(makeTask({ kind: 'chat', agentName: 'MyAgent' }));
      });
      expect(await screen.findByText('MyAgent (chat)')).toBeInTheDocument();
    });

    it('formats subagent with parent', async () => {
      const onTaskChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ listAgentRuntimeTasks: vi.fn().mockResolvedValue([]), onAgentRuntimeTaskChanged: onTaskChanged, onAgentRuntimeSessionChanged: vi.fn().mockReturnValue(() => undefined), onAgentRuntimeWorkerChanged: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
      await act(async () => {
        const h = onTaskChanged.mock.calls[0]![0] as (t: AgentRuntimeTaskState) => void;
        h(makeTask({ kind: 'subagent', agentName: 'SubAgent', parentTaskId: 'parent-1' }));
      });
      expect(await screen.findByText(/SubAgent \(subagent/)).toBeInTheDocument();
      expect(screen.getByText(/parent parent-1/)).toBeInTheDocument();
    });
  });

  describe('Empty tools and references', () => {
    it('renders task with no tools', async () => {
      const onTaskChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ listAgentRuntimeTasks: vi.fn().mockResolvedValue([]), onAgentRuntimeTaskChanged: onTaskChanged, onAgentRuntimeSessionChanged: vi.fn().mockReturnValue(() => undefined), onAgentRuntimeWorkerChanged: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
      await act(async () => {
        const h = onTaskChanged.mock.calls[0]![0] as (t: AgentRuntimeTaskState) => void;
        h(makeTask({ toolsUsed: [] }));
      });
      const taskList = screen.getByRole('list', { name: 'Runtime task activity' });
      expect(within(taskList).getAllByText(/Brak/).length).toBeGreaterThanOrEqual(1);
    });

    it('renders task with no references', async () => {
      const onTaskChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ listAgentRuntimeTasks: vi.fn().mockResolvedValue([]), onAgentRuntimeTaskChanged: onTaskChanged, onAgentRuntimeSessionChanged: vi.fn().mockReturnValue(() => undefined), onAgentRuntimeWorkerChanged: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
      await act(async () => {
        const h = onTaskChanged.mock.calls[0]![0] as (t: AgentRuntimeTaskState) => void;
        h(makeTask({ result: { summary: 'Done', references: [], toolsUsed: [] } }));
      });
      const taskList = screen.getByRole('list', { name: 'Runtime task activity' });
      expect(within(taskList).getAllByText(/Brak/).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Event tone styling', () => {
    it('renders error-tone events', async () => {
      const onSessionChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onAgentRuntimeSessionChanged: onSessionChanged, onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
      await act(async () => {
        const h = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
        h(makeSession({ eventLog: [makeRuntimeEvent({ id: 'e1', type: 'worker-crashed', message: 'Crashed' }), makeRuntimeEvent({ id: 'e2', type: 'task-failed', message: 'Failed' }), makeRuntimeEvent({ id: 'e3', type: 'session-stopped', message: 'Stopped' })] }));
      });
      const list = screen.getByRole('list', { name: 'Agent Runtime event log' });
      expect(within(list).getByText('Crashed')).toBeInTheDocument();
      expect(within(list).getByText('Failed')).toBeInTheDocument();
      expect(within(list).getByText('Stopped')).toBeInTheDocument();
    });

    it('renders success-tone events', async () => {
      const onSessionChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onAgentRuntimeSessionChanged: onSessionChanged, onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
      await act(async () => {
        const h = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
        h(makeSession({ eventLog: [makeRuntimeEvent({ id: 'e1', type: 'worker-started', message: 'Started' }), makeRuntimeEvent({ id: 'e2', type: 'worker-resumed', message: 'Resumed' }), makeRuntimeEvent({ id: 'e3', type: 'task-completed', message: 'Completed' }), makeRuntimeEvent({ id: 'e4', type: 'session-created', message: 'Created' })] }));
      });
      const list = screen.getByRole('list', { name: 'Agent Runtime event log' });
      expect(within(list).getByText('Started')).toBeInTheDocument();
      expect(within(list).getByText('Resumed')).toBeInTheDocument();
      expect(within(list).getByText('Completed')).toBeInTheDocument();
      expect(within(list).getByText('Created')).toBeInTheDocument();
    });

    it('renders info-tone events', async () => {
      const onSessionChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onAgentRuntimeSessionChanged: onSessionChanged, onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
      await act(async () => {
        const h = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
        h(makeSession({ eventLog: [makeRuntimeEvent({ id: 'e1', type: 'worker-stopped', message: 'WStopped' }), makeRuntimeEvent({ id: 'e2', type: 'task-created', message: 'TCreated' }), makeRuntimeEvent({ id: 'e3', type: 'task-updated', message: 'TUpdated' }), makeRuntimeEvent({ id: 'e4', type: 'task-cancelled', message: 'TCancelled' })] }));
      });
      const list = screen.getByRole('list', { name: 'Agent Runtime event log' });
      expect(within(list).getByText('WStopped')).toBeInTheDocument();
      expect(within(list).getByText('TCreated')).toBeInTheDocument();
      expect(within(list).getByText('TUpdated')).toBeInTheDocument();
      expect(within(list).getByText('TCancelled')).toBeInTheDocument();
    });

    it('renders worker and task IDs', async () => {
      const onSessionChanged = vi.fn().mockReturnValue(() => undefined);
      setAgentDeck(mockPreloadApi({ onAgentRuntimeSessionChanged: onSessionChanged, onAgentRuntimeSessionCrashed: vi.fn().mockReturnValue(() => undefined) }));
      await act(async () => { render(<App />); });
      await userEvent.click(screen.getByRole('tab', { name: 'Task Activity' }));
      await act(async () => {
        const h = onSessionChanged.mock.calls[0]![0] as (s: AgentRuntimeSessionState) => void;
        h(makeSession({ eventLog: [makeRuntimeEvent({ workerId: 'worker-1', taskId: 'task-1' })] }));
      });
      expect(await screen.findByText('Worker: worker-1')).toBeInTheDocument();
      expect(screen.getByText('Task: task-1')).toBeInTheDocument();
    });
  });
});
