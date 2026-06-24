export { createLocalStore, LocalStore, LOCAL_STORE_INDEX_VERSION, DEFAULT_EMBEDDING_DIMENSION, DEFAULT_EMBEDDING_MODEL, float32ToUint8, lexicalEmbedding, redactedEventMessage, type LocalStoreOptions, type AppendEventInput, type SearchEmbeddingFilters } from './local-store';
export { createMemoryService, MemoryService, type MemoryServiceOptions, type MemoryEdit, type MemoryReadResult, type MemoryWriteProposalResult, type ListMemoryFilesResult } from './memory-service';
export { redactSecrets } from './redaction';
