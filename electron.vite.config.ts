import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

const alias = {
  '@agentdeck/agent-runtime': resolve(rootDir, 'packages/agent-runtime/src/index.ts'),
  '@agentdeck/services': resolve(rootDir, 'packages/services/src/index.ts'),
  '@agentdeck/shared': resolve(rootDir, 'packages/shared/src/index.ts'),
  '@agentdeck/workbench': resolve(rootDir, 'packages/workbench/src/index.ts'),
  '@agentdeck/memory-service': resolve(rootDir, 'packages/memory-service/src/index.ts'),
  '@agentdeck/code-indexer': resolve(rootDir, 'packages/code-indexer/src/index.ts')
};

/**
 * Vite plugin that makes Monaco Editor runtime assets available locally
 * instead of relying on a CDN at runtime.
 *
 * - In dev mode: adds middleware to serve Monaco files from node_modules.
 * - In build mode: copies Monaco files into the renderer output directory.
 */
function monacoLocalAssetsPlugin() {
  const monacoSrc = resolve(rootDir, 'node_modules/monaco-editor/min/vs');

  return {
    name: 'monaco-local-assets',
    configureServer(server) {
      // In dev mode, serve Monaco assets from node_modules under /monaco-editor
      server.middlewares.use('/monaco-editor/min/vs', (req, res, next) => {
        if (!req.url) return next();
        const filePath = resolve(monacoSrc, req.url.replace(/^\//, ''));
        if (!existsSync(filePath)) return next();
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.end(readFileSync(filePath));
      });

      // Serve index.html with a fresh CSP nonce injected on each request.
      server.middlewares.use((req, res, next) => {
        try {
          if (!req.url) return next();
          const url = req.url.split('?')[0];
          if (url === '/' || url.endsWith('/index.html')) {
            const srcIndex = resolve(rootDir, 'packages/workbench/index.html');
            let html = readFileSync(srcIndex, 'utf8');
            const nonce = randomBytes(16).toString('base64');
            html = html.replaceAll('__CSP_NONCE__', nonce);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
            return;
          }
        } catch (err) {
          console.warn('[monaco-local-assets] failed to serve index.html with injected nonce', err);
          return next();
        }
        return next();
      });
    },
    writeBundle(_options: unknown, bundle: Record<string, unknown>) {
      const firstChunkKey = Object.keys(bundle)[0];
      if (!firstChunkKey) return;
      const firstChunk = bundle[firstChunkKey] as { fileName?: string };
      if (!firstChunk?.fileName) return;

      const outDir = resolve(rootDir, 'out/renderer');
      const monacoDest = resolve(outDir, 'monaco-editor/min/vs');

      if (!existsSync(monacoSrc)) {
        console.warn('[monaco-local-assets] Source not found:', monacoSrc);
        return;
      }

      try {
        mkdirSync(monacoDest, { recursive: true });
        cpSync(monacoSrc, monacoDest, { recursive: true, force: true });
        console.log('[monaco-local-assets] Copied Monaco assets to', monacoDest);

        // Replace CSP nonce placeholder in emitted index.html with a build-time nonce
        const outIndex = resolve(rootDir, 'out/renderer/index.html');
        if (existsSync(outIndex)) {
          const nonce = randomBytes(16).toString('base64');
          const content = readFileSync(outIndex, 'utf8');
          const replaced = content.replaceAll('__CSP_NONCE__', nonce);
          writeFileSync(outIndex, replaced, 'utf8');
          console.log('[monaco-local-assets] Injected CSP nonce into', outIndex);
        }
      } catch (err) {
        console.error('[monaco-local-assets] Failed to copy Monaco assets or inject nonce:', err);
      }
    }
  };
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      externalizeDeps: true,
      rolldownOptions: {
        input: resolve(rootDir, 'apps/desktop/src/main/index.ts')
      }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      externalizeDeps: true,
      rolldownOptions: {
        input: resolve(rootDir, 'apps/desktop/src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: resolve(rootDir, 'packages/workbench'),
    plugins: [
      react(),
      // Copy Monaco's runtime files from node_modules into the renderer output so
      // the app can load Monaco assets locally (avoids a runtime CDN dependency).
      monacoLocalAssetsPlugin()
    ],
    resolve: {
      alias: {
        ...alias,
        keytar: resolve(rootDir, 'packages/workbench/src/keytar-mock.ts')
      }
    },
    build: {
      emptyOutDir: true,
      outDir: resolve(rootDir, 'out/renderer'),
      rolldownOptions: {
        input: resolve(rootDir, 'packages/workbench/index.html')
      }
    }
  }
});