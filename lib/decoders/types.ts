export type DecoderContext = {
  digest: string;
  moveCalls: Array<{ package?: string; module?: string; fn?: string }>;
  objectChanges: Array<{ type?: string; objectType?: string }>;
  balanceChanges: Array<{ coinType?: string; amount?: string }>;
};

export type DecoderResult = {
  title: string;
  detail?: string;
  confidence: 'high' | 'medium' | 'low';
};

export type DecoderMeta = {
  name: string;
  summary: string;
  category: 'defi' | 'nft' | 'gaming' | 'core' | 'other';
  status: 'active' | 'planned' | 'draft';
  targets: string[];
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
  dataSources: string[];
  limitations: string[];
  lastUpdated: string;
};

export type DecoderPlugin = {
  id: string;
  priority: number;
  meta: DecoderMeta;
  match: (ctx: DecoderContext) => boolean;
  describe: (ctx: DecoderContext) => DecoderResult;
};
