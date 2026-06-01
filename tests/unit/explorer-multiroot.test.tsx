import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Explorer } from '../../packages/workbench/src/Explorer';
import type { AgentDeckPreloadApi } from '@agentdeck/shared';

describe('Explorer multi-root UI', () => {
  it('shows a root selector when multiple workspace folders exist and switches roots', async () => {
    const agent: Partial<AgentDeckPreloadApi> = {
      listDirectory: vi.fn().mockImplementation(async (path: string) => {
        if (path === '/root1') return { path: '/root1', entries: [{ name: 'a.txt', path: '/root1/a.txt', kind: 'file', isSensitive: false }] };
        return { path: '/root2', entries: [{ name: 'b.txt', path: '/root2/b.txt', kind: 'file', isSensitive: false }] };
      }),
      onFsEvent: vi.fn().mockReturnValue(() => undefined)
    };

    const workspaceModel = {
      status: 'ok' as const,
      filePath: '/fake.code-workspace',
      kind: 'workspace-file' as const,
      folders: [
        { path: '/root1', name: 'Root One' },
        { path: '/root2', name: 'Root Two' }
      ]
    };

    render(<Explorer agent={agent as AgentDeckPreloadApi} workspaceModel={workspaceModel} />);

    // Root selector should be present with both options
    const select = await screen.findByLabelText('Workspace root');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Root One' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Root Two' })).toBeInTheDocument();

    // Initially entries for root1 should be shown
    expect(await screen.findByText('a.txt')).toBeInTheDocument();

    // Switch to second root
    const user = userEvent.setup();
    await user.selectOptions(select, ['1']);

    // Entries for root2 should be shown after switching
    expect(await screen.findByText('b.txt')).toBeInTheDocument();
  });
});
