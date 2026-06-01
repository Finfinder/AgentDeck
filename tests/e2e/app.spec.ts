import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { stubDialog } from 'electron-playwright-helpers';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

let app: ElectronApplication;
let page: Page;
let tempDir: string;

test.beforeAll(async () => {
  tempDir = join(tmpdir(), `agentdeck-e2e-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  await mkdir(join(tempDir, 'src'), { recursive: true });
  await writeFile(join(tempDir, 'src', 'index.ts'), 'export const x = 1;', 'utf8');
  await writeFile(join(tempDir, 'package.json'), '{"name": "test"}', 'utf8');
  await writeFile(join(tempDir, 'README.md'), '# Test', 'utf8');
});

test.beforeEach(async () => {
  app = await electron.launch({
    args: [join(rootDir, '../../apps/desktop/src/main/index.ts')],
    env: { ...process.env, NODE_ENV: 'test' },
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

test.describe('App Launch', () => {
  test('should render workbench with all main regions', async () => {
    const root = page.locator('[role="main"]');
    await expect(root).toBeVisible();
    await expect(page.locator('.activity-bar')).toBeVisible();
    await expect(page.locator('.side-bar')).toBeVisible();
    await expect(page.locator('.editor-area')).toBeVisible();
  });

  test('should show Open Workspace and Open Folder buttons', async () => {
    await expect(page.getByRole('button', { name: /open workspace/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /open folder/i })).toBeVisible();
  });

  test('should have dark theme by default', async () => {
    await expect(page.locator('[role="main"]')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('Open Folder', () => {
  test('should open folder and display files in Explorer', async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });

    await page.getByRole('button', { name: /open folder/i }).click();

    await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });
    await expect(page.locator('.file-tree')).toBeVisible();
    await expect(page.locator('.file-tree-item', { hasText: 'src' })).toBeVisible();
  });

  test('should show cancelled status when dialog is cancelled', async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [],
      canceled: true,
    });

    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('.workspace-path')).toContainText('No workspace opened');
  });

  test('should enable Search tab after workspace is open', async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });

    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.getByRole('button', { name: /search/i })).toBeEnabled({ timeout: 15000 });
  });
});

test.describe('Explorer', () => {
  test.beforeEach(async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });
  });

  test('should display file tree with workspace contents', async () => {
    await expect(page.locator('.file-tree')).toBeVisible();
    await expect(page.locator('.file-tree-item', { hasText: 'src' })).toBeVisible();
    await expect(page.locator('.file-tree-item', { hasText: 'package.json' })).toBeVisible();
    await expect(page.locator('.file-tree-item', { hasText: 'README.md' })).toBeVisible();
  });

  test('should navigate into directory on click', async () => {
    await page.locator('.file-tree-item', { hasText: 'src' }).click();
    await expect(page.locator('.file-tree-item', { hasText: 'index.ts' })).toBeVisible();
  });

  test('should navigate up after entering subdirectory', async () => {
    await page.locator('.file-tree-item', { hasText: 'src' }).click();
    await expect(page.locator('.file-tree-item', { hasText: 'index.ts' })).toBeVisible();
    await page.locator('.explorer-breadcrumb-up').click();
    await expect(page.locator('.file-tree-item', { hasText: 'package.json' })).toBeVisible();
  });
});
