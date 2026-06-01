import { test, expect } from '@playwright/test';
import { WorkbenchPage } from './pages/workbench.page';

test.describe('Workbench Shell', () => {
  let workbench: WorkbenchPage;

  test.beforeEach(async ({ page }) => {
    workbench = new WorkbenchPage(page);
    await workbench.goto();
  });

  test('should render workbench with all main regions', async () => {
    await workbench.expectWorkbenchVisible();
  });

  test('should show Open Workspace and Open Folder buttons', async () => {
    await expect(workbench.openWorkspaceBtn).toBeVisible();
    await expect(workbench.openFolderBtn).toBeVisible();
  });

  test('should show workspace card when no workspace is open', async () => {
    await expect(workbench.page.locator('.workspace-card')).toBeVisible();
  });

  test('should show "No workspace opened" status initially', async () => {
    await workbench.expectWorkspaceStatusContains('No workspace opened');
  });

  test('should have dark theme by default', async () => {
    await expect(workbench.root).toHaveAttribute('data-theme', 'dark');
  });

  test('should disable Search tab when no workspace is open', async () => {
    await expect(workbench.searchTab).toBeDisabled();
  });
});
