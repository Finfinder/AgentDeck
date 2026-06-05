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
  tempDir = join(tmpdir(), `agentdeck-e2e-problems-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  await mkdir(join(tempDir, 'src'), { recursive: true });
  await writeFile(join(tempDir, 'src', 'app.ts'), 'const x: number = "hello";\n', 'utf8');
  await writeFile(join(tempDir, 'src', 'utils.ts'), 'let unused = 42;\n', 'utf8');
  await writeFile(join(tempDir, 'package.json'), '{"name": "test"}', 'utf8');
});

test.beforeEach(async () => {
  app = await electron.launch({
    args: [join(rootDir, '../../out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test', TEST_WORKSPACE_PATH: tempDir },
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

test.describe('Problems Panel — rendering', () => {
  test.beforeEach(async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    // Status bar shows workspace name after opening; .workspace-path only exists when closed
    await expect(page.locator('output[aria-label="Workspace status"]')).toContainText('opened', { timeout: 15000 });
  });

  test('should render Problems tab in bottom panel', async () => {
    await expect(page.getByRole('tab', { name: 'Problems' })).toBeVisible();
  });

  test('should show Problems panel by default', async () => {
    const problemsRegion = page.getByRole('region', { name: 'Problems' });
    await expect(problemsRegion).toBeVisible();
  });

  test('should show "No problems detected" when diagnostics are empty', async () => {
    await expect(page.getByText('No problems detected.')).toBeVisible({ timeout: 10000 });
  });

  test('should render severity count header', async () => {
    await expect(page.getByLabel('0 errors')).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('0 warnings')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Problems Panel — tab switching', () => {
  test('should switch to Services tab', async () => {
    await page.getByRole('tab', { name: 'Services' }).click();
    await expect(page.getByRole('status', { name: 'Startup state' })).toBeVisible();
  });

  test('should switch to Output tab', async () => {
    await page.getByRole('tab', { name: 'Output' }).click();
    await expect(page.getByText('No output.')).toBeVisible();
  });

  test('should switch back to Problems tab', async () => {
    await page.getByRole('tab', { name: 'Services' }).click();
    await expect(page.getByRole('status', { name: 'Startup state' })).toBeVisible();

    await page.getByRole('tab', { name: 'Problems' }).click();
    await expect(page.getByRole('region', { name: 'Problems' })).toBeVisible();
  });
});

test.describe('Problems Panel — with diagnostics', () => {
  test.beforeEach(async () => {
    // Relaunch with mock that returns diagnostics
    await app.close();
    app = await electron.launch({
      args: [join(rootDir, '../../out/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_WORKSPACE_PATH: tempDir,
        TEST_MOCK_DIAGNOSTICS: JSON.stringify([
          {
            filePath: join(tempDir, 'src', 'app.ts'),
            message: "Type 'string' is not assignable to type 'number'.",
            severity: 'error',
            line: 1,
            col: 7,
            source: 'ts'
          },
          {
            filePath: join(tempDir, 'src', 'utils.ts'),
            message: "'unused' is declared but never used.",
            severity: 'warning',
            line: 1,
            col: 5,
            source: 'eslint'
          }
        ])
      },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // Open workspace so bottom-panel is fully interactive
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    // Status bar shows workspace name after opening; .workspace-path only exists when closed
    await expect(page.locator('output[aria-label="Workspace status"]')).toContainText('opened', { timeout: 15000 });
  });

  test('should render diagnostics list', async () => {
    await expect(page.getByText("Type 'string' is not assignable to type 'number'.")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("'unused' is declared but never used.")).toBeVisible();
  });

  test('should display correct severity counts', async () => {
    await expect(page.getByLabel('1 errors')).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('1 warnings')).toBeVisible();
  });

  test('should show file name and line:col for each diagnostic', async () => {
    await expect(page.locator('.problems-group-path').filter({ hasText: 'app.ts' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.problems-location').filter({ hasText: '1:7' })).toBeVisible();
    await expect(page.locator('.problems-group-path').filter({ hasText: 'utils.ts' })).toBeVisible();
    await expect(page.locator('.problems-location').filter({ hasText: '1:5' })).toBeVisible();
  });
});

test.describe('Problems Panel — navigation to editor', () => {
  test.beforeEach(async () => {
    await app.close();
    app = await electron.launch({
      args: [join(rootDir, '../../out/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_WORKSPACE_PATH: tempDir,
        TEST_MOCK_DIAGNOSTICS: JSON.stringify([
          {
            filePath: join(tempDir, 'src', 'app.ts'),
            message: "Type 'string' is not assignable to type 'number'.",
            severity: 'error',
            line: 1,
            col: 7,
            source: 'ts'
          }
        ])
      },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // Open workspace so editor can open files
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    // Status bar shows workspace name after opening; .workspace-path only exists when closed
    await expect(page.locator('output[aria-label="Workspace status"]')).toContainText('opened', { timeout: 15000 });
  });

  test('should open editor tab when clicking a diagnostic', async () => {
    await expect(page.getByText("Type 'string' is not assignable to type 'number'.")).toBeVisible({ timeout: 10000 });

    await page.getByText("Type 'string' is not assignable to type 'number'.").click();

    await expect(page.locator('.editor-tab', { hasText: 'app.ts' })).toBeVisible({ timeout: 10000 });
  });
});
