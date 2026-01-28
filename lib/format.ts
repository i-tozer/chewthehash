const MIST_PER_SUI = 1_000_000_000n;

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 9
});

export function formatMist(mist: bigint): string {
  const whole = mist / MIST_PER_SUI;
  const fraction = mist % MIST_PER_SUI;
  const wholeText = numberFormatter.format(Number(whole));
  if (fraction === 0n) {
    return `${wholeText} SUI`;
  }
  const fractionText = fraction.toString().padStart(9, '0').replace(/0+$/, '');
  return `${wholeText}.${fractionText} SUI`;
}

export function formatSuiFromMist(value: string | number | bigint): string {
  const mist = typeof value === 'bigint' ? value : BigInt(value);
  return formatMist(mist);
}

export function formatMistWithUnit(value: string | number | bigint): string {
  const mist = typeof value === 'bigint' ? value : BigInt(value);
  return `${formatMist(mist)} (${mist.toString()} MIST)`;
}

export function shortenAddress(value: string, head = 6, tail = 4): string {
  if (!value) return 'unknown';
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatOwner(owner: unknown): string {
  if (!owner) return 'Unknown';
  if (typeof owner === 'string') return shortenAddress(owner);
  if (typeof owner === 'object') {
    const record = owner as Record<string, any>;
    if (record.AddressOwner) return shortenAddress(record.AddressOwner);
    if (record.ObjectOwner) return `Object ${shortenAddress(record.ObjectOwner)}`;
    if (record.Shared) return 'Shared';
    if (record.Immutable) return 'Immutable';
  }
  return 'Unknown';
}

export function formatType(typeName?: string | null): string {
  if (!typeName) return 'Unknown type';
  const match = typeName.match(/<([^>]+)>/);
  if (match?.[1]) {
    const inner = match[1].split('::').pop();
    const outer = typeName.split('::').slice(-2, -1)[0];
    return `${outer}<${inner}>`;
  }
  return typeName.split('::').slice(-2).join('::');
}

export function formatCoinType(coinType?: string | null): string {
  if (!coinType) return 'Unknown';
  const match = coinType.match(/<([^>]+)>/);
  if (match?.[1]) {
    return formatCoinType(match[1]);
  }
  return coinType.split('::').pop() ?? coinType;
}

export function describeBudget(total: bigint, budget?: bigint): string | undefined {
  if (!budget || budget === 0n) return undefined;
  const ratio = Number((total * 100n) / budget);
  const percent = Math.min(Math.max(ratio, 0), 999);
  return `${formatMist(total)} of ${formatMist(budget)} (${percent}% used)`;
}
