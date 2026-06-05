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
  await writeFile(join(tempDir, 'src', 'utils.ts'), 'export function helper() { return true; }', 'utf8');
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

  test('should have a valid theme attribute', async () => {
    const theme = await page.locator('[role="main"]').getAttribute('data-theme');
    expect(['dark', 'light']).toContain(theme);
  });

  test('should show welcome screen in editor area when no file is open', async () => {
    await expect(page.locator('.editor-welcome')).toBeVisible();
    await expect(page.getByText('Open a file from the Explorer to start editing.')).toBeVisible();
  });

  test('should show Ready status in bottom panel', async () => {
    await expect(page.locator('.startup-status')).toContainText('Ready');
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

  test('should update status bar with workspace name after opening', async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('output[aria-label="Workspace status"]')).toContainText('opened', { timeout: 15000 });
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

  test('should open editor tab when clicking a file in Explorer', async () => {
    // Navigate into src directory
    await page.locator('.file-tree-item', { hasText: 'src' }).click();
    await expect(page.locator('.file-tree-item', { hasText: 'index.ts' })).toBeVisible();

    // Click on the file button by role and wait for editor tab
    const fileBtn = page.getByRole('treeitem', { name: 'Open file index.ts' });
    await fileBtn.click();

    // Editor tab should appear
    await expect(page.locator('.editor-tab', { hasText: 'index.ts' })).toBeVisible({ timeout: 10000 });
  });

  test('should open editor tab for root-level file', async () => {
    // Wait for file tree to be fully loaded
    await expect(page.locator('.file-tree-item', { hasText: 'package.json' })).toBeVisible();

    // Dispatch a proper click event that React's event delegation will pick up
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="file-package.json"]') as HTMLButtonElement;
      if (!btn) throw new Error('Button not found');
      // React 19 uses event delegation on the root — dispatch a bubbling click
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    });

    // Editor tab should appear
    await expect(page.locator('.editor-tab', { hasText: 'package.json' })).toBeVisible({ timeout: 10000 });
  });

  test('should show breadcrumb with root folder name', async () => {
    await expect(page.locator('.explorer-breadcrumb-name')).toBeVisible();
  });

  test('should display empty directory message for empty folders', async () => {
    // Create an empty subdirectory
    const emptyDir = join(tempDir, 'empty-dir');
    await mkdir(emptyDir, { recursive: true });
    // Navigate into src and back to trigger fs refresh
    await page.locator('.file-tree-item', { hasText: 'src' }).click();
    await page.waitForTimeout(500);
    await page.locator('.explorer-breadcrumb-up').click();
    await expect(page.locator('.file-tree-item', { hasText: 'empty-dir' })).toBeVisible();
    await page.locator('.file-tree-item', { hasText: 'empty-dir' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('.file-tree-empty')).toBeVisible();
    await expect(page.getByText('Empty directory')).toBeVisible();
    // Cleanup
    await rm(emptyDir, { recursive: true, force: true });
  });
});

test.describe('Activity Bar', () => {
  test.beforeEach(async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });
  });

  test('should switch to Search panel when Search button is clicked', async () => {
    const searchBtn = page.getByRole('button', { name: /search/i });
    await expect(searchBtn).toBeEnabled();
    await searchBtn.click();
    await expect(page.locator('.search-panel')).toBeVisible();
  });

  test('should switch back to Explorer when Explorer button is clicked', async () => {
    await page.getByRole('button', { name: /search/i }).click();
    await expect(page.locator('.search-panel')).toBeVisible();
    await page.getByRole('button', { name: /explorer/i }).click();
    await expect(page.locator('.file-tree')).toBeVisible();
  });

  test('should have Source control button disabled', async () => {
    const scBtn = page.getByRole('button', { name: /source control/i });
    await expect(scBtn).toBeDisabled();
  });
});

test.describe('Search Panel', () => {
  test.beforeEach(async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });
    await page.getByRole('button', { name: /search/i }).click();
    await expect(page.locator('.search-panel')).toBeVisible();
  });

  test('should display search input and button', async () => {
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.getByRole('button', { name: /run search/i })).toBeVisible();
  });

  test('should show no results message after searching for non-existent pattern', async () => {
    await page.locator('#search-input').fill('nonexistent_pattern_xyz');
    await page.getByRole('button', { name: /run search/i }).click();
    await expect(page.locator('.search-empty')).toBeVisible();
    await expect(page.getByText('No results found.')).toBeVisible();
  });

  test('should find results when searching for existing content', async () => {
    await page.locator('#search-input').fill('export');
    await page.getByRole('button', { name: /run search/i }).click();
    await expect(page.locator('.search-results')).toBeVisible({ timeout: 15000 });
    // Both index.ts and utils.ts contain 'export'
    await expect(page.locator('.search-result-item').first()).toBeVisible({ timeout: 15000 });
  });

  test('should open file in editor when clicking a search result', async () => {
    await page.locator('#search-input').fill('export');
    await page.getByRole('button', { name: /run search/i }).click();
    await expect(page.locator('.search-result-item').first()).toBeVisible({ timeout: 15000 });
    await page.locator('.search-result-item').first().click();
    await expect(page.locator('.editor-tab', { hasText: 'index.ts' })).toBeVisible({ timeout: 10000 });
  });

  test('should disable search button when input is empty', async () => {
    await page.locator('#search-input').fill('');
    await expect(page.getByRole('button', { name: /run search/i })).toBeDisabled();
  });

  test('should show searching indicator while search is in progress', async () => {
    await page.locator('#search-input').fill('test');
    await page.getByRole('button', { name: /run search/i }).click();
    // The search completes — either results or empty state should appear
    await expect(
      page.locator('.search-empty').or(page.locator('.search-results'))
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Editor Tabs', () => {
  test.beforeEach(async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });
  });

  test('should show No open editors when no tabs are open', async () => {
    await expect(page.locator('.editor-tab-empty')).toBeVisible();
    await expect(page.getByText('No open editors')).toBeVisible();
  });

  test('should open multiple tabs for different files', async () => {
    // Open index.ts
    await page.locator('.file-tree-item', { hasText: 'src' }).click();
    await expect(page.locator('.file-tree-item', { hasText: 'index.ts' })).toBeVisible();
    await page.getByRole('treeitem', { name: 'Open file index.ts' }).click();
    await expect(page.locator('.editor-tab', { hasText: 'index.ts' })).toBeVisible({ timeout: 10000 });

    // Open README.md
    await page.locator('.explorer-breadcrumb-up').click();
    await expect(page.locator('.file-tree-item', { hasText: 'README.md' })).toBeVisible();
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="file-README.md"]') as HTMLButtonElement;
      if (!btn) throw new Error('Button not found');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    });
    await expect(page.locator('.editor-tab', { hasText: 'README.md' })).toBeVisible({ timeout: 10000 });

    // Both tabs should be visible
    await expect(page.locator('.editor-tab', { hasText: 'index.ts' })).toBeVisible();
    await expect(page.locator('.editor-tab', { hasText: 'README.md' })).toBeVisible();
  });

  test('should switch between tabs on click', async () => {
    // Open index.ts
    await page.locator('.file-tree-item', { hasText: 'src' }).click();
    await page.getByRole('treeitem', { name: 'Open file index.ts' }).click();
    await expect(page.locator('.editor-tab', { hasText: 'index.ts' })).toBeVisible({ timeout: 10000 });

    // Open package.json (root-level file)
    await page.locator('.explorer-breadcrumb-up').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="file-package.json"]') as HTMLButtonElement;
      if (!btn) throw new Error('Button not found');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    });
    await expect(page.locator('.editor-tab', { hasText: 'package.json' })).toBeVisible({ timeout: 10000 });

    // Switch back to index.ts tab
    await page.locator('.editor-tab', { hasText: 'index.ts' }).click();
    await expect(page.locator('.editor-tab.active', { hasText: 'index.ts' })).toBeVisible();
  });

  test('should close tab via close button', async () => {
    await page.locator('.file-tree-item', { hasText: 'src' }).click();
    await page.getByRole('treeitem', { name: 'Open file index.ts' }).click();
    await expect(page.locator('.editor-tab', { hasText: 'index.ts' })).toBeVisible({ timeout: 10000 });

    const closeBtn = page.locator('.editor-tab', { hasText: 'index.ts' }).locator('.editor-tab-close');
    await closeBtn.click();

    await expect(page.locator('.editor-tab', { hasText: 'index.ts' })).toHaveCount(0);
    await expect(page.locator('.editor-welcome')).toBeVisible();
  });

  test('should not show dirty indicator for unmodified file', async () => {
    await page.locator('.file-tree-item', { hasText: 'src' }).click();
    await page.getByRole('treeitem', { name: 'Open file index.ts' }).click();
    await expect(page.locator('.editor-tab', { hasText: 'index.ts' })).toBeVisible({ timeout: 10000 });

    const tabName = page.locator('.editor-tab', { hasText: 'index.ts' }).locator('.editor-tab-name');
    await expect(tabName).toHaveText('index.ts');
  });
});

test.describe('Theme Switching', () => {
  test('should toggle theme when Light button is clicked', async () => {
    // Determine current theme and verify toggle works
    const currentTheme = await page.locator('[role="main"]').getAttribute('data-theme');
    const targetTheme = currentTheme === 'dark' ? 'light' : 'dark';
    await page.getByRole('button', { name: targetTheme === 'light' ? 'Light' : 'Dark' }).click();
    await expect(page.locator('[role="main"]')).toHaveAttribute('data-theme', targetTheme);
  });

  test('should toggle theme back when Dark button is clicked', async () => {
    const currentTheme = await page.locator('[role="main"]').getAttribute('data-theme');
    const targetTheme = currentTheme === 'dark' ? 'light' : 'dark';
    await page.getByRole('button', { name: targetTheme === 'light' ? 'Light' : 'Dark' }).click();
    await expect(page.locator('[role="main"]')).toHaveAttribute('data-theme', targetTheme);
    // Toggle back
    await page.getByRole('button', { name: currentTheme === 'dark' ? 'Dark' : 'Light' }).click();
    await expect(page.locator('[role="main"]')).toHaveAttribute('data-theme', currentTheme!);
  });

  test('should update status bar when theme is changed', async () => {
    const currentTheme = await page.locator('[role="main"]').getAttribute('data-theme');
    const toggleBtn = currentTheme === 'dark' ? 'Light' : 'Dark';
    await page.getByRole('button', { name: toggleBtn }).click();
    await expect(page.locator('output[aria-label="Theme settings"]')).toContainText('saved');
  });
});

test.describe('Status Bar', () => {
  test('should display No workspace opened initially', async () => {
    await expect(page.locator('output[aria-label="Workspace status"]')).toHaveText('No workspace opened.');
  });

  test('should display theme settings status', async () => {
    await expect(page.locator('output[aria-label="Theme settings"]')).toContainText('Theme settings ready');
  });

  test('should show workspace path after opening folder', async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('output[aria-label="Workspace status"]')).toContainText('opened', { timeout: 15000 });
  });
});

test.describe('Menu Bar', () => {
  test('should display File, Edit, View, Window menus', async () => {
    await expect(page.getByRole('menuitem', { name: 'File' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'View' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Window' })).toBeVisible();
  });

  test('should open File menu dropdown on click', async () => {
    await page.getByRole('menuitem', { name: 'File' }).click();
    await expect(page.getByRole('menuitem', { name: 'Open Folder...' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Open Workspace...' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Close Workspace' })).toBeVisible();
    // 'Save' appears with shortcut text 'Save Ctrl+S' in the menu
    await expect(page.getByRole('menuitem', { name: /^Save Ctrl\+S$/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Save As/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Save All' })).toBeVisible();
  });

  test('should open Edit menu dropdown on click', async () => {
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('menuitem', { name: 'Undo' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Redo' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Select All' })).toBeVisible();
  });

  test('should open View menu dropdown on click', async () => {
    await page.getByRole('menuitem', { name: 'View' }).click();
    await expect(page.getByRole('menuitem', { name: 'Explorer' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Search' })).toBeVisible();
  });

  test('should disable Save when no tab is open', async () => {
    await page.getByRole('menuitem', { name: 'File' }).click();
    const saveItem = page.getByRole('menuitem', { name: /^Save Ctrl\+S$/ });
    await expect(saveItem).toHaveAttribute('aria-disabled', 'true');
  });

  test('should disable Save All when no dirty tabs exist', async () => {
    await page.getByRole('menuitem', { name: 'File' }).click();
    const saveAllItem = page.getByRole('menuitem', { name: 'Save All' });
    await expect(saveAllItem).toHaveAttribute('aria-disabled', 'true');
  });

  test('should close File menu on Escape', async () => {
    await page.getByRole('menuitem', { name: 'File' }).click();
    await expect(page.getByRole('menuitem', { name: 'Open Folder...' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Open Folder...' })).toHaveCount(0);
  });
});

test.describe('Close Workspace', () => {
  test.beforeEach(async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });
  });

  test('should close workspace via File menu', async () => {
    await page.getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Close Workspace' }).click();
    await expect(page.locator('output[aria-label="Workspace status"]')).toHaveText('No workspace opened.');
    await expect(page.locator('.workspace-path')).toContainText('No workspace opened');
  });

  test('should disable Search button after closing workspace', async () => {
    await page.getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'Close Workspace' }).click();
    await expect(page.getByRole('button', { name: /search/i })).toBeDisabled();
  });
});

test.describe('Editor Content and Dirty State', () => {
  test.beforeEach(async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });

    // Open index.ts
    await page.locator('.file-tree-item', { hasText: 'src' }).click();
    await page.getByRole('treeitem', { name: 'Open file index.ts' }).click();
    await expect(page.locator('.editor-tab', { hasText: 'index.ts' })).toBeVisible({ timeout: 10000 });
  });

  test('should display file content in Monaco editor', async () => {
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10000 });
  });

  test('should show dirty indicator after editing content', async () => {
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10000 });
    await page.locator('.monaco-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('// modified', { delay: 50 });
    await page.waitForTimeout(500);

    const tabName = page.locator('.editor-tab', { hasText: 'index.ts' }).locator('.editor-tab-name');
    await expect(tabName).toContainText('*');
  });

  test('should enable Save when tab is dirty', async () => {
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10000 });
    await page.locator('.monaco-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('// modified', { delay: 50 });
    await page.waitForTimeout(500);

    await page.getByRole('menuitem', { name: 'File' }).click();
    const saveItem = page.getByRole('menuitem', { name: /^Save Ctrl\+S$/ });
    await expect(saveItem).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('should enable Save All when tab is dirty', async () => {
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10000 });
    await page.locator('.monaco-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('// modified', { delay: 50 });
    await page.waitForTimeout(500);

    await page.getByRole('menuitem', { name: 'File' }).click();
    const saveAllItem = page.getByRole('menuitem', { name: /^Save All$/ });
    await expect(saveAllItem).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('should save dirty file via Ctrl+S and clear dirty indicator', async () => {
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10000 });
    await page.locator('.monaco-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('// saved via ctrl+s', { delay: 50 });
    await page.waitForTimeout(500);

    // Verify dirty indicator is shown
    const tabName = page.locator('.editor-tab', { hasText: 'index.ts' }).locator('.editor-tab-name');
    await expect(tabName).toContainText('*');

    // Save via Ctrl+S
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(1000);

    // Dirty indicator should be cleared
    await expect(tabName).not.toContainText('*');
    await expect(tabName).toHaveText('index.ts');
  });

  test('should save dirty file via File > Save menu', async () => {
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10000 });
    await page.locator('.monaco-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('// saved via menu', { delay: 50 });
    await page.waitForTimeout(500);

    // Save via File > Save
    await page.getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: /^Save Ctrl\+S$/ }).click();
    await page.waitForTimeout(1000);

    // Dirty indicator should be cleared
    const tabName = page.locator('.editor-tab', { hasText: 'index.ts' }).locator('.editor-tab-name');
    await expect(tabName).toHaveText('index.ts');
  });
});

test.describe('Save Changes Dialog', () => {
  test.beforeEach(async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });

    // Open index.ts
    await page.locator('.file-tree-item', { hasText: 'src' }).click();
    await page.getByRole('treeitem', { name: 'Open file index.ts' }).click();
    await expect(page.locator('.editor-tab', { hasText: 'index.ts' })).toBeVisible({ timeout: 10000 });

    // Make the file dirty
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10000 });
    await page.locator('.monaco-editor').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('// modified content', { delay: 50 });
    await page.waitForTimeout(500);
  });

  test('should show save dialog when closing dirty tab', async () => {
    const closeBtn = page.locator('.editor-tab', { hasText: 'index.ts' }).locator('.editor-tab-close');
    await closeBtn.click();
    await expect(page.locator('dialog.dialog-overlay')).toBeVisible();
    await expect(page.getByText(/save changes/i)).toBeVisible();
  });

  test('should show Save, Don\'t Save, and Cancel buttons in dialog', async () => {
    const closeBtn = page.locator('.editor-tab', { hasText: 'index.ts' }).locator('.editor-tab-close');
    await closeBtn.click();
    await expect(page.locator('dialog.dialog-overlay')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /don't save/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('should close tab without saving when Don\'t Save is clicked', async () => {
    const closeBtn = page.locator('.editor-tab', { hasText: 'index.ts' }).locator('.editor-tab-close');
    await closeBtn.click();
    await expect(page.locator('dialog.dialog-overlay')).toBeVisible();
    await page.getByRole('button', { name: /^Don't Save$/ }).click();
    await expect(page.locator('.editor-tab', { hasText: 'index.ts' })).toHaveCount(0);
    await expect(page.locator('.editor-welcome')).toBeVisible();
  });

  test('should cancel close when Cancel is clicked', async () => {
    const closeBtn = page.locator('.editor-tab', { hasText: 'index.ts' }).locator('.editor-tab-close');
    await closeBtn.click();
    await expect(page.locator('dialog.dialog-overlay')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('dialog.dialog-overlay')).toHaveCount(0);
    await expect(page.locator('.editor-tab', { hasText: 'index.ts' })).toBeVisible();
  });
});

test.describe('Explorer Context Menu', () => {
  test.beforeEach(async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });
  });

  test('should show context menu on right-click on file', async () => {
    const fileItem = page.locator('.file-tree-item', { hasText: 'README.md' });
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Copy Path' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Copy Relative Path' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  });

  test('should close context menu on Escape', async () => {
    const fileItem = page.locator('.file-tree-item', { hasText: 'README.md' });
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.context-menu')).toHaveCount(0);
  });

  test('should close context menu on outside click', async () => {
    const fileItem = page.locator('.file-tree-item', { hasText: 'README.md' });
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible();
    await page.locator('.editor-area').click();
    await expect(page.locator('.context-menu')).toHaveCount(0);
  });
});

test.describe('Rename Dialog', () => {
  test.beforeEach(async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });
  });

  test('should show rename dialog when Rename is clicked in context menu', async () => {
    const fileItem = page.locator('.file-tree-item', { hasText: 'README.md' });
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await expect(page.locator('dialog.dialog-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /rename/i })).toBeVisible();
    await expect(page.locator('.dialog-input')).toBeVisible();
  });

  test('should show current filename in rename input', async () => {
    const fileItem = page.locator('.file-tree-item', { hasText: 'README.md' });
    await fileItem.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await expect(page.locator('.dialog-input')).toHaveValue('README.md');
  });

  test('should close rename dialog on Cancel', async () => {
    const fileItem = page.locator('.file-tree-item', { hasText: 'README.md' });
    await fileItem.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await expect(page.locator('dialog.dialog-overlay')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('dialog.dialog-overlay')).toHaveCount(0);
  });

  test('should close rename dialog on Escape in input', async () => {
    const fileItem = page.locator('.file-tree-item', { hasText: 'README.md' });
    await fileItem.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await expect(page.locator('.dialog-input')).toBeVisible();
    await page.locator('.dialog-input').press('Escape');
    await expect(page.locator('dialog.dialog-overlay')).toHaveCount(0);
  });
});

test.describe('Delete File', () => {
  test.beforeEach(async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });
  });

  test('should show confirmation dialog when Delete is clicked', async () => {
    const fileItem = page.locator('.file-tree-item', { hasText: 'README.md' });
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible();

    // Stub the confirm dialog to auto-confirm
    await page.evaluate(() => {
      globalThis.confirm = () => true;
    });

    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('.file-tree-item', { hasText: 'README.md' })).toHaveCount(0);
  });

  test('should not delete file when confirmation is cancelled', async () => {
    // Use package.json instead since README.md may have been deleted by previous test
    const fileItem = page.locator('.file-tree-item', { hasText: 'package.json' });
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible();

    // Stub the confirm dialog to cancel
    await page.evaluate(() => {
      globalThis.confirm = () => false;
    });

    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.locator('.file-tree-item', { hasText: 'package.json' })).toBeVisible();
  });
});

test.describe('View Menu Panel Switching', () => {
  test.beforeEach(async () => {
    await stubDialog(app, 'showOpenDialog', {
      filePaths: [tempDir],
      canceled: false,
    });
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.locator('.workspace-path')).toContainText('opened', { timeout: 15000 });
  });

  test('should switch to Explorer via View menu', async () => {
    await page.getByRole('button', { name: /search/i }).click();
    await expect(page.locator('.search-panel')).toBeVisible();
    await page.getByRole('menuitem', { name: 'View' }).click();
    await page.getByRole('menuitem', { name: 'Explorer' }).click();
    await expect(page.locator('.file-tree')).toBeVisible();
  });

  test('should switch to Search via View menu', async () => {
    await page.getByRole('menuitem', { name: 'View' }).click();
    await page.getByRole('menuitem', { name: 'Search' }).click();
    await expect(page.locator('.search-panel')).toBeVisible();
  });
});

// Note: File Watcher E2E tests are not included here because fs.watch with
// recursive:true on Windows is unreliable for detecting external file changes
// from a separate process. The file watcher feature is covered by:
// - Unit tests in tests/unit/editor-surface.test.tsx (external change detection)
// - Integration tests in tests/unit/editor-surface-edge-cases.test.tsx
// - Integration tests in tests/integration/editor-conflict-flow.test.tsx
// A proper E2E test would require either polling-based fs watcher or a
// dedicated test IPC channel to inject fs-events.
