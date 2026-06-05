import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Polyfill for jsdom missing clipboard API used by monaco-editor.
if (typeof (document as any).queryCommandSupported !== 'function') {
  (document as any).queryCommandSupported = () => false;
}