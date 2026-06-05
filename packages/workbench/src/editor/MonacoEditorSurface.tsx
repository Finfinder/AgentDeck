import Editor, { loader, type Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { type editor, Selection, Range } from 'monaco-editor';

// Ensure @monaco-editor/react uses the same monaco instance as our direct import.
// Without this, getModelMarkers(), getModels() etc. see a different registry.
loader.config({ monaco });
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentDeckPreloadApi, EditorDiagnostic, EditorTab, FileReadResult } from '@agentdeck/shared';

import { setActiveEditor } from './editor-registry';

/** Find the start column of the pattern on the given line. Returns 1-indexed col or null. */
function findPatternCol(
  model: editor.ITextModel,
  line: number,
  startCol: number,
  pattern: string
): number | null {
  const lineContent = model.getLineContent(line);
  const searchFrom = startCol - 1; // col is 1-indexed
  const idx = lineContent.indexOf(pattern, searchFrom);
  if (idx !== -1) return idx + 1;
  // Try searching from the beginning of the line
  const idxFromStart = lineContent.indexOf(pattern);
  if (idxFromStart !== -1) return idxFromStart + 1;
  return null;
}

/** Reveal line, set cursor, and highlight the matched pattern. */
function revealAndSelect(
  monacoEditor: editor.IStandaloneCodeEditor,
  line: number,
  col: number,
  pattern: string | null
): void {
  // Use requestAnimationFrame to ensure the editor has rendered the content.
  requestAnimationFrame(() => {
    monacoEditor.revealLineInCenterIfOutsideViewport(line);

    const model = monacoEditor.getModel();
    if (pattern == null || model == null) {
      monacoEditor.setPosition({ lineNumber: line, column: col });
      return;
    }
    const matchCol = findPatternCol(model, line, col, pattern);
    if (matchCol === null) {
      monacoEditor.setPosition({ lineNumber: line, column: col });
      return;
    }
    const endCol = matchCol + pattern.length - 1;
    monacoEditor.setSelection(new Selection(line, matchCol, line, endCol));
    monacoEditor.revealRangeInCenterIfOutsideViewport(new Range(line, matchCol, line, endCol));

    monacoEditor.focus();
  });
}

/** Convert Monaco marker severity to EditorDiagnostic severity. */
function markerSeverityToDiagnostic(severity: monaco.MarkerSeverity): 'error' | 'warning' | 'info' | 'hint' {
  if (severity === monaco.MarkerSeverity.Error) return 'error';
  if (severity === monaco.MarkerSeverity.Warning) return 'warning';
  if (severity === monaco.MarkerSeverity.Info) return 'info';
  return 'hint';
}

/** Map Monaco markers to EditorDiagnostic array. */
function mapMarkersToDiagnostics(
  markers: monaco.editor.IMarker[],
  filePath: string
): readonly EditorDiagnostic[] {
  return markers.map(marker => ({
    filePath,
    message: marker.message,
    severity: markerSeverityToDiagnostic(marker.severity),
    line: marker.startLineNumber,
    col: marker.startColumn,
    source: marker.source ?? 'monaco'
  }));
}

interface MonacoEditorSurfaceProps {
  readonly agent: AgentDeckPreloadApi;
  readonly tab: EditorTab;
  readonly onDirtyChange: (tabId: string, isDirty: boolean) => void;
  readonly onContentChange: (tabId: string, content: string) => void;
  readonly onDiagnosticsChange?: (diagnostics: readonly EditorDiagnostic[]) => void;
  readonly theme: 'dark' | 'light';
}

type EditorContent = {
  readonly content: string;
};

export function MonacoEditorSurface({
  agent,
  tab,
  onDirtyChange,
  onContentChange,
  onDiagnosticsChange,
  theme
}: MonacoEditorSurfaceProps) {
  const [editorContent, setEditorContent] = useState<EditorContent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const initialContentRef = useRef<string>('');
  const markersListenerRef = useRef<{ dispose(): void } | null>(null);

  // Configure TS/JS language workers once (must be before any conditional returns)
  // Uses monaco.languages.typescript which is deprecated in Monaco 0.55 but still
  // the only API to configure TS worker diagnostics. No replacement exists yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tsConfiguredRef = useRef(false);
  if (!tsConfiguredRef.current) {
    tsConfiguredRef.current = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tsDefaults = (monaco.languages as any)?.typescript?.typescriptDefaults;
    if (tsDefaults) {
      tsDefaults.setEagerModelSync(true);
      tsDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsDefaults = (monaco.languages as any)?.typescript?.javascriptDefaults;
    if (jsDefaults) {
      jsDefaults.setEagerModelSync(true);
      jsDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
    }
  }

  // Load file content when tab changes.
  useEffect(() => {
    let isActive = true;
    setIsLoading(true);
    setLoadError(null);
    setEditorContent(null);

    console.log('[MonacoEditorSurface] Loading file:', tab.filePath);

    agent
      .readFile(tab.filePath)
      .then((result: FileReadResult) => {
        if (isActive) {
          if (result.status === 'ok') {
            console.log('[MonacoEditorSurface] readFile result:', result.status, 'content length:', result.content.length);
            initialContentRef.current = result.content;
            setEditorContent({ content: result.content });
          } else {
            console.log('[MonacoEditorSurface] readFile result:', result.status, result.message);
            setLoadError(result.message);
            initialContentRef.current = '';
            setEditorContent({ content: '' });
          }
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isActive) {
          const message = err instanceof Error ? err.message : 'Failed to load file.';
          console.error('[MonacoEditorSurface] readFile error:', message);
          setLoadError(message);
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [agent, tab.filePath]);

  const handleEditorDidMount = useCallback((monacoEditor: editor.IStandaloneCodeEditor, monacoInstance: Monaco) => {
    editorRef.current = monacoEditor;
    setActiveEditor(monacoEditor);
    // Auto-focus the editor so keyboard input works immediately.
    monacoEditor.focus();

    // Reveal line/col from search result navigation (initial mount).
    if (tab.revealLine !== null) {
      revealAndSelect(monacoEditor, tab.revealLine, tab.revealCol ?? 1, tab.revealPattern);
    }

    // Sync diagnostics from Monaco language services into the Problems panel.
    const syncDiagnostics = () => {
      const currentModel = monacoEditor.getModel();
      if (!currentModel) return;
      const markers = monacoInstance.editor.getModelMarkers({ resource: currentModel.uri });
      onDiagnosticsChange?.(mapMarkersToDiagnostics(markers, tab.filePath));
    };

    // Initial sync after language worker finishes analysis
    const initialTimer = setTimeout(syncDiagnostics, 2000);

    // Poll for marker changes every 3s (language workers don't always fire events)
    const pollInterval = setInterval(syncDiagnostics, 3000);

    // Also subscribe to explicit marker change events
    const markerDispose = monacoInstance.editor.onDidChangeMarkers(syncDiagnostics);

    markersListenerRef.current = { dispose: () => { clearTimeout(initialTimer); clearInterval(pollInterval); markerDispose.dispose(); } };
  }, [tab.filePath, tab.revealLine, tab.revealCol, tab.revealPattern, onDiagnosticsChange]);

  // Reveal line/col when tab properties or nonce change (nonce increments on each search click,
  // ensuring the same line can be re-revealed when switching back to an already-open tab).
  useEffect(() => {
    const ed = editorRef.current;
    if (ed && tab.revealLine !== null) {
      revealAndSelect(ed, tab.revealLine, tab.revealCol ?? 1, tab.revealPattern);
    }
  }, [tab.revealLine, tab.revealCol, tab.revealPattern, tab.revealNonce]);

  // Unregister on unmount.
  // Cleanup on unmount only.
  useEffect(() => {
    return () => {
      setActiveEditor(null);
      markersListenerRef.current?.dispose();
      markersListenerRef.current = null;
    };
  }, []);

  const handleEditorChange = useCallback(
    (value = '') => {
      const isDirty = value !== initialContentRef.current;
      onDirtyChange(tab.id, isDirty);
      onContentChange(tab.id, value);
      if (isDirty) {
        agent.markBufferDirty(tab.filePath).catch(() => {
          // Best-effort: buffer dirty tracking is non-critical for UI.
        });
      }
    },
    [tab.id, tab.filePath, onDirtyChange, onContentChange, agent]
  );

  if (isLoading) {
    return (
      <output
        className="editor-surface-loading"
        style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-editor)' }}
        aria-live="polite"
        aria-label={`Loading ${tab.fileName}`}
      >
        <p>Loading {tab.fileName}</p>
      </output>
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
      key={tab.id}
      height="100%"
      language={tab.language}
      value={editorContent?.content ?? ''}
      theme={theme === 'light' ? 'vs' : 'vs-dark'}
      onMount={handleEditorDidMount}
      onChange={handleEditorChange}
      options={{
        minimap: { enabled: false },
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
