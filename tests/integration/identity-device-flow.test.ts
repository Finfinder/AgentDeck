import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createIdentityService } from '@agentdeck/services';

let tmpDir: string | null = null;

describe('IdentityService device flow (integration)', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'agentdeck-device-'));
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
    vi.restoreAllMocks();
  });

  it('completes device flow and stores token', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => undefined)
    };

    let userCompleted = false;

    // Mock fetch behavior for device endpoints
    (globalThis as any).fetch = vi.fn(async (input: unknown, init?: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/login/device/code')) {
        return { ok: true, json: async () => ({ device_code: 'dev-code', user_code: 'USER-CODE', verification_uri: 'https://example.com/verify', interval: 1 }) } as unknown as Response;
      }

      if (url.includes('/login/oauth/access_token')) {
        if (!userCompleted) {
          return { ok: true, json: async () => ({ error: 'authorization_pending' }) } as unknown as Response;
        }

        return { ok: true, json: async () => ({ access_token: 'device-token' }) } as unknown as Response;
      }

      if (url.includes('api.github.com/user')) {
        return { ok: true, json: async () => ({ login: 'device-octo', id: 123 }) } as unknown as Response;
      }

      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const openUrl = vi.fn(async (url: string) => {
      // simulate user visiting verification URI and completing authorization
      userCompleted = true;
    });

    const svc = createIdentityService(tmpDir!, { secureStore, openUrl });

    const session = await svc.startDeviceFlow({ clientId: 'cid' });

    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('device-octo');
    expect(secureStore.setPassword).toHaveBeenCalledWith('agentdeck', 'github', 'device-token');
  });
});
