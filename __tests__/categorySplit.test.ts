import { buildCategorySplit, personalCategoryAllocations } from '../src/features/transactions/categorySplit';

describe('transaction category splits', () => {
  it('requires distinct categories that exactly match the transaction total', () => {
    expect(buildCategorySplit(10_000, ['Food', 'Shopping'], [
      { category: 'Food', amount: '60' },
      { category: 'Shopping', amount: '40' },
    ])).toEqual({ allocations: [
      { category: 'Food', amountMinor: 6_000 },
      { category: 'Shopping', amountMinor: 4_000 },
    ], error: null });
    expect(buildCategorySplit(10_000, ['Food'], [
      { category: 'Food', amount: '60' }, { category: 'Food', amount: '40' },
    ]).error).toMatch(/only once/);
    expect(buildCategorySplit(10_000, ['Food', 'Shopping'], [
      { category: 'Food', amount: '60' }, { category: 'Shopping', amount: '30' },
    ]).error).toMatch(/₹10.00/);
  });

  it('prorates category allocations to the user share without losing cents', () => {
    expect(personalCategoryAllocations(10_000, 6_667, [
      { category: 'Food', amountMinor: 6_000 },
      { category: 'Shopping', amountMinor: 4_000 },
    ])).toEqual([
      { category: 'Food', amountMinor: 4_000 },
      { category: 'Shopping', amountMinor: 2_667 },
    ]);
  });
});
