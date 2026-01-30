import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { LRUCache } from 'lru-cache';
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

const OPEN_SIGNATURE_BODY_TYPE = {
  TYPE_UNKNOWN: 0,
  ADDRESS: 1,
  BOOL: 2,
  U8: 3,
  U16: 4,
  U32: 5,
  U64: 6,
  U128: 7,
  U256: 8,
  VECTOR: 9,
  DATATYPE: 10,
  TYPE_PARAMETER: 11
} as const;

const OPEN_SIGNATURE_REFERENCE = {
  REFERENCE_UNKNOWN: 0,
  IMMUTABLE: 1,
  MUTABLE: 2
} as const;

const ARGUMENT_KIND = {
  UNKNOWN: 0,
  GAS: 1,
  INPUT: 2,
  RESULT: 3
} as const;

const INPUT_KIND = {
  UNKNOWN: 0,
  PURE: 1,
  IMMUTABLE_OR_OWNED: 2,
  SHARED: 3,
  RECEIVING: 4
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
const functionSignatureCache = new LRUCache<
  string,
  { value: string; cachedAt: number }
>({
  max: 1000,
  ttl: 1000 * 60 * 60
});

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

export function getGrpcClientForAbi(): { client: SuiGrpcClient; provider: GrpcProvider } | null {
  const providers = pickProviders(loadGrpcProviders());
  for (const provider of providers) {
    if (isCircuitOpen(getProviderState(provider))) continue;
    return { client: getGrpcClient(provider), provider };
  }
  return null;
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

function shortTypeName(typeName: string) {
  const parts = typeName.split('::');
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}::${parts[parts.length - 1]}`;
  }
  return typeName;
}

function formatOpenSignatureBody(body: any): string {
  if (!body) return 'unknown';
  switch (body.type) {
    case OPEN_SIGNATURE_BODY_TYPE.ADDRESS:
      return 'address';
    case OPEN_SIGNATURE_BODY_TYPE.BOOL:
      return 'bool';
    case OPEN_SIGNATURE_BODY_TYPE.U8:
      return 'u8';
    case OPEN_SIGNATURE_BODY_TYPE.U16:
      return 'u16';
    case OPEN_SIGNATURE_BODY_TYPE.U32:
      return 'u32';
    case OPEN_SIGNATURE_BODY_TYPE.U64:
      return 'u64';
    case OPEN_SIGNATURE_BODY_TYPE.U128:
      return 'u128';
    case OPEN_SIGNATURE_BODY_TYPE.U256:
      return 'u256';
    case OPEN_SIGNATURE_BODY_TYPE.VECTOR: {
      const inner = formatOpenSignatureBody(body.typeParameterInstantiation?.[0]);
      return `vector<${inner}>`;
    }
    case OPEN_SIGNATURE_BODY_TYPE.DATATYPE: {
      const base = shortTypeName(body.typeName ?? 'unknown');
      const params = (body.typeParameterInstantiation ?? []).map(formatOpenSignatureBody);
      return params.length > 0 ? `${base}<${params.join(', ')}>` : base;
    }
    case OPEN_SIGNATURE_BODY_TYPE.TYPE_PARAMETER:
      return `T${body.typeParameter ?? 0}`;
    default:
      return 'unknown';
  }
}

function formatOpenSignature(signature: any): string {
  if (!signature) return 'unknown';
  const body = formatOpenSignatureBody(signature.body);
  if (signature.reference === OPEN_SIGNATURE_REFERENCE.MUTABLE) {
    return `&mut ${body}`;
  }
  if (signature.reference === OPEN_SIGNATURE_REFERENCE.IMMUTABLE) {
    return `&${body}`;
  }
  return body;
}

async function getMoveFunctionSignature(
  client: SuiGrpcClient,
  packageId: string,
  moduleName: string,
  functionName: string
): Promise<string | undefined> {
  const cacheKey = `${packageId}::${moduleName}::${functionName}`;
  const cached = functionSignatureCache.get(cacheKey);
  if (cached) return cached.value;

  const { response } = await client.movePackageService.getFunction({
    packageId,
    moduleName,
    name: functionName
  });
  const fn = (response as any).function;
  if (!fn) return undefined;

  const params = (fn.parameters ?? []).map(formatOpenSignature);
  const returns = (fn.returns ?? []).map(formatOpenSignature);
  const signature = `${moduleName}::${functionName}(${params.join(', ')})${
    returns.length > 0 ? ` -> ${returns.join(', ')}` : ''
  }`;

  functionSignatureCache.set(cacheKey, { value: signature, cachedAt: Date.now() });
  return signature;
}

async function getMoveCallSignatures(
  client: SuiGrpcClient,
  commands: unknown[]
): Promise<Map<string, string>> {
  const signatures = new Map<string, string>();
  const tasks = commands
    .map((command) => {
      const entry = command as any;
      if (entry?.command?.oneofKind !== 'moveCall') return null;
      const move = entry.command.moveCall;
      if (!move?.package || !move?.module || !move?.function) return null;
      const key = `${move.package}::${move.module}::${move.function}`;
      return { key, move };
    })
    .filter(Boolean) as Array<{ key: string; move: any }>;

  await Promise.all(
    tasks.map(async ({ key, move }) => {
      if (signatures.has(key)) return;
      try {
        const signature = await getMoveFunctionSignature(
          client,
          move.package,
          move.module,
          move.function
        );
        if (signature) signatures.set(key, signature);
      } catch {
        // Ignore signature lookup failures; fallback to simple labels.
      }
    })
  );

  return signatures;
}

function encodeBytes(bytes?: Uint8Array | null) {
  if (!bytes) return null;
  return Buffer.from(bytes).toString('base64');
}

function mapArgument(arg: any) {
  if (!arg) return null;
  switch (arg.kind) {
    case ARGUMENT_KIND.GAS:
      return 'GasCoin';
    case ARGUMENT_KIND.INPUT:
      return { Input: Number(arg.input ?? 0) };
    case ARGUMENT_KIND.RESULT:
      if (arg.subresult !== undefined && arg.subresult !== null) {
        return {
          NestedResult: [Number(arg.result ?? 0), Number(arg.subresult ?? 0)]
        };
      }
      return { Result: Number(arg.result ?? 0) };
    default:
      if (arg.input !== undefined && arg.input !== null) {
        return { Input: Number(arg.input) };
      }
      return null;
  }
}

function mapInputsToTransactionInputs(inputs: unknown[] | undefined) {
  if (!inputs) return [];
  return inputs.map((input) => {
    const entry = input as any;
    switch (entry?.kind) {
      case INPUT_KIND.PURE:
        return {
          Pure: {
            bytes: encodeBytes(entry.pure),
            literal: entry.literal ?? null
          }
        };
      case INPUT_KIND.IMMUTABLE_OR_OWNED:
        return {
          Object: {
            ImmOrOwnedObject: {
              objectId: entry.objectId ?? null,
              version: entry.version ? String(entry.version) : null,
              digest: entry.digest ?? null
            }
          }
        };
      case INPUT_KIND.SHARED:
        return {
          Object: {
            SharedObject: {
              objectId: entry.objectId ?? null,
              initialSharedVersion: entry.version ? String(entry.version) : null,
              mutable: Boolean(entry.mutable)
            }
          }
        };
      case INPUT_KIND.RECEIVING:
        return {
          Object: {
            Receiving: {
              objectId: entry.objectId ?? null,
              version: entry.version ? String(entry.version) : null,
              digest: entry.digest ?? null
            }
          }
        };
      default:
        return {
          Unknown: {
            objectId: entry.objectId ?? null
          }
        };
    }
  });
}

function mapCommandsToTransactions(
  commands: unknown[] | undefined,
  signatures?: Map<string, string>
) {
  if (!commands) return [];
  return commands
    .map((command) => {
      const entry = command as any;
      const kind = entry?.command?.oneofKind;
      if (!kind) return null;

      if (kind === 'moveCall') {
        const move = entry.command.moveCall;
        const signatureKey = `${move.package}::${move.module}::${move.function}`;
        const signature = signatures?.get(signatureKey);
        return {
          MoveCall: {
            package: move.package,
            module: move.module,
            function: move.function,
            typeArguments: move.typeArguments ?? [],
            arguments: (move.arguments ?? []).map(mapArgument).filter(Boolean),
            signature
          }
        };
      }

      if (kind === 'transferObjects') {
        const transfer = entry.command.transferObjects;
        return {
          TransferObjects: [
            (transfer.objects ?? []).map(mapArgument).filter(Boolean),
            mapArgument(transfer.address)
          ]
        };
      }

      if (kind === 'splitCoins') {
        const split = entry.command.splitCoins;
        return {
          SplitCoins: [
            mapArgument(split.coin),
            (split.amounts ?? []).map(mapArgument).filter(Boolean)
          ]
        };
      }

      if (kind === 'mergeCoins') {
        const merge = entry.command.mergeCoins;
        return {
          MergeCoins: [
            mapArgument(merge.coin),
            (merge.coinsToMerge ?? []).map(mapArgument).filter(Boolean)
          ]
        };
      }

      if (kind === 'publish') {
        const publish = entry.command.publish;
        return {
          Publish: {
            modules: (publish.modules ?? []).map(encodeBytes),
            dependencies: publish.dependencies ?? []
          }
        };
      }

      if (kind === 'makeMoveVector') {
        const makeVec = entry.command.makeMoveVector;
        return {
          MakeMoveVec: {
            type: makeVec.elementType ?? null,
            elements: (makeVec.elements ?? []).map(mapArgument).filter(Boolean)
          }
        };
      }

      if (kind === 'upgrade') {
        const upgrade = entry.command.upgrade;
        return {
          Upgrade: {
            modules: (upgrade.modules ?? []).map(encodeBytes),
            dependencies: upgrade.dependencies ?? [],
            package: upgrade.package ?? null,
            ticket: mapArgument(upgrade.ticket)
          }
        };
      }

      return null;
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
      const signatures = await getMoveCallSignatures(client, commands);

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
              inputs: mapInputsToTransactionInputs(programmable?.inputs),
              transactions: mapCommandsToTransactions(commands, signatures)
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
