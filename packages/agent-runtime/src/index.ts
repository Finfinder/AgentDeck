export type AgentRuntimeCapability = 'chat-tabs' | 'worker-lifecycle' | 'event-log';

export type AgentRuntimeDescriptor = Readonly<{
  status: 'idle';
  capabilities: readonly AgentRuntimeCapability[];
}>;

export function describeAgentRuntime(): AgentRuntimeDescriptor {
  return {
    status: 'idle',
    capabilities: ['chat-tabs', 'worker-lifecycle', 'event-log']
  };
}