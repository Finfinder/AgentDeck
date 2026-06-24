import { describe, expect, it } from 'vitest';

import {
  CodeIndexer,
  detectLanguage,
  deterministicChunkId,
  relativePath,
  createCodeIndexer,
  type CodeIndexerOptions,
  type IndexFileResult,
  type RebuildIndexResult
} from '@agentdeck/code-indexer';
import { chunkSource, warmParserLanguages } from '@agentdeck/code-indexer';

describe('index.ts barrel exports', () => {
  it('exports CodeIndexer class', () => {
    expect(CodeIndexer).toBeDefined();
    expect(typeof CodeIndexer).toBe('function');
  });

  it('exports detectLanguage function', () => {
    expect(detectLanguage).toBeDefined();
    expect(typeof detectLanguage).toBe('function');
  });

  it('exports deterministicChunkId function', () => {
    expect(deterministicChunkId).toBeDefined();
    expect(typeof deterministicChunkId).toBe('function');
  });

  it('exports relativePath function', () => {
    expect(relativePath).toBeDefined();
    expect(typeof relativePath).toBe('function');
  });

  it('exports createCodeIndexer function', () => {
    expect(createCodeIndexer).toBeDefined();
    expect(typeof createCodeIndexer).toBe('function');
  });

  it('exports chunkSource function', () => {
    expect(chunkSource).toBeDefined();
    expect(typeof chunkSource).toBe('function');
  });

  it('exports warmParserLanguages function', () => {
    expect(warmParserLanguages).toBeDefined();
    expect(typeof warmParserLanguages).toBe('function');
  });

  it('exports type CodeIndexerOptions', () => {
    // Type-level export — verify it can be used
    const opts: CodeIndexerOptions = { workspaceRoots: [] };
    expect(opts).toBeDefined();
  });

  it('exports type IndexFileResult', () => {
    // Type-level export — verify it can be used
    const result: IndexFileResult = { chunks: [], stored: false };
    expect(result).toBeDefined();
  });

  it('exports type RebuildIndexResult', () => {
    // Type-level export — verify it can be used
    const result: RebuildIndexResult = { chunks: [], stats: { chunks: 0, files: 0, languages: {}, indexVersion: 'v1' } };
    expect(result).toBeDefined();
  });
});
