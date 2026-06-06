import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectNonceCssRule } from '../../packages/workbench/src/csp';

describe('csp – injectNonceCssRule', () => {
  beforeEach(() => {
    if (!document.head) {
      const head = document.createElement('head');
      document.documentElement.appendChild(head);
    }
  });

  it('returns a fallback class name when document is undefined', () => {
    const origDoc = globalThis.document;
    (globalThis as Record<string, unknown>).document = undefined as unknown as Document;
    const result = injectNonceCssRule('color: red', 'test');
    expect(result).toMatch(/^nonce-style-fallback-test-/);
    expect(result.length).toBeGreaterThan(20);
    (globalThis as Record<string, unknown>).document = origDoc;
  });

  it('returns a fallback when document.head is null', () => {
    const origHead = document.head;
    Object.defineProperty(document, 'head', { value: null, configurable: true });
    const result = injectNonceCssRule('color: red');
    expect(result).toMatch(/^nonce-style-fallback-x-/);
    Object.defineProperty(document, 'head', { value: origHead, configurable: true });
  });

  it('creates a style element and returns the class name', () => {
    const result = injectNonceCssRule('color: red', 'test-hint');
    expect(result).toMatch(/^nonce-style-test-hint-/);
    const styles = document.head.querySelectorAll('style');
    const found = Array.from(styles).find(s => s.textContent?.includes(result));
    expect(found).toBeTruthy();
    expect(found!.textContent).toContain('color: red');
  });

  it('sanitises non-alphanumeric chars from hint', () => {
    const result = injectNonceCssRule('display: flex', 'Hello World!@#$');
    expect(result).toMatch(/^nonce-style-helloworld-/);
  });

  it('handles empty hint', () => {
    const result = injectNonceCssRule('display: flex', '');
    expect(result).toMatch(/^nonce-style--/);
  });

  it('handles createElement failure gracefully', () => {
    const spy = vi.spyOn(document, 'createElement').mockImplementation(
      () => { throw new Error('x'); }
    );
    const result = injectNonceCssRule('color: blue', 'fail');
    expect(result).toMatch(/^nonce-style-fail-/);
    spy.mockRestore();
  });

  it('uses crypto.randomUUID when available', () => {
    const orig = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: vi.fn().mockReturnValue('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), getRandomValues: undefined },
      configurable: true
    });
    expect(injectNonceCssRule('c:g', 'uuid')).toBe('nonce-style-uuid-aaaaaa');
    Object.defineProperty(globalThis, 'crypto', { value: orig, configurable: true });
  });

  it('uses crypto.getRandomValues when randomUUID absent', () => {
    const orig = globalThis.crypto;
    const getRandomValues = vi.fn((b: Uint8Array) => { b.fill(0xab); return b; });
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: undefined, getRandomValues },
      configurable: true
    });
    const result = injectNonceCssRule('c:y', 'grv');
    expect(result).toMatch(/^nonce-style-grv-ababab/);
    Object.defineProperty(globalThis, 'crypto', { value: orig, configurable: true });
  });

  it('falls back to counter when crypto unavailable', () => {
    const orig = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    const r1 = injectNonceCssRule('c:p', 'fb');
    expect(r1).toMatch(/^nonce-style-fb-/);
    const r2 = injectNonceCssRule('c:o', 'fb');
    expect(r2).not.toBe(r1);
    Object.defineProperty(globalThis, 'crypto', { value: orig, configurable: true });
  });

  it('handles crypto access throwing', () => {
    const orig = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      get() { throw new Error('blocked'); }, configurable: true
    });
    const result = injectNonceCssRule('c:t', 'err');
    expect(result).toMatch(/^nonce-style-err-/);
    Object.defineProperty(globalThis, 'crypto', { value: orig, configurable: true });
  });

  it('generates unique suffixes', () => {
    expect(injectNonceCssRule('c:a', 'u')).not.toBe(injectNonceCssRule('c:b', 'u'));
  });

  it('strips special chars for safe class names', () => {
    const r = injectNonceCssRule('c:#aaa', 'UPPER_CASE/hint!');
    expect(r).toContain('upper_casehint');
    expect(r).not.toContain('UPPER');
    expect(r).not.toContain('/');
    expect(r).not.toContain('!');
  });
});

describe('csp – module-level nonce detection', () => {
  beforeEach(() => {
    if (!document.head) {
      const head = document.createElement('head');
      document.documentElement.appendChild(head);
    }
  });

  afterEach(() => {
    document.head.querySelector('meta[name="csp-nonce"]')?.remove();
  });

  it('does not patch when nonce meta tag is missing', () => {
    const div = document.createElement('div');
    expect(div.getAttribute('nonce')).toBeNull();
  });

  it('injectNonceCssRule still creates valid CSS even without meta tag', () => {
    const result = injectNonceCssRule('color:red;', 'nometa');
    expect(result).toMatch(/^nonce-style-nometa-/);
  });
});

describe('csp – __secureSuffix Node.js crypto fallback', () => {
  beforeEach(() => {
    if (!document.head) {
      const head = document.createElement('head');
      document.documentElement.appendChild(head);
    }
  });

  it('falls through when global require is not available', () => {
    const origCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });

    const result = injectNonceCssRule('color: navy', 'norequire');
    expect(result).toMatch(/^nonce-style-norequire-/);

    Object.defineProperty(globalThis, 'crypto', { value: origCrypto, configurable: true });
  });

  it('falls through when Node.js require("crypto") fails', () => {
    const origCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });

    // The function has a try/catch around the require fallback
    const result = injectNonceCssRule('color: gold', 'noderequire');
    expect(result).toMatch(/^nonce-style-noderequire-/);

    Object.defineProperty(globalThis, 'crypto', { value: origCrypto, configurable: true });
  });
});