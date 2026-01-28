import txFixture from '../fixtures/tx-success.json';
import { explainTransaction } from '../lib/explain';

describe('explainTransaction', () => {
  it('builds a summary with gas details', () => {
    const result = explainTransaction(txFixture as any, {
      latencyMs: 120,
      cached: false,
      provider: 'fixture',
      requestId: 'test'
    });

    expect(result.ok).toBe(true);
    expect(result.summary.status).toBe('success');
    expect(result.summary.sender).toContain('0x8e1d');
    expect(result.gas.total).toContain('SUI');
    expect(result.moveCalls.length).toBeGreaterThan(0);
    expect(result.objectChanges.length).toBeGreaterThan(0);
    expect(result.balanceChanges.length).toBeGreaterThan(0);
  });

  it('builds transfer flow entries', () => {
    const result = explainTransaction(txFixture as any, {
      latencyMs: 120,
      cached: false,
      provider: 'fixture',
      requestId: 'test'
    });

    expect(result.transfers.length).toBe(1);
    expect(result.transfers[0].to).toContain('0x4c76');
  });
});
