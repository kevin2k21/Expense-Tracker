import { getAppSetting, getDatabaseHandle, initializeDatabase } from './database';
import { TransactionSms } from '../native/TransactionSms';

export type CaptureHealth = {
  smsPermission: string;
  notificationAccess: string;
  selectedApps: number;
  pendingSms: number;
  pendingNotifications: number;
  lastProcessedAt: number | null;
  latestBankBalanceAt: number | null;
  appVersion: string;
};

export async function getCaptureHealth(): Promise<CaptureHealth> {
  await initializeDatabase();
  const [smsPermission, notificationAccess, packages, counts, processed, snapshot, appVersion] = await Promise.all([
    TransactionSms.getPermissionStatus(), TransactionSms.getNotificationAccessStatus(),
    TransactionSms.getNotificationPackages(), TransactionSms.getCaptureQueueCounts(),
    getAppSetting('last_capture_processed_at'),
    getDatabaseHandle().execute('SELECT received_at FROM sms_balance_snapshots ORDER BY received_at DESC LIMIT 1'),
    TransactionSms.getAppVersion(),
  ]);
  const processedAt = processed == null ? null : Number(processed);
  return {
    smsPermission, notificationAccess, selectedApps: packages.length,
    pendingSms: counts.sms, pendingNotifications: counts.notifications,
    lastProcessedAt: processedAt != null && Number.isFinite(processedAt) ? processedAt : null,
    latestBankBalanceAt: snapshot.rows.length ? Number(snapshot.rows[0].received_at) : null,
    appVersion,
  };
}
