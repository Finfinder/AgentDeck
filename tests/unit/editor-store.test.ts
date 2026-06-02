import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useEditorStore } from '@agentdeck/workbench';

describe('useEditorStore', () => {
  it('starts with no tabs', () => {
    const { result } = renderHook(() => useEditorStore());
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBeNull();
  });

  it('opens a tab', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });

    expect(result.current.tabs.length).toBe(1);
    const t = result.current.tabs[0]!;
    expect(t.filePath).toBe('/src/app.ts');
    expect(t.fileName).toBe('app.ts');
    expect(t.language).toBe('typescript');
    expect(result.current.activeTabId).toBe(t.id);
  });

  it('does not duplicate tabs for the same file', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });
    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });

    expect(result.current.tabs.length).toBe(1);
  });

  it('opens multiple tabs for different files', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });
    act(() => {
      result.current.openTab({ filePath: '/src/main.ts' });
    });

    expect(result.current.tabs.length).toBe(2);
  });

  it('closes a tab', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });

    const tabId = result.current.tabs[0]!.id;

    act(() => {
      result.current.closeTab(tabId);
    });

    expect(result.current.tabs.length).toBe(0);
    expect(result.current.activeTabId).toBeNull();
  });

  it('sets active tab', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });
    act(() => {
      result.current.openTab({ filePath: '/src/main.ts' });
    });

    const firstTabId = result.current.tabs[0]!.id;

    act(() => {
      result.current.setActiveTab(firstTabId);
    });

    expect(result.current.activeTabId).toBe(firstTabId);
  });

  it('sets tab dirty state', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });

    const tab = result.current.tabs[0]!;
    const tabId = tab.id;
    expect(tab.isDirty).toBe(false);

    act(() => {
      result.current.setTabDirty(tabId, true);
    });

    expect(result.current.tabs[0]!.isDirty).toBe(true);
  });

  it('sets tab pinned state', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });

    const tab = result.current.tabs[0]!;
    const tabId = tab.id;
    expect(tab.isPinned).toBe(false);

    act(() => {
      result.current.setTabPinned(tabId, true);
    });

    expect(result.current.tabs[0]!.isPinned).toBe(true);
  });

  it('finds tab by path', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });

    const tab = result.current.getTabByPath('/src/app.ts');
    expect(tab).toBeDefined();
    expect(tab?.filePath).toBe('/src/app.ts');

    const missing = result.current.getTabByPath('/src/missing.ts');
    expect(missing).toBeUndefined();
  });

  it('activates existing tab when opening same file', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });

    const tabId = result.current.tabs[0]!.id;

    act(() => {
      result.current.openTab({ filePath: '/src/main.ts' });
    });

    expect(result.current.activeTabId).not.toBe(tabId);

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });

    expect(result.current.tabs.length).toBe(2);
    expect(result.current.activeTabId).toBe(tabId);
  });
});
