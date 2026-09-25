import { filterHomeActivityRows, homeActivityPage } from '../src/features/transactions/activitySearch';
import type { Transaction } from '../src/types';

const at = (day: number, hour = 12) => new Date(2026, 8, day, hour).getTime();
const transaction = (id: string, amountMinor: number, day: number,
  overrides: Partial<Transaction> = {}): Transaction => ({
  id,
  accountId: 'bank',
  amountMinor,
  kind: amountMinor > 0 ? 'credit' : 'debit',
  merchant: id,
  category: 'Other',
  occurredAt: at(day),
  reportedBalanceMinor: null,
  source: 'sms',
  confidence: 1,
  reviewStatus: 'confirmed',
  ...overrides,
});

describe('home activity filter', () => {
  const now = at(18, 18);
  const rows = [
    transaction('debit today', -1_000, 18),
    transaction('credit today', 2_000, 18),
    transaction('debit this week', -3_000, 16),
    transaction('credit this month', 4_000, 4),
    transaction('last month', -5_000, 31, { occurredAt: new Date(2026, 7, 31).getTime() }),
  ];

  it('uses one period for debit, credit, and combined activity', () => {
    expect(filterHomeActivityRows(rows, 'today', 'spending', now).map(row => row.id))
      .toEqual(['debit today']);
    expect(filterHomeActivityRows(rows, 'week', 'income', now).map(row => row.id))
      .toEqual(['credit today']);
    expect(filterHomeActivityRows(rows, 'month', 'netflow', now).map(row => row.id))
      .toEqual(['debit today', 'credit today', 'debit this week', 'credit this month']);
  });

  it('excludes provisional and unconfirmed transactions', () => {
    const hidden = [
      transaction('demo', -1_000, 18, { source: 'demo' }),
      transaction('duplicate', -1_000, 18, { source: 'manual', possibleDuplicate: true }),
      transaction('review', 1_000, 18, { source: 'notification', reviewStatus: 'review' }),
    ];
    expect(filterHomeActivityRows(hidden, 'today', 'netflow', now)).toEqual([]);
  });

  it('paginates the selected activity type with five transactions per page', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      transaction(`row ${index}`, index % 2 ? 1_000 : -1_000, 18, {
        occurredAt: at(18, index),
      }));
    const first = homeActivityPage(many, 'today', 'netflow', now, 0);
    expect(first.rows.map(row => row.id)).toEqual([
      'row 11', 'row 10', 'row 9', 'row 8', 'row 7',
    ]);
    expect(first).toMatchObject({ page: 0, pageCount: 3, total: 12 });
    expect(homeActivityPage(many, 'today', 'netflow', now, 1).rows.map(row => row.id))
      .toEqual(['row 6', 'row 5', 'row 4', 'row 3', 'row 2']);
    expect(homeActivityPage(many, 'today', 'income', now, 0)).toMatchObject({
      pageCount: 2,
      total: 6,
    });
  });
});
