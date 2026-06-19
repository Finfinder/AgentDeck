import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@agentdeck/agent-runtime': resolve(rootDir, 'packages/agent-runtime/src/index.ts'),
      '@agentdeck/permission-broker': resolve(rootDir, 'packages/permission-broker/src/index.ts'),
      '@agentdeck/services': resolve(rootDir, 'packages/services/src/index.ts'),
      '@agentdeck/shared': resolve(rootDir, 'packages/shared/src/index.ts'),
      '@agentdeck/workbench': resolve(rootDir, 'packages/workbench/src/index.ts'),
      '@agentdeck/memory-service': resolve(rootDir, 'packages/memory-service/src/index.ts'),
      '@agentdeck/code-indexer': resolve(rootDir, 'packages/code-indexer/src/index.ts'),
      'node:sqlite': resolve(rootDir, 'tests/__mocks__/node-sqlite.ts'),
      '@monaco-editor/react': resolve(rootDir, 'tests/__mocks__/monaco-editor-react.tsx'),
      keytar: resolve(rootDir, 'packages/workbench/src/keytar-mock.ts')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/unit/local-store-migrations.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    ssr: {
      noExternal: ['@agentdeck/memory-service', '@agentdeck/code-indexer', '@agentdeck/services']
    },
    alias: {
      '@agentdeck/agent-runtime': resolve(rootDir, 'packages/agent-runtime/src/index.ts'),
      '@agentdeck/permission-broker': resolve(rootDir, 'packages/permission-broker/src/index.ts'),
      '@agentdeck/services': resolve(rootDir, 'packages/services/src/index.ts'),
      '@agentdeck/shared': resolve(rootDir, 'packages/shared/src/index.ts'),
      '@agentdeck/workbench': resolve(rootDir, 'packages/workbench/src/index.ts'),
      '@agentdeck/memory-service': resolve(rootDir, 'packages/memory-service/src/index.ts'),
      '@agentdeck/code-indexer': resolve(rootDir, 'packages/code-indexer/src/index.ts'),
      'node:sqlite': resolve(rootDir, 'tests/__mocks__/node-sqlite.ts'),
      '@monaco-editor/react': resolve(rootDir, 'tests/__mocks__/monaco-editor-react.tsx'),
      keytar: resolve(rootDir, 'packages/workbench/src/keytar-mock.ts')
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
      exclude: [
        'apps/desktop/src/main/**',
        'apps/desktop/src/preload/**',
        'packages/agent-runtime/src/index.ts',
        'packages/services/src/index.ts',
        'packages/shared/src/index.ts',
        'packages/workbench/src/index.ts',
        'packages/workbench/src/main.tsx',
        'packages/code-indexer/src/code-indexer.ts',
        'packages/code-indexer/src/utils.ts',
        'packages/memory-service/src/memory-service.ts',
        'packages/memory-service/src/local-store.ts',
        'packages/code-indexer/src/chunking.ts',
        'tests/**',
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/*.config.{js,cjs,mjs,ts}',
        'coverage/**',
        'dist/**',
        'out/**',
        'node_modules/**'
      ]
    }
  }
});
