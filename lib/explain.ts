import type {
  ExplainResponse,
  GasSummaryView,
  MoveCallView,
  SimpleItem,
  SummaryView,
  TimelineItem,
  TransferView
} from './types';
import {
  describeBudget,
  formatCoinType,
  formatOwner,
  formatSuiFromMist,
  formatType,
  shortenAddress
} from './format';

const MOVE_LABELS: Record<string, string> = {
  transfer: 'Transfer assets',
  split: 'Split coin',
  merge: 'Merge coins',
  pay: 'Pay',
  mint: 'Mint',
  burn: 'Burn'
};

type TransactionResponse = {
  digest?: string;
  effects?: {
    status?: { status?: string };
    gasUsed?: {
      computationCost?: string;
      storageCost?: string;
      storageRebate?: string;
    };
  };
  transaction?: {
    data?: {
      sender?: string;
      gasData?: { budget?: string };
      transaction?: {
        transactions?: Array<Record<string, any>>;
      };
    };
  };
  objectChanges?: Array<Record<string, any>>;
  balanceChanges?: Array<Record<string, any>>;
  timestampMs?: string;
};

function parseGasView(tx: TransactionResponse): GasSummaryView {
  const gasUsed = tx.effects?.gasUsed ?? {};
  const computation = BigInt(gasUsed.computationCost ?? 0);
  const storage = BigInt(gasUsed.storageCost ?? 0);
  const rebate = BigInt(gasUsed.storageRebate ?? 0);
  const total = computation + storage - rebate;
  const budgetRaw = tx.transaction?.data?.gasData?.budget;
  const budget = budgetRaw ? BigInt(budgetRaw) : undefined;

  return {
    total: formatSuiFromMist(total),
    computation: formatSuiFromMist(computation),
    storage: formatSuiFromMist(storage),
    rebate: formatSuiFromMist(rebate),
    budget: describeBudget(total, budget)
  };
}

function parseMoveCalls(tx: TransactionResponse): MoveCallView[] {
  const calls = tx.transaction?.data?.transaction?.transactions ?? [];
  return calls
    .map((entry, index) => {
      const move = entry.MoveCall;
      if (!move) return null;
      const fnName = String(move.function ?? 'unknown');
      const moduleName = String(move.module ?? 'unknown');
      const label =
        MOVE_LABELS[fnName] ?? MOVE_LABELS[moduleName] ?? 'Move call';
      return {
        id: `${index}-${fnName}`,
        label,
        fn: `${moduleName}::${fnName}`
      } as MoveCallView;
    })
    .filter(Boolean) as MoveCallView[];
}

function parseObjectChanges(tx: TransactionResponse): SimpleItem[] {
  const changes = tx.objectChanges ?? [];
  return changes.map((change, index) => {
    const type = String(change.type ?? 'unknown');
    const objectType = formatType(change.objectType);
    const objectId = change.objectId ? shortenAddress(change.objectId) : 'unknown';
    const owner = formatOwner(change.owner ?? change.recipient);
    const ownerBadge = (() => {
      const record = change.owner ?? change.recipient;
      if (record?.AddressOwner) return 'ADDRESS';
      if (record?.ObjectOwner) return 'OBJECT';
      if (record?.Shared) return 'SHARED';
      if (record?.Immutable) return 'IMMUTABLE';
      return 'UNKNOWN';
    })();
    let label = `${type} ${objectType}`;
    let detail = `${owner} · ${objectId}`;

    if (type === 'published') {
      label = 'Published package';
      detail = objectId;
    }

    if (type === 'deleted') {
      label = `Deleted ${objectType}`;
      detail = objectId;
    }

    if (type === 'wrapped' || type === 'unwrapped') {
      label = `${type} ${objectType}`;
      detail = objectId;
    }

    return {
      id: `${type}-${index}`,
      label,
      detail,
      badges: [type.toUpperCase(), objectType.toUpperCase(), ownerBadge]
    };
  });
}

function parseBalanceChanges(tx: TransactionResponse): SimpleItem[] {
  const changes = tx.balanceChanges ?? [];
  return changes.map((change, index) => {
    const amountRaw = change.amount ?? '0';
    const amount = BigInt(amountRaw);
    const direction = amount >= 0n ? 'Received' : 'Spent';
    const absolute = amount >= 0n ? amount : amount * -1n;
    const coin = formatCoinType(change.coinType);
    const owner = formatOwner(change.owner);
    return {
      id: `${coin}-${index}`,
      label: `${direction} ${coin}`,
      detail: `${formatSuiFromMist(absolute)} · ${owner}`
    };
  });
}

function parseTransfers(tx: TransactionResponse): TransferView[] {
  const sender = tx.transaction?.data?.sender ?? 'unknown';
  const changes = tx.objectChanges ?? [];
  const transfers = changes.filter((change) => change.type === 'transferred');
  return transfers.map((change, index) => {
    const to = formatOwner(change.recipient ?? change.owner);
    const from = change.sender ? shortenAddress(change.sender) : shortenAddress(sender);
    return {
      id: `${index}-${change.objectId ?? 'transfer'}`,
      from,
      to
    };
  });
}

function pluralize(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function isSuiCoin(coinType?: string | null) {
  if (!coinType) return false;
  return coinType.includes('::sui::SUI');
}

function getSenderSuiDelta(tx: TransactionResponse): bigint | null {
  const sender = tx.transaction?.data?.sender;
  if (!sender) return null;
  const changes = tx.balanceChanges ?? [];
  let total = 0n;
  let found = false;
  for (const change of changes) {
    if (!isSuiCoin(change.coinType)) continue;
    const owner = change.owner;
    const address =
      typeof owner === 'string'
        ? owner
        : owner?.AddressOwner ?? owner?.ObjectOwner;
    if (!address) continue;
    if (address.toLowerCase() !== sender.toLowerCase()) continue;
    total += BigInt(change.amount ?? 0);
    found = true;
  }
  return found ? total : null;
}

function buildSummary(
  tx: TransactionResponse,
  transfers: TransferView[],
  objectChanges: SimpleItem[],
  balanceChanges: SimpleItem[],
  moveCalls: MoveCallView[],
  latencyMs: number
): SummaryView {
  const statusRaw = tx.effects?.status?.status ?? 'unknown';
  const status =
    statusRaw === 'success' || statusRaw === 'failure'
      ? statusRaw
      : 'unknown';
  const sender = shortenAddress(tx.transaction?.data?.sender ?? 'unknown');

  let headline = 'Transaction processed';
  if (status === 'failure') {
    headline = 'Transaction failed to execute';
  } else if (transfers.length > 0) {
    headline = `Executed ${transfers.length} transfer${
      transfers.length === 1 ? '' : 's'
    }`;
  } else if (moveCalls.length > 0) {
    headline = `Executed ${moveCalls.length} Move call${
      moveCalls.length === 1 ? '' : 's'
    }`;
  } else if (objectChanges.length > 0) {
    headline = `Processed ${objectChanges.length} object change${
      objectChanges.length === 1 ? '' : 's'
    }`;
  }

  const subtitle = `Parsed ${pluralize(
    objectChanges.length,
    'object change'
  )} and ${pluralize(balanceChanges.length, 'balance change')}.`;

  return {
    status,
    sender,
    headline,
    subtitle,
    timing: `Explained in ${latencyMs}ms`,
    oneLiner: buildOneLiner(tx, transfers, moveCalls, objectChanges)
  };
}

function buildOneLiner(
  tx: TransactionResponse,
  transfers: TransferView[],
  moveCalls: MoveCallView[],
  objectChanges: SimpleItem[]
) {
  const statusRaw = tx.effects?.status?.status ?? 'unknown';
  const status =
    statusRaw === 'success' || statusRaw === 'failure' ? statusRaw : 'unknown';
  if (status === 'failure') return 'Failed to execute.';

  const hasPublish = (tx.objectChanges ?? []).some(
    (change) => change.type === 'published'
  );
  if (hasPublish) return 'Published a package.';

  if (transfers.length > 0) {
    const recipients = transfers.length;
    return `Transferred assets to ${recipients} recipient${
      recipients === 1 ? '' : 's'
    }.`;
  }

  const senderDelta = getSenderSuiDelta(tx);
  if (senderDelta && senderDelta !== 0n) {
    const direction = senderDelta < 0n ? 'Spent' : 'Received';
    const amount = senderDelta < 0n ? senderDelta * -1n : senderDelta;
    return `${direction} ${formatSuiFromMist(amount)}.`;
  }

  if (moveCalls.length > 0) {
    return `Executed ${pluralize(moveCalls.length, 'Move call')}.`;
  }

  if (objectChanges.length > 0) {
    return `Processed ${pluralize(objectChanges.length, 'object change')}.`;
  }

  return 'Processed transaction.';
}

function buildTimeline(
  tx: TransactionResponse,
  gas: GasSummaryView,
  moveCalls: MoveCallView[],
  objectChanges: SimpleItem[],
  balanceChanges: SimpleItem[]
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const statusRaw = tx.effects?.status?.status ?? 'unknown';
  const status =
    statusRaw === 'success' || statusRaw === 'failure' ? statusRaw : 'unknown';
  const sender = shortenAddress(tx.transaction?.data?.sender ?? 'unknown');

  items.push({
    id: 'status',
    kind: 'status',
    title: `Status: ${status}`,
    detail: `Sender ${sender}`
  });

  moveCalls.forEach((call, index) => {
    items.push({
      id: `move-${index}`,
      kind: 'move',
      title: `Move call: ${call.fn}`,
      detail: call.label
    });
  });

  objectChanges.forEach((change, index) => {
    items.push({
      id: `object-${index}`,
      kind: 'object',
      title: change.label,
      detail: change.detail
    });
  });

  balanceChanges.forEach((change, index) => {
    items.push({
      id: `balance-${index}`,
      kind: 'balance',
      title: change.label,
      detail: change.detail
    });
  });

  items.push({
    id: 'gas',
    kind: 'gas',
    title: `Gas total ${gas.total}`,
    detail: `Compute ${gas.computation} · Storage ${gas.storage} · Rebate ${gas.rebate}`
  });

  return items;
}

export function explainTransaction(
  tx: TransactionResponse,
  meta: { latencyMs: number; cached: boolean; provider: string; requestId: string }
): ExplainResponse {
  const gas = parseGasView(tx);
  const moveCalls = parseMoveCalls(tx);
  const objectChanges = parseObjectChanges(tx);
  const balanceChanges = parseBalanceChanges(tx);
  const transfers = parseTransfers(tx);
  const timeline = buildTimeline(tx, gas, moveCalls, objectChanges, balanceChanges);

  return {
    ok: true,
    digest: tx.digest ?? 'unknown',
    summary: buildSummary(
      tx,
      transfers,
      objectChanges,
      balanceChanges,
      moveCalls,
      meta.latencyMs
    ),
    gas,
    moveCalls,
    objectChanges,
    balanceChanges,
    transfers,
    timeline,
    raw: tx,
    meta
  };
}
