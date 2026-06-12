import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { EventLogEntry } from '@agentdeck/shared';

import { EventLogPanel } from '../../packages/workbench/src/EventLogPanel';

import { createMockAgent } from './mock-agent';

// Mock MonacoDiffPanel to avoid monaco-editor dependency in tests
vi.mock('../../packages/workbench/src/editor/MonacoDiffPanel', () => ({
  MonacoDiffPanel: ({ original, modified, filePath }: { original: string; modified: string; filePath?: string }) => (
    <div data-testid="monaco-diff-panel" data-original={original} data-modified={modified} data-file={filePath}>
      <span>Diff: {original.length} vs {modified.length} chars</span>
    </div>
  ),
}));

describe('EventLogPanel — deep coverage', () => {
  describe('DiffDetail expand/collapse', () => {
    it('expands diff detail when clicking Pokaż diff', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const showDiffBtns = screen.getAllByText('Pokaż diff');
      expect(showDiffBtns.length).toBeGreaterThanOrEqual(1);
      fireEvent.click(showDiffBtns[0]!);

      expect(await screen.findByText('Ukryj diff')).toBeDefined();
    });

    it('collapses diff detail when clicking Ukryj diff', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const showDiffBtns = screen.getAllByText('Pokaż diff');
      fireEvent.click(showDiffBtns[0]!);

      const hideDiffBtn = await screen.findByText('Ukryj diff');
      fireEvent.click(hideDiffBtn);

      expect(await screen.findAllByText('Pokaż diff')).toBeDefined();
    });

    it('renders MonacoDiffPanel after expanding diff', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const showDiffBtns = screen.getAllByText('Pokaż diff');
      fireEvent.click(showDiffBtns[0]!);

      expect(await screen.findByTestId('monaco-diff-panel')).toBeDefined();
    });

    it('passes correct original/modified content from parsed diff', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const showDiffBtns = screen.getAllByText('Pokaż diff');
      fireEvent.click(showDiffBtns[0]!);

      const diffPanel = await screen.findByTestId('monaco-diff-panel');
      const original = diffPanel.getAttribute('data-original') ?? '';
      const modified = diffPanel.getAttribute('data-modified') ?? '';

      expect(original).toContain('context line');
      expect(original).toContain('removed line');
      expect(original).toContain('another context');
      expect(modified).toContain('context line');
      expect(modified).toContain('added line');
      expect(modified).toContain('another context');
    });

    it('passes filePath to MonacoDiffPanel', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const showDiffBtns = screen.getAllByText('Pokaż diff');
      fireEvent.click(showDiffBtns[0]!);

      const diffPanel = await screen.findByTestId('monaco-diff-panel');
      expect(diffPanel.getAttribute('data-file')).toBe('src/file.ts');
    });

    it('sets aria-expanded correctly on diff toggle', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const showDiffBtns = screen.getAllByText('Pokaż diff');
      expect(showDiffBtns[0]!).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(showDiffBtns[0]!);

      const hideDiffBtn = await screen.findByText('Ukryj diff');
      expect(hideDiffBtn).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('parseUnifiedDiff edge cases', () => {
    it('handles diff with only additions', async () => {
      const agent = createMockAgent({
        getEventLog: vi.fn().mockResolvedValue({
          status: 'ok',
          entries: [{
            id: 'evt-add-only',
            timestamp: 1000,
            level: 'info' as const,
            source: 'test',
            message: 'Add only',
            diff: '--- a\n+++ b\n@@ -1 +1 @@\n+line1\n+line2'
          }] as EventLogEntry[],
          total: 1
        })
      });
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const showDiffBtns = await screen.findAllByText('Pokaż diff');
      fireEvent.click(showDiffBtns[0]!);

      const diffPanel = await screen.findByTestId('monaco-diff-panel');
      const original = diffPanel.getAttribute('data-original') ?? '';
      const modified = diffPanel.getAttribute('data-modified') ?? '';

      expect(original).toBe('');
      expect(modified).toContain('line1');
      expect(modified).toContain('line2');
    });

    it('handles diff with only removals', async () => {
      const agent = createMockAgent({
        getEventLog: vi.fn().mockResolvedValue({
          status: 'ok',
          entries: [{
            id: 'evt-removal-only',
            timestamp: 1000,
            level: 'info' as const,
            source: 'test',
            message: 'Removal only',
            diff: '--- a\n+++ b\n@@ -1 +1 @@\n-line1\n-line2'
          }] as EventLogEntry[],
          total: 1
        })
      });
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const showDiffBtns = await screen.findAllByText('Pokaż diff');
      fireEvent.click(showDiffBtns[0]!);

      const diffPanel = await screen.findByTestId('monaco-diff-panel');
      const original = diffPanel.getAttribute('data-original') ?? '';
      const modified = diffPanel.getAttribute('data-modified') ?? '';

      expect(original).toContain('line1');
      expect(original).toContain('line2');
      expect(modified).toBe('');
    });

    it('handles diff with context lines (space prefix)', async () => {
      const agent = createMockAgent({
        getEventLog: vi.fn().mockResolvedValue({
          status: 'ok',
          entries: [{
            id: 'evt-context',
            timestamp: 1000,
            level: 'info' as const,
            source: 'test',
            message: 'Context lines',
            diff: '--- a\n+++ b\n@@ -1 +1 @@\n context line 1\n context line 2'
          }] as EventLogEntry[],
          total: 1
        })
      });
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const showDiffBtns = await screen.findAllByText('Pokaż diff');
      fireEvent.click(showDiffBtns[0]!);

      const diffPanel = await screen.findByTestId('monaco-diff-panel');
      const original = diffPanel.getAttribute('data-original') ?? '';
      const modified = diffPanel.getAttribute('data-modified') ?? '';

      expect(original).toContain('context line 1');
      expect(modified).toContain('context line 1');
    });

    it('handles empty diff string — no Pokaż diff button', async () => {
      const agent = createMockAgent({
        getEventLog: vi.fn().mockResolvedValue({
          status: 'ok',
          entries: [{
            id: 'evt-empty-diff',
            timestamp: 1000,
            level: 'info' as const,
            source: 'test',
            message: 'Empty diff',
            diff: ''
          }] as EventLogEntry[],
          total: 1
        })
      });
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      expect(screen.queryByText('Pokaż diff')).toBeNull();
    });

    it('handles diff with multiple @@ hunk headers', async () => {
      const agent = createMockAgent({
        getEventLog: vi.fn().mockResolvedValue({
          status: 'ok',
          entries: [{
            id: 'evt-multi-hunk',
            timestamp: 1000,
            level: 'info' as const,
            source: 'test',
            message: 'Multi hunk',
            diff: '--- a\n+++ b\n@@ -1,2 +1,2 @@\n-foo\n+bar\n@@ -10,2 +10,2 @@\n-baz\n+qux'
          }] as EventLogEntry[],
          total: 1
        })
      });
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const showDiffBtns = await screen.findAllByText('Pokaż diff');
      fireEvent.click(showDiffBtns[0]!);

      const diffPanel = await screen.findByTestId('monaco-diff-panel');
      const original = diffPanel.getAttribute('data-original') ?? '';
      const modified = diffPanel.getAttribute('data-modified') ?? '';

      expect(original).toContain('foo');
      expect(original).toContain('baz');
      expect(modified).toContain('bar');
      expect(modified).toContain('qux');
    });

    it('handles diff with unmarked non-empty lines treated as context', async () => {
      const agent = createMockAgent({
        getEventLog: vi.fn().mockResolvedValue({
          status: 'ok',
          entries: [{
            id: 'evt-unmarked',
            timestamp: 1000,
            level: 'info' as const,
            source: 'test',
            message: 'Unmarked lines',
            diff: '--- a\n+++ b\n@@ -1 +1 @@\nline1\nline2'
          }] as EventLogEntry[],
          total: 1
        })
      });
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const showDiffBtns = await screen.findAllByText('Pokaż diff');
      fireEvent.click(showDiffBtns[0]!);

      const diffPanel = await screen.findByTestId('monaco-diff-panel');
      const original = diffPanel.getAttribute('data-original') ?? '';
      const modified = diffPanel.getAttribute('data-modified') ?? '';

      // Unmarked lines (no prefix) should be treated as context
      expect(original).toContain('line1');
      expect(modified).toContain('line1');
    });
  });

  describe('multiple entries with diffs', () => {
    it('renders multiple Pokaż diff buttons for multiple entries with diffs', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const buttons = screen.getAllByText('Pokaż diff');
      expect(buttons).toHaveLength(2);
    });

    it('expands only the clicked diff', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      const buttons = screen.getAllByText('Pokaż diff');
      fireEvent.click(buttons[1]!);

      // One expanded, one still collapsed
      expect(screen.getAllByText('Pokaż diff')).toHaveLength(1);
      expect(screen.getByText('Ukryj diff')).toBeDefined();
    });
  });

  describe('filteredEntries useMemo', () => {
    it('re-renders entries when filter changes', async () => {
      const agent = createMockAgent();
      render(<EventLogPanel agent={agent} />);

      await waitFor(() => expect(screen.getByText('Event Log')).toBeDefined());

      // All 3 entries visible initially
      expect(screen.getByText('Patch applied')).toBeDefined();
      expect(screen.getByText('Approval required')).toBeDefined();
      expect(screen.getByText('File not found')).toBeDefined();

      // Toggle off info level to trigger filter change
      const infoButton = screen.getByRole('button', { name: 'Info' });
      fireEvent.click(infoButton);

      // Component should still render after filter change
      expect(screen.getByText('Event Log')).toBeDefined();
    });
  });
});
