import type { DecoderContext, DecoderPlugin } from '../types';

const SWAP_MODULES = new Set(['swap', 'pool', 'router', 'amm']);
const SWAP_FUNCTIONS = new Set(['swap', 'swap_exact_in', 'swap_exact_out', 'swap_tokens']);

export const DEFI_SWAP_DECODER: DecoderPlugin = {
  id: 'defi-swap',
  priority: 90,
  meta: {
    name: 'DeFi Swap',
    summary: 'Flags swap-like Move calls routed through pools, routers, or AMMs.',
    category: 'defi',
    status: 'active',
    targets: ['module: swap/pool/router/amm', 'function: swap*'],
    confidence: 'medium',
    signals: [
      'Move call module matches swap/pool/router/amm',
      'Move call function contains swap'
    ],
    dataSources: ['Move calls (PTB commands)'],
    limitations: [
      'Heuristic detection; does not verify protocol-specific ABI',
      'Does not decode amounts, routes, or pools yet'
    ],
    lastUpdated: '2026-01-28'
  },
  match(ctx: DecoderContext) {
    return ctx.moveCalls.some((call) => {
      const module = call.module?.toLowerCase() ?? '';
      const fn = call.fn?.toLowerCase() ?? '';
      return SWAP_MODULES.has(module) || SWAP_FUNCTIONS.has(fn) || fn.includes('swap');
    });
  },
  describe() {
    return {
      title: 'Token swap',
      detail: 'Detected a swap-like Move call in a DeFi module.',
      confidence: 'medium'
    };
  }
};
