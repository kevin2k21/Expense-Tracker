import { filterActivityByType, filterActivityRows, paginateActivityRows } from '../src/features/transactions/activitySearch';
import { formatLocalDateTime, parseLocalDateTime } from '../src/features/transactions/manualInput';
import { planManualMatch } from '../src/features/transactions/manualMatch';
import { groupReviewTransactions, groupVendorTransactions } from '../src/data/reviewGroups';
import type { Transaction } from '../src/types';

const tx = (id: string, overrides: Partial<Transaction> = {}): Transaction => ({
  id, accountId: 'bank-1', amountMinor: -10000, kind: 'debit', merchant: 'Food Court',
  category: 'Food', occurredAt: new Date(2026, 8, 18, 10).getTime(),
  reportedBalanceMinor: null, source: 'sms', confidence: 1, reviewStatus: 'confirmed',
  ...overrides,
});

describe('activity and manual-entry workflows', () => {
  const now = new Date(2026, 8, 18, 16).getTime();

  it('searches vendor or shared person while respecting date and account', () => {
    const rows = [tx('today'), tx('old', { occurredAt: new Date(2026, 7, 20).getTime() }),
      tx('other-account', { accountId: 'bank-2', merchant: 'Groceries' })];
    const people = new Map([['today', ['Sample']]]);
    expect(filterActivityRows(rows, { query: 'sam', accountId: 'bank-1', period: 'month', now,
      peopleByTransaction: people }).map(item => item.id)).toEqual(['today']);
    expect(filterActivityRows(rows, { query: '', accountId: null, period: 'all', now }).length).toBe(3);
  });

  it('finds a transaction by its note', () => {
    const rows = [tx('rent', { note: 'Security deposit for apartment' }), tx('food')];
    expect(filterActivityRows(rows, { query: 'deposit', accountId: null, period: 'all', now })
      .map(item => item.id)).toEqual(['rent']);
  });

  it('keeps all transactions in Activity Review before grouping and sorting vendors', () => {
    const rows = [tx('small', { merchant: 'Small Shop', amountMinor: -1000 }),
      tx('large-debit', { merchant: 'Large Shop', amountMinor: -10000 }),
      tx('large-credit', { merchant: 'large-shop', amountMinor: 5000, kind: 'credit' })];
    expect(filterActivityByType(rows, 'Expenses').map(item => item.id)).toEqual(['small', 'large-debit']);
    expect(filterActivityByType(rows, 'Income').map(item => item.id)).toEqual(['large-credit']);
    const reviewRows = filterActivityRows(filterActivityByType(rows, 'Review'),
      { query: '', accountId: null, period: 'all', now });
    expect(groupVendorTransactions(reviewRows).map(group => group.representative.merchant))
      .toEqual(['Large Shop', 'Small Shop']);
  });

  it('paginates activity results and clamps pages after filtering', () => {
    const rows = Array.from({ length: 23 }, (_, index) => tx(String(index)));
    expect(paginateActivityRows(rows, 1)).toMatchObject({
      page: 1,
      pageCount: 3,
      total: 23,
      rows: rows.slice(10, 20),
    });
    expect(paginateActivityRows(rows.slice(0, 4), 2)).toMatchObject({
      page: 0,
      pageCount: 1,
      total: 4,
    });
  });

  it('parses a real local date and rejects impossible dates', () => {
    const time = new Date(2026, 8, 18, 12, 45).getTime();
    expect(formatLocalDateTime(time)).toBe('18/09/2026 12:45');
    expect(parseLocalDateTime('18/09/2026 12:45')).toBe(time);
    expect(parseLocalDateTime('31/02/2026 12:45')).toBeNull();
    expect(parseLocalDateTime('18/09/2026 25:45')).toBeNull();
  });

  it('only auto-matches a unique reference, never repeated same-amount payments', () => {
    const candidates = [{ id: 'a', referenceId: null }, { id: 'b', referenceId: null }];
    expect(planManualMatch(null, candidates)).toEqual({ exactId: null, reviewIds: ['a', 'b'] });
    expect(planManualMatch('RRN-1', [{ id: 'a', referenceId: 'RRN-1' }, ...candidates]))
      .toEqual({ exactId: 'a', reviewIds: [] });
    expect(planManualMatch('RRN-1', [{ id: 'a', referenceId: 'RRN-1' }, { id: 'b', referenceId: 'RRN-1' }]))
      .toEqual({ exactId: null, reviewIds: ['a', 'b'] });
  });

  it('shows a confirmed provisional manual entry in review as its own item', () => {
    const groups = groupReviewTransactions([tx('manual', { source: 'manual', possibleDuplicate: true })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].representative.id).toBe('manual');
  });
});
