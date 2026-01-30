'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ExplainResponse } from '../lib/types';
import { bcs, fromBase64, fromHex, toHex } from '@mysten/bcs';
import { DECODER_REGISTRY } from '../lib/decoders/registry';
import decoderCoverage from '../lib/decoders/coverage.json';

const DEFAULT_DIGEST = '';
const HELP_COMMANDS = new Set(['help', 'about', '?']);

type AnimatedValueProps = {
  value: string;
};

type PtbItem = {
  id: string;
  title: string;
  detail?: string;
};

type PtbView = {
  inputs: PtbItem[];
  commands: PtbItem[];
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

function shorten(value?: string | null, prefix = 6, suffix = 4) {
  if (!value) return 'unknown';
  if (value.length <= prefix + suffix + 2) return value;
  return `${value.slice(0, prefix)}...${value.slice(-suffix)}`;
}

function formatArgument(arg: any): string {
  if (!arg) return 'unknown';
  if (arg === 'GasCoin') return 'GasCoin';
  if (typeof arg === 'string') return arg;
  if (Array.isArray(arg)) return arg.map(formatArgument).join(', ');
  if (typeof arg.Input === 'number') return `Input(${arg.Input})`;
  if (typeof arg.Result === 'number') return `Result(${arg.Result})`;
  if (Array.isArray(arg.NestedResult)) {
    return `NestedResult(${arg.NestedResult[0]}, ${arg.NestedResult[1]})`;
  }
  return 'arg';
}

function stripRef(type: string) {
  return type.replace(/^&mut\s+/, '').replace(/^&\s+/, '').trim();
}

function splitParams(paramStr: string) {
  const params: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of paramStr) {
    if (char === '<') depth += 1;
    if (char === '>') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      if (current.trim()) params.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) params.push(current.trim());
  return params;
}

function parseParamTypes(signature?: string | null): string[] {
  if (!signature) return [];
  const start = signature.indexOf('(');
  const end = signature.indexOf(')');
  if (start === -1 || end === -1 || end <= start + 1) return [];
  const paramStr = signature.slice(start + 1, end).trim();
  if (!paramStr) return [];
  return splitParams(paramStr).map(stripRef);
}

function toBytes(raw: string | Uint8Array | null | undefined) {
  if (!raw) return null;
  if (raw instanceof Uint8Array) return raw;
  if (typeof raw !== 'string') return null;
  if (raw.startsWith('0x')) return fromHex(raw);
  return fromBase64(raw);
}

function getPureBytes(input: any): Uint8Array | null {
  if (!input) return null;
  const pure = input.Pure ?? input.pure ?? null;
  if (!pure) return null;
  if (typeof pure === 'string') return toBytes(pure);
  if (pure.bytes) return toBytes(pure.bytes);
  if (pure.value) return toBytes(pure.value);
  return null;
}

function getInputIndex(arg: any): number | null {
  if (!arg) return null;
  if (typeof arg.Input === 'number') return arg.Input;
  if (typeof arg.input === 'number') return arg.input;
  if (typeof arg === 'string') {
    const match = arg.match(/Input\((\d+)\)/);
    if (match) return Number(match[1]);
  }
  return null;
}

function getPrimitiveBcs(type: string) {
  switch (type) {
    case 'u8':
      return bcs.u8();
    case 'u16':
      return bcs.u16();
    case 'u32':
      return bcs.u32();
    case 'u64':
      return bcs.u64();
    case 'u128':
      return bcs.u128();
    case 'u256':
      return bcs.u256();
    case 'bool':
      return bcs.bool();
    case 'address':
      return bcs.bytes(32);
    default:
      return null;
  }
}

function decodeBcsValue(type: string, bytes: Uint8Array): string | null {
  const normalized = stripRef(type);
  const vectorMatch = normalized.match(/^vector<(.+)>$/i);
  if (vectorMatch) {
    const inner = stripRef(vectorMatch[1]);
    const innerBcs = getPrimitiveBcs(inner);
    if (!innerBcs) return null;
    const values = bcs.vector(innerBcs).parse(bytes) as Array<any>;
    return `[${values.join(', ')}]`;
  }
  const primitive = getPrimitiveBcs(normalized);
  if (!primitive) return null;
  const value = primitive.parse(bytes) as any;
  if (normalized === 'address') {
    return `0x${toHex(value)}`;
  }
  return String(value);
}

function decodeMoveCallArgs(
  signature: string | null | undefined,
  args: any[],
  inputs: any[]
) {
  const types = parseParamTypes(signature);
  if (types.length === 0) return [];
  return args
    .map((arg, index) => {
      const inputIndex = getInputIndex(arg);
      if (inputIndex === null) return null;
      const input = inputs[inputIndex];
      const bytes = getPureBytes(input);
      if (!bytes) return null;
      const decoded = decodeBcsValue(types[index] ?? '', bytes);
      if (!decoded) return null;
      return `${types[index]} = ${decoded}`;
    })
    .filter(Boolean) as string[];
}
function summarizeInput(input: any, index: number): PtbItem {
  if (input?.Object) {
    const object = input.Object;
    if (object.ImmOrOwnedObject) {
      const { objectId } = object.ImmOrOwnedObject;
      return {
        id: `input-${index}`,
        title: `Input ${index} · Imm/Owned Object`,
        detail: shorten(objectId)
      };
    }
    if (object.SharedObject) {
      const { objectId, mutable } = object.SharedObject;
      return {
        id: `input-${index}`,
        title: `Input ${index} · Shared Object`,
        detail: `${shorten(objectId)} · mutable: ${mutable ? 'yes' : 'no'}`
      };
    }
    if (object.Receiving) {
      const { objectId } = object.Receiving;
      return {
        id: `input-${index}`,
        title: `Input ${index} · Receiving Object`,
        detail: shorten(objectId)
      };
    }
    if (object.objectId) {
      return {
        id: `input-${index}`,
        title: `Input ${index} · Object`,
        detail: shorten(object.objectId)
      };
    }
  }

  if (input?.Pure) {
    const pure = input.Pure;
    const bytes = typeof pure === 'string' ? pure : pure?.bytes ?? null;
    const literal = pure?.literal ?? null;
    const detail =
      bytes && typeof bytes === 'string'
        ? `bytes: ${bytes.slice(0, 12)}...`
        : literal
          ? `literal: ${JSON.stringify(literal).slice(0, 48)}`
          : 'pure value';
    return {
      id: `input-${index}`,
      title: `Input ${index} · Pure`,
      detail
    };
  }

  if (input?.kind !== undefined) {
    return {
      id: `input-${index}`,
      title: `Input ${index}`,
      detail: `kind: ${input.kind}`
    };
  }

  return { id: `input-${index}`, title: `Input ${index}`, detail: 'unknown' };
}

function summarizeCommand(command: any, index: number, inputs: any[]): PtbItem {
  if (!command || typeof command !== 'object') {
    return { id: `cmd-${index}`, title: `Command ${index}`, detail: 'unknown' };
  }

  const kind = Object.keys(command)[0];
  const payload = kind ? command[kind] : null;
  let detail = '';

  switch (kind) {
    case 'MoveCall': {
      const signature = payload?.signature;
      const moduleName = payload?.module;
      const fnName = payload?.function;
      const decodedArgs =
        Array.isArray(payload?.decodedArgs) && payload.decodedArgs.length > 0
          ? payload.decodedArgs
          : decodeMoveCallArgs(signature ?? null, payload?.arguments ?? [], inputs);
      const decodedLine = decodedArgs.length > 0 ? ` · ${decodedArgs.join(' · ')}` : '';
      detail = `${signature ?? `${moduleName ?? 'unknown'}::${fnName ?? 'unknown'}`}${decodedLine}`;
      break;
    }
    case 'TransferObjects': {
      const objects = Array.isArray(payload?.[0]) ? payload[0] : payload?.objects;
      const address = payload?.[1] ?? payload?.address;
      const count = Array.isArray(objects) ? objects.length : 0;
      let addressDetail = formatArgument(address);
      const addrInput = getInputIndex(address);
      if (addrInput !== null) {
        const addrBytes = getPureBytes(inputs[addrInput]);
        if (addrBytes) {
          const decoded = decodeBcsValue('address', addrBytes);
          if (decoded) addressDetail = decoded;
        }
      }
      detail = `${count} object${count === 1 ? '' : 's'} -> ${addressDetail}`;
      break;
    }
    case 'SplitCoins': {
      const coin = payload?.[0] ?? payload?.coin;
      const amounts = payload?.[1] ?? payload?.amounts;
      const count = Array.isArray(amounts) ? amounts.length : 0;
      const decodedAmounts = Array.isArray(amounts)
        ? amounts
            .map((amount: any) => {
              const inputIndex = getInputIndex(amount);
              if (inputIndex === null) return null;
              const bytes = getPureBytes(inputs[inputIndex]);
              if (!bytes) return null;
              const decoded = decodeBcsValue('u64', bytes);
              return decoded ? `u64=${decoded}` : null;
            })
            .filter(Boolean)
        : [];
      const decodedLine =
        decodedAmounts.length > 0 ? ` · ${decodedAmounts.join(', ')}` : '';
      detail = `${formatArgument(coin)} split ${count} way${count === 1 ? '' : 's'}${decodedLine}`;
      break;
    }
    case 'MergeCoins': {
      const coin = payload?.[0] ?? payload?.coin;
      const coins = payload?.[1] ?? payload?.coinsToMerge;
      const count = Array.isArray(coins) ? coins.length : 0;
      detail = `${count} coin${count === 1 ? '' : 's'} -> ${formatArgument(coin)}`;
      break;
    }
    case 'Publish': {
      const dependencies = payload?.dependencies ?? payload?.[1] ?? [];
      const count = Array.isArray(dependencies) ? dependencies.length : 0;
      detail = `dependencies: ${count}`;
      break;
    }
    case 'MakeMoveVec': {
      const elements = payload?.elements ?? payload?.[1] ?? [];
      const count = Array.isArray(elements) ? elements.length : 0;
      detail = `elements: ${count}`;
      break;
    }
    case 'Upgrade': {
      const pkg = payload?.package ?? payload?.[2] ?? 'package';
      detail = `upgrade ${shorten(pkg)}`;
      break;
    }
    default: {
      detail = 'command';
    }
  }

  return {
    id: `cmd-${index}`,
    title: `${String(index + 1).padStart(2, '0')} · ${kind ?? 'Command'}`,
    detail
  };
}

function buildPtbView(raw: any): PtbView | null {
  const ptb = raw?.transaction?.data?.transaction;
  const inputsRaw = Array.isArray(ptb?.inputs) ? ptb.inputs : [];
  const commandsRaw = Array.isArray(ptb?.transactions) ? ptb.transactions : [];

  if (inputsRaw.length === 0 && commandsRaw.length === 0) return null;

  return {
    inputs: inputsRaw.map((input: any, index: number) =>
      summarizeInput(input, index)
    ),
    commands: commandsRaw.map((command: any, index: number) =>
      summarizeCommand(command, index, inputsRaw)
    )
  };
}

export default function Home() {
  const [digest, setDigest] = useState(DEFAULT_DIGEST);
  const [result, setResult] = useState<ExplainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [helpMode, setHelpMode] = useState<'help' | 'about' | null>(null);
  const [activeView, setActiveView] = useState<'search' | 'results'>('search');
  const [navFocus, setNavFocus] = useState<'search' | 'recent' | 'decoders'>('search');
  const [recentDigests, setRecentDigests] = useState<
    Array<{ digest: string; tag?: { title: string; confidence: string } | null }>
  >([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [rpcMode, setRpcMode] = useState<'json' | 'grpc'>('grpc');
  const [outputMode, setOutputMode] = useState<'human' | 'machine'>('human');
  const [selectedDecoderId, setSelectedDecoderId] = useState<string | null>(
    DECODER_REGISTRY[0]?.id ?? null
  );
  const [pluginSummary, setPluginSummary] = useState<{
    title: string;
    detail?: string;
    confidence: 'high' | 'medium' | 'low';
  } | null>(null);
  const resultAnchorRef = useRef<HTMLDivElement | null>(null);
  const searchAnchorRef = useRef<HTMLDivElement | null>(null);
  const recentAnchorRef = useRef<HTMLDivElement | null>(null);
  const decodersAnchorRef = useRef<HTMLDivElement | null>(null);
  const [pendingScroll, setPendingScroll] = useState<RefObject<HTMLDivElement> | null>(null);

  const hasResult = !!result?.ok;
  const ptbView = useMemo(() => buildPtbView(result?.raw), [result]);
  const selectedDecoder =
    DECODER_REGISTRY.find((decoder) => decoder.id === selectedDecoderId) ??
    DECODER_REGISTRY[0] ??
    null;

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
        const items = (data.digests ?? []).map((item: any) =>
          typeof item === 'string' ? { digest: item, tag: null } : item
        );
        setRecentDigests(items);
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

  useEffect(() => {
    if (!pendingScroll?.current) return;
    pendingScroll.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setPendingScroll(null);
  }, [activeView, pendingScroll]);

  const scrollToResults = () => {
    if (!resultAnchorRef.current) return;
    resultAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const queueScroll = (
    ref: RefObject<HTMLDivElement>,
    view: 'search' | 'results',
    focus?: 'search' | 'recent' | 'decoders'
  ) => {
    if (focus) setNavFocus(focus);
    setPendingScroll(ref);
    setActiveView(view);
  };

  const submitDigest = async (value: string) => {
    const trimmed = value.trim();
    if (HELP_COMMANDS.has(trimmed.toLowerCase())) {
      setHelpMode(trimmed.toLowerCase() === 'about' ? 'about' : 'help');
      setError(null);
      setResult(null);
      setLoading(false);
      setActiveView('search');
      setNavFocus('search');
      return;
    }

    setHelpMode(null);
    setError(null);
    setLoading(true);
    setResult(null);
    setActiveView('results');
    setNavFocus('search');

    try {
      const response = await fetch('/api/tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digest: trimmed, mode: rpcMode })
      });

      const data = (await response.json()) as ExplainResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data?.error ?? 'Unable to explain that transaction.');
      }
      setResult(data);
      setPluginSummary((data as any).pluginSummary ?? null);
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
    setActiveView('search');
    setNavFocus('search');
  };

  return (
    <main className="app-shell">
      <aside className="side-nav">
        <div className="side-brand">
          <div className="side-dot" />
          <div>
            <div className="side-title">Chew The Hash</div>
            <div className="side-subtitle">Transaction Explainer</div>
          </div>
        </div>
        <div className="side-group">
          <div className="side-label">Workspace</div>
          <button
            type="button"
            className={`side-link ${navFocus === 'search' ? 'active' : ''}`}
            onClick={() => queueScroll(searchAnchorRef, 'search', 'search')}
          >
            Search
          </button>
          <button
            type="button"
            className={`side-link ${navFocus === 'recent' ? 'active' : ''}`}
            onClick={() => queueScroll(recentAnchorRef, 'search', 'recent')}
          >
            Recent
          </button>
          <button
            type="button"
            className={`side-link ${navFocus === 'decoders' ? 'active' : ''}`}
            onClick={() => queueScroll(decodersAnchorRef, 'search', 'decoders')}
          >
            Decoders
          </button>
        </div>
      </aside>

      <div className="content">
        {activeView === 'search' && (
          <>
            <div ref={searchAnchorRef} />
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

            <section className="card fade-in" ref={recentAnchorRef}>
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
                key={item.digest}
                className="recent-button"
                type="button"
                onClick={() => {
                  setDigest(item.digest);
                  submitDigest(item.digest);
                }}
              >
                <span>{item.digest}</span>
                {item.tag ? (
                  <span className="recent-tag">
                    {item.tag.title} · {item.tag.confidence}
                  </span>
                ) : (
                  <span className="recent-tag muted">No match</span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

            <section className="card fade-in" ref={decodersAnchorRef}>
              <div className="summary-header">
                <h3>Decoders</h3>
                <span className="badge">maintained</span>
              </div>
              <p className="decoder-meta">
                Maintained list of active decoders. Coverage data last updated{' '}
                <strong>{decoderCoverage.generated_at}</strong>.
              </p>
              <p>
                These are the currently shipped decoder plugins. Each one targets a known
                flow and upgrades the explanation beyond the fallback parser.
              </p>
              <div className="decoder-layout">
                <div className="decoder-list">
                  {DECODER_REGISTRY.map((decoder) => (
                    <button
                      key={decoder.id}
                      type="button"
                      className={`decoder-card ${
                        selectedDecoder?.id === decoder.id ? 'active' : ''
                      }`}
                      onClick={() => setSelectedDecoderId(decoder.id)}
                    >
                      <div className="decoder-head">
                        <span className="decoder-title">{decoder.meta.name}</span>
                        <span className="badge">{decoder.meta.status}</span>
                      </div>
                      <p className="decoder-preview">{decoder.meta.summary}</p>
                      <div className="decoder-inline">
                        <span className="badge">{decoder.meta.confidence}</span>
                        <span className="badge muted">{decoder.meta.category}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="decoder-detail">
                  {selectedDecoder ? (
                    <>
                      <div className="summary-header">
                        <h3>{selectedDecoder.meta.name}</h3>
                        <span className="badge">{selectedDecoder.meta.status}</span>
                      </div>
                      <p>{selectedDecoder.meta.summary}</p>
                      <div className="decoder-tags">
                        <span className="tag">Category: {selectedDecoder.meta.category}</span>
                        <span className="tag">Priority: {selectedDecoder.priority}</span>
                        <span className="tag">Confidence: {selectedDecoder.meta.confidence}</span>
                        <span className="tag">ID: {selectedDecoder.id}</span>
                        <span className="tag">Updated: {selectedDecoder.meta.lastUpdated}</span>
                      </div>
                      <div className="decoder-section">
                        <div className="decoder-section-title">What it detects</div>
                        <div className="decoder-section-body">
                          {selectedDecoder.meta.summary}
                        </div>
                      </div>
                      <div className="decoder-section">
                        <div className="decoder-section-title">Match signals</div>
                        <div className="decoder-targets">
                          {selectedDecoder.meta.targets.map((target) => (
                            <span className="target-chip" key={`${selectedDecoder.id}-${target}`}>
                              {target}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="decoder-section">
                        <div className="decoder-section-title">Signals</div>
                        <ul className="decoder-bullets">
                          {selectedDecoder.meta.signals.map((signal) => (
                            <li key={`${selectedDecoder.id}-${signal}`}>{signal}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="decoder-section">
                        <div className="decoder-section-title">Data sources</div>
                        <ul className="decoder-bullets">
                          {selectedDecoder.meta.dataSources.map((source) => (
                            <li key={`${selectedDecoder.id}-${source}`}>{source}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="decoder-section">
                        <div className="decoder-section-title">Limitations</div>
                        <ul className="decoder-bullets">
                          {selectedDecoder.meta.limitations.map((note) => (
                            <li key={`${selectedDecoder.id}-${note}`}>{note}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="decoder-help">
                        Click a decoder on the left to switch.
                      </div>
                    </>
                  ) : (
                    <p>No decoder selected.</p>
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        {activeView === 'results' && (
          <>
            <div ref={resultAnchorRef} />
            <section className="card fade-in results-switch">
              <div className="results-tabs">
                <button
                  type="button"
                  className={`results-tab ${outputMode === 'human' ? 'active' : ''}`}
                  onClick={() => setOutputMode('human')}
                >
                  Human
                </button>
                <button
                  type="button"
                  className={`results-tab ${outputMode === 'machine' ? 'active' : ''}`}
                  onClick={() => setOutputMode('machine')}
                >
                  Machine
                </button>
              </div>
            </section>

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

            {error && <p className="terminal-error">{error}</p>}

            {outputMode === 'human' && hasResult && result && (
              <section className="card summary-card fade-in">
                <div className="summary-header">
                  <h3>Summary</h3>
                  <span className="badge beta">Beta</span>
                </div>
                <p className="summary-line">{result.summary.headline}</p>
                <p className="summary-subtitle">{result.summary.subtitle}</p>
                <div className="summary-meta">
                  <span className="tag">Status: {result.summary.status}</span>
                  <span className="tag">Sender: {result.summary.sender}</span>
                  <span className="tag">{result.summary.timing}</span>
                </div>
                <p className="summary-muted">One-liner: {result.summary.oneLiner}</p>
              </section>
            )}

            {outputMode === 'human' && (
              <section className="card summary-card fade-in">
                <div className="summary-header">
                  <h3>Decoder match</h3>
                  {pluginSummary ? (
                    <span className="badge">{pluginSummary.confidence}</span>
                  ) : (
                    <span className="badge muted">fallback</span>
                  )}
                </div>
                <p className="summary-line">
                  {pluginSummary ? pluginSummary.title : 'No specialized decoder matched.'}
                </p>
                {pluginSummary?.detail && <p>{pluginSummary.detail}</p>}
              </section>
            )}

            {outputMode === 'human' && (
              <section className="card fade-in">
                <div className="summary-header">
                  <h3>Programmable Transaction Block</h3>
                </div>
                {ptbView ? (
                  <div className="ptb-grid">
                    <div className="ptb-panel">
                      <div className="ptb-title">Inputs</div>
                      {ptbView.inputs.length === 0 ? (
                        <p>No inputs available.</p>
                      ) : (
                        <ul className="ptb-list">
                          {ptbView.inputs.map((item) => (
                            <li key={item.id}>
                              <span className="ptb-index">{item.title}</span>
                              <span className="ptb-detail">{item.detail}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="ptb-panel">
                      <div className="ptb-title">Transactions</div>
                      {ptbView.commands.length === 0 ? (
                        <p>No commands available.</p>
                      ) : (
                        <ul className="ptb-list">
                          {ptbView.commands.map((item) => (
                            <li key={item.id}>
                              <span className="ptb-index">{item.title}</span>
                              <span className="ptb-detail">{item.detail}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : (
                  <p>PTB data unavailable for this transaction.</p>
                )}
              </section>
            )}

            {outputMode === 'human' && hasResult && result && (
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

            {outputMode === 'human' && hasResult && result && (
              <section className="card fade-in">
                <h3>What happened</h3>
                <div className="timeline">
                  {result.timeline.map((item, index) => (
                    <div className="timeline-item" key={item.id}>
                      <div className="timeline-dot" />
                      <div className="timeline-content">
                        <div className="timeline-title">
                          <span className="timeline-index">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          {item.title}
                        </div>
                        {item.detail && <div className="timeline-detail">{item.detail}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {outputMode === 'human' && hasResult && result && (
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
              </section>
            )}

            {outputMode === 'machine' && hasResult && result && (
              <section className="card fade-in">
                <div className="summary-header">
                  <h3>Machine output</h3>
                  <span className="badge">JSON</span>
                </div>
                <pre className="code-block">{JSON.stringify(result, null, 2)}</pre>
              </section>
            )}
          </>
        )}

        <footer>
          Proxy latency: {result?.meta?.latencyMs ? `${result.meta.latencyMs}ms` : '--'}
          . Cached: {result?.meta?.cached ? 'yes' : 'no'}. Provider:{' '}
          {result?.meta?.provider ?? '--'}.
        </footer>
      </div>
    </main>
  );
}
