import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryReviewDialog } from '../../packages/workbench/src/MemoryReviewDialog';

describe('MemoryReviewDialog', () => {
  const baseConflict = {
    id: 'conflict-1',
    kind: 'memory-conflict' as const,
    proposalId: 'patch-1',
    filePath: '/memory/test.md',
    description: 'Plik został zmodyfikowany przez inny proces.',
    riskLevel: 'medium' as const,
    createdAt: Date.now()
  };

  it('renders conflict description', () => {
    render(
      <MemoryReviewDialog conflict={baseConflict} onResolve={vi.fn()} />
    );
    expect(screen.getByText('Konflikt zapisu pamięci')).toBeDefined();
    expect(screen.getByText('/memory/test.md')).toBeDefined();
    expect(screen.getByText(baseConflict.description)).toBeDefined();
  });

  it('renders action buttons', () => {
    render(
      <MemoryReviewDialog conflict={baseConflict} onResolve={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Pomiń' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Edytuj' })).toBeDefined();
  });

  it('calls onResolve with "skip" when Pomiń is clicked', async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryReviewDialog conflict={baseConflict} onResolve={onResolve} />
    );
    await user.click(screen.getByRole('button', { name: 'Pomiń' }));
    expect(onResolve).toHaveBeenCalledWith('skip');
  });

  it('calls onResolve with "edit" when Edytuj is clicked', async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryReviewDialog conflict={baseConflict} onResolve={onResolve} />
    );
    await user.click(screen.getByRole('button', { name: 'Edytuj' }));
    expect(onResolve).toHaveBeenCalledWith('edit');
  });

  it('renders with critical risk level', () => {
    const conflict = { ...baseConflict, riskLevel: 'critical' as const };
    render(
      <MemoryReviewDialog conflict={conflict} onResolve={vi.fn()} />
    );
    expect(screen.getByText('Konflikt zapisu pamięci')).toBeDefined();
  });

  it('renders with high risk level', () => {
    const conflict = { ...baseConflict, riskLevel: 'high' as const };
    render(
      <MemoryReviewDialog conflict={conflict} onResolve={vi.fn()} />
    );
    expect(screen.getByText('Konflikt zapisu pamięci')).toBeDefined();
  });

  it('renders with low risk level', () => {
    const conflict = { ...baseConflict, riskLevel: 'low' as const };
    render(
      <MemoryReviewDialog conflict={conflict} onResolve={vi.fn()} />
    );
    expect(screen.getByText('Konflikt zapisu pamięci')).toBeDefined();
  });

  it('has correct ARIA attributes', () => {
    render(
      <MemoryReviewDialog conflict={baseConflict} onResolve={vi.fn()} />
    );
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Memory conflict');
  });

  it('displays the conflict kind badge', () => {
    render(
      <MemoryReviewDialog conflict={baseConflict} onResolve={vi.fn()} />
    );
    expect(screen.getByText('memory-conflict')).toBeDefined();
  });
});
