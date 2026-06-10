import type { AgentDeckPreloadApi, WorkspaceModel, WorkspaceOpenKind, WorkspaceSelection } from '@agentdeck/shared';
import type { EditorStore } from './editor/useEditorStore';
import type { ChatStore } from './chat/useChatStore';
import { Explorer } from './Explorer';
import { SearchPanel } from './SearchPanel';

interface SidebarContentProps {
  readonly activePanel: 'explorer' | 'search' | 'chat';
  readonly agent: AgentDeckPreloadApi;
  readonly workspaceModel: WorkspaceModel | null;
  readonly workspaceSelection: WorkspaceSelection | null;
  readonly editorStore: EditorStore;
  readonly chatStore: ChatStore;
  readonly onOpenWorkspace: (kind: WorkspaceOpenKind) => void;
}

export function SidebarContent({
  activePanel,
  agent,
  workspaceModel,
  workspaceSelection,
  editorStore,
  chatStore,
  onOpenWorkspace
}: SidebarContentProps) {
  if (activePanel === 'chat') {
    return (
      <div className="chat-sidebar" aria-label="Chat sessions">
        <button
          className="primary-action"
          type="button"
          onClick={() => { chatStore.createTab(); }}
          style={{ width: '100%', marginBottom: 'var(--space-2)' }}
        >
          New Chat
        </button>
        {chatStore.tabs.length > 0 && (
          <ul className="chat-sidebar-list" aria-label="Chat tabs">
            {chatStore.tabs.map(tab => (
              <li key={tab.id}>
                <button
                  className={`chat-sidebar-item ${tab.id === chatStore.activeTabId ? 'chat-sidebar-item-active' : ''}`}
                  type="button"
                  onClick={() => chatStore.setActiveTabId(tab.id)}
                  title={tab.title}
                >
                  {tab.isStreaming && <span className="chat-tab-streaming-indicator">● </span>}
                  {tab.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="workspace-actions" aria-label="Workspace actions">
        <button className="primary-action" type="button" onClick={() => { onOpenWorkspace('workspace-file'); }}>
          Open workspace
        </button>
        <button className="secondary-action" type="button" onClick={() => { onOpenWorkspace('folder'); }}>
          Open folder
        </button>
      </div>

      {workspaceModel?.status === 'ok' && activePanel === 'explorer' && (
        <Explorer agent={agent} workspaceModel={workspaceModel} onFileOpen={(filePath) => { editorStore.openTab({ filePath }); }} />
      )}
      {workspaceModel?.status === 'ok' && activePanel === 'search' && (
        <SearchPanel agent={agent} workspaceModel={workspaceModel} onFileOpen={(filePath, line, col, pattern, revealNonce) => { editorStore.openTab({ filePath, line, col, ...(pattern == null ? {} : { pattern }), ...(revealNonce == null ? {} : { revealNonce }) }); }} />
      )}
      {workspaceModel?.status !== 'ok' && (
        <section className="workspace-card" aria-labelledby="explorer-title">
          <p className="section-label">Explorer</p>
          <h2 id="explorer-title">Explorer</h2>
          {workspaceSelection?.status === 'selected' && workspaceModel?.status === 'error' ? (
            <p className="workspace-path" role="alert">{workspaceModel.message}</p>
          ) : (
            <p className="workspace-path">No workspace opened.</p>
          )}
        </section>
      )}
    </>
  );
}
