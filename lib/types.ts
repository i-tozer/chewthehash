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
};

export type SimpleItem = {
  id: string;
  label: string;
  detail: string;
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

export type ExplainResponse = {
  ok: boolean;
  digest: string;
  summary: SummaryView;
  gas: GasSummaryView;
  moveCalls: MoveCallView[];
  objectChanges: SimpleItem[];
  balanceChanges: SimpleItem[];
  transfers: TransferView[];
  raw: unknown;
  meta: {
    latencyMs: number;
    cached: boolean;
    provider: string;
    requestId: string;
  };
  error?: string;
};
