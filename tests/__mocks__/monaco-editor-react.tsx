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

const MockMonacoEditor: ComponentType<MockMonacoEditorProps> = ({ value, language, onChange }) => {
  const handleChange = onChange
    ? (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value);
      }
    : undefined;

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

export default MockMonacoEditor;
export { loader };
