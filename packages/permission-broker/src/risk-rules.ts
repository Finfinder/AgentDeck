import type { PermissionActionKind, PermissionGrantScope, PermissionRequest, PermissionRiskLevel } from './contracts';

const RISK_ORDER: Record<PermissionRiskLevel, number> = {
  safe: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const MUTATING_TOOLS = new Set(['create_file', 'apply_patch', 'write_file', 'rename_file', 'delete_file']);
const DESTRUCTIVE_TOOLS = new Set(['delete_file', 'drop_database', 'remove_workspace']);
const SECRET_TOOLS = new Set(['get_api_key', 'set_api_key', 'delete_api_key', 'read_secret', 'write_secret']);
const TERMINAL_TOOLS = new Set(['run_terminal', 'execute_shell', 'terminal']);
const NETWORK_TOOLS = new Set(['fetch_url', 'http_request', 'network_request']);
const MCP_TOOLS = new Set(['mcp_tool', 'mcp_resource', 'mcp_prompt']);
const REGEX_SPECIAL_CHARS = new Set(['|', '\\', '{', '}', '(', ')', '[', ']', '+', '?', '.', '^', '$']);

export function isGlobInsideScope(path: string, glob: string): boolean {
  const normalizedPath = normalizeForScope(path);
  const normalizedGlob = normalizeForScope(glob);

  if (!normalizedGlob.includes('*')) {
    return normalizedPath === normalizedGlob || normalizedPath.startsWith(`${normalizedGlob}/`);
  }

  const regex = globToRegex(normalizedGlob);
  return regex.test(normalizedPath);
}

export function classifyToolRisk(toolName: string, action: PermissionActionKind): PermissionRiskLevel {
  if (SECRET_TOOLS.has(toolName) || action === 'secretsAccess') return 'critical';
  if (DESTRUCTIVE_TOOLS.has(toolName) || action === 'delete') return 'critical';
  if (TERMINAL_TOOLS.has(toolName) || action === 'terminal') return 'high';
  if (NETWORK_TOOLS.has(toolName) || action === 'network') return 'high';
  if (MCP_TOOLS.has(toolName) || action === 'mcpTool') return 'high';
  if (MUTATING_TOOLS.has(toolName) || action === 'write' || action === 'workspaceEdit') return 'medium';
  if (action === 'read') return 'low';
  return 'safe';
}

export function classifyRequestRisk(request: PermissionRequest): PermissionRiskLevel {
  const toolRisk = request.toolName ? classifyToolRisk(request.toolName, request.kind) : classifyToolRisk('', request.kind);
  const targetRisk = classifyTargetRisk(request.target);

  return RISK_ORDER[targetRisk] > RISK_ORDER[toolRisk] ? targetRisk : toolRisk;
}

export function isScopeMatch(request: PermissionRequest, scope: PermissionGrantScope): boolean {
  if (scope.toolName !== undefined && request.toolName !== scope.toolName) return false;
  if (scope.action !== undefined && request.kind !== scope.action) return false;
  if (scope.command !== undefined && String(request.metadata.command ?? '') !== scope.command) return false;
  if (scope.host !== undefined && String(request.metadata.host ?? '') !== scope.host) return false;
  if (scope.mcpServerId !== undefined && String(request.metadata.mcpServerId ?? '') !== scope.mcpServerId) return false;

  const workspaceGlob = scope.workspaceGlob;
  if (workspaceGlob !== undefined) {
    const targets = collectTargets(request);
    if (targets.length === 0) return false;
    return targets.every(target => isGlobInsideScope(target, workspaceGlob));
  }

  return true;
}

function classifyTargetRisk(target: string): PermissionRiskLevel {
  const normalized = target.toLowerCase();

  if (normalized.includes('secret') || normalized.includes('api-key') || normalized.includes('token')) return 'critical';
  if (normalized.includes('.env') || normalized.endsWith('/.env')) return 'critical';
  if (normalized.includes('delete') || normalized.includes('drop') || normalized.includes('remove')) return 'critical';
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return 'high';
  if (normalized.includes('terminal') || normalized.includes('shell')) return 'high';
  return 'safe';
}

function collectTargets(request: PermissionRequest): string[] {
  const metadataTargets = request.metadata.targets;
  if (Array.isArray(metadataTargets)) {
    return metadataTargets.filter((target): target is string => typeof target === 'string');
  }

  const operations = request.metadata.operations;
  if (Array.isArray(operations)) {
    return operations
      .filter((operation): operation is Record<string, unknown> => typeof operation === 'object' && operation !== null)
      .map(operation => operation.filePath)
      .filter((filePath): filePath is string => typeof filePath === 'string');
  }

  return [request.target];
}

function normalizeForScope(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+/g, '/');
}

function globToRegex(glob: string): RegExp {
  let pattern = '';

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;

    if (char === '*') {
      if (glob[index + 1] === '*') {
        pattern += '.*';
        index += 1;
        continue;
      }

      pattern += '[^/]*';
      continue;
    }

    if (char === '?') {
      pattern += '.';
      continue;
    }

    pattern += escapeRegexSpecialChar(char);
  }

  return new RegExp(`^${pattern}$`);
}

function escapeRegexSpecialChar(char: string): string {
  return REGEX_SPECIAL_CHARS.has(char) ? `\\${char}` : char;
}
