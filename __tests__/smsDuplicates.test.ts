import {
  findSmsDuplicateLinks,
  isSameSmsTransaction,
  newestBankSnapshot,
  type SmsDuplicateRow,
} from '../src/data/smsDuplicates';

const receivedAt = new Date('2026-09-16T17:57:00Z').getTime();
const row = (changes: Partial<SmsDuplicateRow> = {}): SmsDuplicateRow => ({
  id: 'original',
  accountId: 'account-4242',
  amountMinor: -10000,
  kind: 'debit',
  merchant: 'SAMPLE PAYEE',
  occurredAt: new Date('2026-09-16T12:00:00Z').getTime(),
  reportedBalanceMinor: 1000000,
  sourceReceivedAt: receivedAt,
  merchantUserEdited: false,
  matchedNotificationId: null,
  createdAt: receivedAt,
  ...changes,
});

describe('SMS duplicate reconciliation', () => {
  it('hides an older row without a receive timestamp', () => {
    const legacy = row({
      id: 'legacy',
      merchant: 'Unknown merchant',
      reportedBalanceMinor: null,
      sourceReceivedAt: null,
      createdAt: receivedAt - 1000,
    });
    const canonical = row({ id: 'canonical' });
    expect(findSmsDuplicateLinks([legacy, canonical])).toEqual([
      { duplicateId: 'legacy', keeperId: 'canonical' },
    ]);
  });

  it('does not merge two balance-less legacy rows with unknown timing', () => {
    expect(
      isSameSmsTransaction(
        row({ sourceReceivedAt: null, reportedBalanceMinor: null }),
        row({ id: 'other', sourceReceivedAt: null, reportedBalanceMinor: null }),
      ),
    ).toBe(false);
  });

  it('retains a manually classified name and category row', () => {
    const manuallyEdited = row({
      id: 'edited',
      merchant: 'Sample Person',
      merchantUserEdited: true,
      sourceReceivedAt: null,
    });
    expect(findSmsDuplicateLinks([row(), manuallyEdited])).toEqual([
      { duplicateId: 'original', keeperId: 'edited' },
    ]);
  });

  it('retains a transaction-only category edit even when its vendor name is unchanged', () => {
    const classified = row({ id: 'classified', categoryUserEdited: true, createdAt: receivedAt + 1000 });
    expect(findSmsDuplicateLinks([row(), classified])).toEqual([
      { duplicateId: 'original', keeperId: 'classified' },
    ]);
  });

  it('keeps distinct received messages and different balances separate', () => {
    expect(
      isSameSmsTransaction(
        row(),
        row({ id: 'later', sourceReceivedAt: receivedAt + 5 * 60_000 }),
      ),
    ).toBe(false);
    expect(
      isSameSmsTransaction(
        row(),
        row({ id: 'different-balance', reportedBalanceMinor: 2729165 }),
      ),
    ).toBe(false);
  });

  it('does not merge distinct named vendors with a legacy timestamp', () => {
    expect(
      isSameSmsTransaction(
        row({ sourceReceivedAt: null }),
        row({ id: 'other', merchant: 'SAMPLE PERSON' }),
      ),
    ).toBe(false);
  });

  it('keeps a GPay name but takes the latest balance from its bank SMS twin', () => {
    const namedLegacy = row({
      id: 'named',
      amountMinor: 10000,
      kind: 'credit',
      merchant: 'SAMPLE PAYEE',
      reportedBalanceMinor: null,
      sourceReceivedAt: null,
      matchedNotificationId: 'gpay-receipt',
    });
    const bankSms = row({
      id: 'bank-sms',
      amountMinor: 10000,
      kind: 'credit',
      merchant: 'Sender not provided',
      reportedBalanceMinor: 1010000,
    });
    expect(findSmsDuplicateLinks([namedLegacy, bankSms])).toEqual([
      { duplicateId: 'bank-sms', keeperId: 'named' },
    ]);
    expect(newestBankSnapshot([namedLegacy, bankSms])).toBe(bankSms);
  });
});
