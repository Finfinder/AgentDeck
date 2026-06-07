import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { exec } from 'node:child_process';

export type GithubProfile = Readonly<{
  login: string;
  id?: number;
  avatar_url?: string;
  name?: string;
  email?: string | null;
}>;

export type IdentitySession = Readonly<{
  isLoggedIn: boolean;
  provider?: 'github';
  profile?: GithubProfile;
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

async function createFallbackFileStore(userDataPath: string): Promise<SecureStore> {
  const file = join(userDataPath, '.secure_store.json');
  await mkdir(dirname(file), { recursive: true });

  async function read(): Promise<Record<string, string>> {
    try {
      const data = await readFile(file, 'utf8');
      return JSON.parse(data) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async function write(data: Record<string, string>) {
    await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
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

async function createDefaultSecureStore(userDataPath: string): Promise<SecureStore> {
  try {
    // Try to load keytar if available (preferred secure storage)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const keytar = await import('keytar');
    if (keytar && typeof keytar.getPassword === 'function') {
      return {
        getPassword: (s, a) => keytar.getPassword(s, a),
        setPassword: (s, a, p) => keytar.setPassword(s, a, p),
        deletePassword: (s, a) => keytar.deletePassword(s, a)
      };
    }
  } catch {
    // fallback to file-based store
  }

  return createFallbackFileStore(userDataPath);
}

export class IdentityService {
  private secureStorePromise?: Promise<SecureStore>;

  constructor(private readonly userDataPath: string, private readonly options?: { openUrl?: (url: string) => Promise<void>; secureStore?: SecureStore }) {}

  private async getSecureStore(): Promise<SecureStore> {
    if (!this.secureStorePromise) {
      const store = this.options?.secureStore;
      this.secureStorePromise = store ? Promise.resolve(store) : createDefaultSecureStore(this.userDataPath);
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
      const profileResp = await (globalThis as any).fetch('https://api.github.com/user', { headers: { Authorization: `token ${token}`, Accept: 'application/json' } });
      if (!profileResp.ok) return { isLoggedIn: false };
      const profile = await profileResp.json();
      return { isLoggedIn: true, provider: 'github', profile: { login: profile.login, id: profile.id, avatar_url: profile.avatar_url, name: profile.name, email: profile.email } };
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
          const url = new URL(req.url ?? '', `http://127.0.0.1:${(server.address() as any)?.port ?? 0}`);
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
          try {
            const tokenResp = await (globalThis as any).fetch('https://github.com/login/oauth/access_token', {
              method: 'POST',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
            });

            if (!tokenResp.ok) {
              reject(new Error('Failed to exchange code'));
              server.close();
              return;
            }

            const tokenJson = await tokenResp.json();
            const accessToken = tokenJson.access_token as string | undefined;
            if (!accessToken) {
              reject(new Error('No access token returned'));
              server.close();
              return;
            }

            const store = await this.getSecureStore();
            await store.setPassword('agentdeck', 'github', accessToken);

            // Fetch profile
            const profileResp = await (globalThis as any).fetch('https://api.github.com/user', { headers: { Authorization: `token ${accessToken}`, Accept: 'application/json' } });
            const profile = await profileResp.json();

            resolve({ isLoggedIn: true, provider: 'github', profile: { login: profile.login, id: profile.id, avatar_url: profile.avatar_url, name: profile.name, email: profile.email } });
          } catch (err) {
            reject(err);
          } finally {
            server.close();
          }
        } catch (err) {
          reject(err);
          server.close();
        }
      });

      server.listen(0, '127.0.0.1', async () => {
        const port = (server.address() as any).port as number;
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
        } catch {}
        reject(new Error('OAuth flow timed out'));
      }, timeoutMs);

      // Ensure timer cleared on resolution
      const origResolve = resolve;
      const origReject = reject;
      (resolve as any) = (value: IdentitySession) => {
        clearTimeout(timer);
        origResolve(value);
      };
      (reject as any) = (err: any) => {
        clearTimeout(timer);
        origReject(err);
      };
    });
  }

  async startDeviceFlow(params: { clientId: string; scopes?: string[]; timeoutMs?: number; intervalMs?: number }): Promise<IdentitySession> {
    const { clientId, scopes = ['read:user', 'user:email'], timeoutMs = 2 * 60 * 1000 } = params;

    if (process.env.TEST_IDENTITY_AUTO === '1') {
      return this.createTestSession();
    }

    const { deviceCode, userCode, verificationUri, verificationUriComplete, pollInterval } =
      await this.initiateDeviceCode(clientId, scopes);

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
    const resp = await (globalThis as any).fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, scope: scopes.join(' ') })
    });
    if (!resp.ok) throw new Error('Failed to start device flow');
    const json = await resp.json();
    return {
      deviceCode: json.device_code as string,
      userCode: json.user_code as string,
      verificationUri: json.verification_uri as string,
      verificationUriComplete: json.verification_uri_complete as string | undefined,
      pollInterval: (json.interval ?? 5) * 1000
    };
  }

  private async openVerificationUrl(verificationUri: string, verificationUriComplete: string | undefined, userCode: string) {
    const target = verificationUriComplete ?? verificationUri;
    const url = verificationUriComplete ? target : `${target}?user_code=${encodeURIComponent(userCode)}`;
    try {
      await this.openUrl(url);
    } catch {
      // Opening browser is best-effort
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
    const resp = await (globalThis as any).fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
    });
    if (!resp.ok) throw new Error('Device flow token request failed');
    const json = await resp.json();
    if (json.access_token) {
      const accessToken = json.access_token as string;
      const store = await this.getSecureStore();
      await store.setPassword('agentdeck', 'github', accessToken);
      const profileResp = await (globalThis as any).fetch('https://api.github.com/user', { headers: { Authorization: `token ${accessToken}`, Accept: 'application/json' } });
      const profile = await profileResp.json();
      return { kind: 'success', session: { isLoggedIn: true, provider: 'github', profile: { login: profile.login, id: profile.id, avatar_url: profile.avatar_url, name: profile.name, email: profile.email } } };
    }
    if (json.error === 'authorization_pending') return { kind: 'pending' };
    if (json.error === 'slow_down') return { kind: 'slow_down' };
    if (json.error === 'access_denied') throw new Error('User denied device authorization');
    if (json.error === 'expired_token') throw new Error('Device flow expired');
    throw new Error(`Device flow error: ${json.error}`);
  }
}

export function createIdentityService(userDataPath: string, opts?: { openUrl?: (url: string) => Promise<void>; secureStore?: SecureStore }) {
  return new IdentityService(userDataPath, opts);
}

export default IdentityService;
