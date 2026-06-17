import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createIdentityService } from '@agentdeck/services';

// Mock keytar to force fallback file store
vi.mock('keytar', () => {
  throw new Error('keytar native module not found');
});

let tmp: string | null = null;

describe('IdentityService - Device Flow', () => {
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'agentdeck-device-'));
  });

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = null;
    vi.restoreAllMocks();
  });

  it('completes device flow and stores token', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => {
        store[`${s}:${a}`] = p;
      }),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-code-123',
            user_code: 'ABCD-1234',
            verification_uri: 'https://github.com/login/device',
            verification_uri_complete: 'https://github.com/login/device?user_code=ABCD-1234',
            interval: 1
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'device-token-xyz' })
        } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'deviceuser', id: 77, name: 'Device User', email: 'd@e.com' })
        } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const openUrl = vi.fn(async () => {});
    const onDeviceCode = vi.fn();

    const svc = createIdentityService(tmp!, { secureStore, openUrl });
    const session = await svc.startDeviceFlow({
      clientId: 'test-client-id',
      scopes: ['read:user'],
      timeoutMs: 5000,
      intervalMs: 100,
      onDeviceCode
    });

    expect(session.isLoggedIn).toBe(true);
    expect(session.provider).toBe('github');
    expect(session.profile?.login).toBe('deviceuser');
    expect(session.profile?.id).toBe(77);
    expect(secureStore.setPassword).toHaveBeenCalledWith('agentdeck', 'github', 'device-token-xyz');
    expect(onDeviceCode).toHaveBeenCalledWith('ABCD-1234', 'https://github.com/login/device', 'https://github.com/login/device?user_code=ABCD-1234');
  });

  it('handles authorization_pending then succeeds', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => {
        store[`${s}:${a}`] = p;
      }),
      deletePassword: vi.fn(async () => true)
    };

    let pollCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-pending',
            user_code: 'PEND-0000',
            verification_uri: 'https://github.com/login/device',
            interval: 1
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        pollCount++;
        if (pollCount < 2) {
          return {
            ok: true,
            json: async () => ({ error: 'authorization_pending' })
          } as unknown as Response;
        }
        return {
          ok: true,
          json: async () => ({ access_token: 'pending-token' })
        } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'pendinguser', id: 55 })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });
    const session = await svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 5000,
      intervalMs: 50
    });

    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('pendinguser');
    expect(pollCount).toBe(2);
  });

  it('handles slow_down from GitHub', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => {
        store[`${s}:${a}`] = p;
      }),
      deletePassword: vi.fn(async () => true)
    };

    let pollCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-slow',
            user_code: 'SLOW-0000',
            verification_uri: 'https://github.com/login/device',
            interval: 1
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        pollCount++;
        if (pollCount === 1) {
          return {
            ok: true,
            json: async () => ({ error: 'slow_down' })
          } as unknown as Response;
        }
        return {
          ok: true,
          json: async () => ({ access_token: 'slow-token' })
        } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'slowuser', id: 33 })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });
    const session = await svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 10000,
      intervalMs: 50
    });

    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('slowuser');
  }, 15000);

  it('throws on access_denied', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-deny',
            user_code: 'DENY-0000',
            verification_uri: 'https://github.com/login/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ error: 'access_denied' })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    await expect(svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 5000,
      intervalMs: 50
    })).rejects.toThrow('User denied device authorization');
  });

  it('throws on expired_token', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-expire',
            user_code: 'EXPI-0000',
            verification_uri: 'https://github.com/login/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ error: 'expired_token' })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    await expect(svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 5000,
      intervalMs: 50
    })).rejects.toThrow('Device flow expired');
  });

  it('times out when user never completes device auth', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-timeout',
            user_code: 'TIME-0000',
            verification_uri: 'https://github.com/login/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ error: 'authorization_pending' })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    await expect(svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 200,
      intervalMs: 50
    })).rejects.toThrow('Device flow timed out');
  }, 10000);

  it('uses TEST_IDENTITY_AUTO for device flow test mode', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => {
        store[`${s}:${a}`] = p;
      }),
      deletePassword: vi.fn(async () => true)
    };

    const origAuto = process.env.TEST_IDENTITY_AUTO;
    const origToken = process.env.TEST_IDENTITY_TOKEN;
    const origLogin = process.env.TEST_IDENTITY_LOGIN;
    process.env.TEST_IDENTITY_AUTO = '1';
    process.env.TEST_IDENTITY_TOKEN = 'device-test-token';
    process.env.TEST_IDENTITY_LOGIN = 'device-tester';

    try {
      const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });
      const session = await svc.startDeviceFlow({ clientId: 'any' });

      expect(session.isLoggedIn).toBe(true);
      expect(session.profile?.login).toBe('device-tester');
      expect(session.profile?.id).toBe(99);
      expect(secureStore.setPassword).toHaveBeenCalledWith('agentdeck', 'github', 'device-test-token');
    } finally {
      if (origAuto === undefined) delete process.env.TEST_IDENTITY_AUTO;
      else process.env.TEST_IDENTITY_AUTO = origAuto;
      if (origToken === undefined) delete process.env.TEST_IDENTITY_TOKEN;
      else process.env.TEST_IDENTITY_TOKEN = origToken;
      if (origLogin === undefined) delete process.env.TEST_IDENTITY_LOGIN;
      else process.env.TEST_IDENTITY_LOGIN = origLogin;
    }
  });

  it('handles non-JSON response from device token endpoint', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-nonjson',
            user_code: 'NONJ-0000',
            verification_uri: 'https://github.com/login/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: false,
          status: 502,
          json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    // Non-JSON response treated as pending, should time out
    await expect(svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 200,
      intervalMs: 50
    })).rejects.toThrow('Device flow timed out');
  }, 10000);

  it('opens browser with verification_uri when no complete URI', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    let openedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-nocomplete',
            user_code: 'NOCO-0000',
            verification_uri: 'https://github.com/login/device',
            // no verification_uri_complete
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ error: 'authorization_pending' })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, {
      secureStore,
      openUrl: vi.fn(async (url: string) => { openedUrl = url; })
    });

    // Will time out, but we can verify the URL was opened
    await expect(svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 100,
      intervalMs: 50
    })).rejects.toThrow();

    expect(openedUrl).toContain('https://github.com/login/device');
    expect(openedUrl).toContain('user_code=NOCO-0000');
  }, 10000);
});

describe('IdentityService - deleteModelApiKey', () => {
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'agentdeck-delete-'));
  });

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it('deletes an existing API key', async () => {
    const store: Record<string, string> = { 'agentdeck:api-key-openrouter': 'sk-old-key' };
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => {
        store[`${s}:${a}`] = p;
      }),
      deletePassword: vi.fn(async (s: string, a: string) => {
        delete store[`${s}:${a}`];
        return true;
      })
    };

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    await svc.deleteModelApiKey('openrouter');
    expect(secureStore.deletePassword).toHaveBeenCalledWith('agentdeck', 'api-key-openrouter');
    expect(store['agentdeck:api-key-openrouter']).toBeUndefined();
  });

  it('does nothing for unknown provider', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });
    await svc.deleteModelApiKey('unknown' as never);
    expect(secureStore.deletePassword).not.toHaveBeenCalled();
  });
});

describe('IdentityService - buildProfile edge cases', () => {
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'agentdeck-profile-'));
  });

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it('builds profile with all optional fields', async () => {
    const store: Record<string, string> = { 'agentdeck:github': 'token' };
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        login: 'fulluser',
        id: 123,
        avatar_url: 'https://example.com/avatar.png',
        name: 'Full User',
        email: 'full@example.com'
      })
    }) as unknown as Response);

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });
    const session = await svc.getSession();

    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('fulluser');
    expect(session.profile?.id).toBe(123);
    expect(session.profile?.avatar_url).toBe('https://example.com/avatar.png');
    expect(session.profile?.name).toBe('Full User');
    expect(session.profile?.email).toBe('full@example.com');
  });

  it('builds profile with only login (minimal)', async () => {
    const store: Record<string, string> = { 'agentdeck:github': 'token' };
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => ({ login: 'minimaluser' })
    }) as unknown as Response);

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });
    const session = await svc.getSession();

    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('minimaluser');
    expect(session.profile?.id).toBeUndefined();
    expect(session.profile?.name).toBeUndefined();
  });

  it('handles null email in profile', async () => {
    const store: Record<string, string> = { 'agentdeck:github': 'token' };
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => ({ login: 'nullemail', id: 5, email: null })
    }) as unknown as Response);

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });
    const session = await svc.getSession();

    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('nullemail');
    // buildProfile skips null email (profile.email != null is false for null)
    expect(session.profile?.email).toBeUndefined();
  });
});
