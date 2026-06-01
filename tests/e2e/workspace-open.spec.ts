import { test, expect } from '@playwright/test';
import { WorkbenchPage } from './pages/workbench.page';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('Open Workspace / Open Folder', () => {
  let workbench: WorkbenchPage;
  let tempDir: string;
  let workspaceFile: string;

  test.beforeAll(async () => {
    tempDir = join(tmpdir(), `agentdeck-e2e-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'index.ts'), 'export const x = 1;', 'utf8');
    await writeFile(join(tempDir, 'package.json'), '{"name": "test"}', 'utf8');
    workspaceFile = join(tempDir, 'test.code-workspace');
    await writeFile(workspaceFile, JSON.stringify({ folders: [{ path: '.' }] }), 'utf8');
  });

  test.afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page }) => {
    workbench = new WorkbenchPage(page);
    await workbench.goto();
    // Wait for agentDeck to be available
    await page.waitForFunction(() => !!(globalThis as any).agentDeck, { timeout: 10000 });
    // Set up test mocks after preload has loaded
    await page.evaluate(() => {
      const api = (globalThis as any).agentDeck;
      if (!api || !api.__setAgentDeckMock) return;
      api.__setAgentDeckMock('selectWorkspaceEntry', async (request: any) => {
        if (request.kind === 'folder') {
          return { status: 'selected', kind: 'folder', path: 'C:\\test', name: 'test-folder' } as any;
        }
        return { status: 'cancelled' } as any;
      });
      api.__setAgentDeckMock('openWorkspace', async (path: string, kind: string) => {
        return { status: 'ok', filePath: path, kind, folders: [{ path: 'C:\\test', name: 'test-folder' }] } as any;
      });
      api.__setAgentDeckMock('listDirectory', async (path: string) => {
        return {
          path,
          entries: [
            { name: 'src', path: 'C:\\test\\src', kind: 'directory', isSensitive: false },
            { name: 'package.json', path: 'C:\\test\\package.json', kind: 'file', isSensitive: false }
          ]
        } as any;
      });
    });
  });

  test('should open folder and display files in Explorer', async ({ page }) => {
    // Debug: check agentDeck availability
    const debug = await page.evaluate(() => {
      return {
        hasAgentDeck: !!(globalThis as any).agentDeck,
        hasWindowAgentDeck: !!(window as any).agentDeck,
        userAgent: navigator.userAgent
      };
    });
    console.log('Debug:', JSON.stringify(debug));

    await workbench.clickOpenFolder();
    await expect(workbench.workspaceStatus).toContainText('opened', { timeout: 10000 });
    await workbench.expectFileTreeVisible();
    await workbench.expectFileInTree('src');
  });

  test('should show cancelled status when dialog is cancelled', async ({ page }) => {
    await page.evaluate(() => {
      const api = (globalThis as any).agentDeck;
      if (api) {
        api.selectWorkspaceEntry = async () => ({ status: 'cancelled' });
      }
    });
    await workbench.clickOpenFolder();
    await workbench.expectWorkspaceStatusContains('No workspace opened');
  });

  test('should enable Search tab after workspace is open', async () => {
    await workbench.clickOpenFolder();
    await expect(workbench.searchTab).toBeEnabled({ timeout: 10000 });
  });
});
