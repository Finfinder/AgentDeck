import { describe, it, expect } from 'vitest';
import {
  isThemeSettings,
  isWorkspaceOpenRequest,
  isWorkspaceSelection,
  isStartupState,
  isWorkspaceModel,
  isDirectoryListing,
  isFsChangeEvent
} from '@agentdeck/shared';

describe('packages/shared ipc type guards', () => {
  it('validates theme settings', () => {
    expect(isThemeSettings({ theme: 'dark' })).toBe(true);
    expect(isThemeSettings({ theme: 'light' })).toBe(true);
    expect(isThemeSettings({})).toBe(false);
    expect(isThemeSettings({ theme: 'unknown' } as unknown as { theme: string })).toBe(false);
  });

  it('validates workspace open request', () => {
    expect(isWorkspaceOpenRequest({ kind: 'folder' })).toBe(true);
    expect(isWorkspaceOpenRequest({ kind: 'workspace-file' })).toBe(true);
    expect(isWorkspaceOpenRequest({})).toBe(false);
    expect(isWorkspaceOpenRequest({ kind: 'file' } as unknown as { kind: string })).toBe(false);
  });

  it('validates workspace selection', () => {
    expect(isWorkspaceSelection({ status: 'cancelled' })).toBe(true);

    expect(
      isWorkspaceSelection({
        status: 'selected',
        kind: 'folder',
        path: '/some/path',
        name: 'proj'
      })
    ).toBe(true);

    // invalid: missing name
    expect(
      isWorkspaceSelection({ status: 'selected', kind: 'folder', path: '/x' } as unknown as { status: string; kind: string; path: string; name?: string })
    ).toBe(false);
  });

  it('validates startup state (ready and error)', () => {
    const ready = {
      status: 'ready',
      appVersion: '0.1.0',
      services: [
        { id: 'workspace-service', label: 'Workspace', status: 'ready' }
      ]
    };
    expect(isStartupState(ready)).toBe(true);

    const err = {
      status: 'error',
      appVersion: '0.1.0',
      code: 'DESKTOP_SERVICES_UNAVAILABLE',
      message: 'Unavailable'
    };
    expect(isStartupState(err)).toBe(true);

    // invalid: missing appVersion
    expect(isStartupState({ status: 'ready', services: [] } as unknown as { status: string; appVersion?: string; services?: unknown[] })).toBe(false);
  });

  it('validates workspace model', () => {
    const okModel = {
      status: 'ok',
      filePath: '/wspace.code-workspace',
      kind: 'workspace-file',
      folders: [{ path: '/a', name: 'A' }]
    };
    expect(isWorkspaceModel(okModel)).toBe(true);

    const errModel = {
      status: 'error',
      code: 'INVALID_JSONC',
      message: 'bad'
    };
    expect(isWorkspaceModel(errModel)).toBe(true);

    // invalid: folders not an array
    expect(
      isWorkspaceModel({ status: 'ok', filePath: '/x', kind: 'folder', folders: {} } as unknown as { status: string; filePath: string; kind: string; folders: unknown })
    ).toBe(false);
  });

  it('validates directory listing and file entries', () => {
    const listing = {
      path: '/root',
      entries: [
        { name: 'a.txt', path: '/root/a.txt', kind: 'file', isSensitive: false }
      ]
    };
    expect(isDirectoryListing(listing)).toBe(true);

    // invalid entry
    expect(
      isDirectoryListing({ path: '/root', entries: [{ name: 'x' }] } as unknown as { path: string; entries: unknown[] })
    ).toBe(false);
  });

  it('validates fs change events', () => {
    expect(isFsChangeEvent({ kind: 'add', path: '/a' })).toBe(true);
    expect(isFsChangeEvent({ kind: 'change', path: '/a' })).toBe(true);
    expect(isFsChangeEvent({ kind: 'unlink', path: '/a' })).toBe(true);
    expect(isFsChangeEvent({ kind: 'addDir', path: '/a' })).toBe(true);
    expect(isFsChangeEvent({ kind: 'unknown', path: '/a' } as unknown as { kind: string; path: string })).toBe(false);
  });
});
