export type GasSummaryView = {
  total: string;
  computation: string;
  storage: string;
  rebate: string;
  budget?: string;
};

export type SummaryView = {
  status: 'success' | 'failure' | 'unknown';
  sender: string;
  headline: string;
  subtitle: string;
  timing: string;
  oneLiner: string;
};

export type SimpleItem = {
  id: string;
  label: string;
  detail: string;
  badges?: string[];
};

export type MoveCallView = {
  id: string;
  label: string;
  fn: string;
};

export type TransferView = {
  id: string;
  from: string;
  to: string;
};

export type TimelineItem = {
  id: string;
  title: string;
  detail?: string;
  kind: 'status' | 'move' | 'object' | 'balance' | 'gas';
};

export type ExplainResponse = {
  ok: boolean;
  digest: string;
  summary: SummaryView;
  gas: GasSummaryView;
  moveCalls: MoveCallView[];
  objectChanges: SimpleItem[];
  balanceChanges: SimpleItem[];
  transfers: TransferView[];
  timeline: TimelineItem[];
  raw: unknown;
  meta: {
    latencyMs: number;
    cached: boolean;
    provider: string;
    requestId: string;
  };
  pluginSummary?: {
    title: string;
    detail?: string;
    confidence: 'high' | 'medium' | 'low';
  } | null;
  error?: string;
};
