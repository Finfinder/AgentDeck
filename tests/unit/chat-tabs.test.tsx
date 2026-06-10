import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ChatTabState } from '@agentdeck/shared';
import { ChatTabs } from '../../packages/workbench/src/chat/ChatTabs';

function createTab(id: string, title: string, isStreaming = false): ChatTabState {
  return {
    id,
    title,
    messages: [],
    activeModel: 'default',
    activeProvider: 'ollama',
    isStreaming
  };
}

describe('ChatTabs', () => {
  it('renders empty state when no tabs', () => {
    render(
      <ChatTabs
        tabs={[]}
        activeTabId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />
    );

    expect(screen.getByLabelText('New chat tab')).toBeInTheDocument();
  });

  it('renders all tabs', () => {
    const tabs = [
      createTab('tab-1', 'Chat 1'),
      createTab('tab-2', 'Chat 2')
    ];

    render(
      <ChatTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />
    );

    expect(screen.getByText('Chat 1')).toBeInTheDocument();
    expect(screen.getByText('Chat 2')).toBeInTheDocument();
  });

  it('marks active tab', () => {
    const tabs = [
      createTab('tab-1', 'Chat 1'),
      createTab('tab-2', 'Chat 2')
    ];

    render(
      <ChatTabs
        tabs={tabs}
        activeTabId="tab-2"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />
    );

    const tabButtons = screen.getAllByRole('tab');
    expect(tabButtons[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabButtons[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onSelect when tab is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const tabs = [createTab('tab-1', 'Chat 1')];

    render(
      <ChatTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelect={onSelect}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />
    );

    await user.click(screen.getByText('Chat 1'));
    expect(onSelect).toHaveBeenCalledWith('tab-1');
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const tabs = [createTab('tab-1', 'Chat 1')];

    render(
      <ChatTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelect={vi.fn()}
        onClose={onClose}
        onCreate={vi.fn()}
      />
    );

    await user.click(screen.getByLabelText('Close Chat 1'));
    expect(onClose).toHaveBeenCalledWith('tab-1');
  });

  it('calls onCreate when new tab button is clicked', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    render(
      <ChatTabs
        tabs={[]}
        activeTabId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreate={onCreate}
      />
    );

    await user.click(screen.getByLabelText('New chat tab'));
    expect(onCreate).toHaveBeenCalled();
  });

  it('shows streaming indicator for streaming tabs', () => {
    const tabs = [createTab('tab-1', 'Chat 1', true)];

    render(
      <ChatTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Streaming')).toBeInTheDocument();
  });

  it('has correct ARIA roles', () => {
    const tabs = [createTab('tab-1', 'Chat 1')];

    render(
      <ChatTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />
    );

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'Chat tabs');
  });
});
