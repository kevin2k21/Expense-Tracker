import { initializeDatabase } from '../src/data/database';

type FakeDb = {
  executeSync: jest.Mock;
  execute: jest.Mock;
  transaction: jest.Mock;
  close: jest.Mock;
};
const mockDb: FakeDb = {
  executeSync: jest.fn(),
  execute: jest.fn(async (sql: string) => ({
    rows: sql === 'SELECT merchant_key, category FROM merchant_rules'
      ? [{ merchant_key: 'market shop', category: 'Food' }]
      : sql.includes('SELECT id, merchant, review_status, category_user_edited FROM transactions')
        ? [{ id: 'past', merchant: 'Market Shop', review_status: 'confirmed', category_user_edited: 0 }]
        : [],
    rowsAffected: 0,
  })),
  transaction: jest.fn(async (work: (db: FakeDb) => Promise<void>) => work(mockDb)),
  close: jest.fn(),
};
const mockOpen = jest.fn(() => mockDb);
const mockGetDatabaseKey = jest.fn<Promise<string>, []>();

jest.mock('@op-engineering/op-sqlite', () => ({ open: () => mockOpen() }));
jest.mock('../src/native/TransactionSms', () => ({
  TransactionSms: { getDatabaseKey: () => mockGetDatabaseKey() },
}));

describe('database initialization', () => {
  it('makes concurrent callers wait for the same completed migration', async () => {
    expect(typeof jest.requireMock('@op-engineering/op-sqlite').open).toBe('function');
    let releaseKey!: (key: string) => void;
    mockGetDatabaseKey.mockImplementationOnce(() => new Promise(resolve => { releaseKey = resolve; }));
    const first = initializeDatabase();
    const second = initializeDatabase();
    expect(first).toBe(second);
    expect(mockOpen).not.toHaveBeenCalled();
    releaseKey('test-key');
    await Promise.all([first, second]);
    expect(mockGetDatabaseKey).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockDb.executeSync).toHaveBeenCalledWith(expect.stringContaining('savings_income_estimates'));
    expect(mockDb.executeSync).toHaveBeenCalledWith(expect.stringContaining('transaction_category_splits'));
    expect(mockDb.executeSync).toHaveBeenCalledWith(expect.stringContaining('ADD COLUMN note'));
    expect(mockDb.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE transactions SET category = ?'),
      ['Food', 'past']);
    await initializeDatabase();
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});
