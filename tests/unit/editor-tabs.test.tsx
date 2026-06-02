import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EditorTabs } from '@agentdeck/workbench';
import type { EditorTab } from '@agentdeck/shared';

const tabs: EditorTab[] = [
  {
    id: 'tab-1',
    filePath: '/src/app.ts',
    fileName: 'app.ts',
    language: 'typescript',
    isDirty: false,
    isPinned: false
  },
  {
    id: 'tab-2',
    filePath: '/src/main.ts',
    fileName: 'main.ts',
    language: 'typescript',
    isDirty: true,
    isPinned: false
  },
  {
    id: 'tab-3',
    filePath: '/config.json',
    fileName: 'config.json',
    language: 'json',
    isDirty: false,
    isPinned: true
  }
];

describe('EditorTabs', () => {
  it('renders empty state when no tabs', () => {
    render(
      <EditorTabs
        tabs={[]}
        activeTabId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('No open editors')).toBeDefined();
  });

  it('renders all tabs', () => {
    render(
      <EditorTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    // Tab names are rendered inside buttons.
    expect(screen.getByRole('button', { name: /app.ts/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /main.ts/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /config.json/ })).toBeDefined();
  });

  it('marks active tab', () => {
    const { container } = render(
      <EditorTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const activeTab = container.querySelector('.editor-tab.active');
    expect(activeTab).not.toBeNull();
    expect(activeTab?.textContent).toContain('app.ts');
  });

  it('shows dirty indicator for dirty tabs', () => {
    render(
      <EditorTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    // Dirty tab name span should contain the bullet character.
    const tabButtons = screen.getAllByRole('tab');
    // tab-2 (main.ts) is dirty — its name span includes ' \u2022'.
    const dirtyTabButton = tabButtons.find(
      (btn) => btn.getAttribute('aria-controls') === 'editor-panel-tab-2'
    );
    expect(dirtyTabButton).toBeDefined();
    expect(dirtyTabButton!.textContent).toContain('•');
  });

  it('calls onSelect when tab is clicked', async () => {
    const onSelect = vi.fn();
    render(
      <EditorTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );
    const tabButtons = screen.getAllByRole('tab');
    const mainTab = tabButtons.find(
      (btn) => btn.getAttribute('aria-controls') === 'editor-panel-tab-2'
    );
    await userEvent.click(mainTab!);
    expect(onSelect).toHaveBeenCalledWith('tab-2');
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(
      <EditorTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelect={vi.fn()}
        onClose={onClose}
      />
    );
    const closeButtons = screen.getAllByRole('button', { name: /Close/ });
    await userEvent.click(closeButtons[0]!);
    expect(onClose).toHaveBeenCalledWith('tab-1');
  });

  it('renders language labels', () => {
    render(
      <EditorTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    // Language labels are rendered as small text in each tab.
    const languageLabels = screen.getAllByText(/typescript|json/);
    expect(languageLabels.length).toBeGreaterThanOrEqual(2);
  });

  it('marks pinned tabs with pinned class', () => {
    const { container } = render(
      <EditorTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const pinnedTab = container.querySelector('.editor-tab.pinned');
    expect(pinnedTab).not.toBeNull();
    expect(pinnedTab?.textContent).toContain('config.json');
  });
});
