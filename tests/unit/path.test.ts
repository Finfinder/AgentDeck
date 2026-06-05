import { describe, expect, it } from 'vitest';

import { normalizePathStr, pathBasename } from '@agentdeck/shared';

describe('path utilities', () => {
  describe('normalizePathStr', () => {
    it('converts backslashes to forward slashes', () => {
      expect(normalizePathStr('C:\\Users\\Rafal\\project')).toBe('C:/Users/Rafal/project');
    });

    it('removes trailing slash', () => {
      expect(normalizePathStr('/src/components/')).toBe('/src/components');
    });

    it('preserves root slash', () => {
      expect(normalizePathStr('/')).toBe('/');
    });

    it('removes multiple trailing slashes', () => {
      expect(normalizePathStr('/src///')).toBe('/src');
    });

    it('handles empty string', () => {
      expect(normalizePathStr('')).toBe('');
    });

    it('handles null-ish input (coerced to empty)', () => {
      expect(normalizePathStr(undefined as unknown as string)).toBe('');
    });

    it('handles path without slashes', () => {
      expect(normalizePathStr('file.ts')).toBe('file.ts');
    });

    it('handles Windows-style UNC path', () => {
      expect(normalizePathStr('\\\\server\\share\\file')).toBe('//server/share/file');
    });

    it('handles mixed slashes', () => {
      expect(normalizePathStr('/src\\components/App.tsx')).toBe('/src/components/App.tsx');
    });

    it('handles dot segments as-is (no resolution)', () => {
      expect(normalizePathStr('/src/../lib/./file.ts')).toBe('/src/../lib/./file.ts');
    });
  });

  describe('pathBasename', () => {
    it('extracts filename from Unix path', () => {
      expect(pathBasename('/src/app.ts')).toBe('app.ts');
    });

    it('extracts filename from Windows path', () => {
      expect(pathBasename('C:\\Users\\Rafal\\app.ts')).toBe('app.ts');
    });

    it('returns filename when no directory', () => {
      expect(pathBasename('app.ts')).toBe('app.ts');
    });

    it('handles trailing slash', () => {
      expect(pathBasename('/src/components/')).toBe('components');
    });

    it('handles root path', () => {
      expect(pathBasename('/')).toBe('');
    });

    it('handles empty string', () => {
      expect(pathBasename('')).toBe('');
    });

    it('handles nested path', () => {
      expect(pathBasename('/a/b/c/d/file.json')).toBe('file.json');
    });

    it('handles file with no extension', () => {
      expect(pathBasename('/src/Makefile')).toBe('Makefile');
    });

    it('handles dotfile', () => {
      expect(pathBasename('/src/.gitignore')).toBe('.gitignore');
    });

    it('handles path with mixed slashes', () => {
      expect(pathBasename('/src\\components/App.tsx')).toBe('App.tsx');
    });
  });
});
