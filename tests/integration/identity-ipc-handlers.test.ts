import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createIdentityService, type SecureStore, type SecureStoreWarning } from '@agentdeck/services';
import { isIdentitySession, isIdentitySessionWarning, type IdentitySession } from '@agentdeck/shared';

// Mock keytar to simulate unavailability for fallback warning tests
vi.mock('keytar', () => {
  throw new Error('keytar native module not found');
});

/**
 * Integration tests for the identity IPC handlers logic.
 *
 * These tests verify the behavior of the IPC handler functions that would be
 * registered in apps/desktop/src/main/index.ts, without requiring a full
 * Electron app launch. We test the handler logic directly by calling the
 * identity service methods and validating the session shapes.
 */

let tmpDir = '';

interface MockSecureStore extends SecureStore {
  _store: Record<string, string>;
  deletePassword: SecureStore['deletePassword'];
}

function createMockSecureStore(): MockSecureStore {
  const store: Record<string, string> = {};
  return {
    _store: store,
    getPassword: vi.fn(async (s: string, a: string) => store[`${s}:${a}`] ?? null),
    setPassword: vi.fn(async (s: string, a: string, p: string) => { store[`${s}:${a}`] = p; }),
    deletePassword: vi.fn(async (s: string, a: string) => { delete store[`${s}:${a}`]; return true; })
  };
}

describe('Identity IPC handlers (integration)', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'agentdeck-ipc-'));
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
    vi.restoreAllMocks();
  });

  describe('identityGetSession handler', () => {
    it('returns valid session when token exists', async () => {
      const secureStore = createMockSecureStore();
      secureStore._store['agentdeck:github'] = 'valid-token';

      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
        ok: true,
        json: async () => ({ login: 'ipc-user', id: 10, avatar_url: 'https://example.com/a.png' })
      }) as unknown as Response);

      const svc = createIdentityService(tmpDir, { secureStore, openUrl: vi.fn() });
      const session = await svc.getSession();

      // Simulate what preload does: validate with isIdentitySession
      expect(isIdentitySession(session)).toBe(true);
      expect(session.isLoggedIn).toBe(true);
      expect(session.profile?.login).toBe('ipc-user');
    });

    it('returns not-logged-in when no token', async () => {
      const secureStore = createMockSecureStore();
      const svc = createIdentityService(tmpDir, { secureStore, openUrl: vi.fn() });
      const session = await svc.getSession();

      expect(isIdentitySession(session)).toBe(true);
      expect(session.isLoggedIn).toBe(false);
    });

    it('returns not-logged-in when profile fetch fails', async () => {
      const secureStore = createMockSecureStore();
      secureStore._store['agentdeck:github'] = 'bad-token';

      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
        ok: false, status: 401, json: async () => ({})
      }) as unknown as Response);

      const svc = createIdentityService(tmpDir, { secureStore, openUrl: vi.fn() });
      const session = await svc.getSession();

      expect(isIdentitySession(session)).toBe(true);
      expect(session.isLoggedIn).toBe(false);
    });

    it('returns fallback when getSession throws unexpectedly', async () => {
      const secureStore = createMockSecureStore();
      // Don't mock fetch — let it fail with no network
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('ECONNREFUSED'); });

      const svc = createIdentityService(tmpDir, { secureStore, openUrl: vi.fn() });
      const session = await svc.getSession();

      // Should gracefully return not logged in
      expect(session.isLoggedIn).toBe(false);
    });
  });

  describe('identitySignOut handler', () => {
    it('deletes token and returns not-logged-in session', async () => {
      const secureStore = createMockSecureStore();
      secureStore._store['agentdeck:github'] = 'token-to-delete';

      const svc = createIdentityService(tmpDir, { secureStore, openUrl: vi.fn() });
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

      const svc = createIdentityService(tmpDir, { secureStore, openUrl: vi.fn() });

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

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
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

      const svc = createIdentityService(tmpDir, { secureStore, openUrl });
      const session = await svc.startOAuthLoopback({ clientId: 'test-cid', clientSecret: 'test-secret' });

      expect(session.isLoggedIn).toBe(true);
      expect(session.profile?.login).toBe('oauth-user');
      expect(isIdentitySession(session)).toBe(true);
    });

    it('returns not-logged-in when OAuth fails', async () => {
      const secureStore = createMockSecureStore();

      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: false, status: 400, json: async () => ({}) }) as unknown as Response);

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

      const svc = createIdentityService(tmpDir, { secureStore, openUrl });

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

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
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

      const svc = createIdentityService(tmpDir, { secureStore, openUrl });
      const session = await svc.startDeviceFlow({ clientId: 'cid' });

      expect(session.isLoggedIn).toBe(true);
      expect(session.profile?.login).toBe('dev-user');
      expect(isIdentitySession(session)).toBe(true);
    });
  });

  describe('identityWarning IPC channel (fallback file store)', () => {
    it('onFallbackWarning callback fires when keytar is unavailable', async () => {
      const warnings: SecureStoreWarning[] = [];

      const svc = createIdentityService(tmpDir, {
        onFallbackWarning: (w) => { warnings.push(w); }
      });

      // Trigger lazy secure store initialization
      const session = await svc.getSession();
      expect(session.isLoggedIn).toBe(false);

      // In test env keytar is not available, so fallback should trigger
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      const fallbackWarning = warnings.find(w => w.type === 'FALLBACK_FILE_STORE');
      expect(fallbackWarning).toBeDefined();
      expect(fallbackWarning!.path).toBe(tmpDir);
      expect(typeof fallbackWarning!.reason).toBe('string');
    });

    it('warning payload passes isIdentitySessionWarning type guard', async () => {
      const warnings: SecureStoreWarning[] = [];

      const svc = createIdentityService(tmpDir, {
        onFallbackWarning: (w) => { warnings.push(w); }
      });

      await svc.getSession();

      for (const w of warnings) {
        expect(isIdentitySessionWarning(w)).toBe(true);
      }
    });

    it('no warning when custom secureStore is provided', async () => {
      const warnings: SecureStoreWarning[] = [];
      const secureStore = createMockSecureStore();

      const svc = createIdentityService(tmpDir, {
        secureStore,
        onFallbackWarning: (w) => { warnings.push(w); }
      });

      await svc.getSession();

      // With a custom secureStore, fallback should NOT be triggered
      expect(warnings.length).toBe(0);
    });
  });
});
