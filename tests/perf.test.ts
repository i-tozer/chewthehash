import { performance } from 'perf_hooks';
import txFixture from '../fixtures/tx-success.json';
import { explainTransaction } from '../lib/explain';

describe('performance', () => {
  it('parses quickly for the fixture payload', () => {
    const iterations = 50;
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      explainTransaction(txFixture as any, {
        latencyMs: 0,
        cached: true,
        provider: 'fixture',
        requestId: 'perf'
      });
    }
    const elapsed = performance.now() - start;
    const avg = elapsed / iterations;
    expect(avg).toBeLessThan(5);
  });
});
