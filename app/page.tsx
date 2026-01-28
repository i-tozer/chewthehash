'use client';

import { useMemo, useState } from 'react';
import type { ExplainResponse } from '../lib/types';

const DEFAULT_DIGEST = '';

export default function Home() {
  const [digest, setDigest] = useState(DEFAULT_DIGEST);
  const [result, setResult] = useState<ExplainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hasResult = !!result?.ok;

  const statusMeta = useMemo(() => {
    const status = result?.summary?.status;
    if (status === 'failure') return { label: 'Failure', className: 'failure' };
    if (status === 'unknown') return { label: 'Unknown', className: 'unknown' };
    return { label: 'Success', className: 'success' };
  }, [result]);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digest: digest.trim() })
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

  const reset = () => {
    setDigest('');
    setResult(null);
    setError(null);
  };

  return (
    <main>
      <section className="card fade-in">
        <h1>Sui Transaction Explainer</h1>
        <p>
          Paste a transaction digest to get a plain-language summary in under three
          seconds. Built for quick demos, power users, and curious builders.
        </p>
        <div className="input-row">
          <input
            type="text"
            value={digest}
            onChange={(event) => setDigest(event.target.value)}
            placeholder="Enter a Sui transaction digest"
          />
          <button
            className="primary"
            onClick={handleSubmit}
            disabled={loading || !digest.trim()}
          >
            {loading ? 'Explaining…' : 'Explain'}
          </button>
          {hasResult && (
            <button className="secondary" onClick={reset}>
              Explain another
            </button>
          )}
        </div>
        {error && <p style={{ color: '#b94b2c' }}>{error}</p>}
      </section>

      {loading && (
        <section className="card fade-in">
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
              <div className="tag">{result.summary.timing}</div>
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
                <span>{result.gas.total}</span>
              </li>
              <li>
                <span>Computation</span>
                <span>{result.gas.computation}</span>
              </li>
              <li>
                <span>Storage</span>
                <span>{result.gas.storage}</span>
              </li>
              <li>
                <span>Rebate</span>
                <span>{result.gas.rebate}</span>
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
              <ul className="detail-list">
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
          <details open>
            <summary>Object changes</summary>
            {result.objectChanges.length === 0 ? (
              <p>No object changes found.</p>
            ) : (
              <ul className="detail-list">
                {result.objectChanges.map((change) => (
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
        . Cached: {result?.meta?.cached ? 'yes' : 'no'}.
      </footer>
    </main>
  );
}
