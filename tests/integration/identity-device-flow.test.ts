import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
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
    vi.useRealTimers();
  });

  it('completes device flow and stores token', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    let userCompleted = false;

    // Mock fetch behavior for device endpoints
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    globalThis.fetch = vi.fn(async (input: unknown, _init?: unknown) => {
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const openUrl = vi.fn(async (_url: string) => {
      // simulate user visiting verification URI and completing authorization
      userCompleted = true;
    });

    const svc = createIdentityService(tmpDir!, { secureStore, openUrl });

    const session = await svc.startDeviceFlow({ clientId: 'cid' });

    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('device-octo');
    expect(secureStore.setPassword).toHaveBeenCalledWith('agentdeck', 'github', 'device-token');
  });

  it('device flow handles slow_down by increasing interval', async () => {
    vi.useFakeTimers();

    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, _init?: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/login/device/code')) {
        return { ok: true, json: async () => ({ device_code: 'dev-code', user_code: 'UC', verification_uri: 'https://example.com/v', interval: 0 }) } as unknown as Response;
      }
      if (url.includes('/login/oauth/access_token')) {
        callCount++;
        if (callCount === 1) {
          return { ok: true, json: async () => ({ error: 'authorization_pending' }) } as unknown as Response;
        }
        if (callCount === 2) {
          return { ok: true, json: async () => ({ error: 'slow_down' }) } as unknown as Response;
        }
        return { ok: true, json: async () => ({ access_token: 'slow-token' }) } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return { ok: true, json: async () => ({ login: 'slow-user', id: 55 }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmpDir!, { secureStore, openUrl: vi.fn() });

    // Start the device flow and advance timers to skip real waits
    const sessionPromise = svc.startDeviceFlow({ clientId: 'cid', timeoutMs: 30000, intervalMs: 1 });

    // Advance timers to let the polling loop run through pending ? slow_down ? success
    await vi.runAllTimersAsync();

    const session = await sessionPromise;

    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('slow-user');
    expect(callCount).toBeGreaterThanOrEqual(3);

    vi.useRealTimers();
  }, 10000);

  it('device flow throws on access_denied', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, _init?: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/login/device/code')) {
        return { ok: true, json: async () => ({ device_code: 'dc', user_code: 'UC', verification_uri: 'https://example.com/v', interval: 1 }) } as unknown as Response;
      }
      if (url.includes('/login/oauth/access_token')) {
        return { ok: true, json: async () => ({ error: 'access_denied' }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmpDir!, { secureStore, openUrl: vi.fn() });
    await expect(svc.startDeviceFlow({ clientId: 'cid' })).rejects.toThrow('User denied device authorization');
  });

  it('device flow throws on expired_token', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, _init?: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/login/device/code')) {
        return { ok: true, json: async () => ({ device_code: 'dc', user_code: 'UC', verification_uri: 'https://example.com/v', interval: 1 }) } as unknown as Response;
      }
      if (url.includes('/login/oauth/access_token')) {
        return { ok: true, json: async () => ({ error: 'expired_token' }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmpDir!, { secureStore, openUrl: vi.fn() });
    await expect(svc.startDeviceFlow({ clientId: 'cid' })).rejects.toThrow('Device flow expired');
  });

  it('device flow throws on timeout', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, _init?: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/login/device/code')) {
        return { ok: true, json: async () => ({ device_code: 'dc', user_code: 'UC', verification_uri: 'https://example.com/v', interval: 1 }) } as unknown as Response;
      }
      if (url.includes('/login/oauth/access_token')) {
        return { ok: true, json: async () => ({ error: 'authorization_pending' }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmpDir!, { secureStore, openUrl: vi.fn() });
    await expect(svc.startDeviceFlow({ clientId: 'cid', timeoutMs: 50, intervalMs: 20 })).rejects.toThrow('Device flow timed out');
  });

  // --- Edge-case tests from code review ---

  it('device flow does not store token when profile fetch returns non-OK', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, _init?: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/login/device/code')) {
        return { ok: true, json: async () => ({ device_code: 'dc', user_code: 'UC', verification_uri: 'https://example.com/v', interval: 1 }) } as unknown as Response;
      }
      if (url.includes('/login/oauth/access_token')) {
        return { ok: true, json: async () => ({ access_token: 'bad-profile-token' }) } as unknown as Response;
      }
      // Profile endpoint returns 401 (token is invalid/expired)
      if (url.includes('api.github.com/user')) {
        return { ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmpDir!, { secureStore, openUrl: vi.fn() });

    await expect(svc.startDeviceFlow({ clientId: 'cid' })).rejects.toThrow('Failed to fetch GitHub profile');

    // Token must NOT be stored when profile fetch fails
    expect(store['agentdeck:github']).toBeUndefined();
    expect(secureStore.setPassword).not.toHaveBeenCalled();
  });

  it('device flow handles non-JSON response from token endpoint', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, _init?: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/login/device/code')) {
        return { ok: true, json: async () => ({ device_code: 'dc', user_code: 'UC', verification_uri: 'https://example.com/v', interval: 1 }) } as unknown as Response;
      }
      if (url.includes('/login/oauth/access_token')) {
        callCount++;
        if (callCount === 1) {
          // First call: return non-JSON (simulating 502 HTML)
          return {
            ok: false,
            status: 502,
            json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
          } as unknown as Response;
        }
        return { ok: true, json: async () => ({ access_token: 'recovered-token' }) } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return { ok: true, json: async () => ({ login: 'recovered-user', id: 77 }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmpDir!, { secureStore, openUrl: vi.fn() });

    // Should recover from the non-JSON response and eventually succeed
    const session = await svc.startDeviceFlow({ clientId: 'cid', timeoutMs: 30000, intervalMs: 50 });

    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('recovered-user');
    expect(secureStore.setPassword).toHaveBeenCalledWith('agentdeck', 'github', 'recovered-token');
  });

  it('device flow throws on unsupported_grant_type error', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, _init?: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/login/device/code')) {
        return { ok: true, json: async () => ({ device_code: 'dc', user_code: 'UC', verification_uri: 'https://example.com/v', interval: 1 }) } as unknown as Response;
      }
      if (url.includes('/login/oauth/access_token')) {
        return { ok: true, json: async () => ({ error: 'unsupported_grant_type' }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmpDir!, { secureStore, openUrl: vi.fn() });
    await expect(svc.startDeviceFlow({ clientId: 'cid' })).rejects.toThrow('Device flow configuration error');
  });

  it('device flow throws on incorrect_client_credentials error', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, _init?: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/login/device/code')) {
        return { ok: true, json: async () => ({ device_code: 'dc', user_code: 'UC', verification_uri: 'https://example.com/v', interval: 1 }) } as unknown as Response;
      }
      if (url.includes('/login/oauth/access_token')) {
        return { ok: true, json: async () => ({ error: 'incorrect_client_credentials' }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmpDir!, { secureStore, openUrl: vi.fn() });
    await expect(svc.startDeviceFlow({ clientId: 'cid' })).rejects.toThrow('Device flow configuration error');
  });
});
