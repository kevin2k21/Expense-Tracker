import type { Transaction } from '../../types';

export function personalSpendingMinor(
  transaction: Pick<Transaction, 'amountMinor' | 'kind'>,
  assignedPersonalMinor?: number,
  reimbursementMinor = 0,
): number {
  if (transaction.kind === 'refund') return -Math.max(0, transaction.amountMinor);
  if (transaction.kind === 'transfer' || transaction.amountMinor >= 0) return 0;
  return Math.max(0, (assignedPersonalMinor ?? Math.abs(transaction.amountMinor)) - reimbursementMinor);
}

export function safeToSpendMinor(input: {
  bankBalanceMinor: number | null;
  minimumMinor: number;
  allocatedGoalsMinor: number;
  upcomingBillsMinor: number;
  monthlyBudgetMinor: number | null;
  personalSpentMinor: number;
}): number | null {
  if (input.bankBalanceMinor == null) return null;
  const cash = Math.max(0, input.bankBalanceMinor - input.minimumMinor - input.allocatedGoalsMinor - input.upcomingBillsMinor);
  return input.monthlyBudgetMinor != null && input.monthlyBudgetMinor > 0
    ? Math.min(cash, Math.max(0, input.monthlyBudgetMinor - input.personalSpentMinor)) : cash;
}

export function splitPersonalMinor(grossMinor: number, shares: number[]): number {
  if (!Number.isSafeInteger(grossMinor) || grossMinor <= 0 ||
    shares.some(value => !Number.isSafeInteger(value) || value <= 0)) throw new Error('Invalid split');
  const others = shares.reduce((sum, value) => sum + value, 0);
  if (others > grossMinor) throw new Error('Shares exceed payment');
  return grossMinor - others;
}
