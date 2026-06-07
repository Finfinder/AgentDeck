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

test('device flow in test-mode returns session to renderer', async () => {
  // Trigger device flow via preload
  const sess = await page.evaluate(() => (window as any).agentDeck.startOAuth({ method: 'device' }));
  expect(sess.isLoggedIn).toBe(true);
  expect(sess.profile?.login).toBe('playwright-octo');

  const current = await page.evaluate(() => (window as any).agentDeck.getIdentitySession());
  expect(current.isLoggedIn).toBe(true);
  expect(current.profile?.login).toBe('playwright-octo');
});
