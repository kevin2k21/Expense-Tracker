import { periodStart, type CashFlowPeriod } from './cashFlow';

export function monthKeyFor(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function assignedIncomeMonth(
  transactionId: string,
  assignments: Map<string, string | null>,
): string | null {
  return assignments.get(transactionId) ?? null;
}

export function incomeWindowStart(now: number): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 30);
  return start.getTime();
}

export function recentIncomeCandidates<T extends { occurredAt: number }>(
  candidates: T[],
  now: number,
): T[] {
  const start = incomeWindowStart(now);
  return candidates.filter(item => item.occurredAt >= start && item.occurredAt <= now);
}

export function sortIncomeCandidatesByAmount<T extends { amountMinor: number; occurredAt: number }>(
  candidates: T[],
): T[] {
  return [...candidates].sort((left, right) =>
    right.amountMinor - left.amountMinor || right.occurredAt - left.occurredAt);
}

export function validIncomeMonth(monthKey: string): boolean {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(monthKey);
}

export function totalAssignedIncome(
  candidates: Array<{ assignedMonthKey: string | null; amountMinor: number }>,
  monthKey: string,
): number {
  return candidates.filter(item => item.assignedMonthKey === monthKey)
    .reduce((sum, item) => sum + item.amountMinor, 0);
}

export function selectedIncomeForPeriod<T extends {
  assignedMonthKey: string | null;
  occurredAt: number;
}>(candidates: T[], period: CashFlowPeriod, now: number): T[] {
  if (period === 'month') {
    const currentMonth = monthKeyFor(now);
    return candidates.filter(item => item.assignedMonthKey === currentMonth);
  }
  const start = periodStart(period, now);
  return candidates.filter(item => item.assignedMonthKey != null &&
    item.occurredAt >= start && item.occurredAt <= now);
}

export function compareMonthlyIncomeAndSpending(
  incomeMinor: number,
  personalSpentMinor: number,
  hasSelectedIncome: boolean,
): { status: 'unavailable' | 'surplus' | 'shortfall' | 'even'; differenceMinor: number | null } {
  if (!hasSelectedIncome) return { status: 'unavailable', differenceMinor: null };
  const differenceMinor = incomeMinor - personalSpentMinor;
  return {
    status: differenceMinor > 0 ? 'surplus' : differenceMinor < 0 ? 'shortfall' : 'even',
    differenceMinor,
  };
}
