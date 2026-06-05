import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { editor } from 'monaco-editor';
import { editorRedo, editorSelectAll, editorUndo, getActiveEditor, setActiveEditor } from '../../packages/workbench/src/editor/editor-registry';

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
    revealRangeInCenterIfOutsideViewport: vi.fn()
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
});
