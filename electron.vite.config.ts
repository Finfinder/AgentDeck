import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

const alias = {
  '@agentdeck/agent-runtime': resolve(rootDir, 'packages/agent-runtime/src/index.ts'),
  '@agentdeck/services': resolve(rootDir, 'packages/services/src/index.ts'),
  '@agentdeck/shared': resolve(rootDir, 'packages/shared/src/index.ts'),
  '@agentdeck/workbench': resolve(rootDir, 'packages/workbench/src/index.ts')
};

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
    plugins: [react()],
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