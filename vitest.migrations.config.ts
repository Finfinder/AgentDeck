import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agentdeck/agent-runtime': resolve(rootDir, 'packages/agent-runtime/src/index.ts'),
      '@agentdeck/permission-broker': resolve(rootDir, 'packages/permission-broker/src/index.ts'),
      '@agentdeck/services': resolve(rootDir, 'packages/services/src/index.ts'),
      '@agentdeck/shared': resolve(rootDir, 'packages/shared/src/index.ts'),
      '@agentdeck/workbench': resolve(rootDir, 'packages/workbench/src/index.ts'),
      '@agentdeck/memory-service': resolve(rootDir, 'packages/memory-service/src/index.ts'),
      '@agentdeck/code-indexer': resolve(rootDir, 'packages/code-indexer/src/index.ts'),
      // NOTE: intentionally NO alias for 'node:sqlite' — we want the real module
      '@monaco-editor/react': resolve(rootDir, 'tests/__mocks__/monaco-editor-react.tsx'),
      keytar: resolve(rootDir, 'packages/workbench/src/keytar-mock.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/local-store-migrations.test.ts'],
    setupFiles: [],
  },
});
