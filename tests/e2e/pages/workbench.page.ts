import { type Page, type Locator, expect } from '@playwright/test';

export class WorkbenchPage {
  constructor(readonly page: Page) {}

  // --- Selectors ---
  get root() { return this.page.locator('[role="main"]'); }
  get activityBar() { return this.page.locator('.activity-bar'); }
  get sideBar() { return this.page.locator('.side-bar'); }
  get editorArea() { return this.page.locator('.editor-area'); }
  get bottomPanel() { return this.page.locator('.bottom-panel'); }
  get statusBar() { return this.page.locator('.status-bar'); }

  // --- Workspace actions ---
  get openWorkspaceBtn() { return this.page.getByRole('button', { name: /open workspace/i }); }
  get openFolderBtn() { return this.page.getByRole('button', { name: /open folder/i }); }
  get workspaceStatus() { return this.page.locator('.workspace-path'); }

  // --- Explorer ---
  get explorerPanel() { return this.page.locator('.explorer-panel'); }
  get fileTree() { return this.page.locator('.file-tree'); }
  get fileTreeItems() { return this.page.locator('.file-tree-item'); }
  get breadcrumbName() { return this.page.locator('.explorer-breadcrumb-name'); }
  get navigateUpBtn() { return this.page.locator('.explorer-breadcrumb-up'); }
  get workspaceRootSelect() { return this.page.locator('.explorer-root-select'); }

  // --- Search ---
  get searchPanel() { return this.page.locator('.search-panel'); }
  get searchInput() { return this.page.locator('.search-input'); }
  get searchResults() { return this.page.locator('.search-results'); }
  get searchResultItems() { return this.page.locator('.search-result-item'); }

  // --- Activity bar buttons ---
  get explorerTab() { return this.page.getByRole('button', { name: /explorer/i }); }
  get searchTab() { return this.page.getByRole('button', { name: /search/i }); }

  // --- Theme ---
  get themeToggle() { return this.page.locator('.theme-toggle'); }

  // --- Actions ---
  async goto() {
    await this.page.goto('/');
    await this.root.waitFor({ state: 'visible' });
  }

  async clickOpenWorkspace() {
    await this.openWorkspaceBtn.click();
  }

  async clickOpenFolder() {
    await this.openFolderBtn.click();
  }

  async switchToExplorer() {
    await this.explorerTab.click();
  }

  async switchToSearch() {
    await this.searchTab.click();
  }

  async navigateUp() {
    await this.navigateUpBtn.click();
  }

  async clickFileTreeItem(name: string) {
    await this.page.locator('.file-tree-item', { hasText: name }).click();
  }

  async selectWorkspaceRoot(index: number) {
    await this.workspaceRootSelect.selectOption(String(index));
  }

  async searchFor(pattern: string) {
    await this.searchInput.fill(pattern);
    await this.searchInput.press('Enter');
  }

  // --- Assertions ---
  async expectWorkbenchVisible() {
    await expect(this.root).toBeVisible();
    await expect(this.activityBar).toBeVisible();
    await expect(this.sideBar).toBeVisible();
    await expect(this.editorArea).toBeVisible();
  }

  async expectExplorerVisible() {
    await expect(this.explorerPanel).toBeVisible();
  }

  async expectFileTreeVisible() {
    await expect(this.fileTree).toBeVisible();
  }

  async expectFileInTree(name: string) {
    await expect(this.page.locator('.file-tree-item', { hasText: name }).first()).toBeVisible();
  }

  async expectWorkspaceStatusContains(text: string) {
    await expect(this.workspaceStatus).toContainText(text);
  }

  async expectBreadcrumbContains(text: string) {
    await expect(this.breadcrumbName).toContainText(text);
  }

  async expectSearchResultCount(minCount: number) {
    await expect(this.searchResultItems.first()).toBeVisible();
    const count = await this.searchResultItems.count();
    expect(count).toBeGreaterThanOrEqual(minCount);
  }
}
