import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useEditorStore } from '@agentdeck/workbench';

describe('useEditorStore edge cases', () => {
  it('handles closing the only tab', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });

    const tabId = result.current.tabs[0]!.id;

    act(() => {
      result.current.closeTab(tabId);
    });

    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBeNull();
  });

  it('activates next tab when active tab is closed', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });
    act(() => {
      result.current.openTab({ filePath: '/src/main.ts' });
    });

    const firstTabId = result.current.tabs[0]!.id;
    const secondTabId = result.current.tabs[1]!.id;

    // Set first tab as active
    act(() => {
      result.current.setActiveTab(firstTabId);
    });
    expect(result.current.activeTabId).toBe(firstTabId);

    // Close first tab — should activate second
    act(() => {
      result.current.closeTab(firstTabId);
    });

    expect(result.current.tabs.length).toBe(1);
    expect(result.current.activeTabId).toBe(secondTabId);
  });

  it('handles closing non-existent tab gracefully', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });

    expect(() => {
      act(() => {
        result.current.closeTab('non-existent-id');
      });
    }).not.toThrow();

    expect(result.current.tabs.length).toBe(1);
  });

  it('handles setting dirty on non-existent tab', () => {
    const { result } = renderHook(() => useEditorStore());

    expect(() => {
      act(() => {
        result.current.setTabDirty('non-existent', true);
      });
    }).not.toThrow();
  });

  it('handles setting pinned on non-existent tab', () => {
    const { result } = renderHook(() => useEditorStore());

    expect(() => {
      act(() => {
        result.current.setTabPinned('non-existent', true);
      });
    }).not.toThrow();
  });

  it('handles setting active tab to non-existent id', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts' });
    });

    expect(() => {
      act(() => {
        result.current.setActiveTab('non-existent');
      });
    }).not.toThrow();
  });

  it('handles opening tab with line/col/pattern for search navigation', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts', line: 42, col: 10, pattern: 'function' });
    });

    const tab = result.current.tabs[0]!;
    expect(tab.revealLine).toBe(42);
    expect(tab.revealCol).toBe(10);
    expect(tab.revealPattern).toBe('function');
  });

  it('updates reveal properties when opening same file with new line', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/app.ts', line: 10 });
    });

    const tabId = result.current.tabs[0]!.id;
    expect(result.current.tabs[0]!.revealLine).toBe(10);

    // Re-open same file with different line — should activate existing tab
    act(() => {
      result.current.openTab({ filePath: '/src/app.ts', line: 50 });
    });

    expect(result.current.tabs.length).toBe(1);
    expect(result.current.activeTabId).toBe(tabId);
  });

  it('handles empty file path', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '' });
    });

    expect(result.current.tabs.length).toBe(1);
    expect(result.current.tabs[0]!.filePath).toBe('');
  });

  it('preserves tab order when opening multiple files', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab({ filePath: '/src/a.ts' });
    });
    act(() => {
      result.current.openTab({ filePath: '/src/b.ts' });
    });
    act(() => {
      result.current.openTab({ filePath: '/src/c.ts' });
    });

    expect(result.current.tabs.map(t => t.filePath)).toEqual([
      '/src/a.ts',
      '/src/b.ts',
      '/src/c.ts'
    ]);
  });

  it('handles many tabs without errors', () => {
    const { result } = renderHook(() => useEditorStore());

    for (let i = 0; i < 50; i++) {
      act(() => {
        result.current.openTab({ filePath: `/src/file${i}.ts` });
      });
    }

    expect(result.current.tabs.length).toBe(50);
  });
});
