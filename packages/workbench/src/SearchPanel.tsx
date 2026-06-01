import { type FormEvent, useState } from 'react';

import type { AgentDeckPreloadApi, SearchResult, WorkspaceModel } from '@agentdeck/shared';

interface SearchPanelProps {
  agent: AgentDeckPreloadApi;
  workspaceModel: WorkspaceModel & { status: 'ok' };
}

export function SearchPanel({ agent, workspaceModel }: SearchPanelProps) {
  const [pattern, setPattern] = useState('');
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const workspaceRoots = workspaceModel.folders.map(f => f.path);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = pattern.trim();
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

  function pathBasename(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx === -1 ? normalized : normalized.slice(idx + 1);
  }

  return (
    <section className="search-panel" aria-label="Search">
      <form className="search-form" onSubmit={e => { void handleSubmit(e); }} role="search">
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
            placeholder="Search files…"
            aria-label="Search pattern"
            disabled={isSearching}
            autoComplete="off"
          />
          <button type="submit" disabled={isSearching || pattern.trim() === ''} aria-label="Run search">
            {isSearching ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {searchError && (
        <p className="search-error" role="alert">{searchError}</p>
      )}

      {!isSearching && hasSearched && !searchError && results.length === 0 && (
        <p className="search-empty" role="status">No results found.</p>
      )}

      {results.length > 0 && (
        <ul className="search-results" aria-label={`${results.length.toString()} search results`}>
          {results.map((result, idx) => (
            <li
              key={`${result.file}:${result.line.toString()}:${result.col.toString()}:${idx.toString()}`}
              className={`search-result-item${result.isSensitive ? ' sensitive' : ''}`}
            >
              <span className="search-result-file" title={result.file}>{pathBasename(result.file)}</span>
              <span className="search-result-location">:{result.line}:{result.col}</span>
              <span className="search-result-snippet">{result.snippet}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
