# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\e2e\workspace-open.spec.ts >> Open Workspace / Open Folder >> should show cancelled status when dialog is cancelled
- Location: tests\e2e\workspace-open.spec.ts:73:3

# Error details

```
TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { WorkbenchPage } from './pages/workbench.page';
  3  | import { mkdir, writeFile, rm } from 'node:fs/promises';
  4  | import { tmpdir } from 'node:os';
  5  | import { join } from 'node:path';
  6  | 
  7  | test.describe('Open Workspace / Open Folder', () => {
  8  |   let workbench: WorkbenchPage;
  9  |   let tempDir: string;
  10 |   let workspaceFile: string;
  11 | 
  12 |   test.beforeAll(async () => {
  13 |     tempDir = join(tmpdir(), `agentdeck-e2e-${Date.now()}`);
  14 |     await mkdir(tempDir, { recursive: true });
  15 |     await mkdir(join(tempDir, 'src'), { recursive: true });
  16 |     await writeFile(join(tempDir, 'src', 'index.ts'), 'export const x = 1;', 'utf8');
  17 |     await writeFile(join(tempDir, 'package.json'), '{"name": "test"}', 'utf8');
  18 |     workspaceFile = join(tempDir, 'test.code-workspace');
  19 |     await writeFile(workspaceFile, JSON.stringify({ folders: [{ path: '.' }] }), 'utf8');
  20 |   });
  21 | 
  22 |   test.afterAll(async () => {
  23 |     await rm(tempDir, { recursive: true, force: true });
  24 |   });
  25 | 
  26 |   test.beforeEach(async ({ page }) => {
  27 |     workbench = new WorkbenchPage(page);
  28 |     await workbench.goto();
  29 |     // Wait for agentDeck to be available
> 30 |     await page.waitForFunction(() => !!(globalThis as any).agentDeck, { timeout: 10000 });
     |                ^ TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.
  31 |     // Set up test mocks after preload has loaded
  32 |     await page.evaluate(() => {
  33 |       const api = (globalThis as any).agentDeck;
  34 |       if (!api || !api.__setAgentDeckMock) return;
  35 |       api.__setAgentDeckMock('selectWorkspaceEntry', async (request: any) => {
  36 |         if (request.kind === 'folder') {
  37 |           return { status: 'selected', kind: 'folder', path: 'C:\\test', name: 'test-folder' } as any;
  38 |         }
  39 |         return { status: 'cancelled' } as any;
  40 |       });
  41 |       api.__setAgentDeckMock('openWorkspace', async (path: string, kind: string) => {
  42 |         return { status: 'ok', filePath: path, kind, folders: [{ path: 'C:\\test', name: 'test-folder' }] } as any;
  43 |       });
  44 |       api.__setAgentDeckMock('listDirectory', async (path: string) => {
  45 |         return {
  46 |           path,
  47 |           entries: [
  48 |             { name: 'src', path: 'C:\\test\\src', kind: 'directory', isSensitive: false },
  49 |             { name: 'package.json', path: 'C:\\test\\package.json', kind: 'file', isSensitive: false }
  50 |           ]
  51 |         } as any;
  52 |       });
  53 |     });
  54 |   });
  55 | 
  56 |   test('should open folder and display files in Explorer', async ({ page }) => {
  57 |     // Debug: check agentDeck availability
  58 |     const debug = await page.evaluate(() => {
  59 |       return {
  60 |         hasAgentDeck: !!(globalThis as any).agentDeck,
  61 |         hasWindowAgentDeck: !!(window as any).agentDeck,
  62 |         userAgent: navigator.userAgent
  63 |       };
  64 |     });
  65 |     console.log('Debug:', JSON.stringify(debug));
  66 | 
  67 |     await workbench.clickOpenFolder();
  68 |     await expect(workbench.workspaceStatus).toContainText('opened', { timeout: 10000 });
  69 |     await workbench.expectFileTreeVisible();
  70 |     await workbench.expectFileInTree('src');
  71 |   });
  72 | 
  73 |   test('should show cancelled status when dialog is cancelled', async ({ page }) => {
  74 |     await page.evaluate(() => {
  75 |       const api = (globalThis as any).agentDeck;
  76 |       if (api) {
  77 |         api.selectWorkspaceEntry = async () => ({ status: 'cancelled' });
  78 |       }
  79 |     });
  80 |     await workbench.clickOpenFolder();
  81 |     await workbench.expectWorkspaceStatusContains('No workspace opened');
  82 |   });
  83 | 
  84 |   test('should enable Search tab after workspace is open', async () => {
  85 |     await workbench.clickOpenFolder();
  86 |     await expect(workbench.searchTab).toBeEnabled({ timeout: 10000 });
  87 |   });
  88 | });
  89 | 
```