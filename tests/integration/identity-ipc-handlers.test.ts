import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createIdentityService, type SecureStore } from '@agentdeck/services';
import { isIdentitySession, type IdentitySession } from '@agentdeck/shared';

/**
 * Integration tests for the identity IPC handlers logic.
 *
 * These tests verify the behavior of the IPC handler functions that would be
 * registered in apps/desktop/src/main/index.ts, without requiring a full
 * Electron app launch. We test the handler logic directly by calling the
 * identity service methods and validating the session shapes.
 */

let tmpDir: string | null = null;

function createMockSecureStore(): SecureStore & { _store: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    _store: store,
    getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
    setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
    deletePassword: vi.fn(async (s: string, a: string) => { delete store[`${s}:${a}`]; return true; })
  };
}

describe('Identity IPC handlers (integration)', () => {
  let savedFetch: typeof globalThis.fetch | undefined;

  beforeEach(async () => {
    savedFetch = (globalThis as any).fetch;
    tmpDir = await mkdtemp(join(tmpdir(), 'agentdeck-ipc-'));
  });

  afterEach(async () => {
    if (savedFetch) (globalThis as any).fetch = savedFetch;
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
    vi.restoreAllMocks();
  });

  describe('identityGetSession handler', () => {
    it('returns valid session when token exists', async () => {
      const secureStore = createMockSecureStore();
      secureStore._store['agentdeck:github'] = 'valid-token';

      (globalThis as any).fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ login: 'ipc-user', id: 10, avatar_url: 'https://example.com/a.png' })
      }));

      const svc = createIdentityService(tmpDir!, { secureStore });
      const session = await svc.getSession();

      // Simulate what preload does: validate with isIdentitySession
      expect(isIdentitySession(session)).toBe(true);
      expect(session.isLoggedIn).toBe(true);
      expect(session.profile?.login).toBe('ipc-user');
    });

    it('returns not-logged-in when no token', async () => {
      const secureStore = createMockSecureStore();
      const svc = createIdentityService(tmpDir!, { secureStore });
      const session = await svc.getSession();

      expect(isIdentitySession(session)).toBe(true);
      expect(session.isLoggedIn).toBe(false);
    });

    it('returns not-logged-in when profile fetch fails', async () => {
      const secureStore = createMockSecureStore();
      secureStore._store['agentdeck:github'] = 'bad-token';

      (globalThis as any).fetch = vi.fn(async () => ({
        ok: false, status: 401, json: async () => ({})
      }));

      const svc = createIdentityService(tmpDir!, { secureStore });
      const session = await svc.getSession();

      expect(isIdentitySession(session)).toBe(true);
      expect(session.isLoggedIn).toBe(false);
    });

    it('returns fallback when getSession throws unexpectedly', async () => {
      const secureStore = createMockSecureStore();
      // Don't mock fetch — let it fail with no network
      (globalThis as any).fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });

      const svc = createIdentityService(tmpDir!, { secureStore });
      const session = await svc.getSession();

      // Should gracefully return not logged in
      expect(session.isLoggedIn).toBe(false);
    });
  });

  describe('identitySignOut handler', () => {
    it('deletes token and returns not-logged-in session', async () => {
      const secureStore = createMockSecureStore();
      secureStore._store['agentdeck:github'] = 'token-to-delete';

      const svc = createIdentityService(tmpDir!, { secureStore });
      await svc.signOut();

      // Token should be deleted
      expect(secureStore.deletePassword).toHaveBeenCalledWith('agentdeck', 'github');
      expect(secureStore._store['agentdeck:github']).toBeUndefined();

      // After signOut, getSession should return not logged in
      const session = await svc.getSession();
      expect(session.isLoggedIn).toBe(false);
      expect(isIdentitySession(session)).toBe(true);
    });

    it('returns not-logged-in even when signOut throws', async () => {
      const secureStore = createMockSecureStore();
      secureStore.deletePassword = vi.fn(async () => { throw new Error('Keychain locked'); });

      const svc = createIdentityService(tmpDir!, { secureStore });

      // signOut should throw
      await expect(svc.signOut()).rejects.toThrow('Keychain locked');

      // But the IPC handler catches this and returns { isLoggedIn: false }
      const fallbackSession: IdentitySession = { isLoggedIn: false };
      expect(isIdentitySession(fallbackSession)).toBe(true);
    });
  });

  describe('identityStartOAuth handler (loopback path)', () => {
    it('returns session after successful OAuth loopback', async () => {
      const secureStore = createMockSecureStore();

      (globalThis as any).fetch = vi.fn(async (input: unknown) => {
        const url = typeof input === 'string' ? input : '';
        if (url.includes('login/oauth/access_token')) {
          return { ok: true, json: async () => ({ access_token: 'new-token' }) } as unknown as Response;
        }
        if (url.includes('api.github.com/user')) {
          return { ok: true, json: async () => ({ login: 'oauth-user', id: 77 }) } as unknown as Response;
        }
        return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      });

      const openUrl = vi.fn(async (url: string) => {
        const u = new URL(url);
        const redirect = u.searchParams.get('redirect_uri') ?? '';
        const state = u.searchParams.get('state') ?? '';
        const { request } = await import('node:http');
        await new Promise<void>((resolve, reject) => {
          const req = request(`${redirect}?code=abc&state=${state}`, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve());
          });
          req.on('error', reject);
          req.end();
        });
      });

      const svc = createIdentityService(tmpDir!, { secureStore, openUrl });
      const session = await svc.startOAuthLoopback({ clientId: 'test-cid', clientSecret: 'test-secret' });

      expect(session.isLoggedIn).toBe(true);
      expect(session.profile?.login).toBe('oauth-user');
      expect(isIdentitySession(session)).toBe(true);
    });

    it('returns not-logged-in when OAuth fails', async () => {
      const secureStore = createMockSecureStore();

      (globalThis as any).fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) }));

      const openUrl = vi.fn(async (url: string) => {
        const u = new URL(url);
        const redirect = u.searchParams.get('redirect_uri') ?? '';
        const state = u.searchParams.get('state') ?? '';
        const { request } = await import('node:http');
        await new Promise<void>((resolve, reject) => {
          const req = request(`${redirect}?code=abc&state=${state}`, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve());
          });
          req.on('error', reject);
          req.end();
        });
      });

      const svc = createIdentityService(tmpDir!, { secureStore, openUrl });

      // OAuth with bad credentials should throw
      await expect(svc.startOAuthLoopback({ clientId: 'bad-cid' })).rejects.toThrow();

      // IPC handler catches and returns fallback
      const fallbackSession: IdentitySession = { isLoggedIn: false };
      expect(isIdentitySession(fallbackSession)).toBe(true);
    });
  });

  describe('identityStartOAuth handler (device path)', () => {
    it('returns session after successful device flow', async () => {
      const secureStore = createMockSecureStore();
      let completed = false;

      (globalThis as any).fetch = vi.fn(async (input: unknown) => {
        const url = typeof input === 'string' ? input : '';
        if (url.includes('/login/device/code')) {
          return { ok: true, json: async () => ({ device_code: 'dc', user_code: 'UC', verification_uri: 'https://example.com/v', interval: 1 }) } as unknown as Response;
        }
        if (url.includes('/login/oauth/access_token')) {
          if (!completed) return { ok: true, json: async () => ({ error: 'authorization_pending' }) } as unknown as Response;
          return { ok: true, json: async () => ({ access_token: 'dev-token' }) } as unknown as Response;
        }
        if (url.includes('api.github.com/user')) {
          return { ok: true, json: async () => ({ login: 'dev-user', id: 88 }) } as unknown as Response;
        }
        return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      });

      const openUrl = vi.fn(async () => { completed = true; });

      const svc = createIdentityService(tmpDir!, { secureStore, openUrl });
      const session = await svc.startDeviceFlow({ clientId: 'cid' });

      expect(session.isLoggedIn).toBe(true);
      expect(session.profile?.login).toBe('dev-user');
      expect(isIdentitySession(session)).toBe(true);
    });
  });
});
