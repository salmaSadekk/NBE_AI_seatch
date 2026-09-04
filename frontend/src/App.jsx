import { useState, useRef } from 'react';

export default function App() {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [error, setError] = useState('');

  const inputRef = useRef(null);

  const isArabic = /[\u0600-\u06FF]/.test(query);

  const runSearch = async () => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setAnswer('');
      setSources([]);
      setStatus('idle');
      setError('');
      return;
    }

    setStatus('loading');
    setAnswer('');
    setSources([]);
    setError('');

    try {
      // Backend expects:
      // GET /api/ask?q=...
      const response = await fetch(
        `/api/ask?q=${encodeURIComponent(trimmedQuery)}`
      );

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Search request failed');
      }

      setAnswer(data.answer || 'No answer was generated.');
      setSources(Array.isArray(data.sources) ? data.sources : []);
      setStatus('done');
    } catch (err) {
      console.error('Search error:', err);

      setStatus('error');
      setError(
        'Could not reach the AI search backend. Please try again.'
      );
    }
  };

  const clearSearch = () => {
    setQuery('');
    setAnswer('');
    setSources([]);
    setStatus('idle');
    setError('');

    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
    }

    if (event.key === 'Escape') {
      clearSearch();
    }
  };

  return (
    <div className="page">
      <div className="halo" aria-hidden="true" />

      {/* Header */}
      <header className="header">
        <span className="eyebrow">NBE // AI SEARCH</span>

        <h1 className="wordmark">Lookup</h1>

        <p
          style={{
            margin: '10px 0 0',
            color: 'var(--text-secondary)',
            fontSize: '14px',
          }}
        >
          Search the National Bank of Egypt knowledge base
        </p>
      </header>

      {/* Search */}
      <div
        className="search-shell"
        data-state={status}
        dir={isArabic ? 'rtl' : 'ltr'}
      >
        <svg
          className="search-icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="11"
            cy="11"
            r="7"
            stroke="currentColor"
            strokeWidth="2"
          />

          <line
            x1="21"
            y1="21"
            x2="16.65"
            y2="16.65"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>

        <input
          ref={inputRef}
          className="search-input"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isArabic
              ? 'ابحث في قاعدة معرفة البنك الأهلي المصري…'
              : 'Ask anything about NBE…'
          }
          autoFocus
          aria-label="Search"
        />

        {query && (
          <button
            className="clear-btn"
            onClick={clearSearch}
            aria-label="Clear search"
            type="button"
          >
            ×
          </button>
        )}
      </div>

      {/* Search hint / status */}
      <div className="meta-row">
        {status === 'idle' && (
          <span className="meta-text">
            Press Enter to search the NBE knowledge base
          </span>
        )}

        {status === 'loading' && (
          <span className="meta-text">
            Searching NBE knowledge base…
          </span>
        )}

        {status === 'done' && (
          <span className="meta-text mono">
            AI answer generated from indexed NBE content
          </span>
        )}

        {status === 'error' && (
          <span className="meta-text error">
            {error}
          </span>
        )}
      </div>

      {/* Loading */}
      {status === 'loading' && (
        <section className="answer-card loading-card">
          <div className="loading-dots">
            <span />
            <span />
            <span />
          </div>

          <p className="loading-text">
            Finding the most relevant information…
          </p>
        </section>
      )}

      {/* AI Answer */}
      {status === 'done' && answer && (
        <section
          className="answer-card"
          dir={isArabic ? 'rtl' : 'ltr'}
        >
          <div className="section-label">
            <span className="label-dot" />
            AI ANSWER
          </div>

          <div className="answer-text">
            {answer.split('\n').map((line, index) => {
              const trimmedLine = line.trim();

              if (!trimmedLine) {
                return (
                  <div
                    key={index}
                    className="answer-space"
                  />
                );
              }

              return (
                <p key={index}>
                  {trimmedLine}
                </p>
              );
            })}
          </div>
        </section>
      )}

      {/* Sources */}
      {status === 'done' && sources.length > 0 && (
        <section
          className="sources-section"
          dir={isArabic ? 'rtl' : 'ltr'}
        >
          <div className="section-label">
            SOURCES
          </div>

          <div className="sources-list">
            {Array.from(
              new Map(
                sources.map((source) => [source.url, source])
              ).values()
            ).map((source, index) => {
              const sourceUrl = source.url || '#';

              return (
                <a
                  key={`${source.pageId || 'source'}-${index}`}
                  className="source-card"
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="source-icon">
                    ↗
                  </div>

                  <div className="source-content">
                    <h3>
                      {source.title || 'NBE Source'}
                    </h3>

                    <p>
                      National Bank of Egypt
                    </p>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* Error state */}
      {status === 'error' && (
        <section className="empty-state">
          <p>Something went wrong.</p>

          <p className="empty-hint">
            Make sure the backend and AI services are running.
          </p>
        </section>
      )}
    </div>
  );
}