import { LRUCache } from 'lru-cache';

export type RpcProvider = {
  id: string;
  url: string;
  type: 'jsonrpc';
};

type ProviderHealth = {
  consecutiveFailures: number;
  openUntil?: number;
  lastLatencyMs?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
};

type JsonRpcResponse<T> = {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

const providerState = new Map<string, ProviderHealth>();
const txCache = new LRUCache<string, { value: unknown; cachedAt: number }>({
  max: 500,
  ttl: 1000 * 60 * 10
});

const rateLimiter = new LRUCache<string, { count: number; resetAt: number }>({
  max: 2000,
  ttl: 1000 * 60 * 2
});

const DEFAULT_PROVIDER = 'https://fullnode.mainnet.sui.io:443';

function loadProviders(): RpcProvider[] {
  const urls = [
    process.env.SUI_RPC_PRIMARY,
    process.env.SUI_RPC_SECONDARY,
    process.env.SUI_RPC_TERTIARY
  ].filter(Boolean) as string[];

  const finalUrls = urls.length > 0 ? urls : [DEFAULT_PROVIDER];
  return finalUrls.map((url, index) => ({
    id: `provider-${index + 1}`,
    url,
    type: 'jsonrpc'
  }));
}

function getProviderState(provider: RpcProvider): ProviderHealth {
  if (!providerState.has(provider.id)) {
    providerState.set(provider.id, { consecutiveFailures: 0 });
  }
  return providerState.get(provider.id)!;
}

function isCircuitOpen(state: ProviderHealth): boolean {
  if (!state.openUntil) return false;
  return Date.now() < state.openUntil;
}

function recordSuccess(provider: RpcProvider, latencyMs: number) {
  const state = getProviderState(provider);
  state.consecutiveFailures = 0;
  state.openUntil = undefined;
  state.lastLatencyMs = latencyMs;
  state.lastSuccessAt = Date.now();
}

function recordFailure(provider: RpcProvider) {
  const state = getProviderState(provider);
  state.consecutiveFailures += 1;
  state.lastFailureAt = Date.now();
  if (state.consecutiveFailures >= 3) {
    state.openUntil = Date.now() + 30_000;
  }
}

function pickProviders(providers: RpcProvider[]): RpcProvider[] {
  return [...providers].sort((a, b) => {
    const stateA = getProviderState(a);
    const stateB = getProviderState(b);
    const openA = isCircuitOpen(stateA) ? 1 : 0;
    const openB = isCircuitOpen(stateB) ? 1 : 0;
    if (openA !== openB) return openA - openB;
    const failureDiff = stateA.consecutiveFailures - stateB.consecutiveFailures;
    if (failureDiff !== 0) return failureDiff;
    return (stateA.lastLatencyMs ?? 0) - (stateB.lastLatencyMs ?? 0);
  });
}

async function jsonRpcRequest<T>(
  provider: RpcProvider,
  method: string,
  params: unknown[],
  timeoutMs: number,
  requestId: string
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method,
        params
      }),
      signal: controller.signal
    });

    const data = (await response.json()) as JsonRpcResponse<T>;
    if (!response.ok || data.error) {
      throw new Error(data.error?.message ?? `RPC error ${response.status}`);
    }
    const latency = Date.now() - started;
    recordSuccess(provider, latency);
    return data.result as T;
  } catch (error) {
    recordFailure(provider);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getTransactionBlock(
  digest: string,
  options: Record<string, boolean>,
  requestId: string
) {
  const cacheKey = `${digest}:${JSON.stringify(options)}`;
  const cached = txCache.get(cacheKey);
  if (cached) {
    return { data: cached.value, cached: true, provider: 'cache' };
  }

  const providers = pickProviders(loadProviders());
  const timeoutMs = Number(process.env.SUI_RPC_TIMEOUT_MS ?? 2200);
  let lastError: unknown = null;

  for (const provider of providers) {
    if (isCircuitOpen(getProviderState(provider))) continue;
    try {
      const result = await jsonRpcRequest(
        provider,
        'sui_getTransactionBlock',
        [digest, options],
        timeoutMs,
        requestId
      );
      txCache.set(cacheKey, { value: result, cachedAt: Date.now() });
      return { data: result, cached: false, provider: provider.url };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('All providers failed');
}

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp;
  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  return 'unknown';
}

export function checkRateLimit(ip: string) {
  const max = Number(process.env.RATE_LIMIT_MAX ?? 30);
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  const now = Date.now();

  const record = rateLimiter.get(ip);
  if (!record || record.resetAt < now) {
    rateLimiter.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs };
  }

  if (record.count >= max) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt };
  }

  record.count += 1;
  rateLimiter.set(ip, record);
  return { allowed: true, remaining: max - record.count, resetAt: record.resetAt };
}

export function cacheFixture(key: string, value: unknown) {
  txCache.set(key, { value, cachedAt: Date.now() });
}
