import {
  getAppSetting,
  initializeDatabase,
  reconcileSmsDuplicates,
  saveParsedTransaction,
  setAppSetting,
  wipeAndReinitializeDatabase,
} from '../../data/database';
import { TransactionSms } from '../../native/TransactionSms';
import { smsParserConfig } from './parserConfig';
import { processPendingGpayNotifications } from '../notifications/importer';
import { reconcileAutomaticRepayments } from '../../data/finance';

export type ImportSummary = {
  queued: number;
  imported: number;
  ignored: number;
};

export async function processPendingSms(): Promise<ImportSummary> {
  await initializeDatabase();
  const pending = await TransactionSms.getPendingMessages(200);
  const acknowledged: string[] = [];
  let imported = 0;
  let ignored = 0;

  for (const sms of pending) {
    const parsed = smsParserConfig.parse(sms);
    if (parsed) {
      const added = await saveParsedTransaction(parsed, sms.id, sms.receivedAt);
      if (added) imported += 1;
    } else {
      ignored += 1;
    }
    acknowledged.push(sms.id);
  }

  if (acknowledged.length > 0) {
    await TransactionSms.acknowledgeMessages(acknowledged);
    await reconcileSmsDuplicates();
  }
  const notificationCount = await processPendingGpayNotifications();
  if (acknowledged.length || notificationCount) await setAppSetting('last_capture_processed_at', String(Date.now()));
  await reconcileAutomaticRepayments();
  return { queued: pending.length, imported, ignored };
}

export async function importRecentInbox(days = 90): Promise<ImportSummary & { remaining: number; scanLimitReached: boolean }> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const enqueued = await TransactionSms.importInbox(since);
  const total: ImportSummary = { queued: 0, imported: 0, ignored: 0 };
  // Native inbox import enqueues up to 5,000 messages. Drain that work in
  // batches so the completion message does not describe only the first 200.
  for (let batch = 0; batch < 25; batch += 1) {
    const result = await processPendingSms();
    total.queued += result.queued;
    total.imported += result.imported;
    total.ignored += result.ignored;
    if (result.queued < 200) break;
  }
  const remaining = (await TransactionSms.getCaptureQueueCounts()).sms;
  return { ...total, remaining, scanLimitReached: enqueued >= 5000 };
}

export async function resetLocalData(): Promise<void> {
  // Clear durable native queues before clearing the ledger, so old pending
  // messages and receipts cannot repopulate it on the next refresh.
  await TransactionSms.clearPendingData();
  await wipeAndReinitializeDatabase();
}

const PARSER_VERSION = smsParserConfig.version;

export async function syncSmsData(): Promise<ImportSummary> {
  await initializeDatabase();
  const permission = await TransactionSms.getPermissionStatus();
  const migrated = await getAppSetting('parser_version');
  const reimportDisabled =
    (await getAppSetting('auto_reimport_disabled')) === '1';
  if (permission === 'granted' && migrated !== PARSER_VERSION && !reimportDisabled) {
    // A one-time re-read repairs rows imported by older parser rules. The
    // transaction fingerprint makes this an update, never a duplicate.
    await TransactionSms.importInbox(Date.now() - 365 * 24 * 60 * 60 * 1000);
  }
  const summary = await processPendingSms();
  if (permission === 'granted' && migrated !== PARSER_VERSION) {
    await setAppSetting('parser_version', PARSER_VERSION);
  }
  return summary;
}
