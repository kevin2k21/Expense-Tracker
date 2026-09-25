import { cashFlowSummaries, cashFlowTransactions, summarizeCashFlow } from '../src/features/finance/cashFlow';
import { personalSpendingMinor } from '../src/features/finance/accounting';
import { totalAssignedIncome } from '../src/features/finance/incomeMonth';
import type { Transaction } from '../src/types';

const bank = 'primary-bank';
const at = (day: number, hour = 12, month = 8) => new Date(2026, month, day, hour).getTime();
const transaction = (id: string, amountMinor: number, occurredAt: number,
  overrides: Partial<Transaction> = {}): Transaction => ({
  id, accountId: bank, amountMinor, kind: amountMinor >= 0 ? 'credit' : 'debit',
  merchant: id, category: 'Other', occurredAt, reportedBalanceMinor: null,
  source: 'sms', confidence: 1, reviewStatus: 'confirmed', ...overrides,
});

describe('primary-bank cash flow', () => {
  it('shows the full shared payment and later repayment without changing personal spending twice', () => {
    const payment = transaction('shared', -80000, at(15));
    const firstRepayment = transaction('first repayment', 20000, at(17));
    const finalRepayment = transaction('final repayment', 40000, at(18));
    const summary = cashFlowSummaries([payment, firstRepayment, finalRepayment], bank, at(18, 18))!;
    expect(personalSpendingMinor(payment, 20000)).toBe(20000);
    expect(summary.week).toEqual({ inflowMinor: 60000, outflowMinor: 80000, netMinor: -20000 });
    expect(summary.today).toEqual({ inflowMinor: 40000, outflowMinor: 0, netMinor: 40000 });
    expect(summary.month).toEqual(summary.week);
  });

  it('books a repayment in the month received, while selected income can belong to a different month', () => {
    const payment = transaction('shared', -80000, at(31, 12, 7));
    const repayment = transaction('repayment', 60000, at(1, 12, 8));
    const salary = transaction('salary', 200000, at(31, 16, 7));
    const september = cashFlowSummaries([payment, repayment, salary], bank, at(18))!;
    expect(september.month).toEqual({ inflowMinor: 60000, outflowMinor: 0, netMinor: 60000 });
    expect(totalAssignedIncome([
      { assignedMonthKey: '2026-09', amountMinor: 200000 },
      { assignedMonthKey: null, amountMinor: 60000 },
    ], '2026-09')).toBe(200000);
  });

  it('includes refunds and own-account transfers in cash flow but not transfer spending', () => {
    const rows = [transaction('refund', 25000, at(17), { kind: 'refund' }),
      transaction('own transfer', -10000, at(18), { kind: 'transfer' })];
    expect(cashFlowSummaries(rows, bank, at(18, 18))!.week)
      .toEqual({ inflowMinor: 25000, outflowMinor: 10000, netMinor: 15000 });
    expect(personalSpendingMinor(rows[0])).toBe(-25000);
    expect(personalSpendingMinor(rows[1])).toBe(0);
  });

  it('includes manual bank movements, but not Cash, other banks, or unknown-account alerts', () => {
    const rows = [transaction('manual bank', -5000, at(18), { source: 'manual' }),
      transaction('manual cash', -7000, at(18), { source: 'manual', accountId: 'manual:cash' }),
      transaction('other bank', 3000, at(18), { accountId: 'bank-2' }),
      transaction('unknown alert', 9000, at(18), { source: 'notification', accountId: 'notification:app' }),
      transaction('confirmed primary alert', 2000, at(18), { source: 'notification' })];
    expect(cashFlowSummaries(rows, bank, at(18, 18))!.today)
      .toEqual({ inflowMinor: 2000, outflowMinor: 5000, netMinor: -3000 });
    expect(cashFlowSummaries(rows, null, at(18, 18))).toBeNull();
  });

  it('excludes demo, provisional manual, and unconfirmed alerts without merging identical purchases', () => {
    const rows = [transaction('purchase A', -21200, at(18)), transaction('purchase B', -21200, at(18)),
      transaction('provisional', -21200, at(18), { source: 'manual', possibleDuplicate: true }),
      transaction('unconfirmed', 10000, at(18), { source: 'notification', reviewStatus: 'review' }),
      transaction('demo', 10000, at(18), { source: 'demo' })];
    const included = cashFlowTransactions(rows, bank, 'today', at(18, 18));
    expect(included.map(row => row.id)).toEqual(['purchase A', 'purchase B']);
    expect(summarizeCashFlow(included)).toEqual(cashFlowSummaries(rows, bank, at(18, 18))!.today);
  });

  it('uses local Monday and the first of the month as boundaries', () => {
    const rows = [transaction('last Sunday', -1000, at(13)), transaction('Monday', -2000, at(14)),
      transaction('previous month', -3000, at(31, 12, 7))];
    const summaries = cashFlowSummaries(rows, bank, at(18, 18))!;
    expect(summaries.week.outflowMinor).toBe(2000);
    expect(summaries.month.outflowMinor).toBe(3000);
  });
});
