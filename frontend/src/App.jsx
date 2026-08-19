import { useState, useEffect, useRef, useCallback } from 'react';

const CATEGORY_COLORS = {
  DevOps: '#F0B429',
  Frontend: '#5EEAD4',
  Backend: '#8B7FF0',
  Database: '#F97066',
  Security: '#7DD3FC',
};

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

export default function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [activeIndex, setActiveIndex] = useState(-1);
  const debouncedQuery = useDebouncedValue(query, 250);
  const abortRef = useRef(null);

  const runSearch = useCallback(async (q) => {
    if (!q.trim()) {
      setResults([]);
      setStatus('idle');
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Request failed with ${res.status}`);
      const data = await res.json();
      setResults(data.results || []);
      setStatus('done');
      setActiveIndex(-1);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    runSearch(debouncedQuery);
  }, [debouncedQuery, runSearch]);

  const handleKeyDown = (e) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  };

  return (
    <div className="page">
      <div className="halo" aria-hidden="true" />

      <header className="header">
        <span className="eyebrow">index // local</span>
        <h1 className="wordmark">Lookup</h1>
      </header>

      <div className="search-shell" data-state={status}>
        <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search articles, topics, categories…"
          autoFocus
          aria-label="Search"
        />
        {query && (
          <button className="clear-btn" onClick={() => setQuery('')} aria-label="Clear search">
            ×
          </button>
        )}
      </div>

      <div className="meta-row">
        {status === 'loading' && <span className="meta-text">searching…</span>}
        {status === 'done' && (
          <span className="meta-text mono">
            {String(results.length).padStart(2, '0')} match{results.length === 1 ? '' : 'es'} for “{debouncedQuery}”
          </span>
        )}
        {status === 'error' && <span className="meta-text error">couldn't reach the search backend</span>}
        {status === 'idle' && <span className="meta-text">start typing to search the index</span>}
      </div>

      <ul className="results" role="listbox">
        {results.map((item, i) => (
          <li
            key={item.id}
            className={`result-card ${i === activeIndex ? 'active' : ''}`}
            role="option"
            aria-selected={i === activeIndex}
            onMouseEnter={() => setActiveIndex(i)}
          >
            <div className="result-top">
              <h2 className="result-title">{item.title}</h2>
              <span
                className="category-pill"
                style={{
                  color: CATEGORY_COLORS[item.category] || '#8B93A3',
                  borderColor: CATEGORY_COLORS[item.category] || '#8B93A3',
                }}
              >
                {item.category}
              </span>
            </div>
            <p className="result-desc">{item.description}</p>
          </li>
        ))}

        {status === 'done' && results.length === 0 && (
          <li className="empty-state">
            <p>Nothing matched “{debouncedQuery}”.</p>
            <p className="empty-hint">Try a broader term, like “docker” or “react”.</p>
          </li>
        )}
      </ul>
    </div>
  );
}
