import type { Transaction } from '../../types';

export type CashFlowPeriod = 'today' | 'week' | 'month';
export type CashFlowSummary = {
  inflowMinor: number;
  outflowMinor: number;
  netMinor: number;
};
export type CashFlowSummaries = Record<CashFlowPeriod, CashFlowSummary>;

export function periodStart(period: CashFlowPeriod, now: number): number {
  const date = new Date(now);
  if (period === 'month') return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (period === 'week') start.setDate(start.getDate() - ((date.getDay() + 6) % 7));
  return start.getTime();
}

export function cashFlowTransactions(
  transactions: Transaction[],
  primaryAccountId: string | null,
  period: CashFlowPeriod,
  now: number,
): Transaction[] {
  if (!primaryAccountId) return [];
  const start = periodStart(period, now);
  return transactions.filter(tx => tx.accountId === primaryAccountId &&
    tx.occurredAt >= start && tx.occurredAt <= now &&
    tx.source !== 'demo' &&
    !(tx.source === 'manual' && tx.possibleDuplicate) &&
    (tx.source !== 'notification' || tx.reviewStatus === 'confirmed'));
}

export function summarizeCashFlow(transactions: Transaction[]): CashFlowSummary {
  const inflowMinor = transactions.reduce((sum, tx) => sum + Math.max(0, tx.amountMinor), 0);
  const outflowMinor = transactions.reduce((sum, tx) => sum + Math.max(0, -tx.amountMinor), 0);
  return { inflowMinor, outflowMinor, netMinor: inflowMinor - outflowMinor };
}

export function cashFlowSummaries(
  transactions: Transaction[],
  primaryAccountId: string | null,
  now: number,
): CashFlowSummaries | null {
  if (!primaryAccountId) return null;
  return {
    today: summarizeCashFlow(cashFlowTransactions(transactions, primaryAccountId, 'today', now)),
    week: summarizeCashFlow(cashFlowTransactions(transactions, primaryAccountId, 'week', now)),
    month: summarizeCashFlow(cashFlowTransactions(transactions, primaryAccountId, 'month', now)),
  };
}
