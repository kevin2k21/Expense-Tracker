import {
  planAutomaticRepayments,
  type IncomingCredit,
  type SharedReceivable,
} from '../src/features/finance/automaticRepayments';

const debt = (id: string, person: string, remainingMinor: number, at = 1000): SharedReceivable => ({
  id, person, remainingMinor, expenseOccurredAt: at, expenseReceivedAt: at,
});
const credit = (id: string, merchant: string, amountMinor: number, at = 2000): IncomingCredit => ({
  id, merchant, amountMinor, alreadyAppliedMinor: 0, occurredAt: at, receivedAt: at,
});

describe('automatic shared repayments', () => {
  it('matches a later incoming credit to the person and clears the debt', () => {
    expect(planAutomaticRepayments([credit('in1', 'Sample Person', 5000)], [debt('d1', 'sample person', 5000)])).toEqual([
      { transactionId: 'in1', obligationId: 'd1', amountMinor: 5000 },
    ]);
  });

  it('applies partial repayments once, including earlier manual allocations', () => {
    const first = { ...credit('in1', 'Sample Person', 3000), alreadyAppliedMinor: 1000 };
    const second = credit('in2', 'Sample Person', 2000, 3000);
    expect(planAutomaticRepayments([second, first], [debt('d1', 'Sample Person', 4000)])).toEqual([
      { transactionId: 'in1', obligationId: 'd1', amountMinor: 2000 },
      { transactionId: 'in2', obligationId: 'd1', amountMinor: 2000 },
    ]);
    expect(planAutomaticRepayments([
      { ...credit('in1', 'Sample Person', 4000), alreadyAppliedMinor: 4000 },
    ], [debt('d1', 'Sample Person', 4000)])).toEqual([]);
  });

  it('uses exact matching or oldest-first allocation for multiple expenses', () => {
    expect(planAutomaticRepayments([credit('in1', 'Sample Person', 5000)], [
      debt('older', 'Sample Person', 3000), debt('newer', 'Sample Person', 5000, 1200),
    ])).toEqual([{ transactionId: 'in1', obligationId: 'newer', amountMinor: 5000 }]);
    expect(planAutomaticRepayments([credit('in2', 'Sample Person', 6000)], [
      debt('older', 'Sample Person', 4000), debt('newer', 'Sample Person', 4000, 1200),
    ])).toEqual([
      { transactionId: 'in2', obligationId: 'older', amountMinor: 4000 },
      { transactionId: 'in2', obligationId: 'newer', amountMinor: 2000 },
    ]);
  });

  it('does not match earlier, oversized, generic, or ambiguously identical credits', () => {
    expect(planAutomaticRepayments([credit('before', 'Sample Person', 5000, 900)], [debt('d1', 'Sample Person', 5000)])).toEqual([]);
    expect(planAutomaticRepayments([credit('big', 'Sample Person', 6000)], [debt('d1', 'Sample Person', 5000)])).toEqual([]);
    expect(planAutomaticRepayments([credit('unknown', 'Unknown merchant', 5000)], [debt('d1', 'Sample Person', 5000)])).toEqual([]);
    expect(planAutomaticRepayments([credit('ambiguous', 'Sample Person', 5000)], [
      debt('d1', 'Sample Person', 5000), debt('d2', 'Sample Person', 5000, 1200),
    ])).toEqual([]);
  });

  it('uses receive order if both bank messages have only the same coarse timestamp', () => {
    expect(planAutomaticRepayments([
      { ...credit('later', 'Sample Person', 5000, 1000), receivedAt: 3000 },
    ], [{ ...debt('d1', 'Sample Person', 5000), expenseReceivedAt: 2000 }])).toHaveLength(1);
  });
});
