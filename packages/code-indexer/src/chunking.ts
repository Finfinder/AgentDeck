import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import { Language, Parser } from '@vscode/tree-sitter-wasm';
import type { Node as TreeSitterNode } from '@vscode/tree-sitter-wasm';
import type { IndexChunk, MemoryScope } from '@agentdeck/shared';

import { detectLanguage, deterministicChunkId, deterministicChecksum } from './utils';

type TreeSitterLanguage = InstanceType<typeof Language>;
// TreeSitterParser is used as InstanceType<typeof Parser>

const require = createRequire(import.meta.url);

let parserInitPromise: Promise<void> | undefined;
const languagePromises = new Map<string, Promise<TreeSitterLanguage>>();

const TREE_SITTER_LANGUAGES = new Map<string, string>([
  ['typescript', 'tree-sitter-typescript.wasm'],
  ['tsx', 'tree-sitter-tsx.wasm'],
  ['javascript', 'tree-sitter-javascript.wasm'],
  ['json', 'tree-sitter-json.wasm'],
  ['yaml', 'tree-sitter-yaml.wasm'],
  ['markdown', 'tree-sitter-markdown.wasm'],
  ['powershell', 'tree-sitter-powershell.wasm']
]);

const LINE_BASED_ONLY = new Set<string>(['markdown']);

const INTERESTING_NODE_TYPES = new Set<string>([
  'lexical_declaration',
  'function_declaration',
  'method_definition',
  'class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'export_statement',
  'program',
  'module',
  'function_definition',
  'class_definition',
  'if_statement',
  'for_statement',
  'foreach_statement',
  'pipeline'
]);

export async function chunkSource(filePath: string, content: string, scope: MemoryScope | undefined, createdAt: number): Promise<IndexChunk[]> {
  const language = detectLanguage(filePath);
  const folder = dirname(filePath).replaceAll('\\', '/');

  if (LINE_BASED_ONLY.has(language)) {
    if (language === 'markdown') {
      return lineBasedChunks(filePath, language, content, scope, createdAt, chunkMarkdownSections, folder);
    }
  }

  try {
    return await treeSitterChunks(filePath, language, content, scope, createdAt, folder);
  } catch {
    if (language === 'json') {
      return lineBasedChunks(filePath, language, content, scope, createdAt, chunkJsonBlocks, folder);
    }
    if (language === 'yaml') {
      return lineBasedChunks(filePath, language, content, scope, createdAt, chunkYamlBlocks, folder);
    }
    return lineBasedChunks(filePath, language, content, scope, createdAt, chunkCodeBlocks, folder);
  }
}

export async function warmParserLanguages(languages: readonly string[]): Promise<void> {
  const unique = new Set(languages);
  await Promise.all([...unique].map(language => loadLanguage(language)));
}

async function treeSitterChunks(
  filePath: string,
  languageName: string,
  content: string,
  scope: MemoryScope | undefined,
  createdAt: number,
  folder: string
): Promise<IndexChunk[]> {
  const language = await loadLanguage(languageName);
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(content);
  if (tree === null) {
    return lineBasedChunks(filePath, languageName, content, scope, createdAt, chunkCodeBlocks, folder);
  }
  const chunks: IndexChunk[] = [];
  collectInterestingNodes(tree.rootNode, filePath, languageName, scope, createdAt, folder, chunks);

  if (chunks.length === 0) {
    return lineBasedChunks(filePath, languageName, content, scope, createdAt, chunkCodeBlocks, folder);
  }

  return chunks.sort((a, b) => a.startLine - b.startLine || a.text.localeCompare(b.text));
}

function collectInterestingNodes(
  node: TreeSitterNode,
  filePath: string,
  languageName: string,
  scope: MemoryScope | undefined,
  createdAt: number,
  folder: string,
  chunks: IndexChunk[]
): void {
  const height = node.childCount;
  const span = node.endPosition.row - node.startPosition.row;
  const shouldChunk = INTERESTING_NODE_TYPES.has(node.type) || (span >= 2 && height > 0);

  if (shouldChunk) {
    const text = node.text;
    if (text.trim().length > 0) {
      chunks.push(createChunk(filePath, languageName, scope, createdAt, folder, node, text));
    }
  }

  if (height > 0 && span < 30) {
    for (let i = 0; i < height; i++) {
      const child = node.child(i);
      if (child) collectInterestingNodes(child, filePath, languageName, scope, createdAt, folder, chunks);
    }
  }
}

function createChunk(
  filePath: string,
  languageName: string,
  scope: MemoryScope | undefined,
  createdAt: number,
  folder: string,
  node: TreeSitterNode,
  text: string
): IndexChunk {
  const startLine = node.startPosition.row;
  const endLine = node.endPosition.row;
  const checksum = deterministicChecksum(languageName, startLine, text);
  const baseChunk = {
    id: deterministicChunkId(filePath, languageName, startLine, text),
    filePath,
    language: languageName,
    startLine,
    endLine,
    startCol: node.startPosition.column,
    endCol: node.endPosition.column,
    text,
    checksum,
    createdAt,
    metadata: {
      nodeType: node.type,
      folder
    }
  };

  if (scope !== undefined) {
    return { ...baseChunk, scope } satisfies IndexChunk;
  }

  return baseChunk satisfies IndexChunk;
}

async function loadLanguage(languageName: string): Promise<TreeSitterLanguage> {
  const wasmFile = TREE_SITTER_LANGUAGES.get(languageName);
  if (wasmFile === undefined) {
    throw new Error(`Unsupported Tree-sitter language: ${languageName}`);
  }

  const existing = languagePromises.get(languageName);
  if (existing !== undefined) return existing;

  const promise = ensureParser().then(() => resolveWasmAndLoad(wasmFile));
  languagePromises.set(languageName, promise);
  return promise;
}

async function resolveWasmAndLoad(wasmFile: string): Promise<TreeSitterLanguage> {
  const primary = `@vscode/tree-sitter-wasm/wasm/${wasmFile}`;
  try {
    return await Language.load(require.resolve(primary));
  } catch {
    /* primary not found, try fallback */
  }

  const fallback = `tree-sitter-wasms/out/${wasmFile}`;
  try {
    return await Language.load(require.resolve(fallback));
  } catch {
    throw new Error(`WASM grammar not found: ${wasmFile} (tried ${primary} and ${fallback})`);
  }
}

async function ensureParser(): Promise<void> {
  parserInitPromise ??= Parser.init().then(() => undefined);
  await parserInitPromise;
}

function lineBasedChunks(
  filePath: string,
  language: string,
  content: string,
  scope: MemoryScope | undefined,
  createdAt: number,
  blockFn: (lines: readonly string[]) => readonly string[][],
  folder: string
): IndexChunk[] {
  const lines = content.split(/\r?\n/);
  return blockFn(lines)
    .filter((block) => block.length > 0)
    .map((block, index) => {
      const firstLine = block.at(0);
      const lastLine = block.at(-1);
      if (firstLine === undefined || lastLine === undefined) {
        throw new Error('Empty chunk block');
      }

      const startLine = indexOfLine(lines, firstLine);
      const endLine = indexOfLine(lines, lastLine);
      const text = block.join('\n');

      const baseChunk = {
        id: deterministicChunkId(language, String(index), startLine, text),
        filePath,
        language,
        startLine,
        endLine,
        startCol: 0,
        endCol: lastLine.length,
        text,
        checksum: deterministicChecksum(language, startLine, text),
        createdAt,
        metadata: { folder }
      };

      if (scope !== undefined) {
        return { ...baseChunk, scope } satisfies IndexChunk;
      }

      return baseChunk satisfies IndexChunk;
    });
}

function chunkCodeBlocks(lines: readonly string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) blocks.push(current);
  return blocks.length > 0 ? blocks : [lines.length > 0 ? [lines.at(0) as string] : []];
}

function chunkYamlBlocks(lines: readonly string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    if (/^\S/.test(line) && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) blocks.push(current);
  return blocks.length > 0 ? blocks : [lines.length > 0 ? [lines.at(0) as string] : []];
}

function chunkJsonBlocks(lines: readonly string[]): string[][] {
  if (lines.length <= 20) return [lines.filter((line) => line.trim().length > 0)];

  const blocks: string[][] = [];
  let current: string[] = [];
  let depth = 0;

  for (const line of lines) {
    current.push(line);
    depth += countChar(line, '{') + countChar(line, '[') - countChar(line, '}') - countChar(line, ']');
    if (depth <= 0 && current.length > 0) {
      blocks.push(current.filter((blockLine) => blockLine.trim().length > 0));
      current = [];
    }
  }

  if (current.length > 0) blocks.push(current.filter((line) => line.trim().length > 0));
  return blocks.length > 0 ? blocks : [Array.from(lines)];
}

function chunkMarkdownSections(lines: readonly string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    const isHeading = /^#{1,6}\s+/.test(line);
    if (isHeading && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) blocks.push(current);
  return blocks.length > 0 ? blocks : [lines.length > 0 ? [lines.at(0) as string] : []];
}

function indexOfLine(lines: readonly string[], needle: string): number {
  return Math.max(lines.indexOf(needle), 0);
}

function countChar(value: string, char: string): number {
  return value.split(char).length - 1;
}
