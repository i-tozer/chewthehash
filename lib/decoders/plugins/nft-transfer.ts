import type { DecoderContext, DecoderPlugin } from '../types';

export const NFT_TRANSFER_DECODER: DecoderPlugin = {
  id: 'nft-transfer',
  priority: 80,
  meta: {
    name: 'NFT Transfer',
    summary: 'Detects transfers of NFT-like objects based on object change types.',
    category: 'nft',
    status: 'active',
    targets: ['object change: transferred', 'object type: *nft*'],
    confidence: 'medium',
    signals: [
      'Object change type == transferred',
      'Object type string contains "nft"'
    ],
    dataSources: ['Object changes (effects)'],
    limitations: [
      'Relies on type naming conventions',
      'May miss NFTs with non-standard type names'
    ],
    lastUpdated: '2026-01-28'
  },
  match(ctx: DecoderContext) {
    const hasTransfer = ctx.objectChanges.some((change) => change.type === 'transferred');
    const looksLikeNft = ctx.objectChanges.some((change) =>
      (change.objectType ?? '').toLowerCase().includes('nft')
    );
    return hasTransfer && looksLikeNft;
  },
  describe() {
    return {
      title: 'NFT transfer',
      detail: 'Detected an NFT-like object transfer.',
      confidence: 'medium'
    };
  }
};
