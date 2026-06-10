import '@testing-library/jest-dom/vitest';

// Polyfill for jsdom missing clipboard API used by monaco-editor.
if (typeof (document as unknown as Record<string, unknown>).queryCommandSupported !== 'function') {
  (document as unknown as Record<string, unknown>).queryCommandSupported = () => false;
}

// Polyfill for jsdom missing scrollIntoView.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}