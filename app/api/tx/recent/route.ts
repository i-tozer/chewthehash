import { NextResponse } from 'next/server';
import { getRecentTransactionDigests, getTransactionBlock } from '../../../../lib/rpc';
import { runDecoderPlugins } from '../../../../lib/decoders/registry';

const FALLBACK_DIGESTS = [
  '9iTt5EPbUXacWiSZ7NPhMs1YCChteuZMdNFwb7Frbn1b',
  'DTffHqncHu26zCiriisJQanpYf4qtsiwpiQHbvFhYVH1',
  '3h6559G5fFNqzSyGV79uxHbZ3PbNKnT9s7e2cX54sxMQ'
];

const OPTIONS = {
  showInput: true,
  showEffects: false,
  showEvents: false,
  showObjectChanges: true,
  showBalanceChanges: true
};

function extractMoveCalls(data: any) {
  return (data?.transaction?.data?.transaction?.transactions ?? [])
    .map((tx: any) =>
      tx.MoveCall
        ? {
            package: tx.MoveCall.package,
            module: tx.MoveCall.module,
            fn: tx.MoveCall.function
          }
        : null
    )
    .filter(Boolean);
}

export async function GET(request: Request) {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get('limit') ?? 6);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 3), 10)
    : 6;

  try {
    if (process.env.FIXTURE_MODE === '1') {
      return NextResponse.json({
        ok: true,
        digests: FALLBACK_DIGESTS.slice(0, limit).map((digest) => ({
          digest,
          tag: null
        })),
        meta: { latencyMs: Date.now() - started, cached: true, provider: 'fixture' }
      });
    }

    const { digests, cached, provider } = await getRecentTransactionDigests(
      limit,
      requestId
    );
    const tagged = await Promise.all(
      digests.map(async (digest: string) => {
        try {
          const { data } = await getTransactionBlock(digest, OPTIONS, requestId);
          const plugin = runDecoderPlugins({
            digest,
            moveCalls: extractMoveCalls(data),
            objectChanges: (data as any)?.objectChanges ?? [],
            balanceChanges: (data as any)?.balanceChanges ?? []
          });
          return {
            digest,
            tag: plugin ? { title: plugin.title, confidence: plugin.confidence } : null
          };
        } catch {
          return { digest, tag: null };
        }
      })
    );
    return NextResponse.json({
      ok: true,
      digests: tagged,
      meta: { latencyMs: Date.now() - started, cached, provider }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
