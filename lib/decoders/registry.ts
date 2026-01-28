import type { DecoderContext, DecoderPlugin, DecoderResult } from './types';
import { DEFI_SWAP_DECODER } from './plugins/defi-swap';
import { NFT_TRANSFER_DECODER } from './plugins/nft-transfer';
import { GAME_REWARD_DECODER } from './plugins/game-reward';

export const DECODER_REGISTRY: DecoderPlugin[] = [
  DEFI_SWAP_DECODER,
  NFT_TRANSFER_DECODER,
  GAME_REWARD_DECODER
].sort((a, b) => b.priority - a.priority);

export function runDecoderPlugins(ctx: DecoderContext): DecoderResult | null {
  for (const plugin of DECODER_REGISTRY) {
    try {
      if (plugin.match(ctx)) {
        return plugin.describe(ctx);
      }
    } catch {
      // Ignore plugin errors and fall back to base explanation.
    }
  }
  return null;
}
