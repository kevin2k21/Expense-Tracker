import { buildSharedSplit, parseShareAmount } from '../src/features/finance/sharedSplit';
import { groupPendingExpenses } from '../src/features/finance/pending';
import type { Obligation } from '../src/data/finance';
import type { Transaction } from '../src/types';

const transaction: Transaction = {
  id: 'tx1', accountId: 'bank', amountMinor: -30_000, kind: 'debit',
  merchant: 'Dinner', category: 'Food', occurredAt: 1_700_000_000_000,
  reportedBalanceMinor: null, source: 'sms', confidence: 1, reviewStatus: 'confirmed',
};
const obligation = (id: string, person: string, amountMinor: number, paidMinor: number): Obligation => ({
  id, person, direction: 'receivable', amountMinor, paidMinor,
  remainingMinor: amountMinor - paidMinor, automaticPaidMinor: 0, personalMinor: 0,
  transactionId: 'tx1', createdAt: transaction.occurredAt, category: 'Other',
});

describe('shared expense entry', () => {
  it('calculates the payer’s remainder from unequal shares', () => {
    expect(buildSharedSplit(30_000, [
      { name: 'Sample Person', amount: '75.50' },
      { name: 'Sam', amount: '100' },
    ])).toEqual({
      people: [
        { name: 'Sample Person', amountMinor: 7_550 },
        { name: 'Sam', amountMinor: 10_000 },
      ],
      personalMinor: 12_450,
      error: null,
    });
  });

  it('rejects invalid amounts, repeated people, and over-allocation', () => {
    expect(parseShareAmount('12.345')).toBeNull();
    expect(buildSharedSplit(1_000, [{ name: 'A', amount: '6' }, { name: 'a', amount: '2' }]).error).toMatch(/different/);
    expect(buildSharedSplit(1_000, [{ name: 'A', amount: '11' }]).error).toMatch(/exceed/);
  });
});

describe('pending expense grouping', () => {
  it('keeps the original split total after one person fully repays', () => {
    const groups = groupPendingExpenses([
      obligation('a', 'Sample Person', 8_000, 8_000),
      obligation('b', 'Sam', 7_000, 2_000),
    ], [transaction]);
    expect(groups).toHaveLength(1);
    expect(groups[0].originalMinor).toBe(15_000);
    expect(groups[0].remainingMinor).toBe(5_000);
    expect(groups[0].obligations.map(item => item.person)).toEqual(['Sam']);
    expect(groups[0].transaction?.merchant).toBe('Dinner');
  });

  it('removes fully settled expenses from pending', () => {
    expect(groupPendingExpenses([obligation('a', 'Sample Person', 8_000, 8_000)], [transaction])).toEqual([]);
  });
});
