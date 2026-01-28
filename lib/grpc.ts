import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SuiGrpcClient } from '@mysten/sui/grpc';
type GrpcOwner = { kind?: number; address?: string } | null | undefined;

const OWNER_KIND = {
  UNKNOWN: 0,
  ADDRESS: 1,
  OBJECT: 2,
  SHARED: 3,
  IMMUTABLE: 4,
  CONSENSUS_ADDRESS: 5
} as const;

const INPUT_OBJECT_STATE = {
  UNKNOWN: 0,
  DOES_NOT_EXIST: 1,
  EXISTS: 2
} as const;

const OUTPUT_OBJECT_STATE = {
  UNKNOWN: 0,
  DOES_NOT_EXIST: 1,
  OBJECT_WRITE: 2,
  PACKAGE_WRITE: 3
} as const;

const ID_OPERATION = {
  UNKNOWN: 0,
  NONE: 1,
  CREATED: 2,
  DELETED: 3
} as const;

type GrpcProvider = {
  id: string;
  url: string;
  host: string;
};

type ProviderHealth = {
  consecutiveFailures: number;
  openUntil?: number;
  lastLatencyMs?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  slowCount?: number;
};

const providerState = new Map<string, ProviderHealth>();
const grpcClients = new Map<string, SuiGrpcClient>();

function resolveGrpcHost(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    const url = new URL(endpoint);
    return url.host || `${url.hostname}:443`;
  }
  if (endpoint.includes(':')) return endpoint;
  return `${endpoint}:443`;
}

function getGrpcMeta(): Record<string, string> | undefined {
  const header = process.env.SUI_GRPC_AUTH_HEADER;
  const token = process.env.SUI_GRPC_AUTH_TOKEN;
  if (!header || !token) return undefined;
  return { [header]: token };
}

function loadGrpcProviders(): GrpcProvider[] {
  const urls = [
    process.env.SUI_GRPC_PRIMARY,
    process.env.SUI_GRPC_SECONDARY,
    process.env.SUI_GRPC_TERTIARY,
    process.env.SUI_GRPC_ENDPOINT
  ].filter(Boolean) as string[];

  const finalUrls = urls.length > 0 ? urls : ['fullnode.mainnet.sui.io:443'];
  return finalUrls.map((url, index) => {
    const host = resolveGrpcHost(url);
    return { id: `grpc-${index + 1}`, url, host };
  });
}

function getProviderState(provider: GrpcProvider): ProviderHealth {
  if (!providerState.has(provider.id)) {
    providerState.set(provider.id, { consecutiveFailures: 0, slowCount: 0 });
  }
  return providerState.get(provider.id)!;
}

function isCircuitOpen(state: ProviderHealth): boolean {
  if (!state.openUntil) return false;
  return Date.now() < state.openUntil;
}

function recordSuccess(provider: GrpcProvider, latencyMs: number, sloMs: number) {
  const state = getProviderState(provider);
  state.consecutiveFailures = 0;
  state.openUntil = undefined;
  state.lastLatencyMs = latencyMs;
  state.lastSuccessAt = Date.now();
  if (latencyMs > sloMs) {
    state.slowCount = (state.slowCount ?? 0) + 1;
  } else if ((state.slowCount ?? 0) > 0) {
    state.slowCount = Math.max((state.slowCount ?? 0) - 1, 0);
  }
}

function recordFailure(provider: GrpcProvider) {
  const state = getProviderState(provider);
  state.consecutiveFailures += 1;
  state.lastFailureAt = Date.now();
  if (state.consecutiveFailures >= 3) {
    state.openUntil = Date.now() + 30_000;
  }
}

function pickProviders(providers: GrpcProvider[]): GrpcProvider[] {
  return [...providers].sort((a, b) => {
    const stateA = getProviderState(a);
    const stateB = getProviderState(b);
    const openA = isCircuitOpen(stateA) ? 1 : 0;
    const openB = isCircuitOpen(stateB) ? 1 : 0;
    if (openA !== openB) return openA - openB;
    const failureDiff = stateA.consecutiveFailures - stateB.consecutiveFailures;
    if (failureDiff !== 0) return failureDiff;
    const slowDiff = (stateA.slowCount ?? 0) - (stateB.slowCount ?? 0);
    if (slowDiff !== 0) return slowDiff;
    return (stateA.lastLatencyMs ?? 0) - (stateB.lastLatencyMs ?? 0);
  });
}

export function getGrpcClient(provider: GrpcProvider) {
  if (grpcClients.has(provider.id)) return grpcClients.get(provider.id)!;
  const meta = getGrpcMeta();
  const transport = new GrpcTransport({
    host: provider.host,
    channelCredentials: ChannelCredentials.createSsl(),
    ...(meta ? { meta } : {})
  });

  const client = new SuiGrpcClient({
    network: (process.env.SUI_GRPC_NETWORK ?? 'mainnet') as any,
    transport
  });

  grpcClients.set(provider.id, client);
  return client;
}

function mapOwner(owner: GrpcOwner) {
  if (!owner || owner.kind == null) return null;
  switch (owner.kind) {
    case OWNER_KIND.ADDRESS:
      return { AddressOwner: owner.address };
    case OWNER_KIND.OBJECT:
      return { ObjectOwner: owner.address };
    case OWNER_KIND.SHARED:
      return { Shared: true };
    case OWNER_KIND.IMMUTABLE:
      return { Immutable: true };
    case OWNER_KIND.CONSENSUS_ADDRESS:
      return { AddressOwner: owner.address };
    default:
      return null;
  }
}

function ownersEqual(a: GrpcOwner, b: GrpcOwner) {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === OWNER_KIND.ADDRESS || a.kind === OWNER_KIND.OBJECT) {
    return a.address === b.address;
  }
  if (a.kind === OWNER_KIND.CONSENSUS_ADDRESS) {
    return a.address === b.address;
  }
  return true;
}

function normalizeGasValue(value: unknown) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Math.trunc(value).toString();
  if (typeof value === 'string') return value;
  return '0';
}

function mapCommandsToTransactions(commands: unknown[] | undefined) {
  if (!commands) return [];
  return commands
    .map((command) => {
      const entry = command as any;
      const move =
        entry?.command?.oneofKind === 'moveCall' ? entry.command.moveCall : null;
      if (!move) return null;
      return {
        MoveCall: {
          package: move.package,
          module: move.module,
          function: move.function,
          arguments: move.arguments ?? []
        }
      };
    })
    .filter(Boolean);
}

export async function getGrpcTransactionBlock(digest: string) {
  const providers = pickProviders(loadGrpcProviders());
  const sloMs = Number(process.env.SUI_GRPC_SLO_MS ?? 2000);
  let lastError: unknown = null;

  for (const provider of providers) {
    if (isCircuitOpen(getProviderState(provider))) continue;
    const client = getGrpcClient(provider);
    const started = Date.now();

    try {
      const { response } = await client.ledgerService.getTransaction({
        digest,
        readMask: {
          paths: ['digest', 'transaction', 'effects', 'balance_changes', 'objects', 'timestamp']
        }
      });

      const executed = response.transaction;
      if (!executed) {
        throw new Error('No transaction returned from gRPC provider.');
      }

      const objectTypes: Record<string, string> = {};
      executed.objects?.objects?.forEach((object) => {
        if (object.objectId && object.objectType) {
          objectTypes[object.objectId] = object.objectType;
        }
      });

      const txData = executed.transaction;
      const programmable =
        txData?.kind?.data.oneofKind === 'programmableTransaction'
          ? txData.kind.data.programmableTransaction
          : null;
      const commands = programmable?.commands ?? [];

      const effects = executed.effects;
      if (!effects) {
        throw new Error('gRPC provider returned no effects for this transaction.');
      }

      const objectChanges = effects.changedObjects.map((change) => {
        const objectId = change.objectId ?? 'unknown';
        const objectType = objectTypes[objectId] ?? 'Unknown type';
        const inputOwner = change.inputOwner ?? null;
        const outputOwner = change.outputOwner ?? null;
        let type = 'mutated';

        if (
          change.idOperation === ID_OPERATION.CREATED ||
          change.inputState === INPUT_OBJECT_STATE.DOES_NOT_EXIST
        ) {
          type = 'created';
        } else if (
          change.idOperation === ID_OPERATION.DELETED ||
          change.outputState === OUTPUT_OBJECT_STATE.DOES_NOT_EXIST
        ) {
          type = 'deleted';
        } else if (change.outputState === OUTPUT_OBJECT_STATE.PACKAGE_WRITE) {
          type = 'published';
        } else if (outputOwner && inputOwner && !ownersEqual(inputOwner, outputOwner)) {
          type = 'transferred';
        }

        return {
          type,
          objectId,
          objectType,
          owner: type === 'deleted' ? mapOwner(inputOwner) : mapOwner(outputOwner),
          sender: txData?.sender,
          recipient: type === 'transferred' ? mapOwner(outputOwner) : undefined
        };
      });

      const balanceChanges = (executed.balanceChanges ?? []).map((change) => ({
        owner: { AddressOwner: change.address },
        coinType: change.coinType,
        amount: change.amount
      }));

      const gasPayment = txData?.gasPayment;

      const tx = {
        digest: executed.digest ?? digest,
        effects: {
          status: { status: effects.status?.success ? 'success' : 'failure' },
          gasUsed: {
            computationCost: normalizeGasValue(effects.gasUsed?.computationCost),
            storageCost: normalizeGasValue(effects.gasUsed?.storageCost),
            storageRebate: normalizeGasValue(effects.gasUsed?.storageRebate)
          }
        },
        transaction: {
          data: {
            sender: txData?.sender,
            gasData: {
              budget: normalizeGasValue(gasPayment?.budget)
            },
            transaction: {
              transactions: mapCommandsToTransactions(commands)
            }
          }
        },
        objectChanges,
        balanceChanges,
        timestampMs: executed.timestamp
          ? String(
              Number(executed.timestamp.seconds ?? 0n) * 1000 +
                Math.floor(Number(executed.timestamp.nanos ?? 0) / 1_000_000)
            )
          : null
      };

      const latencyMs = Date.now() - started;
      recordSuccess(provider, latencyMs, sloMs);

      return {
        data: tx,
        provider: provider.url
      };
    } catch (error) {
      recordFailure(provider);
      lastError = error;
    }
  }

  throw lastError ?? new Error('All gRPC providers failed');
}
