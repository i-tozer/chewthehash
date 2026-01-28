import { NextResponse } from 'next/server';
import { getRecentTransactionDigests } from '../../../../lib/rpc';

const FALLBACK_DIGESTS = [
  '9iTt5EPbUXacWiSZ7NPhMs1YCChteuZMdNFwb7Frbn1b',
  'DTffHqncHu26zCiriisJQanpYf4qtsiwpiQHbvFhYVH1',
  '3h6559G5fFNqzSyGV79uxHbZ3PbNKnT9s7e2cX54sxMQ'
];

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
        digests: FALLBACK_DIGESTS.slice(0, limit),
        meta: { latencyMs: Date.now() - started, cached: true, provider: 'fixture' }
      });
    }

    const { digests, cached, provider } = await getRecentTransactionDigests(
      limit,
      requestId
    );
    return NextResponse.json({
      ok: true,
      digests,
      meta: { latencyMs: Date.now() - started, cached, provider }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
