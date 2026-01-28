'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExplainResponse } from '../lib/types';

const DEFAULT_DIGEST = '';
const HELP_COMMANDS = new Set(['help', 'about', '?']);

type AnimatedValueProps = {
  value: string;
};

function parseNumeric(value: string) {
  const match = value.match(/-?[\d,.]+(?:\.\d+)?/);
  if (!match) return null;
  const raw = match[0];
  const numeric = Number(raw.replace(/,/g, ''));
  if (Number.isNaN(numeric)) return null;
  const decimals = raw.includes('.') ? raw.split('.')[1]?.length ?? 0 : 0;
  const suffix = value.replace(raw, '').trim();
  return { numeric, decimals, suffix };
}

function useCountUp(value: string, duration = 450) {
  const parsed = useMemo(() => parseNumeric(value), [value]);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (!parsed) {
      setDisplay(value);
      return;
    }
    const { numeric, decimals, suffix } = parsed;
    const formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    const start = performance.now();

    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = numeric * eased;
      setDisplay(`${formatter.format(current)}${suffix ? ` ${suffix}` : ''}`);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [parsed, value, duration]);

  return display;
}

function AnimatedValue({ value }: AnimatedValueProps) {
  const display = useCountUp(value);
  return <span className="count-up">{display}</span>;
}

export default function Home() {
  const [digest, setDigest] = useState(DEFAULT_DIGEST);
  const [result, setResult] = useState<ExplainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [helpMode, setHelpMode] = useState<'help' | 'about' | null>(null);
  const [recentDigests, setRecentDigests] = useState<string[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [rpcMode, setRpcMode] = useState<'json' | 'grpc'>('json');
  const resultAnchorRef = useRef<HTMLDivElement | null>(null);

  const hasResult = !!result?.ok;

  const statusMeta = useMemo(() => {
    const status = result?.summary?.status;
    if (status === 'failure') return { label: 'Failure', className: 'failure' };
    if (status === 'unknown') return { label: 'Unknown', className: 'unknown' };
    return { label: 'Success', className: 'success' };
  }, [result]);

  useEffect(() => {
    const loadRecent = async () => {
      setRecentLoading(true);
      setRecentError(null);
      try {
        const response = await fetch('/api/tx/recent');
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data?.error ?? 'Unable to load recent transactions.');
        }
        setRecentDigests(data.digests ?? []);
      } catch (err) {
        setRecentError(err instanceof Error ? err.message : 'Unable to load recents.');
      } finally {
        setRecentLoading(false);
      }
    };

    loadRecent();
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem('rpcMode');
    if (stored === 'grpc' || stored === 'json') {
      setRpcMode(stored);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem('rpcMode', rpcMode);
  }, [rpcMode]);

  const scrollToResults = () => {
    if (!resultAnchorRef.current) return;
    resultAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const submitDigest = async (value: string) => {
    const trimmed = value.trim();
    if (HELP_COMMANDS.has(trimmed.toLowerCase())) {
      setHelpMode(trimmed.toLowerCase() === 'about' ? 'about' : 'help');
      setError(null);
      setResult(null);
      setLoading(false);
      return;
    }

    setHelpMode(null);
    setError(null);
    setLoading(true);
    setResult(null);
    scrollToResults();

    try {
      const endpoint = rpcMode === 'grpc' ? '/api/tx/grpc' : '/api/tx';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digest: trimmed })
      });

      const data = (await response.json()) as ExplainResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data?.error ?? 'Unable to explain that transaction.');
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (result) {
      scrollToResults();
    }
  }, [result]);

  const handleSubmit = async () => {
    await submitDigest(digest);
  };

  const reset = () => {
    setDigest('');
    setResult(null);
    setError(null);
    setHelpMode(null);
  };

  return (
    <main>
      <section className="card fade-in">
        <div className="terminal-header">
          <h1>Sui Transaction Explainer</h1>
          <div className="mode-toggle">
            <button
              type="button"
              className={`mode-option ${rpcMode === 'json' ? 'active' : ''}`}
              onClick={() => setRpcMode('json')}
            >
              JSON-RPC
            </button>
            <button
              type="button"
              className={`mode-option ${rpcMode === 'grpc' ? 'active' : ''}`}
              onClick={() => setRpcMode('grpc')}
            >
              gRPC
            </button>
          </div>
        </div>
        <p>
          &gt; Paste a transaction digest to get a plain-language summary in under
          three seconds. Built for quick demos, power users, and curious builders.
        </p>
        <div className="input-row">
          <input
            type="text"
            value={digest}
            onChange={(event) => setDigest(event.target.value)}
            placeholder="enter digest... or type help"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSubmit();
              }
            }}
          />
          <button
            className="primary"
            onClick={handleSubmit}
            disabled={loading || !digest.trim()}
          >
            {loading ? 'Booting…' : 'Explain'}
          </button>
          {hasResult && (
            <button className="secondary" onClick={reset}>
              Explain another
            </button>
          )}
        </div>
        {error && <p className="terminal-error">{error}</p>}
        {!loading && !hasResult && !helpMode && (
          <pre className="ascii-art">{`  .--.\n / o_o \\\n \\_^_/  TERMINAL MODE\n  /|\\   type help for commands\n /_|_\\`}</pre>
        )}
        {helpMode === 'help' && (
          <div className="help-panel">
            <p>Available commands:</p>
            <ul className="detail-list">
              <li>
                <span>help</span>
                <span>Show this panel</span>
              </li>
              <li>
                <span>about</span>
                <span>Explain the explainer</span>
              </li>
              <li>
                <span>digest</span>
                <span>Paste any Sui transaction digest</span>
              </li>
            </ul>
          </div>
        )}
        {helpMode === 'about' && (
          <div className="help-panel">
            <p>About</p>
            <p>
              This console reads a Sui transaction digest and summarizes object
              changes, Move calls, balance shifts, and gas usage in plain language.
              It prioritizes accuracy and speed, and falls back to raw views for
              complex Move arguments.
            </p>
          </div>
        )}
      </section>

      {hasResult && result && (
        <section className="card summary-card fade-in">
          <div className="summary-header">
            <h3>Summary</h3>
            <span className="badge beta">Beta</span>
          </div>
          <p className="summary-line">{result.summary.oneLiner}</p>
        </section>
      )}

      <section className="card fade-in">
        <h3>Recent transactions</h3>
        {recentLoading ? (
          <p>Fetching recent digests...</p>
        ) : recentError ? (
          <p className="terminal-error">{recentError}</p>
        ) : recentDigests.length === 0 ? (
          <p>No recent transactions available.</p>
        ) : (
          <div className="recent-list">
            {recentDigests.map((item) => (
              <button
                key={item}
                className="recent-button"
                type="button"
                onClick={() => {
                  setDigest(item);
                  submitDigest(item);
                }}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </section>

      <div ref={resultAnchorRef} />

      {loading && (
        <section className="card fade-in">
          <div className="boot-line">
            <span className="prompt">suivibe@console</span> booting parser
            <span className="cursor">_</span>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="skeleton" style={{ width: '45%' }} />
            <div className="skeleton" style={{ width: '70%' }} />
            <div className="skeleton" style={{ width: '80%' }} />
          </div>
        </section>
      )}

      {hasResult && result && (
        <section className="section-grid fade-in">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <span className={`status-pill ${statusMeta.className}`}>
                  {statusMeta.label}
                </span>
                <h2 style={{ marginTop: 12 }}>{result.summary.headline}</h2>
                <p>{result.summary.subtitle}</p>
              </div>
              <div className="tag-row">
                <div className="tag">{result.summary.timing}</div>
                <div className="tag">{result.meta.cached ? 'cached' : 'live'}</div>
                <div className="tag">rpc: {result.meta.provider}</div>
              </div>
            </div>
            <div className="keyline" />
            <ul className="detail-list">
              <li>
                <span>Sender</span>
                <span>{result.summary.sender}</span>
              </li>
              <li>
                <span>Digest</span>
                <span>{result.digest}</span>
              </li>
            </ul>
            <div className="keyline" />
            <h3>Gas</h3>
            <ul className="detail-list">
              <li>
                <span>Total</span>
                <AnimatedValue value={result.gas.total} />
              </li>
              <li>
                <span>Computation</span>
                <AnimatedValue value={result.gas.computation} />
              </li>
              <li>
                <span>Storage</span>
                <AnimatedValue value={result.gas.storage} />
              </li>
              <li>
                <span>Rebate</span>
                <AnimatedValue value={result.gas.rebate} />
              </li>
              {result.gas.budget && (
                <li>
                  <span>Budget used</span>
                  <span>{result.gas.budget}</span>
                </li>
              )}
            </ul>
          </div>

          <div className="card">
            <h3>Transfer Flow</h3>
            {result.transfers.length === 0 ? (
              <p>No direct transfer edges detected.</p>
            ) : (
              <div className="flow">
                {result.transfers.map((transfer) => (
                  <div className="flow-item" key={transfer.id}>
                    <span>{transfer.from}</span>
                    <span className="flow-arrow">→</span>
                    <span>{transfer.to}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="keyline" />
            <h3>Move Calls</h3>
            {result.moveCalls.length === 0 ? (
              <p>No Move calls detected.</p>
            ) : (
              <ul className="detail-list detail-list--calls">
                {result.moveCalls.map((call) => (
                  <li key={call.id}>
                    <span>{call.label}</span>
                    <span>{call.fn}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {hasResult && result && (
        <section className="card fade-in">
          <h3>What happened</h3>
          <div className="timeline">
            {result.timeline.map((item, index) => (
              <div className="timeline-item" key={item.id}>
                <div className="timeline-dot" />
                <div className="timeline-content">
                  <div className="timeline-title">
                    <span className="timeline-index">{String(index + 1).padStart(2, '0')}</span>
                    {item.title}
                  </div>
                  {item.detail && <div className="timeline-detail">{item.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {hasResult && result && (
        <section className="card fade-in">
          <details open>
            <summary>Object changes</summary>
            {result.objectChanges.length === 0 ? (
              <p>No object changes found.</p>
            ) : (
              <ul className="detail-list detail-list--objects">
                {result.objectChanges.map((change) => (
                  <li key={change.id}>
                    <div className="detail-main">
                      <span>{change.label}</span>
                      {change.badges && (
                        <div className="badge-row">
                          {change.badges.map((badge) => (
                            <span className="badge" key={`${change.id}-${badge}`}>
                              {badge}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span>{change.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
          <div style={{ height: 12 }} />
          <details>
            <summary>Balance changes</summary>
            {result.balanceChanges.length === 0 ? (
              <p>No balance changes detected.</p>
            ) : (
              <ul className="detail-list">
                {result.balanceChanges.map((change) => (
                  <li key={change.id}>
                    <span>{change.label}</span>
                    <span>{change.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
          <div style={{ height: 12 }} />
          <details>
            <summary>Raw response</summary>
            <pre className="code-block">{JSON.stringify(result.raw, null, 2)}</pre>
          </details>
        </section>
      )}

      <footer>
        Proxy latency: {result?.meta?.latencyMs ? `${result.meta.latencyMs}ms` : '--'}
        . Cached: {result?.meta?.cached ? 'yes' : 'no'}. Provider:{' '}
        {result?.meta?.provider ?? '--'}.
      </footer>
    </main>
  );
}
