import { useState } from 'react';

import { pathBasename } from '@agentdeck/shared';
import type { AgentDeckPreloadApi, SearchResult, WorkspaceModel } from '@agentdeck/shared';

interface SearchPanelProps {
  readonly agent: AgentDeckPreloadApi;
  readonly workspaceModel: WorkspaceModel & { status: 'ok' };
  readonly onFileOpen: (filePath: string, line: number, col: number, pattern?: string, revealNonce?: number) => void;
}


export function SearchPanel({ agent, workspaceModel, onFileOpen }: SearchPanelProps) {
  const [pattern, setPattern] = useState('');
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const workspaceRoots = workspaceModel.folders.map(f => f.path);

  async function runSearch(pat: string): Promise<void> {
    const trimmed = pat.trim();
    if (!trimmed) return;

    setIsSearching(true);
    setSearchError(null);
    setHasSearched(true);

    try {
      const found = await agent.searchFiles({ pattern: trimmed, workspaceRoots });
      setResults(found);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <section className="search-panel" aria-label="Search">
      <form className="search-form" onSubmit={e => { e.preventDefault(); runSearch(pattern).catch(err => console.error('[SearchPanel] Search error:', err)); }} role="search">
        <label className="search-label" htmlFor="search-input">
          Search
        </label>
        <div className="search-input-row">
          <input
            id="search-input"
            className="search-input"
            type="search"
            value={pattern}
            onChange={e => { setPattern(e.target.value); }}
            placeholder="Search files."
            aria-label="Search pattern"
            disabled={isSearching}
            autoComplete="off"
          />
          <button type="submit" disabled={isSearching || pattern.trim() === ''} aria-label="Run search">
            {isSearching ? 'Searching.' : 'Search'}
          </button>
        </div>
      </form>

      {searchError && (
        <p className="search-error" role="alert">{searchError}</p>
      )}

      {!isSearching && hasSearched && !searchError && results.length === 0 && (
        <output className="search-empty">No results found.</output>
      )}

      {results.length > 0 && (
        <ul className="search-results" aria-label={`${results.length.toString()} search results`}>
          {results.map(result => (
            <li key={`${result.file}:${result.line}:${result.col}`}>
              <button
                type="button"
                className={`search-result-item${result.isSensitive ? ' sensitive' : ''}`}
                onClick={() => { onFileOpen(result.file, result.line, result.col, pattern, Date.now()); }}
              >
                <span className="search-result-file" title={result.file}>{pathBasename(result.file)}</span>
                <span className="search-result-location">:{result.line}:{result.col}</span>
                <span className="search-result-snippet">{result.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
