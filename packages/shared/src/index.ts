export { DOMAIN_OWNERSHIP } from './domain';
export {
	DEFAULT_THEME_SETTINGS,
	IPC_CHANNELS,
	isDirectoryListing,
	isEditorLanguage,
	isEditorTab,
	isFileReadResult,
	isFileWriteResult,
	isFsChangeEvent,
	isStartupState,
	isThemeSettings,
	isWorkspaceModel,
	isWorkspaceOpenRequest,
	isWorkspaceSelection
} from './ipc';
export { pathBasename, normalizePathStr } from './path';
export type { DomainEntityName, DomainOwnership, ModuleName } from './domain';
export type {
	AgentDeckPreloadApi,
	DiagnosticSeverity,
	DirectoryListing,
	EditorDiagnostic,
	EditorLanguage,
	EditorSplitDirection,
	EditorTab,
	EditorTabInput,
	FileEntry,
	FileEntryKind,
	FileReadResult,
	FileWriteResult,
	FsChangeEvent,
	FsChangeEventKind,
	RecentWorkspace,
	SearchQuery,
	SearchResult,
	StartupServiceDescriptor,
	StartupState,
	ThemePreference,
	ThemeSettings,
	WorkspaceFolder,
	WorkspaceModel,
	WorkspaceOpenKind,
	WorkspaceOpenRequest,
	WorkspaceParseErrorCode,
	WorkspaceSelection
} from './ipc';