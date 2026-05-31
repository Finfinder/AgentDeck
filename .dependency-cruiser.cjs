module.exports = {
  forbidden: [
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      comment: 'Module boundaries must remain acyclic.',
      from: {},
      to: { circular: true }
    },
    {
      name: 'no-cross-package-internal-imports',
      severity: 'error',
      comment: 'Package internals are not public API.',
      from: { path: '^(apps|packages)/' },
      to: { path: '^packages/[^/]+/src/internal/' }
    },
    {
      name: 'renderer-cannot-import-node-builtins',
      severity: 'error',
      comment: 'The renderer must use versioned preload IPC instead of Node APIs.',
      from: { path: '^packages/workbench/src' },
      to: { dependencyTypes: ['core'] }
    },
    {
      name: 'renderer-cannot-import-electron',
      severity: 'error',
      comment: 'Electron APIs stay in main/preload only.',
      from: { path: '^packages/workbench/src' },
      to: { path: '^electron$' }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      conditionNames: ['import', 'node', 'default'],
      exportsFields: ['exports']
    },
    tsConfig: { fileName: 'tsconfig.typecheck.json' },
    tsPreCompilationDeps: true
  }
};