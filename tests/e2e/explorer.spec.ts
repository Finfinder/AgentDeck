import { test, expect } from '@playwright/test';
import { WorkbenchPage } from './pages/workbench.page';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('Explorer', () => {
  let workbench: WorkbenchPage;
  let tempDir: string;

  test.beforeAll(async () => {
    tempDir = join(tmpdir(), `agentdeck-e2e-explorer-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await mkdir(join(tempDir, 'src', 'components'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'index.ts'), 'export const x = 1;', 'utf8');
    await writeFile(join(tempDir, 'src', 'components', 'App.tsx'), 'export default App;', 'utf8');
    await writeFile(join(tempDir, 'package.json'), '{"name": "test"}', 'utf8');
    await writeFile(join(tempDir, 'README.md'), '# Test', 'utf8');
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
          name: 'test-explorer'
        }),
        openWorkspace: async (path: string, kind: string) => ({
          status: 'ok',
          filePath: path,
          kind,
          folders: [{ path: folderPath, name: 'test-explorer' }]
        }),
        listDirectory: async (path: string) => {
          if (path === folderPath) {
            return {
              path,
              entries: [
                { name: 'src', path: folderPath + '/src', kind: 'directory', isSensitive: false },
                { name: 'package.json', path: folderPath + '/package.json', kind: 'file', isSensitive: false },
                { name: 'README.md', path: folderPath + '/README.md', kind: 'file', isSensitive: false }
              ]
            };
          }
          if (path === folderPath + '/src') {
            return {
              path,
              entries: [
                { name: 'index.ts', path: folderPath + '/src/index.ts', kind: 'file', isSensitive: false },
                { name: 'components', path: folderPath + '/src/components', kind: 'directory', isSensitive: false }
              ]
            };
          }
          return { path, entries: [] };
        }
      };
    }, tempDir);
    await workbench.goto();
    await workbench.clickOpenFolder();
    await expect(workbench.workspaceStatus).toContainText('opened', { timeout: 10000 });
  });

  test('should display file tree with workspace contents', async () => {
    await workbench.expectFileTreeVisible();
    await workbench.expectFileInTree('src');
    await workbench.expectFileInTree('package.json');
    await workbench.expectFileInTree('README.md');
  });

  test('should navigate into directory on click', async () => {
    await workbench.clickFileTreeItem('src');
    await workbench.expectFileInTree('index.ts');
    await workbench.expectFileInTree('components');
  });

  test('should navigate up after entering subdirectory', async () => {
    await workbench.clickFileTreeItem('src');
    await workbench.expectFileInTree('index.ts');
    await workbench.navigateUp();
    await workbench.expectFileInTree('package.json');
  });

  test('should show breadcrumb with current directory name', async () => {
    await workbench.expectBreadcrumbContains('test-explorer');
  });
});
