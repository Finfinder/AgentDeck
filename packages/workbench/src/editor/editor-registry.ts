import type { editor } from 'monaco-editor';

// Module-level registry holding the currently focused Monaco editor instance.
// MonacoEditorSurface registers on mount; MenuBar uses it for edit actions.

let activeEditor: editor.IStandaloneCodeEditor | null = null;

export function setActiveEditor(ed: editor.IStandaloneCodeEditor | null): void {
  activeEditor = ed;
}

export function getActiveEditor(): editor.IStandaloneCodeEditor | null {
  return activeEditor;
}

export function editorUndo(): boolean {
  if (!activeEditor) return false;
  activeEditor.trigger('keyboard', 'undo', null);
  return true;
}

export function editorRedo(): boolean {
  if (!activeEditor) return false;
  activeEditor.trigger('keyboard', 'redo', null);
  return true;
}

export function editorSelectAll(): boolean {
  if (!activeEditor) return false;
  activeEditor.trigger('keyboard', 'editor.action.selectAll', null);
  return true;
}

// ?? WorkspaceEdit for Monaco ??
// Applies edits to the active Monaco editor instance
export function editorApplyWorkspaceEdit(
  operations: readonly { filePath: string; range?: { startLine: number; startCol: number; endLine: number; endCol: number }; text: string }[]
): boolean {
  if (!activeEditor) return false;

  const model = activeEditor.getModel();
  if (!model) return false;

  // Apply each operation to the editor
  for (const op of operations) {
    if (op.range) {
      const monacoRange = {
        startLineNumber: op.range.startLine,
        startColumn: op.range.startCol,
        endLineNumber: op.range.endLine,
        endColumn: op.range.endCol
      };
      activeEditor.executeEdits('workspace-edit', [{ range: monacoRange, text: op.text, forceMoveMarkers: true }]);
    } else {
      // Replace entire document
      const fullRange = model.getFullModelRange();
      activeEditor.executeEdits('workspace-edit', [{ range: fullRange, text: op.text, forceMoveMarkers: true }]);
    }
  }

  return true;
}

// ?? Diff for Monaco ??
// Creates a diff editor model for showing differences
export function editorShowDiff(original: string, modified: string, filePath?: string): { original: string; modified: string } | null {
  // Return diff data for renderer to display
  // In a full implementation, this would create a diff editor view
  return { original, modified };
}
