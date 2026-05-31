import { describe, expect, it } from 'vitest';

import { bootstrapDesktopServices, createStartupErrorState } from '@agentdeck/services';
import { IPC_CHANNELS, isStartupState } from '@agentdeck/shared';

describe('startup IPC contract', () => {
  it('uses a versioned startup state channel', () => {
    expect(IPC_CHANNELS.getStartupState).toBe('agentdeck:v1:startup:get-state');
  });

  it('accepts ready startup state payloads', async () => {
    const state = await bootstrapDesktopServices({ appVersion: '0.1.0' });

    expect(isStartupState(state)).toBe(true);
    expect(state.status).toBe('ready');
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
    expect(isStartupState({ status: 'ready', appVersion: '0.1.0', services: [{ id: 'fs', status: 'ready' }] })).toBe(false);
  });
});