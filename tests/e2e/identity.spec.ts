import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

let app: ElectronApplication;
let page: Page;
let tempDir: string;

test.beforeAll(async () => {
  tempDir = join(tmpdir(), `agentdeck-e2e-id-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  await writeFile(join(tempDir, 'package.json'), '{"name":"e2e"}', 'utf8');
});

test.beforeEach(async () => {
  app = await electron.launch({
    args: [join(rootDir, '../../out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test', TEST_IDENTITY_AUTO: '1', TEST_IDENTITY_LOGIN: 'playwright-octo', TEST_WORKSPACE_PATH: tempDir }
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await app.close();
});

test.afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test('identity preload API is available and returns valid session shape', async () => {
  // Verify getIdentitySession returns a valid session shape
  const session = await page.evaluate(() => (globalThis as { agentDeck: { getIdentitySession: () => Promise<unknown> } }).agentDeck.getIdentitySession()) as { isLoggedIn: boolean };
  expect(session).toBeDefined();
  expect(typeof session.isLoggedIn).toBe('boolean');

  // Verify startOAuth is callable (returns a promise that resolves to a session shape)
  const result = await page.evaluate(async () => {
    try {
      const s = await (globalThis as { agentDeck: { startOAuth: (opts: unknown) => Promise<unknown> } }).agentDeck.startOAuth({ method: 'device' }) as { isLoggedIn: boolean };
      return { ok: true, isLoggedIn: s?.isLoggedIn };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
  expect(result.ok).toBe(true);
  expect(typeof result.isLoggedIn).toBe('boolean');
});

test('signOut returns not-logged-in session shape', async () => {
  // Verify signOut is callable and returns a valid session shape
  const result = await page.evaluate(async () => {
    try {
      const s = await (globalThis as { agentDeck: { signOut: () => Promise<unknown> } }).agentDeck.signOut() as { isLoggedIn: boolean };
      return { ok: true, isLoggedIn: s?.isLoggedIn };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
  expect(result.ok).toBe(true);
  expect(result.isLoggedIn).toBe(false);
});

test('session shape is valid after signOut', async () => {
  // Sign out first
  await page.evaluate(() => (globalThis as { agentDeck: { signOut: () => Promise<unknown> } }).agentDeck.signOut());

  // Verify getIdentitySession returns a valid session shape after signOut
  const afterLogoutSession = await page.evaluate(() => (globalThis as { agentDeck: { getIdentitySession: () => Promise<unknown> } }).agentDeck.getIdentitySession()) as { isLoggedIn: boolean };
  expect(afterLogoutSession).toBeDefined();
  expect(typeof afterLogoutSession.isLoggedIn).toBe('boolean');
  // After signOut, should be not logged in
  expect(afterLogoutSession.isLoggedIn).toBe(false);
});
