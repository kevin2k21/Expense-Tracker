import type { ReviewStatus, Transaction, TransactionKind } from '../types';

export type ReviewGroup = {
  key: string;
  representative: Transaction;
  transactionIds: string[];
  count: number;
  totalMinor: number;
};

export type VendorGroup = {
  key: string;
  representative: Transaction;
  transactions: Transaction[];
  count: number;
  outgoingMinor: number;
  incomingMinor: number;
  needsReview: number;
  unverifiedCount: number;
};

const GENERIC_MERCHANT = /^(?:unknown merchant|sender not provided|money received|bank charges|atm withdrawal|refund|pay|payment)$/i;

export function normalizedVendorKey(merchant: string): string | null {
  const trimmed = merchant.trim();
  if (!trimmed || GENERIC_MERCHANT.test(trimmed)) return null;
  const normalized = trimmed
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return normalized.length >= 2 ? normalized : null;
}

export function shouldApplyVendorDefault(
  transaction: Pick<Transaction, 'merchant' | 'reviewStatus' | 'categoryUserEdited'>,
  vendorKey: string,
): boolean {
  return !transaction.categoryUserEdited &&
    normalizedVendorKey(transaction.merchant) === vendorKey;
}

export const isUnidentifiedCredit = (
  kind: TransactionKind,
  merchant: string,
): boolean =>
  kind === 'credit' &&
  /^(?:unknown merchant|sender not provided|money received)$/i.test(
    merchant.trim(),
  );

export const importedReviewStatus = (
  kind: TransactionKind,
  merchant: string,
): ReviewStatus =>
  isUnidentifiedCredit(kind, merchant)
    ? 'awaiting_sender'
    : 'review';

export function reviewGroupKey(transaction: Transaction): string {
  // Unverified app alerts must be confirmed or merged one by one; grouping
  // them with bank SMS could count the same payment twice.
  if (transaction.source === 'notification' || transaction.possibleDuplicate) return `transaction:${transaction.id}`;
  const normalized = normalizedVendorKey(transaction.merchant);
  if (!normalized) return `transaction:${transaction.id}`;
  // A payment and a refund from the same vendor can need different categories.
  return `vendor:${transaction.kind}:${normalized}`;
}

export function groupReviewTransactions(
  transactions: Transaction[],
): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  for (const transaction of transactions) {
    if (
      (transaction.reviewStatus !== 'review' && !transaction.possibleDuplicate) ||
      isUnidentifiedCredit(transaction.kind, transaction.merchant)
    ) continue;
    const key = reviewGroupKey(transaction);
    const existing = groups.get(key);
    if (existing) {
      existing.transactionIds.push(transaction.id);
      existing.count += 1;
      existing.totalMinor += transaction.amountMinor;
    } else {
      groups.set(key, {
        key,
        representative: transaction,
        transactionIds: [transaction.id],
        count: 1,
        totalMinor: transaction.amountMinor,
      });
    }
  }
  return [...groups.values()];
}

// The vendor view includes past and pending payments. Generic bank labels are
// kept separate because two "Unknown merchant" payments need not be related.
export function groupVendorTransactions(transactions: Transaction[]): VendorGroup[] {
  const groups = new Map<string, VendorGroup>();
  for (const transaction of transactions) {
    const normalized = normalizedVendorKey(transaction.merchant);
    const key = normalized ? `vendor:${normalized}` : `transaction:${transaction.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, representative: transaction, transactions: [], count: 0,
        outgoingMinor: 0, incomingMinor: 0, needsReview: 0, unverifiedCount: 0 };
      groups.set(key, group);
    }
    group.transactions.push(transaction);
    group.count += 1;
    if (transaction.reviewStatus !== 'confirmed' || transaction.possibleDuplicate) group.needsReview += 1;
    // Unverified alerts and possible duplicates can describe a bank payment
    // already present in the ledger, so they do not contribute to totals.
    if ((transaction.source === 'notification' && transaction.reviewStatus !== 'confirmed') ||
        transaction.possibleDuplicate) {
      group.unverifiedCount += 1;
    } else if (transaction.amountMinor < 0) {
      group.outgoingMinor += Math.abs(transaction.amountMinor);
    } else {
      group.incomingMinor += transaction.amountMinor;
    }
    if (transaction.occurredAt > group.representative.occurredAt) group.representative = transaction;
  }
  for (const group of groups.values()) {
    group.transactions.sort((a, b) =>
      Math.abs(b.amountMinor) - Math.abs(a.amountMinor) || b.occurredAt - a.occurredAt);
  }
  return [...groups.values()].sort((a, b) =>
    (b.outgoingMinor + b.incomingMinor) - (a.outgoingMinor + a.incomingMinor) ||
    Number(b.needsReview > 0) - Number(a.needsReview > 0) ||
    b.representative.occurredAt - a.representative.occurredAt ||
    a.key.localeCompare(b.key));
}

export function groupVendorsNeedingReview(transactions: Transaction[]): VendorGroup[] {
  return groupVendorTransactions(transactions).filter(group => group.needsReview > 0);
}

export function reviewMemberIds(
  transactions: Transaction[],
  transactionId: string,
): string[] {
  const selected = transactions.find(row => row.id === transactionId);
  if (!selected) return [];
  if (selected.reviewStatus !== 'review') return [transactionId];
  const key = reviewGroupKey(selected);
  return transactions
    .filter(
      row => row.reviewStatus === 'review' && reviewGroupKey(row) === key,
    )
    .map(row => row.id);
}

export function vendorRenameIds(
  transactions: Transaction[],
  transactionId: string,
): string[] {
  const selected = transactions.find(row => row.id === transactionId);
  if (!selected) return [];
  const oldKey = normalizedVendorKey(selected.merchant);
  // Generic labels can represent unrelated payments, so only rename the
  // selected record in that case.
  if (!oldKey) return [transactionId];
  return transactions
    .filter(row => normalizedVendorKey(row.merchant) === oldKey)
    .map(row => row.id);
}
