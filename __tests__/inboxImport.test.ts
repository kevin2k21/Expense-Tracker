import { importRecentInbox } from '../src/features/sms/importer';
import type { PendingSms } from '../src/types';

jest.mock('../src/data/database', () => ({
  initializeDatabase: jest.fn().mockResolvedValue(undefined),
  saveParsedTransaction: jest.fn().mockResolvedValue(true),
  reconcileSmsDuplicates: jest.fn().mockResolvedValue(undefined),
  setAppSetting: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/data/finance', () => ({
  reconcileAutomaticRepayments: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/features/notifications/importer', () => ({
  processPendingGpayNotifications: jest.fn().mockResolvedValue(0),
}));
jest.mock('../src/features/sms/parserConfig', () => ({
  smsParserConfig: {
    version: 'test-parser-v1',
    parse: jest.fn((message: PendingSms) => ({
      amountMinor: 100, kind: 'debit', merchant: 'Shop', category: 'Other',
      accountLastFour: '1234', reportedBalanceMinor: 1000,
      occurredAt: message.receivedAt, confidence: 1, referenceId: null,
    })),
  },
}));
jest.mock('../src/native/TransactionSms', () => ({
  TransactionSms: {
    importInbox: jest.fn().mockResolvedValue(275),
    getPendingMessages: jest.fn(),
    acknowledgeMessages: jest.fn().mockResolvedValue(undefined),
    getCaptureQueueCounts: jest.fn().mockResolvedValue({ sms: 0, notifications: 0 }),
  },
}));

const { TransactionSms } = jest.requireMock('../src/native/TransactionSms');
const messages = (count: number): PendingSms[] => Array.from({ length: count }, (_, index) => ({
  id: `sms-${index}`, sender: 'BANK', body: 'test', receivedAt: Date.now(),
}));

describe('manual inbox import', () => {
  beforeEach(() => jest.clearAllMocks());

  it('processes every batch before reporting completion', async () => {
    TransactionSms.getPendingMessages.mockResolvedValueOnce(messages(200))
      .mockResolvedValueOnce(messages(75));
    TransactionSms.getCaptureQueueCounts.mockResolvedValueOnce({ sms: 0, notifications: 0 });
    const result = await importRecentInbox();
    expect(result).toEqual({ queued: 275, imported: 275, ignored: 0, remaining: 0, scanLimitReached: false });
    expect(TransactionSms.getPendingMessages).toHaveBeenCalledTimes(2);
    expect(TransactionSms.acknowledgeMessages).toHaveBeenCalledTimes(2);
  });

  it('reports queued messages if processing remains', async () => {
    TransactionSms.getPendingMessages.mockResolvedValueOnce([]);
    TransactionSms.getCaptureQueueCounts.mockResolvedValueOnce({ sms: 7, notifications: 0 });
    const result = await importRecentInbox();
    expect(result.remaining).toBe(7);
  });

  it('flags the native scan cap instead of claiming every older message was scanned', async () => {
    TransactionSms.importInbox.mockResolvedValueOnce(5000);
    TransactionSms.getPendingMessages.mockResolvedValueOnce([]);
    expect((await importRecentInbox()).scanLimitReached).toBe(true);
  });
});
