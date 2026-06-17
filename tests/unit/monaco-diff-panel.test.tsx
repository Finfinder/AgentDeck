import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock monaco-editor ────────────────────────────────────────────────────

const mockModelDispose = vi.fn();
const mockSetModel = vi.fn();
const mockSetTheme = vi.fn();
const mockDiffEditorDispose = vi.fn();

const createMockModel = (value: string) => ({
  getValue: () => value,
  dispose: mockModelDispose,
});

const createMockDiffEditor = () => ({
  setModel: mockSetModel,
  layout: vi.fn(),
  dispose: mockDiffEditorDispose,
});

const mockCreateModel = vi.fn();
const mockCreateDiffEditor = vi.fn();

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeEach(() => {
  mockModelDispose.mockClear();
  mockSetModel.mockClear();
  mockSetTheme.mockClear();
  mockDiffEditorDispose.mockClear();
  mockCreateModel.mockClear();
  mockCreateDiffEditor.mockClear();

  mockCreateModel.mockImplementation((value: string) => createMockModel(value));
  mockCreateDiffEditor.mockImplementation(() => createMockDiffEditor());

  vi.stubGlobal('ResizeObserver', MockResizeObserver);

  vi.doMock('monaco-editor', () => ({
    editor: {
      createModel: mockCreateModel,
      createDiffEditor: mockCreateDiffEditor,
      setTheme: mockSetTheme,
    },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('monaco-editor');
});

// Helper to render with fresh module
async function renderPanel(props: {
  original: string;
  modified: string;
  filePath: string | undefined;
  language: string | undefined;
  theme: 'dark' | 'light' | undefined;
}) {
  const { MonacoDiffPanel } = await import('../../packages/workbench/src/editor/MonacoDiffPanel');
  return render(<MonacoDiffPanel {...props} />);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MonacoDiffPanel', () => {
  describe('resolveLanguage via file extension', () => {
    it('resolves .ts to typescript', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'typescript');
      expect(mockCreateModel).toHaveBeenCalledWith('b', 'typescript');
    });

    it('resolves .tsx to typescript', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.tsx', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'typescript');
    });

    it('resolves .js to javascript', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.js', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'javascript');
    });

    it('resolves .jsx to javascript', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.jsx', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'javascript');
    });

    it('resolves .json to json', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.json', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'json');
    });

    it('resolves .yaml to yaml', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.yaml', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'yaml');
    });

    it('resolves .yml to yaml', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.yml', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'yaml');
    });

    it('resolves .md to markdown', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.md', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'markdown');
    });

    it('resolves .ps1 to powershell', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ps1', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'powershell');
    });

    it('resolves .py to python', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.py', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'python');
    });

    it('resolves .cpp to cpp', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.cpp', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'cpp');
    });

    it('resolves .c to c', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.c', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'c');
    });

    it('resolves .cs to csharp', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.cs', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'csharp');
    });

    it('resolves .css to css', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.css', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'css');
    });

    it('resolves .scss to scss', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.scss', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'scss');
    });

    it('resolves .less to less', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.less', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'less');
    });

    it('resolves .html to html', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.html', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'html');
    });

    it('resolves .dockerfile to dockerfile', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.dockerfile', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'dockerfile');
    });

    it('falls back to plaintext for unknown extension', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.xyz', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'plaintext');
    });

    it('falls back to plaintext when filePath is undefined', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: undefined, language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'plaintext');
    });

    it('uses explicit language prop over file extension', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: 'python', theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'python');
    });
  });

  describe('theme handling', () => {
    it('applies vs-dark theme for dark', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: undefined, theme: 'dark' });
      expect(mockSetTheme).toHaveBeenCalledWith('vs-dark');
    });

    it('applies light theme for light', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: undefined, theme: 'light' });
      expect(mockSetTheme).toHaveBeenCalledWith('light');
    });

    it('defaults to dark theme when theme is undefined', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: undefined, theme: undefined });
      expect(mockSetTheme).toHaveBeenCalledWith('vs-dark');
    });
  });

  describe('diff editor creation', () => {
    it('creates models for original and modified content', async () => {
      await renderPanel({ original: 'original content', modified: 'modified content', filePath: 'test.ts', language: undefined, theme: 'dark' });
      expect(mockCreateModel).toHaveBeenCalledTimes(2);
      expect(mockCreateModel).toHaveBeenCalledWith('original content', 'typescript');
      expect(mockCreateModel).toHaveBeenCalledWith('modified content', 'typescript');
    });

    it('creates diff editor with correct options', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: undefined, theme: 'dark' });
      expect(mockCreateDiffEditor).toHaveBeenCalledTimes(1);
      const options = mockCreateDiffEditor.mock.calls[0]![1];
      expect(options.readOnly).toBe(true);
      expect(options.renderSideBySide).toBe(true);
      expect(options.renderOverviewRuler).toBe(true);
      expect(options.ignoreTrimWhitespace).toBe(false);
      expect(options.minimap).toEqual({ enabled: false });
    });

    it('sets model on diff editor', async () => {
      await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: undefined, theme: 'dark' });
      expect(mockSetModel).toHaveBeenCalledTimes(1);
      const modelArg = mockSetModel.mock.calls[0]![0];
      expect(modelArg).toHaveProperty('original');
      expect(modelArg).toHaveProperty('modified');
    });
  });

  describe('cleanup on unmount', () => {
    it('disposes models on unmount', async () => {
      const { unmount } = await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: undefined, theme: 'dark' });
      unmount();
      expect(mockModelDispose).toHaveBeenCalledTimes(2);
    });

    it('disposes diff editor on unmount', async () => {
      const { unmount } = await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: undefined, theme: 'dark' });
      unmount();
      expect(mockDiffEditorDispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('re-render on prop change', () => {
    it('recreates editor when original content changes', async () => {
      const { rerender } = await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: undefined, theme: 'dark' });
      mockCreateModel.mockClear();
      mockCreateDiffEditor.mockClear();

      const { MonacoDiffPanel } = await import('../../packages/workbench/src/editor/MonacoDiffPanel');
      rerender(<MonacoDiffPanel original="a2" modified="b" filePath="test.ts" language={undefined} theme="dark" />);
      expect(mockCreateModel).toHaveBeenCalledTimes(2);
      expect(mockCreateDiffEditor).toHaveBeenCalledTimes(1);
    });

    it('recreates editor when language changes', async () => {
      const { rerender } = await renderPanel({ original: 'a', modified: 'b', filePath: undefined, language: 'python', theme: 'dark' });
      mockCreateModel.mockClear();

      const { MonacoDiffPanel } = await import('../../packages/workbench/src/editor/MonacoDiffPanel');
      rerender(<MonacoDiffPanel original="a" modified="b" filePath={undefined} language="rust" theme="dark" />);
      expect(mockCreateModel).toHaveBeenCalledWith('a', 'rust');
    });

    it('disposes previous editor before creating new one', async () => {
      const { rerender } = await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: undefined, theme: 'dark' });
      mockDiffEditorDispose.mockClear();

      const { MonacoDiffPanel } = await import('../../packages/workbench/src/editor/MonacoDiffPanel');
      rerender(<MonacoDiffPanel original="a2" modified="b" filePath="test.ts" language={undefined} theme="dark" />);
      expect(mockDiffEditorDispose).toHaveBeenCalledTimes(1);
    });
  });

  describe('container rendering', () => {
    it('renders a div container with correct class', async () => {
      const { container } = await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: undefined, theme: 'dark' });
      const panelDiv = container.querySelector('.monaco-diff-panel');
      expect(panelDiv).not.toBeNull();
    });

    it('sets data-theme attribute', async () => {
      const { container } = await renderPanel({ original: 'a', modified: 'b', filePath: 'test.ts', language: undefined, theme: 'light' });
      const panelDiv = container.querySelector('.monaco-diff-panel');
      expect(panelDiv).not.toBeNull();
      expect(panelDiv!.getAttribute('data-theme')).toBe('light');
    });
  });
});
