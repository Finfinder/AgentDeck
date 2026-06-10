import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

let app: ElectronApplication;
let page: Page;
let tempDir: string;

test.beforeAll(async () => {
  tempDir = join(tmpdir(), `agentdeck-e2e-chat-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  await writeFile(join(tempDir, 'package.json'), '{"name":"e2e-chat"}', 'utf8');
});

test.beforeEach(async () => {
  app = await electron.launch({
    args: [join(rootDir, '../../out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test', TEST_WORKSPACE_PATH: tempDir }
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

async function switchToChat() {
  await page.getByRole('button', { name: 'Chat' }).click();
  await expect(page.locator('.chat-sidebar')).toBeVisible();
}

async function createChatTabViaSidebar() {
  await switchToChat();
  await page.locator('.chat-sidebar .primary-action', { hasText: 'New Chat' }).click();
  await expect(page.locator('.chat-panel')).toBeVisible();
}

test.describe('Chat Panel — Launch and Visibility', () => {
  test('should show Chat button in activity bar', async () => {
    await expect(page.getByRole('button', { name: 'Chat' })).toBeVisible();
  });

  test('should switch to Chat panel when Chat button is clicked', async () => {
    await switchToChat();
    await expect(page.locator('.chat-sidebar .primary-action', { hasText: 'New Chat' })).toBeVisible();
  });

  test('should show welcome message when no chat tab is open', async () => {
    await switchToChat();
    await expect(page.getByText('Create a new chat tab to start a conversation with an AI model.')).toBeVisible();
  });

  test('should have correct aria-label on sidebar when chat is active', async () => {
    await switchToChat();
    await expect(page.locator('.side-bar')).toHaveAttribute('aria-label', 'Chat');
  });
});

test.describe('Chat Tab Management', () => {
  test('should create a new chat tab when New Chat sidebar button is clicked', async () => {
    await createChatTabViaSidebar();
    await expect(page.locator('.chat-tabs')).toBeVisible();
    await expect(page.locator('.chat-tab')).toBeVisible();
    await expect(page.locator('.chat-panel')).toBeVisible();
  });

  test('should create a new chat tab via the + button in tab bar', async () => {
    await createChatTabViaSidebar();
    await page.getByRole('button', { name: 'New chat tab' }).click();
    await expect(page.locator('.chat-tab')).toHaveCount(2);
  });

  test('should close a chat tab when close button is clicked', async () => {
    await createChatTabViaSidebar();
    await page.locator('.chat-tab-close').first().click();
    await expect(page.getByText('Create a new chat tab to start a conversation with an AI model.')).toBeVisible();
  });

  test('should switch between chat tabs when clicked', async () => {
    await createChatTabViaSidebar();
    await page.getByRole('button', { name: 'New chat tab' }).click();

    await page.locator('.chat-tab-button').first().click();
    await expect(page.locator('.chat-tab').first()).toHaveClass(/chat-tab-active/);

    await page.locator('.chat-tab-button').nth(1).click();
    await expect(page.locator('.chat-tab').nth(1)).toHaveClass(/chat-tab-active/);
  });

  test('should show chat sidebar list with tab titles', async () => {
    await createChatTabViaSidebar();
    await expect(page.locator('.chat-sidebar-item')).toBeVisible();
  });
});

test.describe('Chat Panel — Message Input', () => {
  test('should show message input area', async () => {
    await createChatTabViaSidebar();
    await expect(page.getByLabel('Chat message input')).toBeVisible();
    await expect(page.getByLabel('Send message')).toBeVisible();
  });

  test('should disable send button when input is empty', async () => {
    await createChatTabViaSidebar();
    await expect(page.getByLabel('Send message')).toBeDisabled();
  });

  test('should enable send button when input has text', async () => {
    await createChatTabViaSidebar();
    await page.getByLabel('Chat message input').fill('Hello AI');
    await expect(page.getByLabel('Send message')).toBeEnabled();
  });

  test('should clear input after sending a message', async () => {
    await createChatTabViaSidebar();
    const input = page.getByLabel('Chat message input');
    await input.fill('Hello AI');
    await page.getByLabel('Send message').click();
    await expect(input).toHaveValue('');
  });

  test('should display user message in chat after sending', async () => {
    await createChatTabViaSidebar();
    await page.getByLabel('Chat message input').fill('Hello AI');
    await page.getByLabel('Send message').click();
    await expect(page.locator('.chat-message-user')).toContainText('Hello AI');
  });
});

test.describe('Chat Panel — Model Gateway Preload API', () => {
  test('should have getModelGatewayConfig preload API available', async () => {
    const config = await page.evaluate(() =>
      (globalThis as { agentDeck: { getModelGatewayConfig: () => Promise<unknown> } }).agentDeck.getModelGatewayConfig()
    ) as { providers: unknown[]; activeProvider: string; activeModel: string };

    expect(config).toBeDefined();
    expect(Array.isArray(config.providers)).toBe(true);
    expect(typeof config.activeProvider).toBe('string');
    expect(typeof config.activeModel).toBe('string');
  });

  test('should have listChatTabs preload API available', async () => {
    const tabs = await page.evaluate(() =>
      (globalThis as { agentDeck: { listChatTabs: () => Promise<unknown> } }).agentDeck.listChatTabs()
    );
    expect(Array.isArray(tabs)).toBe(true);
  });

  test('should have createChatTab preload API available', async () => {
    const tab = await page.evaluate(() =>
      (globalThis as { agentDeck: { createChatTab: (title?: string) => Promise<unknown> } }).agentDeck.createChatTab('E2E Test Chat')
    ) as { id: string; title: string; messages: unknown[]; isStreaming: boolean };

    expect(tab).toBeDefined();
    expect(typeof tab.id).toBe('string');
    expect(tab.title).toBe('E2E Test Chat');
    expect(Array.isArray(tab.messages)).toBe(true);
    expect(tab.isStreaming).toBe(false);
  });

  test('should have closeChatTab preload API available', async () => {
    const tab = await page.evaluate(() =>
      (globalThis as { agentDeck: { createChatTab: () => Promise<{ id: string }> } }).agentDeck.createChatTab()
    );

    await page.evaluate((tabId: string) =>
      (globalThis as { agentDeck: { closeChatTab: (id: string) => Promise<void> } }).agentDeck.closeChatTab(tabId),
      tab.id
    );

    const tabs = await page.evaluate(() =>
      (globalThis as unknown as { agentDeck: { listChatTabs: () => Promise<unknown[]> } }).agentDeck.listChatTabs()
    );
    expect(tabs).toHaveLength(0);
  });

  test('should have sendMessage preload API available', async () => {
    // Verify sendMessage API exists as a callable function (do not invoke — no provider available)
    const apiType = await page.evaluate(() =>
      typeof (globalThis as { agentDeck?: { sendMessage?: unknown } }).agentDeck?.sendMessage
    );
    expect(apiType).toBe('function');
  });

  test('should have getApiKey preload API available', async () => {
    const result = await page.evaluate(() =>
      (globalThis as { agentDeck: { getApiKey: (id: string) => Promise<unknown> } }).agentDeck.getApiKey('ollama')
    );

    // Should return null (no key set in test) or a string
    expect(result === null || typeof result === 'string').toBe(true);
  });

  test('should have setApiKey and deleteApiKey preload API available', async () => {
    // Set API key
    await page.evaluate(() =>
      (globalThis as { agentDeck: { setApiKey: (id: string, key: string) => Promise<void> } }).agentDeck.setApiKey('ollama', 'test-key-123')
    );

    // Delete API key
    await page.evaluate(() =>
      (globalThis as { agentDeck: { deleteApiKey: (id: string) => Promise<void> } }).agentDeck.deleteApiKey('ollama')
    );

    // Should not throw
    expect(true).toBe(true);
  });

  test('should have testConnection preload API available', async () => {
    const result = await page.evaluate(() =>
      (globalThis as { agentDeck: { testConnection: (id: string, url: string) => Promise<unknown> } }).agentDeck.testConnection('ollama', 'http://localhost:11434')
    ) as { status: string; message?: string };

    expect(result).toBeDefined();
    expect(typeof result.status).toBe('string');
  });

  test('should have setProviderConfig and getProviderConfig preload API available', async () => {
    // Set provider config
    await page.evaluate(() =>
      (globalThis as { agentDeck: { setProviderConfig: (id: string, url: string) => Promise<void> } }).agentDeck.setProviderConfig('ollama', 'http://custom:8080')
    );

    // Get provider config
    const config = await page.evaluate(() =>
      (globalThis as { agentDeck: { getProviderConfig: (id: string) => Promise<unknown> } }).agentDeck.getProviderConfig('ollama')
    ) as { baseUrl: string; hasApiKey: boolean };

    expect(config).toBeDefined();
    expect(config.baseUrl).toBe('http://custom:8080');
    expect(typeof config.hasApiKey).toBe('boolean');
  });
});

test.describe('Chat Panel — Model Configuration UI', () => {
  test.beforeEach(async () => {
    await page.getByRole('button', { name: 'Chat' }).click();
    await page.waitForSelector('.chat-sidebar');
    await page.locator('.chat-sidebar .primary-action', { hasText: 'New Chat' }).click();
    await expect(page.locator('.chat-panel')).toBeVisible();
  });

  test('should show model config toggle button', async () => {
    const toggleBtn = page.getByRole('button', { name: /model/i });
    await expect(toggleBtn).toBeVisible();
  });

  test('should toggle config panel on toggle click', async () => {
    const toggleBtn = page.getByRole('button', { name: /model/i });

    // Initially collapsed
    await expect(page.locator('.chat-config-panel')).toHaveCount(0);

    // Expand
    await toggleBtn.click();
    await expect(page.locator('.chat-config-panel')).toHaveCount(1);

    // Collapse
    await toggleBtn.click();
    await expect(page.locator('.chat-config-panel')).toHaveCount(0);
  });

  test('should show provider dropdown in config panel', async () => {
    await page.getByRole('button', { name: /model/i }).click();

    const providerSelect = page.locator('.chat-config-select').first();
    await expect(providerSelect).toBeVisible();
    await expect(providerSelect).toHaveText(/Ollama/);
  });

  test('should show model dropdown in config panel', async () => {
    await page.getByRole('button', { name: /model/i }).click();

    const modelSelect = page.locator('.chat-config-select').nth(1);
    await expect(modelSelect).toBeVisible();
  });

  test('should show API URL input in config panel', async () => {
    await page.getByRole('button', { name: /model/i }).click();

    const urlInput = page.locator('.chat-config-input').first();
    await expect(urlInput).toBeVisible();
  });

  test('should show API Key input in config panel', async () => {
    await page.getByRole('button', { name: /model/i }).click();

    const apiKeyInput = page.locator('.chat-config-apikey-input');
    await expect(apiKeyInput).toBeVisible();
    await expect(apiKeyInput).toHaveAttribute('type', 'password');
  });

  test('should show test connection button in config panel', async () => {
    await page.getByRole('button', { name: /model/i }).click();

    const testBtn = page.getByRole('button', { name: /test connection/i });
    await expect(testBtn).toBeVisible();
  });

  test('should show provider status info', async () => {
    await page.getByRole('button', { name: /model/i }).click();

    await expect(page.getByText(/status:/i)).toBeVisible();
  });

  test('should show model count info', async () => {
    await page.getByRole('button', { name: /model/i }).click();

    await expect(page.locator('.chat-config-summary')).toBeVisible();
  });

  test('should show provider/model summary in header', async () => {
    await expect(page.getByText(/Ollama/)).toBeVisible();
  });
});

test.describe('Chat Panel — Navigation from Editor', () => {
  test('should switch from Explorer to Chat and back', async () => {
    await expect(page.locator('.side-bar')).toHaveAttribute('aria-label', 'Explorer');

    await switchToChat();
    await expect(page.locator('.side-bar')).toHaveAttribute('aria-label', 'Chat');

    await page.getByRole('button', { name: 'Explorer' }).click();
    await expect(page.locator('.side-bar')).toHaveAttribute('aria-label', 'Explorer');
  });

  test('should show chat container instead of editor when chat is active', async () => {
    await expect(page.locator('.editor-area')).toBeVisible();

    await switchToChat();
    await expect(page.locator('.chat-container')).toBeVisible();
  });
});
