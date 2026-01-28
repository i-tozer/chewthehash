import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Experimental_SuiClientTypes } from '@mysten/sui/experimental';

let grpcClient: SuiGrpcClient | null = null;

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

export function getGrpcClient() {
  if (grpcClient) return grpcClient;
  const endpoint = process.env.SUI_GRPC_ENDPOINT ?? 'fullnode.mainnet.sui.io:443';
  const host = resolveGrpcHost(endpoint);
  const meta = getGrpcMeta();

  const transport = new GrpcTransport({
    host,
    channelCredentials: ChannelCredentials.createSsl(),
    ...(meta ? { meta } : {})
  });

  grpcClient = new SuiGrpcClient({
    network: (process.env.SUI_GRPC_NETWORK ?? 'mainnet') as Experimental_SuiClientTypes.Network,
    transport
  });

  return grpcClient;
}

function mapOwner(owner: Experimental_SuiClientTypes.ObjectOwner | null | undefined) {
  if (!owner) return null;
  switch (owner.$kind) {
    case 'AddressOwner':
      return { AddressOwner: owner.AddressOwner };
    case 'ObjectOwner':
      return { ObjectOwner: owner.ObjectOwner };
    case 'Shared':
      return { Shared: true };
    case 'Immutable':
      return { Immutable: true };
    case 'ConsensusAddressOwner':
      return { AddressOwner: owner.ConsensusAddressOwner.owner };
    default:
      return null;
  }
}

function ownersEqual(
  a: Experimental_SuiClientTypes.ObjectOwner | null,
  b: Experimental_SuiClientTypes.ObjectOwner | null
) {
  if (!a || !b) return false;
  if (a.$kind !== b.$kind) return false;
  if (a.$kind === 'AddressOwner') return a.AddressOwner === (b as any).AddressOwner;
  if (a.$kind === 'ObjectOwner') return a.ObjectOwner === (b as any).ObjectOwner;
  if (a.$kind === 'Shared') return true;
  if (a.$kind === 'Immutable') return true;
  if (a.$kind === 'ConsensusAddressOwner') {
    return a.ConsensusAddressOwner.owner === (b as any).ConsensusAddressOwner.owner;
  }
  return false;
}

function normalizeGasValue(value: unknown) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Math.trunc(value).toString();
  if (typeof value === 'string') return value;
  return '0';
}

function mapCommandsToTransactions(commands: any[] | undefined) {
  if (!commands) return [];
  return commands
    .map((command) => {
      const move = command?.MoveCall;
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
  const client = getGrpcClient();
  const { transaction } = await client.core.getTransaction({ digest });
  const objectTypes = await transaction.objectTypes;
  const effects = transaction.effects;
  const commands = transaction.transaction?.commands ?? [];
  const gasData = transaction.transaction?.gasData ?? {};

  const objectChanges = effects.changedObjects.map((change) => {
    const objectType = objectTypes?.[change.id] ?? 'Unknown type';
    const inputOwner = change.inputOwner ?? null;
    const outputOwner = change.outputOwner ?? null;
    let type = 'mutated';

    if (change.idOperation === 'Created' || change.inputState === 'DoesNotExist') {
      type = 'created';
    } else if (change.idOperation === 'Deleted' || change.outputState === 'DoesNotExist') {
      type = 'deleted';
    } else if (change.outputState === 'PackageWrite') {
      type = 'published';
    } else if (outputOwner && inputOwner && !ownersEqual(inputOwner, outputOwner)) {
      type = 'transferred';
    }

    return {
      type,
      objectId: change.id,
      objectType,
      owner: type === 'deleted' ? mapOwner(inputOwner) : mapOwner(outputOwner),
      sender: transaction.transaction?.sender,
      recipient: type === 'transferred' ? mapOwner(outputOwner) : undefined
    };
  });

  const balanceChanges = (transaction.balanceChanges ?? []).map((change) => ({
    owner: { AddressOwner: change.address },
    coinType: change.coinType,
    amount: change.amount
  }));

  const tx = {
    digest: transaction.digest,
    effects: {
      status: { status: effects.status.success ? 'success' : 'failure' },
      gasUsed: {
        computationCost: normalizeGasValue(effects.gasUsed?.computationCost),
        storageCost: normalizeGasValue(effects.gasUsed?.storageCost),
        storageRebate: normalizeGasValue(effects.gasUsed?.storageRebate)
      }
    },
    transaction: {
      data: {
        sender: transaction.transaction?.sender,
        gasData: {
          ...gasData,
          budget: normalizeGasValue(gasData?.budget)
        },
        transaction: {
          transactions: mapCommandsToTransactions(commands)
        }
      }
    },
    objectChanges,
    balanceChanges,
    timestampMs: null
  };

  return { data: tx, provider: process.env.SUI_GRPC_ENDPOINT ?? 'fullnode.mainnet.sui.io:443' };
}
