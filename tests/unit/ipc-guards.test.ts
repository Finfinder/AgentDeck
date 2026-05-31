import { describe, expect, it } from 'vitest';

import { isStartupState, isWorkspaceSelection } from '@agentdeck/shared';

describe('ipc guards extra cases', () => {
  it('accepts error startup state with INVALID_STARTUP_STATE', () => {
    const state = { status: 'error', appVersion: '1.0.0', code: 'INVALID_STARTUP_STATE', message: 'Invalid' };
    expect(isStartupState(state)).toBe(true);
  });

  it('rejects startup state when services invalid', () => {
    const state = { status: 'ready', appVersion: '1.0.0', services: [{ id: 'unknown', label: 'x', status: 'ready' }] };
    expect(isStartupState(state)).toBe(false);
  });

  it('workspace selection rejects missing name or path', () => {
    expect(isWorkspaceSelection({ status: 'selected', kind: 'workspace-file', path: '/x' })).toBe(false);
    expect(isWorkspaceSelection({ status: 'selected', kind: 'workspace-file', name: 'A' })).toBe(false);
  });
});
