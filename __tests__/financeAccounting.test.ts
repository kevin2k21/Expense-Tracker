import { personalSpendingMinor, safeToSpendMinor, splitPersonalMinor } from '../src/features/finance/accounting';

describe('personal versus bank spending', () => {
  it('keeps bank outflow separate from unequal friends shares', () => {
    const own = splitPersonalMinor(150000, [40000, 35000]);
    expect(own).toBe(75000);
    expect(personalSpendingMinor({ amountMinor: -150000, kind: 'debit' }, own)).toBe(75000);
  });
  it('excludes a debt repayment debit after an off-ledger expense', () => {
    expect(personalSpendingMinor({ amountMinor: -50000, kind: 'debit' }, undefined, 50000)).toBe(0);
  });
  it('subtracts refunds and excludes transfers', () => {
    expect(personalSpendingMinor({ amountMinor: 25000, kind: 'refund' })).toBe(-25000);
    expect(personalSpendingMinor({ amountMinor: -25000, kind: 'transfer' })).toBe(0);
  });
  it('rejects a split larger than the payment', () => {
    expect(() => splitPersonalMinor(10000, [6000, 5000])).toThrow();
  });
});

describe('safe to spend', () => {
  it('reserves minimum balance, goals and bills then caps by budget', () => {
    expect(safeToSpendMinor({ bankBalanceMinor: 100000, minimumMinor: 20000,
      allocatedGoalsMinor: 10000, upcomingBillsMinor: 15000, monthlyBudgetMinor: 50000,
      personalSpentMinor: 20000 })).toBe(30000);
  });
  it('is unavailable without a recent bank balance', () => {
    expect(safeToSpendMinor({ bankBalanceMinor: null, minimumMinor: 0,
      allocatedGoalsMinor: 0, upcomingBillsMinor: 0, monthlyBudgetMinor: null,
      personalSpentMinor: 0 })).toBeNull();
  });
});
