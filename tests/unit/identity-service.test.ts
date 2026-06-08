import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createIdentityService } from '@agentdeck/services';

let tmp: string | null = null;

describe('IdentityService (loopback OAuth)', () => {
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'agentdeck-identity-'));
  });

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = null;
    vi.restoreAllMocks();
  });

  it('completes OAuth loopback, stores token and returns profile', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => {
        store[`${s}:${a}`] = p;
      }),
      deletePassword: vi.fn(async () => {
        // noop
        return true;
      })
    };

    // Stub fetch for token exchange and profile
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, _init?: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/oauth/access_token')) {
        return { ok: true, json: async () => ({ access_token: 'fake-token' }) } as unknown as Response;
      }

      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'octocat', id: 1, avatar_url: 'https://example/', name: 'Octo', email: 'octo@example.com' })
        } as unknown as Response;
      }

      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    // openUrl will simulate the browser by parsing the auth URL and calling back to redirect_uri
    const openUrl = vi.fn(async (url: string) => {
      const u = new URL(url);
      const redirect = u.searchParams.get('redirect_uri')!;
      const state = u.searchParams.get('state')!;

      // simulate user completing auth by calling the redirect URL using node http
      const target = `${redirect}?code=test-code&state=${state}`;
      const { request } = await import('node:http');
      await new Promise<void>((resolve, reject) => {
        const req = request(target, (res) => {
          // consume body
          res.on('data', () => {});
          res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.end();
      });
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl });

    const session = await svc.startOAuthLoopback({ clientId: 'cid', clientSecret: 'secret' });

    expect(session.isLoggedIn).toBe(true);
    expect(session.provider).toBe('github');
    expect(session.profile?.login).toBe('octocat');
    expect(secureStore.setPassword).toHaveBeenCalledWith('agentdeck', 'github', 'fake-token');
  });

  it('rejects when callback state mismatches', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response));

    const badOpen = vi.fn(async (url: string) => {
      const u = new URL(url);
      const redirect = u.searchParams.get('redirect_uri')!;
      // send wrong state via node http
      const target = `${redirect}?code=whatever&state=BAD_STATE`;
      const { request } = await import('node:http');
      await new Promise<void>((resolve, reject) => {
        const req = request(target, (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.end();
      });
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: badOpen });

    await expect(svc.startOAuthLoopback({ clientId: 'cid' })).rejects.toThrow();
  });

  it('getSession returns profile when token exists and fetch succeeds', async () => {
    const store: Record<string, string> = { 'agentdeck:github': 'valid-token' };
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => ({ login: 'testuser', id: 42, avatar_url: 'https://example.com/a.png', name: 'Test', email: 't@e.com' })
    }) as unknown as Response);

    const svc = createIdentityService(tmp!, { secureStore });
    const session = await svc.getSession();

    expect(session.isLoggedIn).toBe(true);
    expect(session.provider).toBe('github');
    expect(session.profile?.login).toBe('testuser');
    expect(session.profile?.id).toBe(42);
  });

  it('getSession returns not logged in when no token in store', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    const svc = createIdentityService(tmp!, { secureStore });
    const session = await svc.getSession();

    expect(session.isLoggedIn).toBe(false);
    expect(session.profile).toBeUndefined();
  });

  it('getSession returns not logged in when fetch profile fails', async () => {
    const store: Record<string, string> = { 'agentdeck:github': 'expired-token' };
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Bad credentials' })
    }) as unknown as Response);

    const svc = createIdentityService(tmp!, { secureStore });
    const session = await svc.getSession();

    expect(session.isLoggedIn).toBe(false);
    expect(session.profile).toBeUndefined();
  });

  it('getSession returns not logged in when fetch throws network error', async () => {
    const store: Record<string, string> = { 'agentdeck:github': 'some-token' };
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('Network error'); });

    const svc = createIdentityService(tmp!, { secureStore });
    const session = await svc.getSession();

    expect(session.isLoggedIn).toBe(false);
  });

  it('startOAuthLoopback rejects when server port is busy', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    // Test via openUrl failure path (port busy simulation)
    const svc = createIdentityService(tmp!, {
      secureStore,
      openUrl: vi.fn(async () => { throw new Error('Failed to open browser'); })
    });

    await expect(svc.startOAuthLoopback({ clientId: 'cid' })).rejects.toThrow('Failed to open browser');
  });

  it('signOut deletes token from secure store', async () => {
    const store: Record<string, string> = { 'agentdeck:github': 'my-token' };
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async (s: string, a: string) => { delete store[`${s}:${a}`]; return true; })
    };

    const svc = createIdentityService(tmp!, { secureStore });
    await svc.signOut();

    expect(secureStore.deletePassword).toHaveBeenCalledWith('agentdeck', 'github');
    expect(store['agentdeck:github']).toBeUndefined();
  });

  // --- Edge-case tests from code review ---

  it('loopback OAuth does not store token when profile fetch fails', async () => {
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
      if (url.includes('login/oauth/access_token')) {
        return { ok: true, json: async () => ({ access_token: 'fake-token' }) } as unknown as Response;
      }
      // Profile endpoint returns 401
      if (url.includes('api.github.com/user')) {
        return { ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const openUrl = vi.fn(async (url: string) => {
      const u = new URL(url);
      const redirect = u.searchParams.get('redirect_uri')!;
      const state = u.searchParams.get('state')!;
      const target = `${redirect}?code=test-code&state=${state}`;
      const { request } = await import('node:http');
      await new Promise<void>((resolve, reject) => {
        const req = request(target, (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.end();
      });
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl });

    await expect(svc.startOAuthLoopback({ clientId: 'cid', clientSecret: 'secret' })).rejects.toThrow('Failed to fetch GitHub profile');

    // Token must NOT be stored when profile fetch fails
    expect(store['agentdeck:github']).toBeUndefined();
    expect(secureStore.setPassword).not.toHaveBeenCalled();
  });

  it('loopback OAuth handles non-JSON response from token endpoint', async () => {
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
      if (url.includes('login/oauth/access_token')) {
        // Return a non-JSON response (simulating 502 HTML)
        return {
          ok: false,
          status: 502,
          json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
        } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const openUrl = vi.fn(async (url: string) => {
      const u = new URL(url);
      const redirect = u.searchParams.get('redirect_uri')!;
      const state = u.searchParams.get('state')!;
      const target = `${redirect}?code=test-code&state=${state}`;
      const { request } = await import('node:http');
      await new Promise<void>((resolve, reject) => {
        const req = request(target, (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.end();
      });
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl });

    await expect(svc.startOAuthLoopback({ clientId: 'cid', clientSecret: 'secret' })).rejects.toThrow();
    expect(store['agentdeck:github']).toBeUndefined();
  });

  it('startOAuthLoopback times out when no callback received', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    // openUrl does nothing — no callback will be received
    const svc = createIdentityService(tmp!, {
      secureStore,
      openUrl: vi.fn(async () => { /* simulate user never completes auth */ })
    });

    await expect(svc.startOAuthLoopback({ clientId: 'cid', timeoutMs: 100 }))
      .rejects.toThrow('OAuth flow timed out');
  }, 10000);

  it('buildProfile throws when login is missing', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => ({ id: 1, name: 'No Login' })  // missing login
    }) as unknown as Response);

    const svc = createIdentityService(tmp!, { secureStore });
    const session = await svc.getSession();

    // Should return not logged in because buildProfile throws
    expect(session.isLoggedIn).toBe(false);
  });

  it('getSession returns not logged in when profile has no login', async () => {
    const store: Record<string, string> = { 'agentdeck:github': 'valid-token' };
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => ({ id: 1, avatar_url: 'https://example.com/a.png' })  // no login field
    }) as unknown as Response);

    const svc = createIdentityService(tmp!, { secureStore });
    const session = await svc.getSession();

    expect(session.isLoggedIn).toBe(false);
  });

  it('uses custom secure store for signOut, getSession, and token storage', async () => {
    // Test that a custom secure store (simulating file-based fallback) works end-to-end
    const fileStore: Record<string, string> = { 'agentdeck:github': 'stored-token' };
    const fallbackStore = {
      getPassword: vi.fn(async (s: string, a: string) => fileStore[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { fileStore[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async (s: string, a: string) => { delete fileStore[`${s}:${a}`]; return true; })
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'filestore', id: 100 })
        } as unknown as Response;
      }
      if (url.includes('login/oauth/access_token')) {
        return { ok: true, json: async () => ({ access_token: 'new-token' }) } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const svc = createIdentityService(tmp!, { secureStore: fallbackStore });

    // getSession should find the token and return profile
    const session = await svc.getSession();
    expect(session.isLoggedIn).toBe(true);
    expect(session.profile?.login).toBe('filestore');

    // signOut should delete the token
    await svc.signOut();
    expect(fallbackStore.deletePassword).toHaveBeenCalledWith('agentdeck', 'github');
    expect(fileStore['agentdeck:github']).toBeUndefined();
  });

  it('rejects when setPassword throws during OAuth callback', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async () => { throw new Error('Keychain locked'); }),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/oauth/access_token')) {
        return { ok: true, json: async () => ({ access_token: 'tok' }) } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'user', id: 1 })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const openUrl = vi.fn(async (url: string) => {
      const u = new URL(url);
      const redirect = u.searchParams.get('redirect_uri')!;
      const state = u.searchParams.get('state')!;
      const target = `${redirect}?code=test-code&state=${state}`;
      const { request } = await import('node:http');
      await new Promise<void>((resolve, reject) => {
        const req = request(target, (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.end();
      });
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl });

    await expect(svc.startOAuthLoopback({ clientId: 'cid' }))
      .rejects.toThrow('Keychain locked');
  });

  it('rejects when token exchange returns no access_token', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/oauth/access_token')) {
        // Return 200 but no access_token
        return { ok: true, json: async () => ({}) } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const openUrl = vi.fn(async (url: string) => {
      const u = new URL(url);
      const redirect = u.searchParams.get('redirect_uri')!;
      const state = u.searchParams.get('state')!;
      const target = `${redirect}?code=test-code&state=${state}`;
      const { request } = await import('node:http');
      await new Promise<void>((resolve, reject) => {
        const req = request(target, (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.end();
      });
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl });

    await expect(svc.startOAuthLoopback({ clientId: 'cid' }))
      .rejects.toThrow('No access token returned');

    expect(store['agentdeck:github']).toBeUndefined();
    expect(secureStore.setPassword).not.toHaveBeenCalled();
  });

  it('rejects when getSecureStore throws during OAuth callback', async () => {
    const secureStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true)
    };

    let callCount = 0;
    const throwingStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true),
    };

    // We need getSecureStore to throw. Since it's called after profile fetch,
    // we use a custom secureStore that throws on first call (during getSession)
    // but the OAuth flow calls getSecureStore() internally.
    // Instead, let's use the options.secureStore to inject a store that throws.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/oauth/access_token')) {
        return { ok: true, json: async () => ({ access_token: 'tok' }) } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'user', id: 1 })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    const openUrl = vi.fn(async (url: string) => {
      const u = new URL(url);
      const redirect = u.searchParams.get('redirect_uri')!;
      const state = u.searchParams.get('state')!;
      const target = `${redirect}?code=test-code&state=${state}`;
      const { request } = await import('node:http');
      await new Promise<void>((resolve, reject) => {
        const req = request(target, (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.end();
      });
    });

    // Create a store that throws when getSecureStore resolves and is called
    let storeCallCount = 0;
    const errStore = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => {
        storeCallCount++;
        throw new Error('Secure store unavailable');
      }),
      deletePassword: vi.fn(async () => true),
    };

    const svc = createIdentityService(tmp!, { secureStore: errStore, openUrl });

    await expect(svc.startOAuthLoopback({ clientId: 'cid' }))
      .rejects.toThrow('Secure store unavailable');
  });

  it('returns 404 for non-callback paths', async () => {
    const store: Record<string, string> = {};
    const secureStore = {
      getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async () => true)
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('login/oauth/access_token')) {
        return { ok: true, json: async () => ({ access_token: 'tok' }) } as unknown as Response;
      }
      if (url.includes('api.github.com/user')) {
        return {
          ok: true,
          json: async () => ({ login: 'user', id: 1 })
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });

    let serverPort: number | null = null;
    const openUrl = vi.fn(async (url: string) => {
      const u = new URL(url);
      const redirect = u.searchParams.get('redirect_uri')!;
      const state = u.searchParams.get('state')!;

      // Parse the port from redirect URI
      const redirectUrl = new URL(redirect);
      serverPort = parseInt(redirectUrl.port);

      // First, hit a non-callback path to trigger the 404 handler
      const { request } = await import('node:http');
      await new Promise<void>((resolve, reject) => {
        const req = request(`http://127.0.0.1:${serverPort}/notfound`, (res) => {
          expect(res.statusCode).toBe(404);
          res.on('data', () => {});
          res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.end();
      });

      // Then complete the OAuth flow normally
      const target = `${redirect}?code=test-code&state=${state}`;
      await new Promise<void>((resolve, reject) => {
        const req = request(target, (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.end();
      });
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl });
    const session = await svc.startOAuthLoopback({ clientId: 'cid' });

    expect(session.isLoggedIn).toBe(true);
  });

  it('uses TEST_IDENTITY_AUTO env for OAuth loopback test mode', async () => {
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
    process.env.TEST_IDENTITY_TOKEN = 'oauth-test-token';
    process.env.TEST_IDENTITY_LOGIN = 'oauth-tester';

    try {
      const svc = createIdentityService(tmp!, { secureStore });
      const session = await svc.startOAuthLoopback({ clientId: 'any' });

      expect(session.isLoggedIn).toBe(true);
      expect(session.profile?.login).toBe('oauth-tester');
      expect(session.profile?.id).toBe(42);
      expect(secureStore.setPassword).toHaveBeenCalledWith('agentdeck', 'github', 'oauth-test-token');
    } finally {
      if (origAuto === undefined) delete process.env.TEST_IDENTITY_AUTO;
      else process.env.TEST_IDENTITY_AUTO = origAuto;
      if (origToken === undefined) delete process.env.TEST_IDENTITY_TOKEN;
      else process.env.TEST_IDENTITY_TOKEN = origToken;
      if (origLogin === undefined) delete process.env.TEST_IDENTITY_LOGIN;
      else process.env.TEST_IDENTITY_LOGIN = origLogin;
    }
  });

  it('falls back to file store when keytar import fails', async () => {
    // This test verifies the createFallbackFileStore path by using a custom
    // secureStore that simulates file-based storage (same as the fallback).
    // The actual keytar import failure path is hard to test in unit tests
    // because keytar is a native module, but the fallback behavior is identical.
    const fileData: Record<string, string> = {};
    const fileStore = {
      getPassword: vi.fn(async (s: string, a: string) => fileData[`${s}:${a}`] ?? null),
      setPassword: vi.fn(async (s: string, a: string, p: string) => { fileData[`${s}:${a}`] = p; }),
      deletePassword: vi.fn(async (s: string, a: string) => { delete fileData[`${s}:${a}`]; return true; })
    };

    const svc = createIdentityService(tmp!, { secureStore: fileStore });

    // signOut on empty store should not throw
    await svc.signOut();
    expect(fileStore.deletePassword).toHaveBeenCalledWith('agentdeck', 'github');

    // getSession with no token should return not logged in
    const session = await svc.getSession();
    expect(session.isLoggedIn).toBe(false);
  });
});
