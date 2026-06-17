import { describe, expect, it, vi } from 'vitest';

import { createAgentRuntime } from '@agentdeck/agent-runtime';
import { bootstrapDesktopServices, createStartupErrorState } from '@agentdeck/services';
import { IPC_CHANNELS, isStartupState, isThemeSettings, isWorkspaceOpenRequest, isWorkspaceSelection } from '@agentdeck/shared';

describe('startup IPC contract', () => {
  it('uses a versioned startup state channel', () => {
    expect(IPC_CHANNELS.getStartupState).toBe('agentdeck:v1:startup:get-state');
  });

  it('uses versioned settings and workspace channels', () => {
    expect(IPC_CHANNELS.getThemeSettings).toBe('agentdeck:v1:settings:get-theme');
    expect(IPC_CHANNELS.setThemeSettings).toBe('agentdeck:v1:settings:set-theme');
    expect(IPC_CHANNELS.selectWorkspaceEntry).toBe('agentdeck:v1:workspace:select-entry');
  });

  it('accepts ready startup state payloads', async () => {
    const state = await bootstrapDesktopServices({ appVersion: '0.1.0' });

    expect(isStartupState(state)).toBe(true);
    expect(state.status).toBe('ready');
  });

  it('describes the agent runtime capabilities', () => {
    const runtime = createAgentRuntime({
      workerFactory: workerId => ({ id: workerId, run: vi.fn() })
    });

    expect(runtime).toBeDefined();
    expect(runtime.createSession).toBeDefined();
    expect(runtime.startWorker).toBeDefined();
    expect(runtime.startSubagent).toBeDefined();
  });

  it('throws a controlled error when desktop services fail', async () => {
    await expect(bootstrapDesktopServices({ appVersion: '0.1.0', forceFailure: true })).rejects.toMatchObject({
      name: 'StartupServiceError',
      message: 'Required desktop services failed to start.'
    });
  });

  it('accepts controlled startup error payloads', () => {
    const state = createStartupErrorState('0.1.0');

    expect(isStartupState(state)).toBe(true);
    expect(state).toMatchObject({
      status: 'error',
      code: 'DESKTOP_SERVICES_UNAVAILABLE',
      message: 'Required desktop services failed to start.'
    });
  });

  it('rejects malformed startup payloads', () => {
    expect(isStartupState(null)).toBe(false);
    expect(isStartupState({ status: 'ready', services: [] })).toBe(false);
    expect(isStartupState({ status: 'error', appVersion: '0.1.0', code: 'UNKNOWN', message: 'x' })).toBe(false);
    expect(isStartupState({ status: 'ready', appVersion: '0.1.0', services: 'ready' })).toBe(false);
    expect(isStartupState({ status: 'ready', appVersion: '0.1.0', services: [{ id: 'fs', status: 'ready' }] })).toBe(false);
  });

  it('validates theme settings payloads', () => {
    expect(isThemeSettings({ theme: 'dark' })).toBe(true);
    expect(isThemeSettings({ theme: 'light' })).toBe(true);
    expect(isThemeSettings({ theme: 'system' })).toBe(false);
    expect(isThemeSettings(null)).toBe(false);
  });

  it('validates workspace open requests and selections', () => {
    expect(isWorkspaceOpenRequest({ kind: 'folder' })).toBe(true);
    expect(isWorkspaceOpenRequest({ kind: 'workspace-file' })).toBe(true);
    expect(isWorkspaceOpenRequest({ kind: 'project' })).toBe(false);

    expect(isWorkspaceSelection({ status: 'cancelled' })).toBe(true);
    expect(
      isWorkspaceSelection({
        status: 'selected',
        kind: 'workspace-file',
        path: String.raw`C:\AgentDeck.code-workspace`,
        name: 'AgentDeck.code-workspace'
      })
    ).toBe(true);
    expect(isWorkspaceSelection({ status: 'selected', kind: 'workspace-file', path: String.raw`C:\AgentDeck.code-workspace` })).toBe(false);
  });
});
