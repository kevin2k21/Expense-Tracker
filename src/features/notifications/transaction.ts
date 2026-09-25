import type { PendingGpayNotification } from './gpay';

export type NotificationTransaction = {
  id: string;
  packageName: string;
  amountMinor: number;
  kind: 'credit' | 'debit';
  merchant: string;
  postedAt: number;
  referenceId: string | null;
  accountLastFour: string | null;
};

const MONEY = '(?:₹|Rs\\.?|INR)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
const patterns: Array<{ kind: 'credit' | 'debit'; regex: RegExp; merchant: number; amount: number }> = [
  { kind: 'credit', regex: new RegExp(`^(.{2,60}?)\\s+paid you\\s+${MONEY}$`, 'i'), merchant: 1, amount: 2 },
  { kind: 'credit', regex: new RegExp(`^(?:received|credited)\\s+${MONEY}\\s+from\\s+(.{2,60})$`, 'i'), merchant: 2, amount: 1 },
  { kind: 'credit', regex: new RegExp(`^(?:you\\s+)?received\\s+${MONEY}\\s+from\\s+(.{2,60})$`, 'i'), merchant: 2, amount: 1 },
  { kind: 'credit', regex: new RegExp(`^${MONEY}\\s+(?:received|credited)\\s+from\\s+(.{2,60})$`, 'i'), merchant: 2, amount: 1 },
  { kind: 'debit', regex: new RegExp(`^(?:paid|sent)\\s+${MONEY}\\s+to\\s+(.{2,60})$`, 'i'), merchant: 2, amount: 1 },
  { kind: 'debit', regex: new RegExp(`^you\\s+(?:paid|sent)\\s+${MONEY}\\s+to\\s+(.{2,60})$`, 'i'), merchant: 2, amount: 1 },
  { kind: 'debit', regex: new RegExp(`^${MONEY}\\s+(?:paid|debited)\\s+(?:to|at)\\s+(.{2,60})$`, 'i'), merchant: 2, amount: 1 },
  { kind: 'debit', regex: new RegExp(`^(.{2,60}?)\\s+(?:received|was paid)\\s+${MONEY}\\s+from you$`, 'i'), merchant: 1, amount: 2 },
  { kind: 'debit', regex: new RegExp(`^your\\s+(?:a\\/c|account)\\b.{0,35}?\\bdebited\\s+by\\s+${MONEY}.*?;\\s*(.{2,60}?)\\s+credited\\b`, 'i'), merchant: 2, amount: 1 },
  { kind: 'credit', regex: new RegExp(`^your\\s+(?:a\\/c|account)\\b.{0,35}?\\bcredited\\s+(?:by|with)\\s+${MONEY}\\b`, 'i'), merchant: 0, amount: 1 },
];

export function parseTransactionNotification(input: PendingGpayNotification): NotificationTransaction | null {
  const title = input.title.replace(/\s+/g, ' ').trim();
  if (/\b(offer|reward|cashback|request|reminder|failed|declined|pending|due|recharge for|will be)\b/i.test(title)) return null;
  for (const candidate of [title, input.body?.replace(/\s+/g, ' ').trim()].filter((value): value is string => Boolean(value))) {
  for (const pattern of patterns) {
    const match = candidate.match(pattern.regex);
    if (!match) continue;
    const merchant = (pattern.merchant === 0 ? 'Unknown merchant' : match[pattern.merchant])
      .trim().replace(/[. ]+$/, '').slice(0, 48);
    const amountMinor = Math.round(Number(match[pattern.amount].replace(/,/g, '')) * 100);
    if (!merchant || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
    const sourceText = `${input.title} ${input.body ?? ''}`;
    return { id: input.id, packageName: input.packageName ?? 'com.google.android.apps.nbu.paisa.user',
      amountMinor, kind: pattern.kind, merchant, postedAt: input.postedAt,
      referenceId: sourceText.match(/\b(?:RRN|UTR|ref(?:erence)?(?:\s*no)?|transaction\s*id)\s*[:#.-]?\s*([a-z0-9]{6,30})\b/i)?.[1]?.toUpperCase() ?? null,
      accountLastFour: sourceText.match(/\b(?:a\/c|account|card)(?:\s*(?:no\.?|ending|xx|x))?[\s:*x-]*[0-9]*([0-9]{4})\b/i)?.[1] ?? null };
  }
  }
  return null;
}
