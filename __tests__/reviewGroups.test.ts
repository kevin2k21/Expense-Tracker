import {
  groupReviewTransactions,
  groupVendorTransactions,
  groupVendorsNeedingReview,
  importedReviewStatus,
  normalizedVendorKey,
  reviewMemberIds,
  shouldApplyVendorDefault,
  vendorRenameIds,
} from '../src/data/reviewGroups';
import type { Transaction } from '../src/types';

const transaction = (
  id: string,
  merchant: string,
  changes: Partial<Transaction> = {},
): Transaction => ({
  id,
  accountId: 'account-4242',
  amountMinor: -10000,
  kind: 'debit',
  merchant,
  category: 'Other',
  occurredAt: Date.now(),
  reportedBalanceMinor: 2500000,
  source: 'sms',
  confidence: 0.9,
  reviewStatus: 'review',
  ...changes,
});

describe('vendor review groups', () => {
  it('uses a stable vendor key but never aliases generic labels', () => {
    expect(normalizedVendorKey("SAMPLE FOOD COURT")).toBe('sample food court');
    expect(normalizedVendorKey('sample food-court')).toBe('sample food court');
    expect(normalizedVendorKey('  sample@upi  ')).toBe('sample upi');
    expect(normalizedVendorKey('Unknown merchant')).toBeNull();
    expect(normalizedVendorKey('Sender not provided')).toBeNull();
  });
  it('applies vendor defaults to matching unedited transactions regardless of review state', () => {
    const key = normalizedVendorKey('SAMPLE PERSON')!;
    expect(shouldApplyVendorDefault(transaction('pending', 'Sample Person'), key)).toBe(true);
    expect(shouldApplyVendorDefault(transaction('edited', 'Sample Person', {
      category: 'Friends', categoryUserEdited: true,
    }), key)).toBe(false);
    expect(shouldApplyVendorDefault(transaction('confirmed', 'Sample Person', {
      reviewStatus: 'confirmed', category: 'Food',
    }), key)).toBe(true);
    expect(shouldApplyVendorDefault(transaction('other', 'Other person'), key)).toBe(false);
  });
  it('shows repeat payments as one item and totals their amounts', () => {
    const rows = [
      transaction('latest', "SAMPLE FOOD COURT", { amountMinor: -20000 }),
      transaction('older', 'Sample food-court', { amountMinor: -15000 }),
    ];
    expect(groupReviewTransactions(rows)).toMatchObject([
      {
        representative: { id: 'latest' },
        count: 2,
        totalMinor: -35000,
        transactionIds: ['latest', 'older'],
      },
    ]);
    expect(reviewMemberIds(rows, 'older')).toEqual(['latest', 'older']);
  });

  it('keeps unnamed credits in the ledger but out of Review', () => {
    const rows = [
      transaction('one', 'Unknown merchant', {
        kind: 'credit', amountMinor: 10000, reviewStatus: 'awaiting_sender',
      }),
      transaction('two', 'Money received', {
        kind: 'credit', amountMinor: 10000, reviewStatus: 'review',
      }),
    ];
    expect(groupReviewTransactions(rows)).toHaveLength(0);
    expect(reviewMemberIds(rows, 'one')).toEqual(['one']);
    expect(importedReviewStatus('credit', 'Unknown merchant')).toBe('awaiting_sender');
    expect(importedReviewStatus('credit', 'Money received')).toBe('awaiting_sender');
    expect(importedReviewStatus('debit', 'Unknown merchant')).toBe('review');
    expect(importedReviewStatus('credit', 'TEST SENDER GAMMA')).toBe('review');
  });

  it('keeps an unnamed debit in Review as a separate item', () => {
    const rows = [
      transaction('one', 'Unknown merchant'),
      transaction('two', 'Unknown merchant'),
    ];
    expect(groupReviewTransactions(rows)).toHaveLength(2);
  });

  it('does not mix incoming and outgoing payments or reviewed transactions', () => {
    const rows = [
      transaction('debit', 'SAMPLE PERSON'),
      transaction('credit', 'sample person', { kind: 'credit', amountMinor: 10000 }),
      transaction('confirmed', 'Sample Person', { reviewStatus: 'confirmed' }),
    ];
    expect(groupReviewTransactions(rows)).toHaveLength(2);
    expect(reviewMemberIds(rows, 'debit')).toEqual(['debit']);
    expect(reviewMemberIds(rows, 'confirmed')).toEqual(['confirmed']);
  });

  it('groups named GPay credits but never generic payment labels', () => {
    const rows = [
      transaction('a', 'TEST SENDER ALPHA', { kind: 'credit', amountMinor: 30000 }),
      transaction('b', 'test sender alpha', { kind: 'credit', amountMinor: 50000 }),
      transaction('c', 'Money received', { kind: 'credit', amountMinor: 30000 }),
      transaction('d', 'Money received', { kind: 'credit', amountMinor: 50000 }),
    ];
    expect(groupReviewTransactions(rows).map(group => group.count)).toEqual([2]);
    expect(reviewMemberIds(rows, 'b')).toEqual(['a', 'b']);
  });

  it('keeps unverified notifications separate from bank transactions for review', () => {
    const rows = [
      transaction('bank', 'Snowcube Food Court'),
      transaction('alert', 'Snowcube Food Court', { source: 'notification' }),
    ];
    expect(groupReviewTransactions(rows)).toHaveLength(2);
    expect(reviewMemberIds(rows, 'alert')).toEqual(['alert']);
  });

  it('renames every transaction with the old vendor name, regardless of review state or source', () => {
    const rows = [
      transaction('selected', "SAMPLE FOOD COURT"),
      transaction('confirmed', 'Sample food-court', { reviewStatus: 'confirmed' }),
      transaction('income', 'sample food court', { kind: 'credit', amountMinor: 15000 }),
      transaction('alert', 'Sample Food Court', { source: 'notification' }),
      transaction('other', 'Another vendor'),
    ];
    expect(vendorRenameIds(rows, 'selected')).toEqual(['selected', 'confirmed', 'income', 'alert']);
    expect(vendorRenameIds(rows, 'missing')).toEqual([]);
  });

  it('does not bulk rename unrelated transactions with generic labels', () => {
    const rows = [transaction('one', 'Unknown merchant'), transaction('two', 'Unknown merchant')];
    expect(vendorRenameIds(rows, 'one')).toEqual(['one']);
  });

  it('combines all states and payment directions for a named vendor without netting them', () => {
    const rows = [
      transaction('paid', 'SAMPLE PERSON', { amountMinor: -12000, occurredAt: 300 }),
      transaction('past', 'Sample Person', { amountMinor: -8000, reviewStatus: 'confirmed', occurredAt: 100 }),
      transaction('received', 'sample-person', { kind: 'credit', amountMinor: 5000, occurredAt: 200 }),
      transaction('alert', 'Sample Person', { source: 'notification', amountMinor: -12000, occurredAt: 150 }),
      transaction('duplicate', 'Sample Person', { possibleDuplicate: true, amountMinor: -8000, occurredAt: 50 }),
    ];
    expect(groupVendorTransactions(rows)).toMatchObject([{
      count: 5, outgoingMinor: 20000, incomingMinor: 5000,
      needsReview: 4, unverifiedCount: 2,
      representative: { id: 'paid' },
    }]);
  });

  it('keeps generic labels separate and sorts vendors by total money moved', () => {
    const rows = [
      transaction('unknown-1', 'Unknown merchant', { amountMinor: -30000, reviewStatus: 'confirmed', occurredAt: 30 }),
      transaction('unknown-2', 'Unknown merchant', { amountMinor: -20000, reviewStatus: 'confirmed', occurredAt: 20 }),
      transaction('review', 'Market Shop', { amountMinor: -10000, occurredAt: 10 }),
    ];
    const groups = groupVendorTransactions(rows);
    expect(groups).toHaveLength(3);
    expect(groups.map(group => group.representative.id)).toEqual(['unknown-1', 'unknown-2', 'review']);
    expect(groups.map(group => group.count)).toEqual([1, 1, 1]);
  });

  it('adds credits and debits for sorting without cancelling them out, then sorts payments within a vendor', () => {
    const rows = [
      transaction('small', 'Person A', { amountMinor: -1000, occurredAt: 30 }),
      transaction('credit', 'Person A', { amountMinor: 30000, kind: 'credit', occurredAt: 10 }),
      transaction('large', 'Person B', { amountMinor: -25000, reviewStatus: 'confirmed', occurredAt: 40 }),
      transaction('alert', 'Person C', { amountMinor: -90000, source: 'notification', occurredAt: 50 }),
    ];
    const groups = groupVendorTransactions(rows);
    expect(groups.map(group => group.representative.merchant)).toEqual(['Person A', 'Person B', 'Person C']);
    expect(groups[0].transactions.map(tx => tx.id)).toEqual(['credit', 'small']);
    expect(groups[2].unverifiedCount).toBe(1);
  });

  it('removes a vendor from Review once every payment is confirmed', () => {
    const confirmed = transaction('past', 'Market Shop', { reviewStatus: 'confirmed' });
    const pending = transaction('pending', 'market-shop');
    expect(groupVendorsNeedingReview([confirmed, pending])).toHaveLength(1);
    expect(groupVendorsNeedingReview([confirmed, { ...pending, reviewStatus: 'confirmed' }])).toHaveLength(0);
    expect(groupVendorTransactions([confirmed, { ...pending, reviewStatus: 'confirmed' }])).toHaveLength(1);
  });
});
