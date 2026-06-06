import type { ComponentType } from 'react';

interface MockMonacoEditorProps {
  value?: string;
  language?: string;
  theme?: string;
  height?: string;
  onMount?: (editor: unknown, monaco: unknown) => void;
  onChange?: (value: string | undefined) => void;
  options?: Record<string, unknown>;
}

// Create a mock editor instance that matches the Monaco editor interface
// The getLineContent returns content that includes 'const' to test findPatternCol branches
const createMockEditorInstance = (options?: { modelReturnsNull?: boolean; lineContent?: string }) => ({
  revealLineInCenterIfOutsideViewport: () => undefined,
  setPosition: () => undefined,
  setSelection: () => undefined,
  revealRangeInCenterIfOutsideViewport: () => undefined,
  focus: () => undefined,
  getModel: () => {
    if (options?.modelReturnsNull) return null;
    return {
      // Returns content with 'const' at position 0 to test findPatternCol's idxFromStart branch
      // Or custom content for testing pattern not found branch
      getLineContent: (line: number) => options?.lineContent ?? `const x = 1; // line ${line}`,
      getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 100, endColumn: 1 })
    };
  },
  trigger: () => undefined,
  executeEdits: () => undefined,
  getPosition: () => ({ lineNumber: 1, column: 1 })
});

// Mock marker data for testing mapMarkersToDiagnostics - includes all severity types and missing source
const mockMarkers = [
  {
    message: 'Test error message',
    severity: 8, // monaco.MarkerSeverity.Error
    startLineNumber: 10,
    startColumn: 5,
    source: 'typescript'
  },
  {
    message: 'Test warning message',
    severity: 4, // monaco.MarkerSeverity.Warning
    startLineNumber: 15,
    startColumn: 1,
    source: 'eslint'
  },
  {
    message: 'Test info message',
    severity: 2, // monaco.MarkerSeverity.Info
    startLineNumber: 20,
    startColumn: 1
    // No source - tests the nullish coalescing branch
  },
  {
    message: 'Test hint message',
    severity: 1, // monaco.MarkerSeverity.Hint
    startLineNumber: 25,
    startColumn: 1,
    source: 'lsp'
  }
];

const MockMonacoEditor: ComponentType<MockMonacoEditorProps> = ({ value, language, onChange, onMount }) => {
  const handleChange = onChange
    ? (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value);
      }
    : undefined;

  // Call onMount synchronously to trigger editorDidMount logic
  if (onMount) {
    onMount(createMockEditorInstance(), {
      editor: {
        getModelMarkers: () => mockMarkers,
        onDidChangeMarkers: (cb: () => void) => {
          // Call the callback immediately to trigger syncDiagnostics
          setTimeout(cb, 0);
          return { dispose: () => undefined };
        }
      }
    });
  }

  return (
    <div data-testid="monaco-editor-mock" data-language={language ?? 'plaintext'}>
      <pre>{value ?? ''}</pre>
      {handleChange && (
        <textarea
          aria-label="Editor"
          value={value ?? ''}
          onChange={handleChange}
          data-testid="monaco-editor-textarea"
          style={{ position: 'fixed', left: -9999, top: -9999, width: 100, height: 20, opacity: 0.01 }}
        />
      )}
    </div>
  );
};

const loader = { config: () => undefined };

// Expose factory and constants for advanced tests that need to control the mock
// (e.g. testing the `model returns null` branch of MonacoEditorSurface).
const editorMocks = {
  createMockEditorInstance,
  mockMarkers
};

export default MockMonacoEditor;
export { loader, editorMocks };
