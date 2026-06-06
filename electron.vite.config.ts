import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

const alias = {
  '@agentdeck/agent-runtime': resolve(rootDir, 'packages/agent-runtime/src/index.ts'),
  '@agentdeck/services': resolve(rootDir, 'packages/services/src/index.ts'),
  '@agentdeck/shared': resolve(rootDir, 'packages/shared/src/index.ts'),
  '@agentdeck/workbench': resolve(rootDir, 'packages/workbench/src/index.ts')
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
      } catch (err) {
        console.error('[monaco-local-assets] Failed to copy Monaco assets:', err);
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
    resolve: { alias },
    build: {
      emptyOutDir: true,
      outDir: resolve(rootDir, 'out/renderer'),
      rolldownOptions: {
        input: resolve(rootDir, 'packages/workbench/index.html')
      }
    }
  }
});