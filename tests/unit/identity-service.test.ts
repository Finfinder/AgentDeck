import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createIdentityService } from '@agentdeck/services';

let tmp: string | null = null;

describe('IdentityService (loopback OAuth)', () => {
  let savedFetch: typeof global.fetch | undefined;

  beforeEach(async () => {
    savedFetch = (globalThis as any).fetch;
    tmp = await mkdtemp(join(tmpdir(), 'agentdeck-identity-'));
  });

  afterEach(async () => {
    if (savedFetch) (globalThis as any).fetch = savedFetch;
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
      })
    };

    // Stub fetch for token exchange and profile
    (globalThis as any).fetch = vi.fn(async (input: unknown, init?: unknown) => {
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

      // simulate user completing auth by calling the redirect URL
      await fetch(`${redirect}?code=test-code&state=${state}`);
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
      deletePassword: vi.fn(async () => undefined)
    };

    (globalThis as any).fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response));

    const badOpen = vi.fn(async (url: string) => {
      const u = new URL(url);
      const redirect = u.searchParams.get('redirect_uri')!;
      // send wrong state
      await fetch(`${redirect}?code=whatever&state=BAD_STATE`);
    });

    const svc = createIdentityService(tmp!, { secureStore, openUrl: badOpen });

    await expect(svc.startOAuthLoopback({ clientId: 'cid' })).rejects.toThrow();
  });
});
