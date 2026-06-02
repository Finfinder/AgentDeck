import type { ComponentType } from 'react';

interface MockMonacoEditorProps {
  value?: string;
  language?: string;
  theme?: string;
  height?: string;
  onMount?: (editor: unknown) => void;
  onChange?: (value: string | undefined) => void;
  options?: Record<string, unknown>;
}

const MockMonacoEditor: ComponentType<MockMonacoEditorProps> = ({ value, language }) => {
  return (
    <div data-testid="monaco-editor-mock" data-language={language ?? 'plaintext'}>
      <pre>{value ?? ''}</pre>
    </div>
  );
};

export default MockMonacoEditor;
