export type DomainEntityName =
  | 'ChatTab'
  | 'AgentDefinition'
  | 'Worker'
  | 'AgentTask'
  | 'PatchSet'
  | 'Conflict'
  | 'MemoryEntry'
  | 'RetrievalQuery'
  | 'McpServerProfile'
  | 'ExtensionManifest'
  | 'IdentitySession';

export type ModuleName =
  | 'workbench'
  | 'workspace-service'
  | 'editor-service'
  | 'agent-runtime'
  | 'model-gateway'
  | 'identity-service'
  | 'permission-broker'
  | 'conflict-broker'
  | 'memory-service'
  | 'code-indexer'
  | 'mcp-manager'
  | 'extension-host'
  | 'shared';

export type DomainOwnership = Readonly<{
  entity: DomainEntityName;
  owner: ModuleName;
  publicContract: string;
}>;

export const DOMAIN_OWNERSHIP = [
  { entity: 'ChatTab', owner: 'agent-runtime', publicContract: 'Agent session metadata and event stream references.' },
  { entity: 'AgentDefinition', owner: 'agent-runtime', publicContract: 'Agent name, instructions, model defaults and allowed tools.' },
  { entity: 'Worker', owner: 'agent-runtime', publicContract: 'Isolated task execution lifecycle and permission scope.' },
  { entity: 'AgentTask', owner: 'agent-runtime', publicContract: 'Task status, inputs, result and related patch references.' },
  { entity: 'PatchSet', owner: 'conflict-broker', publicContract: 'Text operations with base file version and risk metadata.' },
  { entity: 'Conflict', owner: 'conflict-broker', publicContract: 'Patch conflict or high-risk change requiring a decision.' },
  { entity: 'MemoryEntry', owner: 'memory-service', publicContract: 'Auditable Markdown-backed memory pointer and checksum.' },
  { entity: 'RetrievalQuery', owner: 'code-indexer', publicContract: 'Semantic search filters for code and memory retrieval.' },
  { entity: 'McpServerProfile', owner: 'mcp-manager', publicContract: 'User/workspace MCP configuration, trust and lifecycle status.' },
  { entity: 'ExtensionManifest', owner: 'extension-host', publicContract: 'Normalized VS Code-like extension manifest subset.' },
  { entity: 'IdentitySession', owner: 'identity-service', publicContract: 'GitHub profile and token availability status without token material.' }
] as const satisfies readonly DomainOwnership[];