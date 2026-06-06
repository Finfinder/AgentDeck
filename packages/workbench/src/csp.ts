// Small runtime helper that reads the generated CSP nonce from
// <meta name="csp-nonce" content="..."> and ensures dynamically
// created <style> elements receive the nonce attribute so they are
// allowed by the CSP (style-src 'nonce-...').
const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="csp-nonce"]') : null;
const nonce = (meta instanceof Element ? meta.getAttribute('content') : null) || null;

if (nonce) {
  // Patch document.createElement so created <style> elements get the nonce
  const origCreate = Document.prototype.createElement as any;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  Document.prototype.createElement = function (tagName: string, options?: ElementCreationOptions) {
    const el = origCreate.call(this, tagName);
    try {
      if (typeof tagName === 'string' && tagName.toLowerCase() === 'style' && !el.getAttribute('nonce')) {
        el.setAttribute('nonce', nonce);
      }
    } catch (e) {
      console.warn('[csp] failed to set nonce on created style element', e);
    }
    return el;
  };

  // Also ensure any existing <style> elements have the nonce
  document.querySelectorAll('style').forEach((s) => {
    try {
      if (!s.getAttribute('nonce')) s.setAttribute('nonce', nonce);
    } catch (e) {
      console.warn('[csp] failed to set nonce on existing style element', e);
    }
  });
}

export {};
