import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Owner } from '@mysten/sui/grpc/proto/sui/rpc/v2/owner.js';
import { Owner_OwnerKind } from '@mysten/sui/grpc/proto/sui/rpc/v2/owner.js';
import type { Command } from '@mysten/sui/grpc/proto/sui/rpc/v2/transaction.js';
import {
  ChangedObject_IdOperation,
  ChangedObject_InputObjectState,
  ChangedObject_OutputObjectState
} from '@mysten/sui/grpc/proto/sui/rpc/v2/effects.js';

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
    network: (process.env.SUI_GRPC_NETWORK ?? 'mainnet') as any,
    transport
  });

  return grpcClient;
}

function mapOwner(owner: Owner | null | undefined) {
  if (!owner || owner.kind == null) return null;
  switch (owner.kind) {
    case Owner_OwnerKind.ADDRESS:
      return { AddressOwner: owner.address };
    case Owner_OwnerKind.OBJECT:
      return { ObjectOwner: owner.address };
    case Owner_OwnerKind.SHARED:
      return { Shared: true };
    case Owner_OwnerKind.IMMUTABLE:
      return { Immutable: true };
    case Owner_OwnerKind.CONSENSUS_ADDRESS:
      return { AddressOwner: owner.address };
    default:
      return null;
  }
}

function ownersEqual(a: Owner | null | undefined, b: Owner | null | undefined) {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === Owner_OwnerKind.ADDRESS || a.kind === Owner_OwnerKind.OBJECT) {
    return a.address === b.address;
  }
  if (a.kind === Owner_OwnerKind.CONSENSUS_ADDRESS) {
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

function mapCommandsToTransactions(commands: Command[] | undefined) {
  if (!commands) return [];
  return commands
    .map((command) => {
      const move = command.command.oneofKind === 'moveCall' ? command.command.moveCall : null;
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
  const programmable = txData?.kind?.data.oneofKind === 'programmableTransaction'
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
      change.idOperation === ChangedObject_IdOperation.CREATED ||
      change.inputState === ChangedObject_InputObjectState.DOES_NOT_EXIST
    ) {
      type = 'created';
    } else if (
      change.idOperation === ChangedObject_IdOperation.DELETED ||
      change.outputState === ChangedObject_OutputObjectState.DOES_NOT_EXIST
    ) {
      type = 'deleted';
    } else if (change.outputState === ChangedObject_OutputObjectState.PACKAGE_WRITE) {
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

  return {
    data: tx,
    provider: process.env.SUI_GRPC_ENDPOINT ?? 'fullnode.mainnet.sui.io:443'
  };
}
