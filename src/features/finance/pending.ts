import type { Obligation } from '../../data/finance';
import type { Transaction } from '../../types';

export type PendingGroup = {
  id: string;
  transaction: Transaction | null;
  obligations: Obligation[];
  remainingMinor: number;
  originalMinor: number;
};

export function groupPendingExpenses(
  obligations: Obligation[],
  transactions: Transaction[],
): PendingGroup[] {
  const transactionsById = new Map(transactions.map(transaction => [transaction.id, transaction]));
  const groups = new Map<string, PendingGroup>();
  for (const obligation of obligations) {
    const id = obligation.transactionId ?? obligation.id;
    const group = groups.get(id) ?? {
      id,
      transaction: obligation.transactionId ? transactionsById.get(obligation.transactionId) ?? null : null,
      obligations: [],
      remainingMinor: 0,
      originalMinor: 0,
    };
    if (obligation.remainingMinor > 0) {
      group.obligations.push(obligation);
      group.remainingMinor += obligation.remainingMinor;
    }
    group.originalMinor += obligation.amountMinor;
    groups.set(id, group);
  }
  return [...groups.values()].filter(group => group.remainingMinor > 0).sort((a, b) => {
    const aTime = a.transaction?.occurredAt ?? a.obligations[0].createdAt;
    const bTime = b.transaction?.occurredAt ?? b.obligations[0].createdAt;
    return bTime - aTime;
  });
}
