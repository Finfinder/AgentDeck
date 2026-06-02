import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentDeckPreloadApi, EditorTab, FileReadResult } from '@agentdeck/shared';

interface MonacoEditorSurfaceProps {
  readonly agent: AgentDeckPreloadApi;
  readonly tab: EditorTab;
  readonly onDirtyChange: (tabId: string, isDirty: boolean) => void;
  readonly onContentChange: (tabId: string, content: string) => void;
}

type EditorContent = {
  readonly content: string;
  readonly isDirty: boolean;
  readonly originalContent: string;
};

export function MonacoEditorSurface({
  agent,
  tab,
  onDirtyChange,
  onContentChange
}: MonacoEditorSurfaceProps) {
  const [editorContent, setEditorContent] = useState<EditorContent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const initialContentRef = useRef<string>('');

  // Load file content when tab changes.
  useEffect(() => {
    let isActive = true;
    setIsLoading(true);
    setLoadError(null);
    setEditorContent(null);

    agent
      .readFile(tab.filePath)
      .then((result: FileReadResult) => {
        if (!isActive) return;
        if (result.status === 'ok') {
          initialContentRef.current = result.content;
          setEditorContent({
            content: result.content,
            isDirty: false,
            originalContent: result.content
          });
        } else {
          setLoadError(result.message);
          initialContentRef.current = '';
          setEditorContent({
            content: '',
            isDirty: false,
            originalContent: ''
          });
        }
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (!isActive) return;
        const message = err instanceof Error ? err.message : 'Failed to load file.';
        setLoadError(message);
        setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [agent, tab.filePath]);

  const handleEditorDidMount = useCallback((editor: editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
  }, []);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      const content = value ?? '';
      const isDirty = content !== initialContentRef.current;
      setEditorContent({
        content,
        isDirty,
        originalContent: initialContentRef.current
      });
      onDirtyChange(tab.id, isDirty);
      onContentChange(tab.id, content);
    },
    [tab.id, onDirtyChange, onContentChange]
  );

  if (isLoading) {
    return (
      <div className="editor-surface-loading" role="status" aria-label="Loading editor">
        <p>Loading {tab.fileName}�</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="editor-surface-error" role="alert">
        <p>Error loading {tab.fileName}</p>
        <p className="editor-error-message">{loadError}</p>
      </div>
    );
  }

  return (
    <Editor
      height="100%"
      language={tab.language}
      value={editorContent?.content ?? ''}
      theme="vs-dark"
      onMount={handleEditorDidMount}
      onChange={handleEditorChange}
      options={{
        minimap: { enabled: true },
        fontSize: 13,
        lineNumbers: 'on',
        roundedSelection: true,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        renderLineHighlight: 'all',
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on'
      }}
    />
  );
}
