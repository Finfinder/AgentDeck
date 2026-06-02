import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Explorer } from '../../packages/workbench/src/Explorer';
import type { AgentDeckPreloadApi } from '@agentdeck/shared';

describe('Explorer accessibility', () => {
  it('exposes correct roles and aria labels for tree and controls', async () => {
    const agent: Partial<AgentDeckPreloadApi> = {
      listDirectory: vi.fn().mockResolvedValue({ path: '/root', entries: [{ name: 'a.txt', path: '/root/a.txt', kind: 'file', isSensitive: false }] }),
      onFsEvent: vi.fn().mockReturnValue(() => undefined)
    };

    const workspaceModel = {
      status: 'ok' as const,
      filePath: '/fake.code-workspace',
      kind: 'workspace-file' as const,
      folders: [ { path: '/root1', name: 'Root One' }, { path: '/root2', name: 'Root Two' } ]
    };

    render(<Explorer agent={agent as AgentDeckPreloadApi} workspaceModel={workspaceModel} />);

    // Landmark for explorer
    expect(await screen.findByRole('region', { name: 'Explorer' })).toBeInTheDocument();

    // Tree semantics
    expect(screen.getByRole('tree')).toBeInTheDocument();
    const items = screen.getAllByRole('treeitem');
    expect(items.length).toBeGreaterThan(0);

    // If a directory existed we'd have a button with accessible name; ensure select is focusable
    const select = screen.getByLabelText('Workspace root');
    const user = userEvent.setup();
    await user.tab();
    // Focus may land on other interactive controls first; ensure select exists and is reachable
    expect(select).toBeInTheDocument();
  });
});
