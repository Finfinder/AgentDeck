export { createLocalStore, LocalStore, LOCAL_STORE_INDEX_VERSION, DEFAULT_EMBEDDING_DIMENSION, DEFAULT_EMBEDDING_MODEL, lexicalEmbedding, float32ToUint8, redactedEventMessage } from '@agentdeck/memory-service';
export type { LocalStoreOptions, AppendEventInput, SearchEmbeddingFilters } from '@agentdeck/memory-service';

export { createMemoryService, MemoryService } from '@agentdeck/memory-service';
export type { MemoryServiceOptions, MemoryEdit, MemoryReadResult, MemoryWriteProposalResult, ListMemoryFilesResult } from '@agentdeck/memory-service';

export { CodeIndexer, detectLanguage, deterministicChunkId, relativePath, createCodeIndexer } from '@agentdeck/code-indexer';
export type { CodeIndexerOptions, IndexFileResult, RebuildIndexResult } from '@agentdeck/code-indexer';
