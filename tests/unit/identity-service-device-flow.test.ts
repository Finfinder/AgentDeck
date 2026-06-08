import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createIdentityService } from '@agentdeck/services';

let tmp: string | null = null;

describe('IdentityService — device flow', () => {
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'agentdeck-df-'));
  });

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = null;
    vi.restoreAllMocks();
  });

  it('completes device flow successfully', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-code',
            user_code: 'ABCD-1234',
            verification_uri: 'https://github.com/device',
            verification_uri_complete: 'https://github.com/device?user_code=ABCD-1234',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({ error: 'authorization_pending' })
          } as unknown as Response;
        }
        return {
          ok: true,
          json: async () => ({ access_token: 'device-token' })
        } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'devuser', id: 77, name: 'Dev User', email: 'dev@test.com' })
        } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const openUrl = vi.fn(async () => {});
    const onDeviceCode = vi.fn();

    const svc = createIdentityService(tmp!, { secureStore, openUrl });
    const session = await svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 5000,
      intervalMs: 10,
      onDeviceCode
    });

    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('devuser');
    expect(session.profile?.id).toBe(77);
    expect(onDeviceCode).toHaveBeenCalledWith('ABCD-1234', 'https://github.com/device', 'https://github.com/device?user_code=ABCD-1234');
    expect(secureStore.setPassword).toHaveBeenCalledWith('agentdeck', 'github', 'device-token');
  });

  it('calls onDeviceCode before opening browser', async () => {
    const callOrder: string[] = [];
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
            device_code: 'dev-code',
            user_code: 'WXYZ-5678',
            verification_uri: 'https://github.com/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'tok' })
        } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'user', id: 1 })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const openUrl = vi.fn(async () => { callOrder.push('openUrl'); });
    const onDeviceCode = vi.fn(() => { callOrder.push('onDeviceCode'); });

    const svc = createIdentityService(tmp!, { secureStore, openUrl });
    await svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 5000,
      intervalMs: 10,
      onDeviceCode
    });

    expect(callOrder).toEqual(['onDeviceCode', 'openUrl']);
  });

  it('throws when device code initiation fails', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    await expect(svc.startDeviceFlow({ clientId: 'bad-client' }))
      .rejects.toThrow('Failed to start device flow');
  });

  it('handles slow_down response by increasing interval', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    let tokenCallCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-code',
            user_code: 'SLOW-0000',
            verification_uri: 'https://github.com/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        tokenCallCount++;
        if (tokenCallCount === 1) {
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
          json: async () => ({ login: 'slowuser', id: 55 })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });
    const session = await svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 15000,
      intervalMs: 10
    });

    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('slowuser');
    expect(tokenCallCount).toBe(2);
  }, 20000);

  it('throws on access_denied error', async () => {
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
            device_code: 'dev-code',
            user_code: 'DENY-0000',
            verification_uri: 'https://github.com/device',
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

    await expect(svc.startDeviceFlow({ clientId: 'test-client', timeoutMs: 5000, intervalMs: 10 }))
      .rejects.toThrow('User denied device authorization');
  });

  it('throws on expired_token error', async () => {
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
            device_code: 'dev-code',
            user_code: 'EXPI-0000',
            verification_uri: 'https://github.com/device',
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

    await expect(svc.startDeviceFlow({ clientId: 'test-client', timeoutMs: 5000, intervalMs: 10 }))
      .rejects.toThrow('Device flow expired');
  });

  it('throws on unsupported_grant_type error', async () => {
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
            device_code: 'dev-code',
            user_code: 'GRNT-0000',
            verification_uri: 'https://github.com/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ error: 'unsupported_grant_type' })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    await expect(svc.startDeviceFlow({ clientId: 'test-client', timeoutMs: 5000, intervalMs: 10 }))
      .rejects.toThrow('Device flow configuration error');
  });

  it('throws on incorrect_client_credentials error', async () => {
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
            device_code: 'dev-code',
            user_code: 'CRED-0000',
            verification_uri: 'https://github.com/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ error: 'incorrect_client_credentials' })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    await expect(svc.startDeviceFlow({ clientId: 'test-client', timeoutMs: 5000, intervalMs: 10 }))
      .rejects.toThrow('Device flow configuration error');
  });

  it('throws on incorrect_device_code error', async () => {
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
            device_code: 'dev-code',
            user_code: 'DCODE-000',
            verification_uri: 'https://github.com/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ error: 'incorrect_device_code' })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    await expect(svc.startDeviceFlow({ clientId: 'test-client', timeoutMs: 5000, intervalMs: 10 }))
      .rejects.toThrow('Device flow invalid code');
  });

  it('throws on unknown error code', async () => {
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
            device_code: 'dev-code',
            user_code: 'UNKN-0000',
            verification_uri: 'https://github.com/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ error: 'some_weird_error' })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    await expect(svc.startDeviceFlow({ clientId: 'test-client', timeoutMs: 5000, intervalMs: 10 }))
      .rejects.toThrow('Device flow failed: some_weird_error');
  });

  it('handles non-JSON error response (e.g. 502 HTML) as pending', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    let tokenCallCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-code',
            user_code: 'HTML-0000',
            verification_uri: 'https://github.com/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        tokenCallCount++;
        if (tokenCallCount === 1) {
          return {
            ok: false,
            status: 502,
            json: async () => { throw new SyntaxError('Unexpected token'); }
          } as unknown as Response;
        }
        return {
          ok: true,
          json: async () => ({ access_token: 'recovered-token' })
        } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'recovered', id: 33 })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });
    const session = await svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 5000,
      intervalMs: 10
    });

    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('recovered');
  });

  it('uses TEST_IDENTITY_AUTO env for test mode', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    const origAuto = process.env.TEST_IDENTITY_AUTO;
    const origToken = process.env.TEST_IDENTITY_TOKEN;
    const origLogin = process.env.TEST_IDENTITY_LOGIN;
    process.env.TEST_IDENTITY_AUTO = '1';
    process.env.TEST_IDENTITY_TOKEN = 'env-test-token';
    process.env.TEST_IDENTITY_LOGIN = 'env-tester';

    try {
      const svc = createIdentityService(tmp!, { secureStore });
      const session = await svc.startDeviceFlow({ clientId: 'any' });

      expect(session.isLoggedIn).toBe(true);
      expect(session.profile?.login).toBe('env-tester');
      expect(session.profile?.id).toBe(99);
      expect(secureStore.setPassword).toHaveBeenCalledWith('agentdeck', 'github', 'env-test-token');
    } finally {
      if (origAuto === undefined) delete process.env.TEST_IDENTITY_AUTO;
      else process.env.TEST_IDENTITY_AUTO = origAuto;
      if (origToken === undefined) delete process.env.TEST_IDENTITY_TOKEN;
      else process.env.TEST_IDENTITY_TOKEN = origToken;
      if (origLogin === undefined) delete process.env.TEST_IDENTITY_LOGIN;
      else process.env.TEST_IDENTITY_LOGIN = origLogin;
    }
  });

  it('uses default test token when TEST_IDENTITY_TOKEN is not set', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    const origAuto = process.env.TEST_IDENTITY_AUTO;
    const origToken = process.env.TEST_IDENTITY_TOKEN;
    const origLogin = process.env.TEST_IDENTITY_LOGIN;
    process.env.TEST_IDENTITY_AUTO = '1';
    delete process.env.TEST_IDENTITY_TOKEN;
    delete process.env.TEST_IDENTITY_LOGIN;

    try {
      const svc = createIdentityService(tmp!, { secureStore });
      const session = await svc.startDeviceFlow({ clientId: 'any' });

      expect(session.isLoggedIn).toBe(true);
      expect(session.profile?.login).toBe('e2e-octo');
      expect(secureStore.setPassword).toHaveBeenCalledWith('agentdeck', 'github', 'test-device-token');
    } finally {
      if (origAuto === undefined) delete process.env.TEST_IDENTITY_AUTO;
      else process.env.TEST_IDENTITY_AUTO = origAuto;
      if (origToken === undefined) delete process.env.TEST_IDENTITY_TOKEN;
      else process.env.TEST_IDENTITY_TOKEN = origToken;
      if (origLogin === undefined) delete process.env.TEST_IDENTITY_LOGIN;
      else process.env.TEST_IDENTITY_LOGIN = origLogin;
    }
  });

  it('does not store token when profile fetch fails in device flow', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-code',
            user_code: 'FAIL-0000',
            verification_uri: 'https://github.com/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'bad-profile-token' })
        } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return { ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    await expect(svc.startDeviceFlow({ clientId: 'test-client', timeoutMs: 5000, intervalMs: 10 }))
      .rejects.toThrow('Failed to fetch GitHub profile');

    expect(store['agentdeck:github']).toBeUndefined();
    expect(secureStore.setPassword).not.toHaveBeenCalled();
  });

  it('uses verificationUri without verificationUriComplete when complete is absent', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-code',
            user_code: 'NOCO-0000',
            verification_uri: 'https://github.com/device',
            // No verification_uri_complete
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'tok' })
        } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'user', id: 1 })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });
    const session = await svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 5000,
      intervalMs: 10
    });

    expect(session.isLoggedIn).toBe(true);
  });

  it('continues polling when openUrl fails (best-effort browser open)', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dev-code',
            user_code: 'BRSK-0000',
            verification_uri: 'https://github.com/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'tok' })
        } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'user', id: 1 })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, {
      secureStore,
      openUrl: vi.fn(async () => { throw new Error('Browser not available'); })
    });

    const session = await svc.startDeviceFlow({
      clientId: 'test-client',
      timeoutMs: 5000,
      intervalMs: 10
    });

    expect(session.isLoggedIn).toBe(true);
  });

  it('throws on null access token in device flow success response', async () => {
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
            device_code: 'dev-code',
            user_code: 'NULL-0000',
            verification_uri: 'https://github.com/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        // Return 200 with null access_token (missing field)
        return {
          ok: true,
          json: async () => ({ access_token: null })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    // null access_token is falsy, so it falls through to handleDeviceTokenError
    await expect(svc.startDeviceFlow({ clientId: 'test-client', timeoutMs: 5000, intervalMs: 10 }))
      .rejects.toThrow('Device flow failed: unknown error');
  });

  it('handles HTTP error with JSON error body in fetchDeviceToken', async () => {
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
            device_code: 'dev-code',
            user_code: 'HTER-0000',
            verification_uri: 'https://github.com/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        // Return HTTP 400 with JSON error body
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'access_denied' })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    await expect(svc.startDeviceFlow({ clientId: 'test-client', timeoutMs: 5000, intervalMs: 10 }))
      .rejects.toThrow('User denied device authorization');
  });

  it('device flow times out when polling exceeds timeout', async () => {
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
            device_code: 'dev-code',
            user_code: 'TIME-0000',
            verification_uri: 'https://github.com/device',
            interval: 0
          })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        // Always return pending
        return {
          ok: true,
          json: async () => ({ error: 'authorization_pending' })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: vi.fn() });

    await expect(svc.startDeviceFlow({ clientId: 'test-client', timeoutMs: 200, intervalMs: 10 }))
      .rejects.toThrow('Device flow timed out');
  }, 10000);
});
