import { initializeDatabase, saveNotificationTransaction } from '../../data/database';
import { TransactionSms } from '../../native/TransactionSms';
import { parseTransactionNotification } from './transaction';

export async function processPendingGpayNotifications(): Promise<number> {
  await initializeDatabase();
  const pending = await TransactionSms.getPendingGpayNotifications(500);
  const acknowledged: string[] = [];
  let imported = 0;
  for (const item of pending) {
    const event = parseTransactionNotification(item);
    if (event && (await saveNotificationTransaction(event))) {
      imported += 1;
    }
    acknowledged.push(item.id);
  }

  if (acknowledged.length > 0) {
    await TransactionSms.acknowledgeGpayNotifications(acknowledged);
  }
  return imported;
}
