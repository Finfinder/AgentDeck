import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProblemsPanel } from '@agentdeck/workbench';
import type { EditorDiagnostic } from '@agentdeck/shared';

const mockOnDiagnosticClick = vi.fn();

const sampleDiagnostics: readonly EditorDiagnostic[] = [
  {
    filePath: '/workspace/src/app.ts',
    message: "Type 'string' is not assignable to type 'number'.",
    severity: 'error',
    line: 42,
    col: 10,
    source: 'ts'
  },
  {
    filePath: '/workspace/src/utils.ts',
    message: "Variable 'x' is declared but never used.",
    severity: 'warning',
    line: 7,
    col: 5,
    source: 'eslint'
  },
  {
    filePath: '/workspace/src/index.ts',
    message: 'Missing return type annotation.',
    severity: 'info',
    line: 1,
    col: 1,
    source: 'ts'
  },
  {
    filePath: '/workspace/src/helpers.ts',
    message: 'Consider using const instead of let.',
    severity: 'hint',
    line: 15,
    col: 3,
    source: 'eslint'
  }
];

const multiDiagnostics: readonly EditorDiagnostic[] = [
  { filePath: '/workspace/src/a.ts', message: 'Error 1', severity: 'error', line: 1, col: 1, source: 'ts' },
  { filePath: '/workspace/src/b.ts', message: 'Error 2', severity: 'error', line: 2, col: 1, source: 'ts' },
  { filePath: '/workspace/src/c.ts', message: 'Error 3', severity: 'error', line: 3, col: 1, source: 'ts' },
  { filePath: '/workspace/src/d.ts', message: 'Warning 1', severity: 'warning', line: 1, col: 1, source: 'eslint' }
] as const;

describe('ProblemsPanel', () => {
  // --- Empty state ---

  it('shows "No problems detected" when diagnostics are empty', async () => {
    render(<ProblemsPanel diagnostics={[]} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot={null} />);

    await waitFor(() => {
      expect(screen.getByText('No problems detected.')).toBeInTheDocument();
    });
  });

  // --- Grouped rendering ---

  it('groups diagnostics by file with relative path and count', async () => {
    render(<ProblemsPanel diagnostics={sampleDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      expect(screen.getByLabelText('src/app.ts, 1 problems')).toBeInTheDocument();
      expect(screen.getByLabelText('src/utils.ts, 1 problems')).toBeInTheDocument();
      expect(screen.getByLabelText('src/index.ts, 1 problems')).toBeInTheDocument();
      expect(screen.getByLabelText('src/helpers.ts, 1 problems')).toBeInTheDocument();
    });
  });

  it('shows correct count for files with multiple diagnostics', async () => {
    render(<ProblemsPanel diagnostics={multiDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      expect(screen.getByLabelText('src/a.ts, 1 problems')).toBeInTheDocument();
      expect(screen.getByLabelText('src/b.ts, 1 problems')).toBeInTheDocument();
      expect(screen.getByLabelText('src/c.ts, 1 problems')).toBeInTheDocument();
      expect(screen.getByLabelText('src/d.ts, 1 problems')).toBeInTheDocument();
    });
  });

  it('renders all diagnostic messages within groups', async () => {
    render(<ProblemsPanel diagnostics={sampleDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      expect(screen.getByText("Type 'string' is not assignable to type 'number'.")).toBeInTheDocument();
      expect(screen.getByText("Variable 'x' is declared but never used.")).toBeInTheDocument();
      expect(screen.getByText('Missing return type annotation.')).toBeInTheDocument();
      expect(screen.getByText('Consider using const instead of let.')).toBeInTheDocument();
    });
  });

  it('renders line:col for each diagnostic', async () => {
    render(<ProblemsPanel diagnostics={sampleDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      expect(screen.getByText('42:10')).toBeInTheDocument();
      expect(screen.getByText('7:5')).toBeInTheDocument();
      expect(screen.getByText('1:1')).toBeInTheDocument();
      expect(screen.getByText('15:3')).toBeInTheDocument();
    });
  });

  it('renders source for each diagnostic', async () => {
    render(<ProblemsPanel diagnostics={sampleDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      expect(screen.getAllByText('[ts]').length).toBe(2);
      expect(screen.getAllByText('[eslint]').length).toBe(2);
    });
  });

  it('uses basename when workspaceRoot is null', async () => {
    render(<ProblemsPanel diagnostics={sampleDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot={null} />);

    await waitFor(() => {
      expect(screen.getByLabelText('app.ts, 1 problems')).toBeInTheDocument();
      expect(screen.getByLabelText('utils.ts, 1 problems')).toBeInTheDocument();
    });
  });

  // --- Collapse / expand ---

  it('starts with all groups expanded', async () => {
    render(<ProblemsPanel diagnostics={sampleDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      expect(screen.getByText("Type 'string' is not assignable to type 'number'.")).toBeInTheDocument();
    });
  });

  it('collapses a group when clicking the header', async () => {
    const user = userEvent.setup();

    render(<ProblemsPanel diagnostics={sampleDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      expect(screen.getByLabelText('src/app.ts, 1 problems')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('src/app.ts, 1 problems'));

    await waitFor(() => {
      expect(screen.queryByText("Type 'string' is not assignable to type 'number'.")).not.toBeInTheDocument();
    });
  });

  it('expands a group when clicking the collapsed header', async () => {
    const user = userEvent.setup();

    render(<ProblemsPanel diagnostics={sampleDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      expect(screen.getByLabelText('src/app.ts, 1 problems')).toBeInTheDocument();
    });

    // Collapse
    await user.click(screen.getByLabelText('src/app.ts, 1 problems'));
    await waitFor(() => {
      expect(screen.queryByText("Type 'string' is not assignable to type 'number'.")).not.toBeInTheDocument();
    });

    // Expand
    await user.click(screen.getByLabelText('src/app.ts, 1 problems'));
    await waitFor(() => {
      expect(screen.getByText("Type 'string' is not assignable to type 'number'.")).toBeInTheDocument();
    });
  });

  // --- Navigation (onDiagnosticClick) ---

  it('calls onDiagnosticClick with filePath, line, col when clicking a diagnostic', async () => {
    const user = userEvent.setup();

    render(<ProblemsPanel diagnostics={sampleDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      expect(screen.getByText("Type 'string' is not assignable to type 'number'.")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Type 'string' is not assignable to type 'number'."));

    expect(mockOnDiagnosticClick).toHaveBeenCalledWith('/workspace/src/app.ts', 42, 10);
  });

  it('calls onDiagnosticClick with correct params for each diagnostic', async () => {
    const user = userEvent.setup();

    render(<ProblemsPanel diagnostics={sampleDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      expect(screen.getByText("Variable 'x' is declared but never used.")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Variable 'x' is declared but never used."));

    expect(mockOnDiagnosticClick).toHaveBeenCalledWith('/workspace/src/utils.ts', 7, 5);
  });

  // --- Accessibility ---

  it('uses section element with aria-label for the panel', async () => {
    render(<ProblemsPanel diagnostics={[]} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot={null} />);

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Problems' })).toBeInTheDocument();
    });
  });

  it('provides aria-label on each diagnostic button describing severity, message, file and line', async () => {
    render(<ProblemsPanel diagnostics={[sampleDiagnostics[0]] as EditorDiagnostic[]} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      expect(
        screen.getByLabelText("Error: Type 'string' is not assignable to type 'number'. in /workspace/src/app.ts at line 42")
      ).toBeInTheDocument();
    });
  });

  it('marks the problems group list with aria-label showing total and file count', async () => {
    render(<ProblemsPanel diagnostics={sampleDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      expect(screen.getByLabelText('4 problems in 4 files')).toBeInTheDocument();
    });
  });

  it('sets aria-expanded on group headers', async () => {
    render(<ProblemsPanel diagnostics={sampleDiagnostics} onDiagnosticClick={mockOnDiagnosticClick} workspaceRoot="/workspace" />);

    await waitFor(() => {
      const header = screen.getByLabelText('src/app.ts, 1 problems');
      expect(header).toHaveAttribute('aria-expanded', 'true');
    });
  });
});
