import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@agentdeck/workbench';
import type { AgentDeckPreloadApi } from '@agentdeck/shared';

import { createMockAgent } from './mock-agent';

function setAgentDeck(api: AgentDeckPreloadApi) {
  Object.defineProperty(globalThis, 'agentDeck', { configurable: true, value: api });
}

function clearGlobalAgent() {
  Object.defineProperty(globalThis, 'agentDeck', { configurable: true, value: undefined });
}

describe('App — chat panel with active tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
  });

  afterEach(() => {
    clearGlobalAgent();
  });

  it('renders ChatPanel when chat tab is active and exists in tabs list', async () => {
    const createdTab = {
      id: 'chat-tab-test-1',
      title: 'Test Chat',
      messages: [],
      activeModel: 'default',
      activeProvider: 'ollama' as const,
      isStreaming: false
    };

    // listChatTabs returns the tab from the start so the store has it
    const listChatTabs = vi.fn().mockResolvedValue([createdTab]);
    const createChatTab = vi.fn().mockResolvedValue(createdTab);
    const onChatTabsChange = vi.fn().mockReturnValue(() => undefined);

    setAgentDeck(createMockAgent({
      listChatTabs,
      createChatTab,
      onChatTabsChange,
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    // Wait for app to load and effects to settle
    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    // Wait for useChatStore effect to complete and state to settle
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // Switch to chat panel
    await user.click(screen.getByRole('button', { name: 'Chat' }));

    // Since listChatTabs returns a tab, the store should have it and render ChatPanel
    // Verify welcome message is NOT shown (ChatPanel is rendered instead)
    await waitFor(() => {
      const welcome = screen.queryByText('Create a new chat tab to start a conversation with an AI model.');
      expect(welcome).toBeNull();
    });
  });

  it('renders welcome message when chat panel is active but no tabs exist', async () => {
    setAgentDeck(createMockAgent({
      listChatTabs: vi.fn().mockResolvedValue([]),
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    // Switch to chat panel
    await user.click(screen.getByRole('button', { name: 'Chat' }));

    // Welcome message should be shown
    expect(await screen.findByText('Create a new chat tab to start a conversation with an AI model.')).toBeDefined();
  });
});

describe('App — identity logged-in status bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalAgent();
  });

  afterEach(() => {
    clearGlobalAgent();
  });

  it('shows logged-in identity in status bar with login name', async () => {
    setAgentDeck(createMockAgent({
      getIdentitySession: vi.fn().mockResolvedValue({
        isLoggedIn: true,
        profile: {
          login: 'testuser',
          email: 'test@example.com',
          avatar_url: 'https://example.com/avatar.png'
        }
      }),
    }));

    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    // Status bar should show logged-in identity (two buttons have this name: activity bar + status bar)
    const identityAreas = screen.getAllByRole('button', { name: 'Logged in as testuser' });
    expect(identityAreas.length).toBeGreaterThanOrEqual(1);
    // The status bar one has .login span
    const statusBarIdentity = identityAreas.find(btn => btn.querySelector('.login'));
    expect(statusBarIdentity).toBeDefined();
    expect(statusBarIdentity?.querySelector('.login')).toHaveTextContent('testuser');
  });

  it('shows logged-in identity with avatar', async () => {
    setAgentDeck(createMockAgent({
      getIdentitySession: vi.fn().mockResolvedValue({
        isLoggedIn: true,
        profile: {
          login: 'avataruser',
          avatar_url: 'https://example.com/avatar.png'
        }
      }),
    }));

    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    const identityAreas = screen.getAllByRole('button', { name: 'Logged in as avataruser' });
    const statusBarIdentity = identityAreas.find(btn => btn.querySelector('img.avatar'));
    expect(statusBarIdentity).toBeDefined();
    const avatar = statusBarIdentity?.querySelector('img.avatar');
    expect(avatar).not.toBeNull();
    expect(avatar?.getAttribute('src')).toBe('https://example.com/avatar.png');
  });

  it('shows logged-in identity without email', async () => {
    setAgentDeck(createMockAgent({
      getIdentitySession: vi.fn().mockResolvedValue({
        isLoggedIn: true,
        profile: {
          login: 'noemail'
        }
      }),
    }));

    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    const identityAreas = screen.getAllByRole('button', { name: 'Logged in as noemail' });
    const statusBarIdentity = identityAreas.find(btn => btn.querySelector('.login'));
    expect(statusBarIdentity).toBeDefined();
    expect(statusBarIdentity?.querySelector('.login')).toHaveTextContent('noemail');
  });

  it('shows sign-in button when not logged in', async () => {
    setAgentDeck(createMockAgent({
      getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
    }));

    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    const signInBtn = screen.getByRole('button', { name: 'Sign in' });
    expect(signInBtn).toBeDefined();
  });

  it('shows identity error in menu', async () => {
    setAgentDeck(createMockAgent({
      getIdentitySession: vi.fn().mockResolvedValue({
        isLoggedIn: false,
        error: 'Token expired'
      }),
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    // Click sign-in button to open menu
    const signInBtn = screen.getByRole('button', { name: 'Sign in' });
    await user.click(signInBtn);

    // Error should be shown in dropdown
    expect(await screen.findByText('Token expired')).toBeDefined();
  });

  it('shows logged-in user without avatar in status bar', async () => {
    setAgentDeck(createMockAgent({
      getIdentitySession: vi.fn().mockResolvedValue({
        isLoggedIn: true,
        profile: {
          login: 'noavatar'
        }
      }),
    }));

    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    // Should show login name without avatar
    const identityAreas = screen.getAllByRole('button', { name: 'Logged in as noavatar' });
    const statusBarIdentity = identityAreas.find(btn => btn.querySelector('.login'));
    expect(statusBarIdentity).toBeDefined();
    // No avatar image should be present
    expect(statusBarIdentity?.querySelector('img.avatar')).toBeNull();
    expect(statusBarIdentity?.querySelector('.login')).toHaveTextContent('noavatar');
  });

  it('shows device code in identity menu after opening', async () => {
    let deviceCodeHandler: ((data: unknown) => void) | undefined;
    const onDeviceCode = vi.fn().mockImplementation((handler: (data: unknown) => void) => {
      deviceCodeHandler = handler;
      return () => undefined;
    });
    setAgentDeck(createMockAgent({
      getIdentitySession: vi.fn().mockResolvedValue({ isLoggedIn: false }),
      onDeviceCode,
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    // Trigger device code callback after render
    expect(deviceCodeHandler).toBeDefined();
    await act(async () => {
      deviceCodeHandler!({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/device' });
    });

    // Open identity menu by clicking the sign-in button
    const signInBtn = screen.getByRole('button', { name: 'Sign in' });
    await user.click(signInBtn);

    // Device code should be shown in the dropdown
    expect(await screen.findByText('ABCD-1234')).toBeDefined();
  });

  it('renders approval dialog when pending approval exists', async () => {
    const onToolApprovalRequest = vi.fn().mockReturnValue(() => undefined);
    setAgentDeck(createMockAgent({
      onToolApprovalRequest,
    }));

    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    // Trigger approval request
    expect(onToolApprovalRequest).toHaveBeenCalled();
    const handler = onToolApprovalRequest.mock.calls[0]![0] as (response: unknown) => void;
    await act(async () => {
      handler({
        status: 'pending-approval',
        callId: 'call-1',
        classification: {
          name: 'test-tool',
          description: 'Test tool description',
          riskLevel: 'medium'
        },
        expiresAt: Date.now() + 60000
      });
    });

    // Approval dialog should be shown
    expect(await screen.findByText('Zatwierdź wywołanie narzędzia')).toBeDefined();
    expect(screen.getByText('test-tool')).toBeDefined();
  });

  it('renders patch conflict dialog when conflict detected', async () => {
    const onConflictDetected = vi.fn().mockReturnValue(() => undefined);
    setAgentDeck(createMockAgent({
      onConflictDetected,
    }));

    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    // Trigger conflict
    expect(onConflictDetected).toHaveBeenCalled();
    const handler = onConflictDetected.mock.calls[0]![0] as (conflict: unknown) => void;
    await act(async () => {
      handler({
        id: 'conflict-1',
        kind: 'patch-conflict',
        patchId: 'patch-abc',
        filePath: '/workspace/src/app.ts',
        description: 'File was modified on disk',
        riskLevel: 'high',
        createdAt: Date.now()
      });
    });

    // Conflict dialog should be shown
    expect(await screen.findByText('Konflikt patcha')).toBeDefined();
    expect(screen.getByText('/workspace/src/app.ts')).toBeDefined();
  });

  it('renders services panel with startup services', async () => {
    setAgentDeck(createMockAgent({
      getStartupState: vi.fn().mockResolvedValue({
        status: 'ready',
        appVersion: '0.1.0',
        services: [
          { id: 'svc-1', label: 'Seq', status: 'running' },
          { id: 'svc-2', label: 'LSP', status: 'stopped' }
        ]
      }),
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    // Switch to services panel
    await user.click(screen.getByRole('tab', { name: 'Services' }));

    // Services should be listed
    expect(await screen.findByText('Seq')).toBeDefined();
    expect(screen.getByText('LSP')).toBeDefined();
  });

  it('renders output panel', async () => {
    setAgentDeck(createMockAgent());

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    // Switch to output panel
    await user.click(screen.getByRole('tab', { name: 'Output' }));

    // Output empty message should be shown
    expect(await screen.findByText('No output.')).toBeDefined();
  });

  it('handles approval dialog approve button', async () => {
    let approvalHandler: ((response: unknown) => void) | undefined;
    const onToolApprovalRequest = vi.fn().mockImplementation((handler: (response: unknown) => void) => {
      approvalHandler = handler;
      return () => undefined;
    });
    setAgentDeck(createMockAgent({
      onToolApprovalRequest,
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    // Trigger approval request
    expect(approvalHandler).toBeDefined();
    await act(async () => {
      approvalHandler!({
        status: 'pending-approval',
        callId: 'call-1',
        classification: {
          name: 'test-tool',
          description: 'Test tool',
          riskLevel: 'critical'
        },
        expiresAt: Date.now() + 60000
      });
    });

    // Approval dialog should be shown
    expect(await screen.findByText('Zatwierdź wywołanie narzędzia')).toBeDefined();

    // Click approve
    const approveBtn = screen.getByRole('button', { name: 'Zatwierdź' });
    await user.click(approveBtn);

    // Dialog should be dismissed
    await waitFor(() => {
      expect(screen.queryByText('Zatwierdź wywołanie narzędzia')).toBeNull();
    });
  });

  it('handles approval dialog deny button', async () => {
    let approvalHandler: ((response: unknown) => void) | undefined;
    const onToolApprovalRequest = vi.fn().mockImplementation((handler: (response: unknown) => void) => {
      approvalHandler = handler;
      return () => undefined;
    });
    setAgentDeck(createMockAgent({
      onToolApprovalRequest,
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    await act(async () => {
      approvalHandler!({
        status: 'pending-approval',
        callId: 'call-2',
        classification: {
          name: 'dangerous-tool',
          description: 'Dangerous',
          riskLevel: 'high'
        },
        expiresAt: Date.now() + 60000
      });
    });

    expect(await screen.findByText('Zatwierdź wywołanie narzędzia')).toBeDefined();

    // Click deny
    const denyBtn = screen.getByRole('button', { name: 'Odrzuć' });
    await user.click(denyBtn);

    await waitFor(() => {
      expect(screen.queryByText('Zatwierdź wywołanie narzędzia')).toBeNull();
    });
  });

  it('handles patch conflict dialog skip', async () => {
    let conflictHandler: ((conflict: unknown) => void) | undefined;
    const onConflictDetected = vi.fn().mockImplementation((handler: (conflict: unknown) => void) => {
      conflictHandler = handler;
      return () => undefined;
    });
    setAgentDeck(createMockAgent({
      onConflictDetected,
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    await act(async () => {
      conflictHandler!({
        id: 'conflict-2',
        kind: 'patch-conflict',
        patchId: 'patch-xyz',
        filePath: '/workspace/src/test.ts',
        description: 'Conflict detected',
        riskLevel: 'medium',
        createdAt: Date.now()
      });
    });

    expect(await screen.findByText('Konflikt patcha')).toBeDefined();

    // Click skip
    const skipBtn = screen.getByRole('button', { name: 'Pomiń' });
    await user.click(skipBtn);

    await waitFor(() => {
      expect(screen.queryByText('Konflikt patcha')).toBeNull();
    });
  });

  it('handles patch conflict dialog apply', async () => {
    let conflictHandler: ((conflict: unknown) => void) | undefined;
    const onConflictDetected = vi.fn().mockImplementation((handler: (conflict: unknown) => void) => {
      conflictHandler = handler;
      return () => undefined;
    });
    setAgentDeck(createMockAgent({
      onConflictDetected,
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    await act(async () => {
      conflictHandler!({
        id: 'conflict-3',
        kind: 'patch-conflict',
        patchId: 'patch-apply',
        filePath: '/workspace/src/apply.ts',
        description: 'Conflict',
        riskLevel: 'low',
        createdAt: Date.now()
      });
    });

    expect(await screen.findByText('Konflikt patcha')).toBeDefined();

    // Click apply (Nadpisz)
    const applyBtn = screen.getByRole('button', { name: 'Nadpisz' });
    await user.click(applyBtn);

    await waitFor(() => {
      expect(screen.queryByText('Konflikt patcha')).toBeNull();
    });
  });

  it('handles patch conflict dialog edit', async () => {
    let conflictHandler: ((conflict: unknown) => void) | undefined;
    const onConflictDetected = vi.fn().mockImplementation((handler: (conflict: unknown) => void) => {
      conflictHandler = handler;
      return () => undefined;
    });
    setAgentDeck(createMockAgent({
      onConflictDetected,
    }));

    const user = userEvent.setup();
    await act(async () => { render(<App />); });

    expect(await screen.findByRole('status', { name: 'Startup state' })).toHaveTextContent('Ready');

    await act(async () => {
      conflictHandler!({
        id: 'conflict-4',
        kind: 'patch-conflict',
        patchId: 'patch-edit',
        filePath: '/workspace/src/edit.ts',
        description: 'Conflict',
        riskLevel: 'high',
        createdAt: Date.now()
      });
    });

    expect(await screen.findByText('Konflikt patcha')).toBeDefined();

    // Click edit
    const editBtn = screen.getByRole('button', { name: 'Edytuj' });
    await user.click(editBtn);

    await waitFor(() => {
      expect(screen.queryByText('Konflikt patcha')).toBeNull();
    });
  });
});
