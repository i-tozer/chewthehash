import { NextResponse } from 'next/server';
import { z } from 'zod';
import path from 'path';
import { readFile } from 'fs/promises';
import {
  checkRateLimit,
  getClientIp,
  getObjectTypes,
  getTransactionBlock
} from '../../../lib/rpc';
import { explainTransaction } from '../../../lib/explain';
import { runDecoderPlugins } from '../../../lib/decoders/registry';
import { getGrpcTransactionBlock } from '../../../lib/grpc';
import { decodeMoveCallArgsWithAbi } from '../../../lib/abi';

const DIGEST_REGEX = /^[1-9A-HJ-NP-Za-km-z]{20,80}$|^0x[0-9a-fA-F]{40,128}$/;

const requestSchema = z.object({
  digest: z
    .string()
    .trim()
    .min(20)
    .max(80)
    .refine((value) => DIGEST_REGEX.test(value), {
      message: 'Digest must be base58 or hex.'
    }),
  mode: z.enum(['json', 'grpc']).optional()
});

const OPTIONS = {
  showInput: true,
  showEffects: true,
  showEvents: false,
  showObjectChanges: true,
  showBalanceChanges: true
};

function extractInputObjectIds(inputs: any[]) {
  const ids: string[] = [];
  inputs.forEach((input) => {
    const object = input?.Object ?? null;
    if (object?.ImmOrOwnedObject?.objectId) {
      ids.push(object.ImmOrOwnedObject.objectId);
    } else if (object?.SharedObject?.objectId) {
      ids.push(object.SharedObject.objectId);
    } else if (object?.Receiving?.objectId) {
      ids.push(object.Receiving.objectId);
    } else if (object?.objectId) {
      ids.push(object.objectId);
    }
  });
  return Array.from(new Set(ids));
}

async function attachAbiDecodedArgs(data: any, requestId: string) {
  const inputs = data?.transaction?.data?.transaction?.inputs ?? [];
  const transactions = data?.transaction?.data?.transaction?.transactions ?? [];
  const objectIds = extractInputObjectIds(inputs);
  const objectTypes = objectIds.length > 0 ? await getObjectTypes(objectIds, requestId) : {};
  await Promise.all(
    transactions.map(async (tx: any) => {
      if (!tx?.MoveCall) return;
      const move = tx.MoveCall;
      if (!move.package || !move.module || !move.function) return;
      const decoded = await decodeMoveCallArgsWithAbi({
        packageId: move.package,
        moduleName: move.module,
        functionName: move.function,
        typeArguments: move.typeArguments ?? [],
        arguments: move.arguments ?? [],
        inputs,
        objectTypes
      });
      if (decoded.length === 0) return;
      move.decodedArgs = decoded.map((item) => `${item.type} = ${item.value}`);
    })
  );
}

async function loadFixture(digest: string) {
  const fixturePath = path.join(process.cwd(), 'fixtures', 'tx-success.json');
  const raw = await readFile(fixturePath, 'utf8');
  const data = JSON.parse(raw) as Record<string, any>;
  data.digest = digest;
  return data;
}

export async function POST(request: Request) {
  const started = Date.now();
  const requestId = crypto.randomUUID();

  try {
    const body = await request.json();
    const { digest, mode } = requestSchema.parse(body);

    const ip = getClientIp(request.headers);
    const rate = checkRateLimit(ip);
    if (!rate.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Rate limit exceeded. Try again shortly.' },
        { status: 429 }
      );
    }

    if (process.env.FIXTURE_MODE === '1') {
      const fixture = await loadFixture(digest);
      const response = explainTransaction(fixture, {
        latencyMs: Date.now() - started,
        cached: false,
        provider: 'fixture',
        requestId
      });
      return NextResponse.json(response);
    }

    let response;
    const latencyMs = () => Date.now() - started;

    if (mode === 'json') {
      const { data, cached, provider } = await getTransactionBlock(
        digest,
        OPTIONS,
        requestId
      );
      await attachAbiDecodedArgs(data as any, requestId);
      response = explainTransaction(data as any, {
        latencyMs: latencyMs(),
        cached,
        provider: `json:${provider}`,
        requestId
      });
      (response as any).pluginSummary = runDecoderPlugins({
        digest,
        moveCalls: (data as any)?.transaction?.data?.transaction?.transactions
          ?.map((tx: any) =>
            tx.MoveCall
              ? {
                  package: tx.MoveCall.package,
                  module: tx.MoveCall.module,
                  fn: tx.MoveCall.function
                }
              : null
          )
          .filter(Boolean),
        objectChanges: (data as any)?.objectChanges ?? [],
        balanceChanges: (data as any)?.balanceChanges ?? []
      });
    } else {
      try {
        const { data, provider } = await getGrpcTransactionBlock(digest);
        await attachAbiDecodedArgs(data as any, requestId);
        response = explainTransaction(data as any, {
          latencyMs: latencyMs(),
          cached: false,
          provider: `grpc:${provider}`,
          requestId
        });
        (response as any).pluginSummary = runDecoderPlugins({
          digest,
          moveCalls: (data as any)?.transaction?.data?.transaction?.transactions
            ?.map((tx: any) =>
              tx.MoveCall
                ? {
                    package: tx.MoveCall.package,
                    module: tx.MoveCall.module,
                    fn: tx.MoveCall.function
                  }
                : null
            )
            .filter(Boolean),
          objectChanges: (data as any)?.objectChanges ?? [],
          balanceChanges: (data as any)?.balanceChanges ?? []
        });
      } catch (grpcError) {
        const { data, cached, provider } = await getTransactionBlock(
          digest,
          OPTIONS,
          requestId
        );
        await attachAbiDecodedArgs(data as any, requestId);
        response = explainTransaction(data as any, {
          latencyMs: latencyMs(),
          cached,
          provider: `json:${provider}`,
          requestId
        });
        (response as any).pluginSummary = runDecoderPlugins({
          digest,
          moveCalls: (data as any)?.transaction?.data?.transaction?.transactions
            ?.map((tx: any) =>
              tx.MoveCall
                ? {
                    package: tx.MoveCall.package,
                    module: tx.MoveCall.module,
                    fn: tx.MoveCall.function
                  }
                : null
            )
            .filter(Boolean),
          objectChanges: (data as any)?.objectChanges ?? [],
          balanceChanges: (data as any)?.balanceChanges ?? []
        });
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, status: 'ready' });
}
