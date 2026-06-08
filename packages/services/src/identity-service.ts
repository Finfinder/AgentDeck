import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { writeFile, readFile, mkdir, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { IdentitySession } from '@agentdeck/shared';

function buildProfile(profile: Record<string, unknown>): NonNullable<IdentitySession['profile']> {
  const login = profile.login;
  if (typeof login !== 'string') throw new Error('Missing login in GitHub profile');
  const result: Record<string, unknown> = { login };
  if (profile.id != null) result.id = profile.id;
  if (profile.avatar_url != null) result.avatar_url = profile.avatar_url;
  if (profile.name != null) result.name = profile.name;
  if (profile.email != null) result.email = profile.email;
  return result as NonNullable<IdentitySession['profile']>;
}

export type GithubProfile = Readonly<{
  login: string;
  id?: number;
  avatar_url?: string;
  name?: string;
  email?: string | null;
}>;

export type SecureStore = Readonly<{
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}>;

function defaultOpenUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    const escaped = url.replaceAll('"', String.raw`\"`);
    let cmd: string;
    if (platform === 'win32') {
      cmd = String.raw`start "" "${escaped}"`;
    } else if (platform === 'darwin') {
      cmd = String.raw`open "${escaped}"`;
    } else {
      cmd = String.raw`xdg-open "${escaped}"`;
    }

    exec(cmd, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export type SecureStoreWarning = Readonly<{
  type: 'FALLBACK_FILE_STORE';
  reason: string;
  path: string;
}>;

async function createDefaultSecureStore(
  userDataPath: string,
  onFallbackWarning?: (warning: SecureStoreWarning) => void
): Promise<SecureStore> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const keytarModule = await import('keytar');
    // Handle ESM/CJS interop: keytar may be in .default
    const keytar = keytarModule.default ?? keytarModule;
    if (keytar && typeof keytar.getPassword === 'function' && typeof keytar.setPassword === 'function') {
      return {
        getPassword: (s, a) => keytar.getPassword(s, a),
        setPassword: (s, a, p) => keytar.setPassword(s, a, p),
        deletePassword: (s, a) => keytar.deletePassword(s, a)
      };
    }
  } catch (err) {
    // keytar failed to load — log diagnostic info for troubleshooting
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      '[IdentityService] Secure storage (keytar) unavailable:',
      reason,
      '— falling back to file store in',
      userDataPath
    );
  }

  const warning: SecureStoreWarning = {
    type: 'FALLBACK_FILE_STORE',
    reason: 'keytar not available',
    path: userDataPath
  };
  onFallbackWarning?.(warning);

  return createFallbackFileStore(userDataPath);
}

async function createFallbackFileStore(userDataPath: string): Promise<SecureStore> {
  const file = join(userDataPath, '.secure_store.json');

  async function read(): Promise<Record<string, string>> {
    try {
      const data = await readFile(file, 'utf8');
      return JSON.parse(data) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async function write(data: Record<string, string>) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    await chmod(file, 0o600); // ensure permissions even if file already exists
  }

  return {
    async getPassword(service, account) {
      const data = await read();
      return data[`${service}:${account}`] ?? null;
    },
    async setPassword(service, account, password) {
      const data = await read();
      data[`${service}:${account}`] = password;
      await write(data);
    },
    async deletePassword(service, account) {
      const data = await read();
      delete data[`${service}:${account}`];
      await write(data);
      return true;
    }
  };
}

export type IdentityServiceOptions = Readonly<{
  openUrl?: (url: string) => Promise<void>;
  secureStore?: SecureStore;
  onFallbackWarning?: (warning: SecureStoreWarning) => void;
}>;

export class IdentityService {
  private secureStorePromise?: Promise<SecureStore>;

  constructor(private readonly userDataPath: string, private readonly options?: IdentityServiceOptions) {}

  private async getSecureStore(): Promise<SecureStore> {
    if (!this.secureStorePromise) {
      const store = this.options?.secureStore;
      this.secureStorePromise = store
        ? Promise.resolve(store)
        : createDefaultSecureStore(this.userDataPath, this.options?.onFallbackWarning);
    }
    return this.secureStorePromise;
  }

  private async openUrl(url: string) {
    if (this.options?.openUrl) return this.options.openUrl(url);
    return defaultOpenUrl(url);
  }

  async getSession(): Promise<IdentitySession> {
    const store = await this.getSecureStore();
    const token = await store.getPassword('agentdeck', 'github');
    if (!token) return { isLoggedIn: false };

    try {
      const profileResp = await globalThis.fetch('https://api.github.com/user', { headers: { Authorization: `token ${token}`, Accept: 'application/json' } });
      if (!profileResp.ok) return { isLoggedIn: false };
      const profile = await profileResp.json() as Record<string, unknown>;
      return { isLoggedIn: true, provider: 'github', profile: buildProfile(profile) };
    } catch {
      return { isLoggedIn: false };
    }
  }

  async signOut(): Promise<void> {
    const store = await this.getSecureStore();
    await store.deletePassword('agentdeck', 'github');
  }

  async startOAuthLoopback(params: { clientId: string; clientSecret?: string; scopes?: string[]; timeoutMs?: number }): Promise<IdentitySession> {
    const { clientId, clientSecret, scopes = ['read:user', 'user:email'], timeoutMs = 2 * 60 * 1000 } = params;

    // Test mode: shortcut for E2E tests
    if (process.env.TEST_IDENTITY_AUTO === '1') {
      const store = await this.getSecureStore();
      const token = process.env.TEST_IDENTITY_TOKEN ?? 'test-token';
      await store.setPassword('agentdeck', 'github', token);
      return { isLoggedIn: true, provider: 'github', profile: { login: process.env.TEST_IDENTITY_LOGIN ?? 'e2e-octo', id: 42 } };
    }

    const state = randomBytes(12).toString('hex');

    return new Promise<IdentitySession>((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          const address = server.address() as { port: number } | null;
          const url = new URL(req.url ?? '', `http://127.0.0.1:${address?.port ?? 0}`);
          if (url.pathname !== '/callback') {
            res.writeHead(404);
            res.end('Not found');
            return;
          }

          const code = url.searchParams.get('code');
          const incomingState = url.searchParams.get('state');
          if (!code || incomingState !== state) {
            res.writeHead(400);
            res.end('Invalid request');
            reject(new Error('Invalid OAuth callback'));
            server.close();
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><h1>You may now return to AgentDeck.</h1></body></html>');

          // Exchange code for token
          const tokenResp = await globalThis.fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
          });

          if (!tokenResp.ok) {
            reject(new Error('Failed to exchange code'));
            server.close();
            return;
          }

          const tokenJson = await tokenResp.json() as Record<string, unknown>;
          const accessToken = tokenJson.access_token as string | undefined;
          if (!accessToken) {
            reject(new Error('No access token returned'));
            server.close();
            return;
          }

          // Fetch profile BEFORE storing token -- only persist token if profile is valid
          const profileResp = await globalThis.fetch('https://api.github.com/user', { headers: { Authorization: `token ${accessToken}`, Accept: 'application/json' } });
          if (!profileResp.ok) {
            reject(new Error('Failed to fetch GitHub profile'));
            server.close();
            return;
          }
          const profile = await profileResp.json() as Record<string, unknown>;

          const session: IdentitySession = { isLoggedIn: true, provider: 'github', profile: buildProfile(profile) };

          // Store token only after profile fetch succeeds
          const store = await this.getSecureStore();
          await store.setPassword('agentdeck', 'github', accessToken);
          resolve(session);
        } catch (err) {
          reject(err);
          server.close();
        }
      });

      server.listen(0, '127.0.0.1', async () => {
        const address = server.address() as { port: number } | null;
        const port = address!.port;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes.join(' '))}&state=${encodeURIComponent(state)}`;

        // Open system browser
        try {
          await this.openUrl(authUrl);
        } catch (err) {
          server.close();
          reject(err);
          return;
        }
      });

      const timer = setTimeout(() => {
        try {
          server.close();
        } catch {
          // server already closed
        }
        reject(new Error('OAuth flow timed out'));
      }, timeoutMs);

      // Ensure timer cleared on resolution -- replace resolve/reject with wrapped versions
      // that clear the timeout timer before calling the original
      const originalResolve = resolve;
      const originalReject = reject;
      // Wrap resolve/reject to clear the timeout timer before calling the original
      resolve = ((value: IdentitySession) => {
        clearTimeout(timer);
        originalResolve(value);
      }) as typeof resolve;
      reject = ((err: unknown) => {
        clearTimeout(timer);
        originalReject(err);
      }) as typeof reject;
    });
  }

  async startDeviceFlow(params: { 
    clientId: string; 
    scopes?: string[]; 
    timeoutMs?: number; 
    intervalMs?: number;
    onDeviceCode?: (userCode: string, verificationUri: string, verificationUriComplete?: string) => void 
  }): Promise<IdentitySession> {
    const { clientId, scopes = ['read:user', 'user:email'], timeoutMs = 2 * 60 * 1000, onDeviceCode } = params;

    if (process.env.TEST_IDENTITY_AUTO === '1') {
      return this.createTestSession();
    }

    const { deviceCode, userCode, verificationUri, verificationUriComplete, pollInterval } =
      await this.initiateDeviceCode(clientId, scopes);

    // Notify UI about the device code BEFORE opening browser
    if (onDeviceCode) {
      onDeviceCode(userCode, verificationUri, verificationUriComplete);
    }

    await this.openVerificationUrl(verificationUri, verificationUriComplete, userCode);

    return this.pollForDeviceToken(clientId, deviceCode, pollInterval, timeoutMs);
  }

  private async createTestSession(): Promise<IdentitySession> {
    const store = await this.getSecureStore();
    const token = process.env.TEST_IDENTITY_TOKEN ?? 'test-device-token';
    await store.setPassword('agentdeck', 'github', token);
    return { isLoggedIn: true, provider: 'github', profile: { login: process.env.TEST_IDENTITY_LOGIN ?? 'e2e-octo', id: 99 } };
  }

  private async initiateDeviceCode(clientId: string, scopes: string[]) {
    const resp = await globalThis.fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, scope: scopes.join(' ') })
    });
    if (!resp.ok) throw new Error('Failed to start device flow');
    const json = await resp.json() as Record<string, unknown>;
    return {
      deviceCode: json.device_code as string,
      userCode: json.user_code as string,
      verificationUri: json.verification_uri as string,
      verificationUriComplete: json.verification_uri_complete as string | undefined,
      pollInterval: ((json.interval as number) ?? 5) * 1000
    };
  }

  private async openVerificationUrl(verificationUri: string, verificationUriComplete: string | undefined, userCode: string) {
    const target = verificationUriComplete ?? verificationUri;
    const url = verificationUriComplete ? target : `${target}?user_code=${encodeURIComponent(userCode)}`;
    try {
      await this.openUrl(url);
    } catch {
      // Opening browser is best-effort; continue with polling
    }
  }

  private async pollForDeviceToken(clientId: string, deviceCode: string, pollInterval: number, timeoutMs: number): Promise<IdentitySession> {
    const start = Date.now();
    let interval = pollInterval;
    while (Date.now() - start < timeoutMs) {
      const result = await this.fetchDeviceToken(clientId, deviceCode);
      if (result.kind === 'success') return result.session;
      if (result.kind === 'slow_down') { interval += 5000; }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error('Device flow timed out');
  }

  private async fetchDeviceToken(clientId: string, deviceCode: string): Promise<{ kind: 'success'; session: IdentitySession } | { kind: 'pending' } | { kind: 'slow_down' }> {
    const resp = await globalThis.fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
    });
    
    // Parse error response even for HTTP errors (GitHub returns 400 for authorization_pending, etc.)
    let json: Record<string, unknown>;
    try {
      json = await resp.json() as Record<string, unknown>;
    } catch {
      // Non-JSON response (e.g. 502 HTML) -- treat as transient error
      return { kind: 'pending' };
    }

    if (!resp.ok) {
      return this.handleDeviceTokenError(json);
    }

    if (json.access_token) {
      return this.handleDeviceTokenSuccess(json);
    }

    return this.handleDeviceTokenError(json);
  }

  private handleDeviceTokenError(json: Record<string, unknown>): { kind: 'pending' } | { kind: 'slow_down' } {
    const errorCode = json.error as string | undefined;
    if (errorCode === 'authorization_pending') return { kind: 'pending' };
    if (errorCode === 'slow_down') return { kind: 'slow_down' };
    if (errorCode === 'access_denied') throw new Error('User denied device authorization');
    if (errorCode === 'expired_token') throw new Error('Device flow expired');
    if (errorCode === 'unsupported_grant_type') throw new Error('Device flow configuration error');
    if (errorCode === 'incorrect_client_credentials') throw new Error('Device flow configuration error');
    if (errorCode === 'incorrect_device_code') throw new Error('Device flow invalid code');
    // For any other unexpected error, include the code for debugging but keep message generic
    throw new Error(`Device flow failed: ${errorCode ?? 'unknown error'}`);
  }

  private async handleDeviceTokenSuccess(json: Record<string, unknown>): Promise<{ kind: 'success'; session: IdentitySession }> {
    const accessToken = json.access_token as string;
    // Fetch profile BEFORE storing token -- only persist token if profile is valid
    const profileResp = await globalThis.fetch('https://api.github.com/user', { headers: { Authorization: `token ${accessToken}`, Accept: 'application/json' } });
    if (!profileResp.ok) {
      throw new Error('Failed to fetch GitHub profile');
    }
    const profile = await profileResp.json() as Record<string, unknown>;
    const session: IdentitySession = { isLoggedIn: true, provider: 'github', profile: buildProfile(profile) };
    // Store token only after profile fetch succeeds
    const store = await this.getSecureStore();
    await store.setPassword('agentdeck', 'github', accessToken);
    return { kind: 'success', session };
  }
}

export function createIdentityService(userDataPath: string, opts?: IdentityServiceOptions): IdentityService {
  return new IdentityService(userDataPath, opts);
}


