export type TransactionKind =
  | 'debit'
  | 'credit'
  | 'refund'
  | 'fee'
  | 'withdrawal'
  | 'transfer';

export type ReviewStatus = 'confirmed' | 'review' | 'awaiting_sender';

export type Account = {
  id: string;
  name: string;
  lastFour: string | null;
  type: 'bank' | 'card' | 'wallet' | 'cash';
  currency: string;
  openingBalanceMinor: number;
  reportedBalanceMinor: number | null;
  minimumBalanceMinor: number | null;
};

export type AccountProtection = {
  accountId: string;
  name: string;
  lastFour: string | null;
  balanceMinor: number | null;
  minimumBalanceMinor: number | null;
  aboveMinimumMinor: number | null;
};

export type Transaction = {
  id: string;
  accountId: string;
  amountMinor: number;
  kind: TransactionKind;
  merchant: string;
  category: string;
  categorySplits?: Array<{ category: string; amountMinor: number }>;
  categorySplitCount?: number;
  note?: string;
  categoryUserEdited?: boolean;
  occurredAt: number;
  reportedBalanceMinor: number | null;
  source: 'sms' | 'notification' | 'manual' | 'demo';
  confidence: number;
  reviewStatus: ReviewStatus;
  referenceId?: string | null;
  notificationPackages?: string[];
  possibleDuplicate?: boolean;
};

export type PendingSms = {
  id: string;
  sender: string;
  body: string;
  receivedAt: number;
};

export type ParsedTransaction = {
  amountMinor: number;
  kind: TransactionKind;
  merchant: string;
  category: string;
  accountLastFour: string | null;
  reportedBalanceMinor: number | null;
  occurredAt: number;
  confidence: number;
  referenceId?: string | null;
};

export type Dashboard = {
  balanceMinor: number | null;
  balanceIsReported: boolean;
  balanceAsOf: number | null;
  balanceAccountId: string | null;
  accountProtections: AccountProtection[];
  monthlyBudgetMinor: number | null;
  budgetRemainingMinor: number | null;
  budgetOverageMinor: number | null;
  dailyTargetMinor: number | null;
  weeklyPaceMinor: number | null;
  budgetDaysRemaining: number | null;
  incomeMinor: number;
  spentMinor: number;
  reviewCount: number;
  transactions: Transaction[];
  categories: Array<{ category: string; amountMinor: number }>;
  months: Array<{ label: string; amountMinor: number }>;
};
