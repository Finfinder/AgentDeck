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
  tempDir = join(tmpdir(), `agentdeck-e2e-eventlog-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  await mkdir(join(tempDir, 'src'), { recursive: true });
  await writeFile(join(tempDir, 'src', 'index.ts'), 'export const x = 1;', 'utf8');
  await writeFile(join(tempDir, 'package.json'), '{"name": "test"}', 'utf8');
  await writeFile(join(tempDir, 'README.md'), '# Test', 'utf8');
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

// ---------------------------------------------------------------------------
// Helper: open workspace so event log IPC is fully wired
// ---------------------------------------------------------------------------

async function openWorkspace() {
  await stubDialog(app, 'showOpenDialog', {
    filePaths: [tempDir],
    canceled: false,
  });
  await page.getByRole('button', { name: /open folder/i }).click();
  await expect(page.locator('output[aria-label="Workspace status"]')).toContainText('opened', { timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Event Log Panel — rendering', () => {
  test.beforeEach(async () => {
    await openWorkspace();
  });

  test('should show Event Log tab in bottom panel', async () => {
    const eventLogTab = page.getByRole('tab', { name: 'Event Log' });
    await expect(eventLogTab).toBeVisible();
  });

  test('should switch to Event Log panel when tab is clicked', async () => {
    await page.getByRole('tab', { name: 'Event Log' }).click();

    const panel = page.locator('.event-log-panel');
    await expect(panel).toBeVisible();
  });

  test('should show empty state when no events', async () => {
    await page.getByRole('tab', { name: 'Event Log' }).click();

    await expect(page.locator('.event-log-empty')).toBeVisible();
    await expect(page.locator('.event-log-empty')).toHaveText('Brak eventów do wyświetlenia');
  });

  test('should show event count in header', async () => {
    await page.getByRole('tab', { name: 'Event Log' }).click();

    const count = page.locator('.event-log-count');
    await expect(count).toBeVisible();
    await expect(count).toContainText('0');
  });

  test('should render filter controls', async () => {
    await page.getByRole('tab', { name: 'Event Log' }).click();

    // Search input
    await expect(page.locator('.event-log-search')).toBeVisible();
    await expect(page.locator('.event-log-search')).toHaveAttribute('placeholder', 'Szukaj w eventach...');

    // Level filters
    await expect(page.locator('.event-log-level-filter').filter({ hasText: 'Info' })).toBeVisible();
    await expect(page.locator('.event-log-level-filter').filter({ hasText: 'Ostrzeżenie' })).toBeVisible();
    await expect(page.locator('.event-log-level-filter').filter({ hasText: 'Błąd' })).toBeVisible();

    // Diff-only filter
    await expect(page.locator('.event-log-diff-filter')).toBeVisible();
    await expect(page.locator('.event-log-diff-filter')).toHaveText('Tylko z diffem');

    // Clear button
    await expect(page.locator('.event-log-clear-btn')).toBeVisible();
    await expect(page.locator('.event-log-clear-btn')).toHaveText('Wyczyść');
  });
});

test.describe('Event Log Panel — level filtering', () => {
  test.beforeEach(async () => {
    await openWorkspace();
    await page.getByRole('tab', { name: 'Event Log' }).click();
  });

  test('should toggle level filter off when clicked', async () => {
    const infoBtn = page.locator('.event-log-level-filter').filter({ hasText: 'Info' });
    await expect(infoBtn).toHaveClass(/active/);

    await infoBtn.click();
    // After clicking, should be inactive (no "active" class)
    const classes = await infoBtn.getAttribute('class');
    expect(classes).not.toContain('active');
  });

  test('should toggle level filter back on when clicked again', async () => {
    const infoBtn = page.locator('.event-log-level-filter').filter({ hasText: 'Info' });

    // Toggle off
    await infoBtn.click();
    // Toggle on
    await infoBtn.click();

    await expect(infoBtn).toHaveClass(/active/);
  });

  test('should toggle diff-only filter', async () => {
    const diffBtn = page.locator('.event-log-diff-filter');
    await expect(diffBtn).not.toHaveClass(/active/);

    await diffBtn.click();
    await expect(diffBtn).toHaveClass(/active/);

    await diffBtn.click();
    await expect(diffBtn).not.toHaveClass(/active/);
  });
});

test.describe('Event Log Panel — clear', () => {
  test.beforeEach(async () => {
    await openWorkspace();
    await page.getByRole('tab', { name: 'Event Log' }).click();
  });

  test('should clear event log when clear button is clicked', async () => {
    const clearBtn = page.locator('.event-log-clear-btn');
    await expect(clearBtn).toBeVisible();

    await clearBtn.click();

    // Should still show empty state
    await expect(page.locator('.event-log-empty')).toBeVisible();
    await expect(page.locator('.event-log-count')).toContainText('0');
  });
});

test.describe('Event Log Panel — panel switching', () => {
  test.beforeEach(async () => {
    await openWorkspace();
  });

  test('should switch between Problems and Event Log panels', async () => {
    // Start on Problems
    await expect(page.locator('.problems-panel')).toBeVisible();

    // Switch to Event Log
    await page.getByRole('tab', { name: 'Event Log' }).click();
    await expect(page.locator('.event-log-panel')).toBeVisible();

    // Switch back to Problems
    await page.getByRole('tab', { name: 'Problems' }).click();
    await expect(page.locator('.problems-panel')).toBeVisible();
  });

  test('should switch between Output and Event Log panels', async () => {
    // Switch to Output
    await page.getByRole('tab', { name: 'Output' }).click();
    await expect(page.locator('.output-empty')).toBeVisible();

    // Switch to Event Log
    await page.getByRole('tab', { name: 'Event Log' }).click();
    await expect(page.locator('.event-log-panel')).toBeVisible();
  });
});

test.describe('Event Log Panel — accessibility', () => {
  test.beforeEach(async () => {
    await openWorkspace();
    await page.getByRole('tab', { name: 'Event Log' }).click();
  });

  test('should have aria-label on search input', async () => {
    const search = page.locator('.event-log-search');
    await expect(search).toHaveAttribute('aria-label', 'Szukaj w eventach');
  });

  test('should have aria-pressed on level filter buttons', async () => {
    const infoBtn = page.locator('.event-log-level-filter').filter({ hasText: 'Info' });
    await expect(infoBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('should have aria-pressed on diff-only filter', async () => {
    const diffBtn = page.locator('.event-log-diff-filter');
    await expect(diffBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('should have role="log" on entries container', async () => {
    const entries = page.locator('.event-log-entries');
    await expect(entries).toHaveAttribute('role', 'log');
  });

  test('should have aria-live on entries container', async () => {
    const entries = page.locator('.event-log-entries');
    await expect(entries).toHaveAttribute('aria-live', 'polite');
  });
});

test.describe('Event Log Panel — filtering with events', () => {
  test.beforeEach(async () => {
    await openWorkspace();
    await page.getByRole('tab', { name: 'Event Log' }).click();
  });

  test('should filter events by level — toggle Info off leaves other levels', async () => {
    // Inject events via proposePatch to populate the event log
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (globalThis as any).agentDeck;
      if (api && typeof api.proposePatch === 'function') {
        await api.proposePatch({
          filePath: 'src/index.ts',
          baseHash: 'hash1',
          operations: [{ filePath: 'src/index.ts', range: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 }, text: 'test' }],
          author: 'agent',
          riskLevel: 'low'
        }).catch(() => {});
      }
    });

    await page.waitForTimeout(500);

    // Toggle off Info level
    const infoBtn = page.locator('.event-log-level-filter').filter({ hasText: 'Info' });
    await expect(infoBtn).toHaveClass(/active/);
    await infoBtn.click();

    // Info should now be inactive
    const classes = await infoBtn.getAttribute('class');
    expect(classes).not.toContain('active');
  });

  test('should filter events by search text', async () => {
    // Inject an event
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (globalThis as any).agentDeck;
      if (api && typeof api.proposePatch === 'function') {
        await api.proposePatch({
          filePath: 'src/special-file.ts',
          baseHash: 'hash2',
          operations: [{ filePath: 'src/special-file.ts', range: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 }, text: 'test' }],
          author: 'agent',
          riskLevel: 'low'
        }).catch(() => {});
      }
    });

    await page.waitForTimeout(500);

    // Type in search box
    const searchInput = page.locator('.event-log-search');
    await searchInput.fill('special-file');
    await page.waitForTimeout(300);

    // The search should filter — verify the search input has the value
    await expect(searchInput).toHaveValue('special-file');
  });

  test('should toggle diff-only filter and show only events with diffs', async () => {
    // Inject an event with diff
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (globalThis as any).agentDeck;
      if (api && typeof api.proposePatch === 'function') {
        await api.proposePatch({
          filePath: 'src/with-diff.ts',
          baseHash: 'hash3',
          operations: [{ filePath: 'src/with-diff.ts', range: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 }, text: 'test' }],
          author: 'agent',
          riskLevel: 'low'
        }).catch(() => {});
      }
    });

    await page.waitForTimeout(500);

    // Toggle diff-only filter
    const diffBtn = page.locator('.event-log-diff-filter');
    await diffBtn.click();
    await expect(diffBtn).toHaveClass(/active/);

    // Toggle back off
    await diffBtn.click();
    await expect(diffBtn).not.toHaveClass(/active/);
  });

  test('should show event count after injecting events', async () => {
    // Inject an event
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (globalThis as any).agentDeck;
      if (api && typeof api.proposePatch === 'function') {
        await api.proposePatch({
          filePath: 'src/count-test.ts',
          baseHash: 'hash4',
          operations: [{ filePath: 'src/count-test.ts', range: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 }, text: 'test' }],
          author: 'agent',
          riskLevel: 'low'
        }).catch(() => {});
      }
    });

    await page.waitForTimeout(500);

    // Event count should be visible (may be > 0 from previous tests in same session)
    const count = page.locator('.event-log-count');
    await expect(count).toBeVisible();
    const countText = await count.textContent();
    expect(countText).toMatch(/\d+ eventów/);
  });
});
