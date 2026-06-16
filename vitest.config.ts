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
      '@monaco-editor/react': resolve(rootDir, 'tests/__mocks__/monaco-editor-react.tsx'),
      keytar: resolve(rootDir, 'packages/workbench/src/keytar-mock.ts')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
      exclude: [
        'apps/desktop/src/main/**',
        'apps/desktop/src/preload/**',
        'packages/**/src/index.ts',
        'packages/workbench/src/main.tsx',
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
