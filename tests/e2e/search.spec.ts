import { test, expect } from '@playwright/test';
import { WorkbenchPage } from './pages/workbench.page';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('Search', () => {
  let workbench: WorkbenchPage;
  let tempDir: string;

  test.beforeAll(async () => {
    tempDir = join(tmpdir(), `agentdeck-e2e-search-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'index.ts'), 'export const hello = "world";', 'utf8');
    await writeFile(join(tempDir, 'src', 'app.ts'), 'const hello = 42;', 'utf8');
    await writeFile(join(tempDir, 'README.md'), '# Hello World', 'utf8');
  });

  test.afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page }) => {
    workbench = new WorkbenchPage(page);
    await page.addInitScript((folderPath) => {
      (globalThis as any).__TEST_MOCKS__ = {
        selectWorkspaceEntry: async () => ({
          status: 'selected',
          kind: 'folder',
          path: folderPath,
          name: 'test-search'
        }),
        openWorkspace: async (path: string, kind: string) => ({
          status: 'ok',
          filePath: path,
          kind,
          folders: [{ path: folderPath, name: 'test-search' }]
        }),
        listDirectory: async (path: string) => ({
          path,
          entries: [
            { name: 'src', path: folderPath + '/src', kind: 'directory', isSensitive: false },
            { name: 'README.md', path: folderPath + '/README.md', kind: 'file', isSensitive: false }
          ]
        }),
        searchFiles: async (query: any) => {
          if (query.pattern === 'hello') {
            return [
              { file: folderPath + '/src/index.ts', line: 1, col: 1, snippet: 'export const hello = "world";', isSensitive: false }
            ];
          }
          return [];
        }
      };
    }, tempDir);
    await workbench.goto();
    await workbench.clickOpenFolder();
    await expect(workbench.workspaceStatus).toContainText('opened', { timeout: 10000 });
    await workbench.switchToSearch();
  });

  test('should show search panel when Search tab is active', async () => {
    await expect(workbench.searchPanel).toBeVisible();
  });

  test('should find files matching search pattern', async () => {
    await workbench.searchFor('hello');
    await workbench.expectSearchResultCount(1);
  });

  test('should show no results for non-matching pattern', async () => {
    await workbench.searchFor('nonexistentxyz');
    const count = await workbench.searchResultItems.count();
    expect(count).toBe(0);
  });
});
