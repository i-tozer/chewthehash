import type { DecoderContext, DecoderPlugin } from '../types';

const GAME_KEYWORDS = ['claim', 'reward', 'loot', 'quest', 'mint'];

export const GAME_REWARD_DECODER: DecoderPlugin = {
  id: 'game-reward',
  priority: 70,
  meta: {
    name: 'Game Reward',
    summary: 'Captures reward/claim flows common in game and quest Move calls.',
    category: 'gaming',
    status: 'active',
    targets: ['function: claim/reward/loot/quest/mint'],
    confidence: 'low',
    signals: [
      'Move call function contains claim/reward/loot/quest',
      'Move call function contains mint'
    ],
    dataSources: ['Move calls (PTB commands)'],
    limitations: [
      'May match generic mints unrelated to rewards',
      'Does not inspect game-specific object types yet'
    ],
    lastUpdated: '2026-01-28'
  },
  match(ctx: DecoderContext) {
    return ctx.moveCalls.some((call) => {
      const fn = call.fn?.toLowerCase() ?? '';
      return GAME_KEYWORDS.some((keyword) => fn.includes(keyword));
    });
  },
  describe() {
    return {
      title: 'Game reward',
      detail: 'Detected a reward or claim action in game-related Move calls.',
      confidence: 'low'
    };
  }
};
