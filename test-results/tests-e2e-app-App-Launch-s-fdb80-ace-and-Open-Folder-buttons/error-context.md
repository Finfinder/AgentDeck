# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\e2e\app.spec.ts >> App Launch >> should show Open Workspace and Open Folder buttons
- Location: tests\e2e\app.spec.ts:50:3

# Error details

```
TimeoutError: electronApplication.firstWindow: Timeout 30000ms exceeded while waiting for event "window"
```

# Test source

```ts
  1   | import { test, expect, _electron as electron } from '@playwright/test';
  2   | import type { ElectronApplication, Page } from '@playwright/test';
  3   | import { stubDialog } from 'electron-playwright-helpers';
  4   | import { mkdir, writeFile, rm } from 'node:fs/promises';
  5   | import { tmpdir } from 'node:os';
  6   | import { join, dirname } from 'node:path';
  7   | import { fileURLToPath } from 'node:url';
  8   | 
  9   | const rootDir = dirname(fileURLToPath(import.meta.url));
  10  | 
  11  | let app: ElectronApplication;
  12  | let page: Page;
  13  | let tempDir: string;
  14  | 
  15  | test.beforeAll(async () => {
  16  |   tempDir = join(tmpdir(), `agentdeck-e2e-${Date.now()}`);
  17  |   await mkdir(tempDir, { recursive: true });
  18  |   await mkdir(join(tempDir, 'src'), { recursive: true });
  19  |   await writeFile(join(tempDir, 'src', 'index.ts'), 'export const x = 1;', 'utf8');
  20  |   await writeFile(join(tempDir, 'package.json'), '{"name": "test"}', 'utf8');
  21  |   await writeFile(join(tempDir, 'README.md'), '# Test', 'utf8');
  22  | });
  23  | 
  24  | test.beforeEach(async () => {
  25  |   app = await electron.launch({
  26  |     args: [join(rootDir, '../../apps/desktop/src/main/index.ts')],
  27  |     env: { ...process.env, NODE_ENV: 'test' },
  28  |   });
> 29  |   page = await app.firstWindow();
      |                    ^ TimeoutError: electronApplication.firstWindow: Timeout 30000ms exceeded while waiting for event "window"
  30  |   await page.waitForLoadState('domcontentloaded');
  31  | });
  32  | 
  33  | test.afterEach(async () => {
  34  |   await app.close();
  35  | });
  36  | 
  37  | test.afterAll(async () => {
  38  |   await rm(tempDir, { recursive: true, force: true });
  39  | });
  40  | 
  41  | test.describe('App Launch', () => {
  42  |   test('should render workbench with all main regions', async () => {
  43  |     const root = page.locator('[role="main"]');
  44  |     await expect(root).toBeVisible();
  45  |     await expect(page.locator('.activity-bar')).toBeVisible();
  46  |     await expect(page.locator('.side-bar')).toBeVisible();
  47  |     await expect(page.locator('.editor-area')).toBeVisible();
  48  |   });
  49  | 
  50  |   test('should show Open Workspace and Open Folder buttons', async () => {
  51  |     await expect(page.getByRole('button', { name: /open workspace/i })).toBeVisible();
  52  |     await expect(page.getByRole('button', { name: /open folder/i })).toBeVisible();
  53  |   });
  54  | 
  55  |   test('should have dark theme by default', async () => {
  56  |     await expect(page.locator('[role="main"]')).toHaveAttribute('data-theme', 'dark');
  57  |   });
  58  | });
  59  | 
  60  | test.describe('Open Folder', () => {
  61  |   test('should open folder and display files in Explorer', async () => {
  62  |     await stubDialog(app, 'showOpenDialog', {
  63  |       filePaths: [tempDir],
  64  |       canceled: false,
  65  |     });
  66  | 
  67  |     await page.getByRole('button', { name: /open folder/i }).click();
  68  | 
  69  |     await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });
  70  |     await expect(page.locator('.file-tree')).toBeVisible();
  71  |     await expect(page.locator('.file-tree-item', { hasText: 'src' })).toBeVisible();
  72  |   });
  73  | 
  74  |   test('should show cancelled status when dialog is cancelled', async () => {
  75  |     await stubDialog(app, 'showOpenDialog', {
  76  |       filePaths: [],
  77  |       canceled: true,
  78  |     });
  79  | 
  80  |     await page.getByRole('button', { name: /open folder/i }).click();
  81  |     await expect(page.locator('.workspace-path')).toContainText('No workspace opened');
  82  |   });
  83  | 
  84  |   test('should enable Search tab after workspace is open', async () => {
  85  |     await stubDialog(app, 'showOpenDialog', {
  86  |       filePaths: [tempDir],
  87  |       canceled: false,
  88  |     });
  89  | 
  90  |     await page.getByRole('button', { name: /open folder/i }).click();
  91  |     await expect(page.getByRole('button', { name: /search/i })).toBeEnabled({ timeout: 15000 });
  92  |   });
  93  | });
  94  | 
  95  | test.describe('Explorer', () => {
  96  |   test.beforeEach(async () => {
  97  |     await stubDialog(app, 'showOpenDialog', {
  98  |       filePaths: [tempDir],
  99  |       canceled: false,
  100 |     });
  101 |     await page.getByRole('button', { name: /open folder/i }).click();
  102 |     await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });
  103 |   });
  104 | 
  105 |   test('should display file tree with workspace contents', async () => {
  106 |     await expect(page.locator('.file-tree')).toBeVisible();
  107 |     await expect(page.locator('.file-tree-item', { hasText: 'src' })).toBeVisible();
  108 |     await expect(page.locator('.file-tree-item', { hasText: 'package.json' })).toBeVisible();
  109 |     await expect(page.locator('.file-tree-item', { hasText: 'README.md' })).toBeVisible();
  110 |   });
  111 | 
  112 |   test('should navigate into directory on click', async () => {
  113 |     await page.locator('.file-tree-item', { hasText: 'src' }).click();
  114 |     await expect(page.locator('.file-tree-item', { hasText: 'index.ts' })).toBeVisible();
  115 |   });
  116 | 
  117 |   test('should navigate up after entering subdirectory', async () => {
  118 |     await page.locator('.file-tree-item', { hasText: 'src' }).click();
  119 |     await expect(page.locator('.file-tree-item', { hasText: 'index.ts' })).toBeVisible();
  120 |     await page.locator('.explorer-breadcrumb-up').click();
  121 |     await expect(page.locator('.file-tree-item', { hasText: 'package.json' })).toBeVisible();
  122 |   });
  123 | });
  124 | 
```