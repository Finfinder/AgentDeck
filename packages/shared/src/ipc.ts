export const IPC_CHANNELS = {
  getStartupState: 'agentdeck:v1:startup:get-state',
  getThemeSettings: 'agentdeck:v1:settings:get-theme',
  setThemeSettings: 'agentdeck:v1:settings:set-theme',
  selectWorkspaceEntry: 'agentdeck:v1:workspace:select-entry',
  openWorkspace: 'agentdeck:v1:workspace:open',
  listDirectory: 'agentdeck:v1:workspace:list-directory',
  searchFiles: 'agentdeck:v1:workspace:search-files',
  getRecentWorkspaces: 'agentdeck:v1:workspace:get-recent',
  fsEvent: 'agentdeck:v1:workspace:fs-event',
  readFile: 'agentdeck:v1:editor:read-file',
  writeFile: 'agentdeck:v1:editor:write-file',
  getEditorDiagnostics: 'agentdeck:v1:editor:get-diagnostics'
} as const;

export type ThemePreference = 'dark' | 'light';

export type ThemeSettings = Readonly<{
  theme: ThemePreference;
}>;

export const DEFAULT_THEME_SETTINGS = {
  theme: 'dark'
} as const satisfies ThemeSettings;

export type WorkspaceOpenKind = 'folder' | 'workspace-file';

export type WorkspaceOpenRequest = Readonly<{
  kind: WorkspaceOpenKind;
}>;

export type WorkspaceSelection =
  | Readonly<{
      status: 'selected';
      kind: WorkspaceOpenKind;
      path: string;
      name: string;
    }>
  | Readonly<{
      status: 'cancelled';
    }>;

export type StartupServiceDescriptor = Readonly<{
  id: 'workspace-service' | 'agent-runtime' | 'settings-service';
  label: string;
  status: 'ready';
}>;

export type WorkspaceFolder = Readonly<{
  path: string;
  name?: string;
}>;

export type WorkspaceParseErrorCode = 'INVALID_JSONC' | 'FILE_NOT_FOUND' | 'EMPTY_WORKSPACE';

export type WorkspaceModel =
  | Readonly<{
      status: 'ok';
      filePath: string;
      kind: WorkspaceOpenKind;
      folders: readonly WorkspaceFolder[];
    }>
  | Readonly<{
      status: 'error';
      code: WorkspaceParseErrorCode;
      message: string;
    }>;

export type FileEntryKind = 'file' | 'directory';

export type FileEntry = Readonly<{
  name: string;
  path: string;
  kind: FileEntryKind;
  isSensitive: boolean;
}>;

export type DirectoryListing = Readonly<{
  path: string;
  entries: readonly FileEntry[];
}>;

export type SearchQuery = Readonly<{
  pattern: string;
  include?: string | undefined;
  exclude?: string | undefined;
  workspaceRoots: readonly string[];
}>;

export type SearchResult = Readonly<{
  file: string;
  line: number;
  col: number;
  snippet: string;
  isSensitive: boolean;
}>;

export type RecentWorkspace = Readonly<{
  path: string;
  name: string;
  kind: WorkspaceOpenKind;
  lastOpened: number;
}>;

export type FsChangeEventKind = 'add' | 'change' | 'unlink' | 'addDir';

export type FsChangeEvent = Readonly<{
  kind: FsChangeEventKind;
  path: string;
}>;

export type StartupState =
  | Readonly<{
      status: 'ready';
      appVersion: string;
      services: readonly StartupServiceDescriptor[];
    }>
  | Readonly<{
      status: 'error';
      appVersion: string;
      code: 'DESKTOP_SERVICES_UNAVAILABLE' | 'INVALID_STARTUP_STATE';
      message: string;
    }>;

// ?? Editor types ????????????????????????????????????????????????????????????

export type EditorLanguage =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'yaml'
  | 'markdown'
  | 'powershell'
  | 'plaintext';

export type EditorTab = Readonly<{
  id: string;
  filePath: string;
  fileName: string;
  language: EditorLanguage;
  isDirty: boolean;
  isPinned: boolean;
}>;

export type EditorTabInput = Readonly<{
  filePath: string;
}>;

export type FileReadResult =
  | Readonly<{
      status: 'ok';
      content: string;
      encoding: string;
    }>
  | Readonly<{
      status: 'error';
      code: 'FILE_NOT_FOUND' | 'ACCESS_DENIED' | 'ENCODING_ERROR' | 'UNKNOWN';
      message: string;
    }>;

export type FileWriteResult =
  | Readonly<{
      status: 'ok';
    }>
  | Readonly<{
      status: 'error';
      code: 'WRITE_CONFLICT' | 'ACCESS_DENIED' | 'UNKNOWN';
      message: string;
    }>;

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export type EditorDiagnostic = Readonly<{
  filePath: string;
  message: string;
  severity: DiagnosticSeverity;
  line: number;
  col: number;
  source: string;
}>;

export type EditorSplitDirection = 'horizontal' | 'vertical';

export type AgentDeckPreloadApi = Readonly<{
  getStartupState: () => Promise<StartupState>;
  getThemeSettings: () => Promise<ThemeSettings>;
  setThemeSettings: (settings: ThemeSettings) => Promise<ThemeSettings>;
  selectWorkspaceEntry: (request: WorkspaceOpenRequest) => Promise<WorkspaceSelection>;
  openWorkspace: (path: string, kind: WorkspaceOpenKind) => Promise<WorkspaceModel>;
  listDirectory: (path: string) => Promise<DirectoryListing>;
  searchFiles: (query: SearchQuery) => Promise<readonly SearchResult[]>;
  getRecentWorkspaces: () => Promise<readonly RecentWorkspace[]>;
  onFsEvent: (handler: (event: FsChangeEvent) => void) => () => void;
  readFile: (filePath: string) => Promise<FileReadResult>;
  writeFile: (filePath: string, content: string) => Promise<FileWriteResult>;
  getEditorDiagnostics: (filePath: string) => Promise<readonly EditorDiagnostic[]>;
  versions: Readonly<{
    chrome: string;
    electron: string;
    node: string;
  }>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStartupServiceDescriptor(value: unknown): value is StartupServiceDescriptor {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.id === 'workspace-service' || value.id === 'agent-runtime' || value.id === 'settings-service') &&
    typeof value.label === 'string' &&
    value.status === 'ready'
  );
}

export function isThemeSettings(value: unknown): value is ThemeSettings {
  return isRecord(value) && (value.theme === 'dark' || value.theme === 'light');
}

export function isWorkspaceOpenRequest(value: unknown): value is WorkspaceOpenRequest {
  return isRecord(value) && (value.kind === 'folder' || value.kind === 'workspace-file');
}

export function isWorkspaceSelection(value: unknown): value is WorkspaceSelection {
  if (!isRecord(value)) {
    return false;
  }

  if (value.status === 'cancelled') {
    return true;
  }

  return (
    value.status === 'selected' &&
    (value.kind === 'folder' || value.kind === 'workspace-file') &&
    typeof value.path === 'string' &&
    typeof value.name === 'string'
  );
}

export function isStartupState(value: unknown): value is StartupState {
  if (!isRecord(value) || typeof value.appVersion !== 'string') {
    return false;
  }

  if (value.status === 'error') {
    return (
      (value.code === 'DESKTOP_SERVICES_UNAVAILABLE' || value.code === 'INVALID_STARTUP_STATE') &&
      typeof value.message === 'string'
    );
  }

  if (value.status !== 'ready' || !Array.isArray(value.services)) {
    return false;
  }

  return value.services.every(isStartupServiceDescriptor);
}

function isWorkspaceFolder(value: unknown): value is WorkspaceFolder {
  return isRecord(value) && typeof value.path === 'string' && (value.name === undefined || typeof value.name === 'string');
}

export function isWorkspaceModel(value: unknown): value is WorkspaceModel {
  if (!isRecord(value)) return false;

  if (value.status === 'error') {
    return (
      (value.code === 'INVALID_JSONC' || value.code === 'FILE_NOT_FOUND' || value.code === 'EMPTY_WORKSPACE') &&
      typeof value.message === 'string'
    );
  }

  return (
    value.status === 'ok' &&
    typeof value.filePath === 'string' &&
    (value.kind === 'folder' || value.kind === 'workspace-file') &&
    Array.isArray(value.folders) &&
    value.folders.every(isWorkspaceFolder)
  );
}

function isFileEntry(value: unknown): value is FileEntry {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    (value.kind === 'file' || value.kind === 'directory') &&
    typeof value.isSensitive === 'boolean'
  );
}

export function isDirectoryListing(value: unknown): value is DirectoryListing {
  return isRecord(value) && typeof value.path === 'string' && Array.isArray(value.entries) && value.entries.every(isFileEntry);
}

export function isFsChangeEvent(value: unknown): value is FsChangeEvent {
  return (
    isRecord(value) &&
    (value.kind === 'add' || value.kind === 'change' || value.kind === 'unlink' || value.kind === 'addDir') &&
    typeof value.path === 'string'
  );
}

const EDITOR_LANGUAGES: readonly string[] = [
  'typescript', 'javascript', 'json', 'yaml', 'markdown', 'powershell', 'plaintext'
];

export function isEditorLanguage(value: unknown): value is EditorLanguage {
  return typeof value === 'string' && EDITOR_LANGUAGES.includes(value);
}

export function isEditorTab(value: unknown): value is EditorTab {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.filePath === 'string' &&
    typeof value.fileName === 'string' &&
    isEditorLanguage(value.language) &&
    typeof value.isDirty === 'boolean' &&
    typeof value.isPinned === 'boolean'
  );
}

export function isFileReadResult(value: unknown): value is FileReadResult {
  if (!isRecord(value)) return false;
  if (value.status === 'ok') {
    return typeof value.content === 'string' && typeof value.encoding === 'string';
  }
  return (
    value.status === 'error' &&
    (value.code === 'FILE_NOT_FOUND' || value.code === 'ACCESS_DENIED' || value.code === 'ENCODING_ERROR' || value.code === 'UNKNOWN') &&
    typeof value.message === 'string'
  );
}

export function isFileWriteResult(value: unknown): value is FileWriteResult {
  if (!isRecord(value)) return false;
  if (value.status === 'ok') return true;
  return (
    value.status === 'error' &&
    (value.code === 'WRITE_CONFLICT' || value.code === 'ACCESS_DENIED' || value.code === 'UNKNOWN') &&
    typeof value.message === 'string'
  );
}