import { NextResponse } from 'next/server';
import { z } from 'zod';
import path from 'path';
import { readFile } from 'fs/promises';
import { checkRateLimit, getClientIp, getTransactionBlock } from '../../../lib/rpc';
import { explainTransaction } from '../../../lib/explain';

const DIGEST_REGEX = /^[1-9A-HJ-NP-Za-km-z]{20,80}$|^0x[0-9a-fA-F]{40,128}$/;

const requestSchema = z.object({
  digest: z
    .string()
    .trim()
    .min(20)
    .max(80)
    .refine((value) => DIGEST_REGEX.test(value), {
      message: 'Digest must be base58 or hex.'
    })
});

const OPTIONS = {
  showInput: true,
  showEffects: true,
  showEvents: false,
  showObjectChanges: true,
  showBalanceChanges: true
};

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
    const { digest } = requestSchema.parse(body);

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

    const { data, cached, provider } = await getTransactionBlock(
      digest,
      OPTIONS,
      requestId
    );

    const response = explainTransaction(data as any, {
      latencyMs: Date.now() - started,
      cached,
      provider,
      requestId
    });

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, status: 'ready' });
}
