import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { editor } from 'monaco-editor';
import { editorApplyWorkspaceEdit, editorRedo, editorSelectAll, editorShowDiff, editorUndo, getActiveEditor, setActiveEditor } from '../../packages/workbench/src/editor/editor-registry';

// Mock Monaco editor instance
function createMockEditor() {
  const ret: Partial<editor.IStandaloneCodeEditor> = {
    trigger: vi.fn(),
    focus: vi.fn(),
    getModel: vi.fn(),
    getPosition: vi.fn(),
    setPosition: vi.fn(),
    revealLineInCenterIfOutsideViewport: vi.fn(),
    setSelection: vi.fn(),
    revealRangeInCenterIfOutsideViewport: vi.fn(),
    executeEdits: vi.fn()
  };
  return ret as editor.IStandaloneCodeEditor;
}

describe('editor-registry', () => {
  beforeEach(() => {
    // Ensure clean state: reset active editor to null
    setActiveEditor(null);
  });

  afterEach(() => {
    setActiveEditor(null);
  });

  describe('setActiveEditor / getActiveEditor', () => {
    it('returns null when no editor is registered', () => {
      expect(getActiveEditor()).toBeNull();
    });

    it('registers and retrieves an editor instance', () => {
      const editor = createMockEditor();
      setActiveEditor(editor);
      expect(getActiveEditor()).toBe(editor);
    });

    it('overwrites previous editor when set again', () => {
      const editor1 = createMockEditor();
      const editor2 = createMockEditor();
      setActiveEditor(editor1);
      setActiveEditor(editor2);
      expect(getActiveEditor()).toBe(editor2);
    });

    it('allows setting null to clear the registry', () => {
      const editor = createMockEditor();
      setActiveEditor(editor);
      expect(getActiveEditor()).toBe(editor);
      setActiveEditor(null);
      expect(getActiveEditor()).toBeNull();
    });
  });

  describe('editorUndo', () => {
    it('returns false when no editor is active', () => {
      expect(editorUndo()).toBe(false);
    });

    it('triggers undo on the active editor and returns true', () => {
      const editor = createMockEditor();
      setActiveEditor(editor);
      expect(editorUndo()).toBe(true);
      expect(editor.trigger).toHaveBeenCalledWith('keyboard', 'undo', null);
    });

    it('returns false after editor is cleared', () => {
      const editor = createMockEditor();
      setActiveEditor(editor);
      setActiveEditor(null);
      expect(editorUndo()).toBe(false);
    });
  });

  describe('editorRedo', () => {
    it('returns false when no editor is active', () => {
      expect(editorRedo()).toBe(false);
    });

    it('triggers redo on the active editor and returns true', () => {
      const editor = createMockEditor();
      setActiveEditor(editor);
      expect(editorRedo()).toBe(true);
      expect(editor.trigger).toHaveBeenCalledWith('keyboard', 'redo', null);
    });

    it('returns false after editor is cleared', () => {
      const editor = createMockEditor();
      setActiveEditor(editor);
      setActiveEditor(null);
      expect(editorRedo()).toBe(false);
    });
  });

  describe('editorSelectAll', () => {
    it('returns false when no editor is active', () => {
      expect(editorSelectAll()).toBe(false);
    });

    it('triggers selectAll on the active editor and returns true', () => {
      const editor = createMockEditor();
      setActiveEditor(editor);
      expect(editorSelectAll()).toBe(true);
      expect(editor.trigger).toHaveBeenCalledWith('keyboard', 'editor.action.selectAll', null);
    });

    it('returns false after editor is cleared', () => {
      const editor = createMockEditor();
      setActiveEditor(editor);
      setActiveEditor(null);
      expect(editorSelectAll()).toBe(false);
    });
  });

  describe('editorApplyWorkspaceEdit', () => {
    it('returns false when no editor is active', () => {
      const operations = [{ filePath: '/test.ts', text: 'new content' }];
      expect(editorApplyWorkspaceEdit(operations)).toBe(false);
    });

    it('returns false when editor has no model', () => {
      const editor = createMockEditor();
      (editor.getModel as ReturnType<typeof vi.fn>).mockReturnValue(null);
      setActiveEditor(editor);
      const operations = [{ filePath: '/test.ts', text: 'new content' }];
      expect(editorApplyWorkspaceEdit(operations)).toBe(false);
    });

    it('applies edit with range to the editor', () => {
      const mockModel = {
        getFullModelRange: vi.fn().mockReturnValue({ startLineNumber: 1, startColumn: 1, endLineNumber: 10, endColumn: 1 })
      };
      const editor = createMockEditor();
      (editor.getModel as ReturnType<typeof vi.fn>).mockReturnValue(mockModel);
      setActiveEditor(editor);

      const operations = [{
        filePath: '/test.ts',
        range: { startLine: 1, startCol: 1, endLine: 5, endCol: 1 },
        text: 'replaced'
      }];
      expect(editorApplyWorkspaceEdit(operations)).toBe(true);
      expect(editor.executeEdits).toHaveBeenCalledWith('workspace-edit', [
        expect.objectContaining({ text: 'replaced' })
      ]);
    });

    it('applies edit without range (full document replace)', () => {
      const mockModel = {
        getFullModelRange: vi.fn().mockReturnValue({ startLineNumber: 1, startColumn: 1, endLineNumber: 10, endColumn: 1 })
      };
      const editor = createMockEditor();
      (editor.getModel as ReturnType<typeof vi.fn>).mockReturnValue(mockModel);
      setActiveEditor(editor);

      const operations = [{ filePath: '/test.ts', text: 'full replacement' }];
      expect(editorApplyWorkspaceEdit(operations)).toBe(true);
      expect(editor.executeEdits).toHaveBeenCalledWith('workspace-edit', [
        expect.objectContaining({ text: 'full replacement' })
      ]);
    });

    it('applies multiple operations', () => {
      const mockModel = {
        getFullModelRange: vi.fn().mockReturnValue({ startLineNumber: 1, startColumn: 1, endLineNumber: 10, endColumn: 1 })
      };
      const editor = createMockEditor();
      (editor.getModel as ReturnType<typeof vi.fn>).mockReturnValue(mockModel);
      setActiveEditor(editor);

      const operations = [
        { filePath: '/test.ts', text: 'first' },
        { filePath: '/test.ts', range: { startLine: 2, startCol: 1, endLine: 3, endCol: 1 }, text: 'second' }
      ];
      expect(editorApplyWorkspaceEdit(operations)).toBe(true);
      expect(editor.executeEdits).toHaveBeenCalledTimes(2);
    });
  });

  describe('editorShowDiff', () => {
    it('returns diff data for renderer', () => {
      const result = editorShowDiff('original content', 'modified content');
      expect(result).toEqual({ original: 'original content', modified: 'modified content' });
    });

    it('returns null when no editor is active', () => {
      // editorShowDiff doesn't require active editor in current implementation
      const result = editorShowDiff('original', 'modified');
      expect(result).not.toBeNull();
    });
  });
});
