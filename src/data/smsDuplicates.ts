export type SmsDuplicateRow = {
  id: string;
  accountId: string;
  amountMinor: number;
  kind: string;
  merchant: string;
  occurredAt: number;
  reportedBalanceMinor: number | null;
  sourceReceivedAt: number | null;
  merchantUserEdited: boolean;
  categoryUserEdited?: boolean;
  matchedNotificationId: string | null;
  createdAt: number;
};

const unknownMerchant = (merchant: string) =>
  /^(unknown merchant|sender not provided|money received)$/i.test(
    merchant.trim(),
  );

const sameMerchant = (a: SmsDuplicateRow, b: SmsDuplicateRow) =>
  a.merchant.trim().toLowerCase() === b.merchant.trim().toLowerCase() ||
  unknownMerchant(a.merchant) ||
  unknownMerchant(b.merchant) ||
  a.merchantUserEdited ||
  b.merchantUserEdited;

const sameBankDay = (a: SmsDuplicateRow, b: SmsDuplicateRow) =>
  new Date(a.occurredAt).toDateString() ===
  new Date(b.occurredAt).toDateString();

export function isSameSmsTransaction(
  a: SmsDuplicateRow,
  b: SmsDuplicateRow,
): boolean {
  if (
    a.accountId !== b.accountId ||
    a.amountMinor !== b.amountMinor ||
    a.kind !== b.kind ||
    (a.reportedBalanceMinor != null &&
      b.reportedBalanceMinor != null &&
      a.reportedBalanceMinor !== b.reportedBalanceMinor) ||
    !sameBankDay(a, b) ||
    !sameMerchant(a, b)
  ) {
    return false;
  }
  if (a.reportedBalanceMinor == null && b.reportedBalanceMinor == null) {
    // Without a bank balance, a date and amount alone do not identify an SMS.
    return (
      a.sourceReceivedAt != null &&
      b.sourceReceivedAt != null &&
      Math.abs(a.sourceReceivedAt - b.sourceReceivedAt) <= 60_000
    );
  }
  return (
    a.sourceReceivedAt == null ||
    b.sourceReceivedAt == null ||
    Math.abs(a.sourceReceivedAt - b.sourceReceivedAt) <= 60_000
  );
}

const keeperRank = (row: SmsDuplicateRow) =>
  (row.categoryUserEdited ? 8 : 0) +
  (row.merchantUserEdited ? 4 : 0) +
  (row.matchedNotificationId ? 2 : 0) +
  (row.sourceReceivedAt != null ? 1 : 0);

export function findSmsDuplicateLinks(
  rows: SmsDuplicateRow[],
): Array<{ duplicateId: string; keeperId: string }> {
  const ordered = [...rows].sort(
    (a, b) => keeperRank(b) - keeperRank(a) || a.createdAt - b.createdAt,
  );
  const keepers: SmsDuplicateRow[] = [];
  const links: Array<{ duplicateId: string; keeperId: string }> = [];
  for (const row of ordered) {
    const keeper = keepers.find(item => isSameSmsTransaction(item, row));
    if (keeper) {
      links.push({ duplicateId: row.id, keeperId: keeper.id });
    } else {
      keepers.push(row);
    }
  }
  return links;
}

export function newestBankSnapshot(
  rows: SmsDuplicateRow[],
): SmsDuplicateRow | null {
  const withBalance = rows.filter(row => row.reportedBalanceMinor != null);
  if (withBalance.length === 0) return null;
  return withBalance.reduce((latest, row) => {
    const latestTime = latest.sourceReceivedAt ?? 0;
    const rowTime = row.sourceReceivedAt ?? 0;
    return rowTime > latestTime ||
      (rowTime === latestTime && row.createdAt > latest.createdAt)
      ? row
      : latest;
  });
}
