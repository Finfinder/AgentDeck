// Small runtime helper that reads the generated CSP nonce from
// <meta name="csp-nonce" content="..."> and ensures dynamically
// created <style> elements receive the nonce attribute so they are
// allowed by the CSP (style-src 'nonce-...').
const meta = typeof document === 'undefined' ? null : document.querySelector('meta[name="csp-nonce"]');
const nonce = (meta instanceof Element ? meta.getAttribute('content') : null) || null;

if (nonce) {
  // Patch document.createElement so created <style> elements get the nonce
  const origCreate = Document.prototype.createElement;

  const patchedCreate = function (this: Document, tagName: string, options?: ElementCreationOptions) {
    // Forward to original using apply to handle overloaded signatures safely
    const el = (origCreate as (this: Document, tag: string, opts?: ElementCreationOptions) => HTMLElement).apply(this, arguments as unknown as [string, ElementCreationOptions?]);
    try {
      if (typeof tagName === 'string' && tagName.toLowerCase() === 'style' && !el.getAttribute('nonce')) {
        el.setAttribute('nonce', nonce);
      }
    } catch (e) {
      console.warn('[csp] failed to set nonce on created style element', e);
    }
    return el;
  };

  // Assign the patched function using defineProperty to avoid unsafe casts
  Object.defineProperty(Document.prototype, 'createElement', {
    value: patchedCreate,
    configurable: true,
    writable: true,
  });

  // Also ensure any existing <style> elements have the nonce
  document.querySelectorAll('style').forEach((s) => {
    try {
      if (!s.getAttribute('nonce')) s.setAttribute('nonce', nonce);
    } catch (e) {
      console.warn('[csp] failed to set nonce on existing style element', e);
    }
  });
}

/**
 * Inject a small CSS rule wrapped in a <style nonce> and return the generated class name.
 * The created <style> element will receive the CSP nonce via the createElement patch above.
 * If `document` is not available (SSR / test environment), a deterministic fallback
 * class name is returned so callers can still reference the class name safely.
 */
let __nonce_id_counter = Date.now();

function __secureSuffix(len = 6): string {
  try {
    const c = typeof globalThis === 'undefined' ? undefined : (globalThis as any).crypto;
    if (c) {
      if (typeof c.randomUUID === 'function') {
        return c.randomUUID().split('-').join('').slice(0, len);
      }
      if (typeof c.getRandomValues === 'function') {
        const bytes = new Uint8Array(Math.ceil(len / 2));
        c.getRandomValues(bytes);
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
      }
    }
  } catch (e) {
    console.debug('[csp] web-crypto unavailable, falling back', e);
  }

  try {
    // Node/Electron fallback when `require` is available
    const req = (globalThis as any).require;
    if (typeof req === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodeCrypto = req('crypto');
      if (nodeCrypto && typeof nodeCrypto.randomBytes === 'function') {
        return nodeCrypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
      }
    }
  } catch (e) {
    console.debug('[csp] node crypto fallback failed, falling back', e);
  }

  // Deterministic counter fallback (not a PRNG) to avoid security-sensitive randomness
  __nonce_id_counter = (__nonce_id_counter + 1) % Number.MAX_SAFE_INTEGER;
  return __nonce_id_counter.toString(36).slice(-len).padStart(len, '0');
}

export function injectNonceCssRule(css: string, hint?: string): string {
  if (typeof document === 'undefined' || !document.head) {
    // SSR or test environment: return a stable-but-unused class name
    return `nonce-style-fallback-${(hint || 'x').replace(/[^a-z0-9_-]/gi, '').toLowerCase()}-` + __secureSuffix(6);
  }

  const base = `nonce-style-${(hint || '').replace(/[^a-z0-9_-]/gi, '').toLowerCase()}`;
  const className = `${base}-${__secureSuffix(6)}`;

  try {
    const style = document.createElement('style');
    style.textContent = `.${className}{${css}}`;
    document.head.appendChild(style);
  } catch (err) {
    console.warn('[csp] failed to inject nonce CSS rule', err);
  }

  return className;
}
