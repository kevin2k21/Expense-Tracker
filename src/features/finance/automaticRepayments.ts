import { normalizedVendorKey } from '../../data/reviewGroups';

export type IncomingCredit = {
  id: string;
  merchant: string;
  amountMinor: number;
  alreadyAppliedMinor: number;
  occurredAt: number;
  receivedAt: number | null;
};

export type SharedReceivable = {
  id: string;
  person: string;
  remainingMinor: number;
  expenseOccurredAt: number;
  expenseReceivedAt: number | null;
};

export type AutomaticRepayment = {
  transactionId: string;
  obligationId: string;
  amountMinor: number;
};

const afterExpense = (credit: IncomingCredit, debt: SharedReceivable) =>
  credit.occurredAt > debt.expenseOccurredAt ||
  (credit.occurredAt === debt.expenseOccurredAt &&
    credit.receivedAt != null && debt.expenseReceivedAt != null &&
    credit.receivedAt > debt.expenseReceivedAt);

export function planAutomaticRepayments(
  credits: IncomingCredit[],
  receivables: SharedReceivable[],
): AutomaticRepayment[] {
  const debts = receivables.map(debt => ({ ...debt }));
  const matches: AutomaticRepayment[] = [];
  const orderedCredits = [...credits].sort((a, b) =>
    a.occurredAt - b.occurredAt || (a.receivedAt ?? 0) - (b.receivedAt ?? 0) || a.id.localeCompare(b.id));
  for (const credit of orderedCredits) {
    const available = credit.amountMinor - credit.alreadyAppliedMinor;
    const creditName = normalizedVendorKey(credit.merchant);
    if (!creditName || !Number.isSafeInteger(available) || available <= 0) continue;
    const eligible = debts.filter(debt => debt.remainingMinor > 0 &&
      normalizedVendorKey(debt.person) === creditName && afterExpense(credit, debt))
      .sort((a, b) => a.expenseOccurredAt - b.expenseOccurredAt ||
        (a.expenseReceivedAt ?? 0) - (b.expenseReceivedAt ?? 0) || a.id.localeCompare(b.id));
    const outstanding = eligible.reduce((sum, debt) => sum + debt.remainingMinor, 0);
    // Larger credits may be unrelated income. Leave them for manual matching.
    if (!outstanding || available > outstanding) continue;
    const exact = eligible.filter(debt => debt.remainingMinor === available);
    // Two identical dues cannot be assigned to the right expense confidently.
    if (exact.length > 1) continue;
    const allocation = exact.length === 1 ? exact : eligible;
    let left = available;
    for (const debt of allocation) {
      const amountMinor = Math.min(left, debt.remainingMinor);
      if (amountMinor <= 0) continue;
      matches.push({ transactionId: credit.id, obligationId: debt.id, amountMinor });
      debt.remainingMinor -= amountMinor;
      left -= amountMinor;
      if (left === 0) break;
    }
  }
  return matches;
}
