import * as monaco from 'monaco-editor';
import { type editor } from 'monaco-editor';
import { useEffect, useRef } from 'react';

export interface MonacoDiffPanelProps {
  readonly original: string;
  readonly modified: string;
  readonly filePath: string | undefined;
  readonly language: string | undefined;
  readonly theme: 'dark' | 'light' | undefined;
}

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.ps1': 'powershell',
  '.py': 'python',
  '.cpp': 'cpp',
  '.c': 'c',
  '.cs': 'csharp',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.dockerfile': 'dockerfile'
};

function resolveLanguage(filePath?: string): string {
  if (!filePath) return 'plaintext';
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return LANGUAGE_MAP[ext] ?? 'plaintext';
}

export function MonacoDiffPanel({
  original,
  modified,
  filePath,
  language,
  theme = 'dark'
}: Readonly<MonacoDiffPanelProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  const lang = language ?? resolveLanguage(filePath);
  const monacoTheme = theme === 'light' ? 'light' : 'vs-dark';

  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous editor
    if (diffEditorRef.current) {
      diffEditorRef.current.dispose();
      diffEditorRef.current = null;
    }

    // Create models for original and modified content
    const originalModel = monaco.editor.createModel(original, lang);
    const modifiedModel = monaco.editor.createModel(modified, lang);

    // Create diff editor
    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      readOnly: true,
      renderSideBySide: true,
      renderOverviewRuler: true,
      renderIndicators: true,
      ignoreTrimWhitespace: false,
      diffCodeLens: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: 'on',
      glyphMargin: true,
      folding: true,
      lineDecorationsWidth: 10,
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        useShadows: false
      }
    });

    diffEditorRef.current = diffEditor;

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel
    });

    // Apply theme
    monaco.editor.setTheme(monacoTheme);

    // Fit content to viewport
    const layoutObserver = new ResizeObserver(() => {
      diffEditor.layout();
    });
    layoutObserver.observe(containerRef.current);

    return () => {
      layoutObserver.disconnect();
      originalModel.dispose();
      modifiedModel.dispose();
      diffEditor.dispose();
      diffEditorRef.current = null;
    };
  }, [original, modified, lang, monacoTheme]);

  return (
    <div
      ref={containerRef}
      className="monaco-diff-panel"
      data-theme={theme}
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    />
  );
}
