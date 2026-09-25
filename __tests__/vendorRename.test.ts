import { initializeDatabase, renameVendorForTransaction, saveVendorProfile, setTransactionCategorySplits, setTransactionNote, setVendorDefaultCategory, updateManualTransaction } from '../src/data/database';

const mockRows: Array<Record<string, string | number>> = [];
type FakeDb = { executeSync: jest.Mock; execute: jest.Mock; transaction: jest.Mock; close: jest.Mock };
const mockExecute = jest.fn(async (sql: string, params?: unknown[]) => {
  if (sql.includes('UPDATE transactions SET merchant = ?')) {
    const match = mockRows.find(row => row.id === params?.[1]);
    if (match) match.merchant = String(params?.[0]);
  }
  const rows = sql === 'SELECT * FROM transactions WHERE duplicate_of IS NULL' ? mockRows :
    sql.startsWith('SELECT name FROM categories WHERE name') ? [{ name: 'Food' }] :
      sql === 'SELECT name FROM categories' ? [{ name: 'Food' }, { name: 'Shopping' }] :
      sql.startsWith('SELECT amount_minor, kind FROM transactions') ?
        mockRows.filter(item => item.id === params?.[0]).map(item => ({ amount_minor: item.amount_minor, kind: item.kind })) :
      sql.startsWith('SELECT merchant FROM transactions WHERE id = ?') ?
        mockRows.filter(item => item.id === params?.[0]).map(item => ({ merchant: item.merchant })) :
      sql.includes('SELECT id, merchant, review_status, category_user_edited FROM transactions') ?
        mockRows.filter(item => item.category_user_edited === 0) :
      sql.startsWith('SELECT occurred_at, merchant FROM transactions') ?
        [{ occurred_at: 1, merchant: 'Old Vendor' }] : [];
  return { rows, rowsAffected: 1 };
});
const mockDb: FakeDb = {
  executeSync: jest.fn(),
  execute: mockExecute,
  transaction: jest.fn(async (work: (handle: FakeDb) => Promise<void>) => work(mockDb)),
  close: jest.fn(),
};

jest.mock('@op-engineering/op-sqlite', () => ({ open: () => mockDb }));
jest.mock('../src/native/TransactionSms', () => ({
  TransactionSms: { getDatabaseKey: jest.fn(async () => 'test-key') },
}));

const row = (id: string, merchant: string, reviewStatus = 'confirmed') => ({
  id, merchant, review_status: reviewStatus, account_id: 'bank', amount_minor: -10000,
  kind: 'debit', category: 'Food', category_user_edited: 0, occurred_at: 1,
  source: 'sms', confidence: 1,
});

describe('vendor rename persistence', () => {
  beforeAll(async () => { await initializeDatabase(); });
  beforeEach(() => { mockRows.length = 0; mockExecute.mockClear(); mockDb.transaction.mockClear(); });

  it('updates older confirmed payments and keeps categories intact', async () => {
    mockRows.push(row('selected', 'Old Vendor', 'review'),
      row('older', 'old-vendor'), row('another', 'Other Vendor'));
    await renameVendorForTransaction('selected', 'New Vendor');
    const updates = mockExecute.mock.calls.filter(([sql]) => sql.includes('UPDATE transactions SET merchant = ?'));
    expect(updates.map(([, params]) => params)).toEqual([
      ['New Vendor', 'selected'], ['New Vendor', 'older'],
    ]);
    expect(updates.every(([sql]) => !sql.includes('category ='))).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO vendor_aliases'),
      ['old vendor', 'New Vendor', expect.any(Number)]);
  });

  it('saves a note only on the selected transaction and trims it', async () => {
    mockRows.push(row('selected', 'Old Vendor'), row('other', 'Old Vendor'));
    await setTransactionNote('selected', '  Dinner with the design team  ');
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE transactions SET note = ? WHERE id = ? AND duplicate_of IS NULL',
      ['Dinner with the design team', 'selected'],
    );
  });

  it('saves an exact category allocation for one transaction', async () => {
    mockRows.push(row('selected', 'Department Store'));
    await setTransactionCategorySplits('selected', [
      { category: 'Food', amountMinor: 4_000 },
      { category: 'Shopping', amountMinor: 6_000 },
    ]);
    expect(mockExecute.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO transaction_category_splits'))
      .map(([, params]) => params)).toEqual([
        ['selected', 'Food', 4_000], ['selected', 'Shopping', 6_000],
      ]);
  });

  it('changes only the selected payment for a generic label', async () => {
    mockRows.push(row('selected', 'Unknown merchant'), row('unrelated', 'Unknown merchant'));
    await renameVendorForTransaction('selected', 'Specific Vendor');
    const updates = mockExecute.mock.calls.filter(([sql]) => sql.includes('UPDATE transactions SET merchant = ?'));
    expect(updates.map(([, params]) => params)).toEqual([['Specific Vendor', 'selected']]);
  });

  it('renames matching payments when editing a manual transaction', async () => {
    mockRows.push({ ...row('selected', 'Old Vendor'), source: 'manual' },
      row('older', 'old-vendor'));
    await updateManualTransaction('selected', {
      accountId: null, amountMinor: 10000, kind: 'debit', merchant: 'New Vendor',
      category: 'Food', occurredAt: Date.now() - 60000,
    });
    const updates = mockExecute.mock.calls.filter(([sql]) => sql.includes('UPDATE transactions SET merchant = ?'));
    expect(updates.map(([, params]) => params)).toEqual([
      ['New Vendor', 'selected'], ['New Vendor', 'older'],
    ]);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  it('saves the vendor name and default category together for past unedited payments', async () => {
    mockRows.push(row('selected', 'Old Vendor', 'review'), row('older', 'old-vendor'),
      { ...row('pending', 'old vendor', 'review'), category_user_edited: 1 });
    await saveVendorProfile('selected', 'New Vendor', 'Food');
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.calls.filter(([sql]) => sql.includes('UPDATE transactions SET merchant = ?'))
      .map(([, params]) => params)).toEqual([
        ['New Vendor', 'selected'], ['New Vendor', 'older'], ['New Vendor', 'pending'],
      ]);
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO merchant_rules'),
      ['new vendor', 'Food', 'New Vendor', expect.any(Number)]);
    expect(mockExecute.mock.calls.filter(([sql]) => sql.includes('UPDATE transactions SET category = ?'))
      .map(([, params]) => params)).toEqual([['Food', 'selected'], ['Food', 'older']]);
  });

  it('classifies every matching unedited payment and confirms safe review rows', async () => {
    mockRows.push(row('pending', 'Old Vendor', 'review'), row('past', 'old-vendor'),
      { ...row('manual-choice', 'Old Vendor', 'review'), category_user_edited: 1 },
      { ...row('alert', 'Old Vendor', 'review'), source: 'notification' },
      row('other', 'Another Vendor', 'review'));
    await setVendorDefaultCategory('Old Vendor', 'Food');
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    const updates = mockExecute.mock.calls.filter(([sql]) => sql.includes('UPDATE transactions SET category = ?'));
    expect(updates.map(([, params]) => params)).toEqual([
      ['Food', 'pending'], ['Food', 'past'], ['Food', 'alert'],
    ]);
    expect(updates[0][0]).toContain("ELSE 'confirmed' END");
    expect(updates[0][0]).toContain("source = 'notification' AND review_status <> 'confirmed'");
    expect(updates[0][0]).toContain('manual_duplicate_candidates');
  });
});
