import { open, type DB, type Scalar, type Transaction as SqlTransaction } from '@op-engineering/op-sqlite';
import { TransactionSms } from '../native/TransactionSms';
import { calculateWeeklyBudgetPlan } from '../features/budget/plan';
import {
  groupReviewTransactions,
  importedReviewStatus,
  normalizedVendorKey,
  shouldApplyVendorDefault,
  vendorRenameIds,
} from './reviewGroups';
import {
  findSmsDuplicateLinks,
  isSameSmsTransaction,
  newestBankSnapshot,
  type SmsDuplicateRow,
} from './smsDuplicates';
import type {
  Account,
  Dashboard,
  ParsedTransaction,
  Transaction,
} from '../types';
import type { NotificationTransaction } from '../features/notifications/transaction';
import { uniqueSourceMatch } from '../features/transactions/match';
import { planManualMatch } from '../features/transactions/manualMatch';

let database: DB | null = null;
let initializationPromise: Promise<void> | null = null;

export const DEFAULT_CATEGORIES = [
  'Food',
  'Friends',
  'Essentials',
  'Transport',
  'Bills',
  'Shopping',
  'Health',
  'Laundry',
  'Entertainment',
  'Income',
  'Other',
];

const id = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;

const value = (row: Record<string, Scalar>, key: string) => row[key];
const number = (row: Record<string, Scalar>, key: string) =>
  Number(value(row, key) ?? 0);
const text = (row: Record<string, Scalar>, key: string) =>
  String(value(row, key) ?? '');

export function initializeDatabase(): Promise<void> {
  if (initializationPromise) return initializationPromise;
  if (database) return Promise.resolve();
  initializationPromise = performDatabaseInitialization().catch(error => {
    database?.close();
    database = null;
    throw error;
  }).finally(() => { initializationPromise = null; });
  return initializationPromise;
}

async function performDatabaseInitialization(): Promise<void> {
  const encryptionKey = await TransactionSms.getDatabaseKey();
  database = open({ name: 'paisa.sqlite', encryptionKey });
  database.executeSync('PRAGMA foreign_keys = ON');
  const migrations = [
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, last_four TEXT,
      type TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'INR',
      opening_balance_minor INTEGER NOT NULL DEFAULT 0,
      reported_balance_minor INTEGER, minimum_balance_minor INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      amount_minor INTEGER NOT NULL, kind TEXT NOT NULL, merchant TEXT NOT NULL,
      category TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', occurred_at INTEGER NOT NULL,
      reported_balance_minor INTEGER, source TEXT NOT NULL,
      source_fingerprint TEXT UNIQUE, confidence REAL NOT NULL DEFAULT 1,
      review_status TEXT NOT NULL DEFAULT 'confirmed',
      merchant_user_edited INTEGER NOT NULL DEFAULT 0,
      category_user_edited INTEGER NOT NULL DEFAULT 0,
      reference_id TEXT,
      source_account_last_four TEXT,
      source_received_at INTEGER,
      matched_notification_id TEXT UNIQUE,
      duplicate_of TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sms_balance_snapshots (
      source_fingerprint TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      amount_minor INTEGER NOT NULL,
      kind TEXT NOT NULL,
      balance_minor INTEGER NOT NULL,
      received_at INTEGER NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS sms_balance_received_idx ON sms_balance_snapshots(received_at DESC)',
    'CREATE INDEX IF NOT EXISTS tx_date_idx ON transactions(occurred_at DESC)',
    'CREATE INDEX IF NOT EXISTS tx_category_idx ON transactions(category)',
    `CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY, category TEXT NOT NULL UNIQUE,
      limit_minor INTEGER NOT NULL, month_key TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS merchant_rules (
      merchant_key TEXT PRIMARY KEY, category TEXT NOT NULL,
      merchant_label TEXT NOT NULL, updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS vendor_aliases (
      source_key TEXT PRIMARY KEY, display_name TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY COLLATE NOCASE, created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS notification_events (
      id TEXT PRIMARY KEY, package_name TEXT NOT NULL, merchant TEXT NOT NULL,
      amount_minor INTEGER NOT NULL, kind TEXT NOT NULL, posted_at INTEGER NOT NULL,
      reference_id TEXT,
      account_last_four TEXT,
      transaction_id TEXT REFERENCES transactions(id)
    )`,
    `CREATE TABLE IF NOT EXISTS transaction_splits (
      transaction_id TEXT PRIMARY KEY REFERENCES transactions(id), personal_minor INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS split_people (
      transaction_id TEXT NOT NULL REFERENCES transactions(id), person TEXT NOT NULL,
      amount_minor INTEGER NOT NULL, PRIMARY KEY(transaction_id, person)
    )`,
    `CREATE TABLE IF NOT EXISTS transaction_category_splits (
      transaction_id TEXT NOT NULL REFERENCES transactions(id),
      category TEXT NOT NULL REFERENCES categories(name),
      amount_minor INTEGER NOT NULL,
      PRIMARY KEY(transaction_id, category)
    )`,
    `CREATE TABLE IF NOT EXISTS obligations (
      id TEXT PRIMARY KEY, person TEXT NOT NULL, direction TEXT NOT NULL,
      amount_minor INTEGER NOT NULL, personal_minor INTEGER NOT NULL DEFAULT 0,
      transaction_id TEXT REFERENCES transactions(id), created_at INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other'
    )`,
    `CREATE TABLE IF NOT EXISTS repayments (
      id TEXT PRIMARY KEY, obligation_id TEXT NOT NULL REFERENCES obligations(id),
      transaction_id TEXT REFERENCES transactions(id), amount_minor INTEGER NOT NULL,
      created_at INTEGER NOT NULL, origin TEXT NOT NULL DEFAULT 'manual'
    )`,
    `CREATE TABLE IF NOT EXISTS ignored_auto_repayments (
      transaction_id TEXT PRIMARY KEY REFERENCES transactions(id),
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS income_assignments (
      transaction_id TEXT PRIMARY KEY REFERENCES transactions(id),
      month_key TEXT, created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS savings_goals (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, target_minor INTEGER NOT NULL,
      allocated_minor INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
      due_month_key TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS savings_income_estimates (
      month_key TEXT PRIMARY KEY, amount_minor INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS recurring_bills (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, amount_minor INTEGER NOT NULL,
      due_day INTEGER NOT NULL, account_id TEXT REFERENCES accounts(id),
      active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'debit', last_done_month TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS review_days (
      day_key TEXT PRIMARY KEY, completed_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS manual_duplicate_candidates (
      manual_id TEXT NOT NULL REFERENCES transactions(id),
      sms_id TEXT NOT NULL REFERENCES transactions(id),
      created_at INTEGER NOT NULL,
      PRIMARY KEY(manual_id, sms_id)
    )`,
    `CREATE TABLE IF NOT EXISTS manual_match_decisions (
      manual_id TEXT NOT NULL REFERENCES transactions(id),
      sms_id TEXT NOT NULL REFERENCES transactions(id),
      PRIMARY KEY(manual_id, sms_id)
    )`,
  ];
  for (const statement of migrations) database.executeSync(statement);
  try { database.executeSync('ALTER TABLE transactions ADD COLUMN reference_id TEXT'); } catch { /* already present */ }
  try { database.executeSync("ALTER TABLE transactions ADD COLUMN note TEXT NOT NULL DEFAULT ''"); } catch { /* already present */ }
  try { database.executeSync('ALTER TABLE notification_events ADD COLUMN reference_id TEXT'); } catch { /* already present */ }
  try { database.executeSync('ALTER TABLE transactions ADD COLUMN source_account_last_four TEXT'); } catch { /* already present */ }
  try { database.executeSync('ALTER TABLE notification_events ADD COLUMN account_last_four TEXT'); } catch { /* already present */ }
  try { database.executeSync("ALTER TABLE recurring_bills ADD COLUMN kind TEXT NOT NULL DEFAULT 'debit'"); } catch { /* already present */ }
  try { database.executeSync('ALTER TABLE recurring_bills ADD COLUMN last_done_month TEXT'); } catch { /* already present */ }
  try { database.executeSync("ALTER TABLE obligations ADD COLUMN category TEXT NOT NULL DEFAULT 'Other'"); } catch { /* already present */ }
  try { database.executeSync("ALTER TABLE repayments ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'"); } catch { /* already present */ }
  try { database.executeSync('ALTER TABLE savings_goals ADD COLUMN due_month_key TEXT'); } catch { /* already present */ }
  for (const [index, name] of DEFAULT_CATEGORIES.entries()) {
    database.executeSync(
      'INSERT OR IGNORE INTO categories (name, created_at) VALUES (?, ?)',
      [name, index],
    );
  }
  try {
    database.executeSync(
      'ALTER TABLE accounts ADD COLUMN minimum_balance_minor INTEGER',
    );
  } catch {
    // The account minimum column already exists.
  }
  try {
    database.executeSync(
      'ALTER TABLE transactions ADD COLUMN merchant_user_edited INTEGER NOT NULL DEFAULT 0',
    );
  } catch {
    // The column already exists on current installations.
  }
  try {
    database.executeSync(
      'ALTER TABLE transactions ADD COLUMN category_user_edited INTEGER NOT NULL DEFAULT 0',
    );
    // Older review actions saved merchant and category together. Preserve those
    // transaction-level choices when future imports or vendor defaults change.
    database.executeSync(`UPDATE transactions SET category_user_edited = 1
      WHERE merchant_user_edited = 1 AND review_status = 'confirmed'`);
  } catch {
    // Already migrated.
  }
  for (const statement of [
    'ALTER TABLE transactions ADD COLUMN source_received_at INTEGER',
    'ALTER TABLE transactions ADD COLUMN matched_notification_id TEXT',
    'ALTER TABLE transactions ADD COLUMN duplicate_of TEXT',
  ]) {
    try {
      database.executeSync(statement);
    } catch {
      // This migration has already run.
    }
  }
  database.executeSync(
    'CREATE UNIQUE INDEX IF NOT EXISTS tx_notification_idx ON transactions(matched_notification_id)',
  );
  // Recover balance-bearing SMS from older versions, including transactions
  // hidden by duplicate cleanup. A bank balance must not depend on which
  // transaction row was kept for display.
  database.executeSync(
    `INSERT OR IGNORE INTO sms_balance_snapshots
     (source_fingerprint, account_id, amount_minor, kind, balance_minor, received_at)
     SELECT source_fingerprint, account_id, amount_minor, kind,
       reported_balance_minor, source_received_at
     FROM transactions
     WHERE source = 'sms' AND source_fingerprint IS NOT NULL
       AND reported_balance_minor IS NOT NULL AND source_received_at IS NOT NULL`,
  );
  database.executeSync(
    `UPDATE accounts SET reported_balance_minor = (
       SELECT balance_minor FROM sms_balance_snapshots
       WHERE account_id = accounts.id ORDER BY received_at DESC LIMIT 1
     ) WHERE EXISTS (
       SELECT 1 FROM sms_balance_snapshots WHERE account_id = accounts.id
     )`,
  );
  // Reset previously saved recurring entries once. Existing transactions are
  // untouched; after this migration, only explicit user creation adds a bill.
  if ((await getAppSetting('recurring_items_opt_in_reset_20260918')) !== '1') {
    await db().transaction(async tx => {
      await tx.execute('DELETE FROM recurring_bills');
      await tx.execute(`INSERT OR REPLACE INTO app_settings (key, value)
        VALUES ('recurring_items_opt_in_reset_20260918', '1')`);
    });
  }
  // Older development builds inserted sample rows into the real ledger. Remove
  // them during migration so demo activity can never be mixed with SMS data.
  await removeDemoData();
  await reconcileSmsDuplicates();
  if ((await getAppSetting('manual_category_migration')) !== '1') {
    await db().transaction(async tx => {
      await tx.execute(
        `UPDATE transactions SET category = 'Other', review_status = 'review'
         WHERE source = 'sms' AND merchant_user_edited = 0`,
      );
      await tx.execute(
        "INSERT INTO app_settings (key, value) VALUES ('manual_category_migration', '1')",
      );
    });
  }
  if ((await getAppSetting('unidentified_credit_migration')) !== '1') {
    await db().transaction(async tx => {
      await tx.execute(
        `UPDATE transactions SET review_status = 'awaiting_sender'
         WHERE kind = 'credit' AND merchant_user_edited = 0
           AND lower(trim(merchant)) IN ('sender not provided', 'money received')`,
      );
      await tx.execute(
        "INSERT INTO app_settings (key, value) VALUES ('unidentified_credit_migration', '1')",
      );
    });
  }
  if ((await getAppSetting('unknown_merchant_label_migration')) !== '1') {
    await db().transaction(async tx => {
      await tx.execute(
        `UPDATE transactions
         SET merchant = 'Unknown merchant', review_status = 'awaiting_sender'
         WHERE kind = 'credit' AND merchant_user_edited = 0
           AND matched_notification_id IS NULL
           AND lower(trim(merchant)) IN
             ('sender not provided', 'money received', 'unknown merchant')`,
      );
      await tx.execute(
        "INSERT INTO app_settings (key, value) VALUES ('unknown_merchant_label_migration', '1')",
      );
    });
  }
  if ((await getAppSetting('category_rule_seed_v1')) !== '1') {
    const historical = await db().execute(
      `SELECT merchant, category FROM transactions WHERE merchant_user_edited = 1
       AND category <> 'Other' AND review_status = 'confirmed'
       ORDER BY created_at ASC`,
    );
    await db().transaction(async tx => {
      for (const row of historical.rows) {
        const merchant = text(row, 'merchant');
        const key = normalizedVendorKey(merchant);
        if (!key) continue;
        await tx.execute(
          `INSERT INTO merchant_rules (merchant_key, category, merchant_label, updated_at)
           VALUES (?, ?, ?, ?) ON CONFLICT(merchant_key) DO NOTHING`,
          [key, text(row, 'category'), merchant, Date.now()],
        );
      }
      await tx.execute("INSERT INTO app_settings VALUES ('category_rule_seed_v1', '1')");
    });
  }
  // Earlier versions applied a vendor default only to pending payments at the
  // moment it was saved. Bring existing saved rules into line once on upgrade.
  if ((await getAppSetting('vendor_default_unedited_backfill_v1')) !== '1') {
    const rules = await db().execute('SELECT merchant_key, category FROM merchant_rules');
    const defaults = new Map(rules.rows.map(rule => [text(rule, 'merchant_key'), text(rule, 'category')]));
    await db().transaction(async tx => {
      await applyVendorDefaultsInTransaction(tx, defaults);
      await tx.execute("INSERT INTO app_settings (key, value) VALUES ('vendor_default_unedited_backfill_v1', '1')");
    });
  }
}

const db = (): DB => {
  if (!database) throw new Error('Database has not been initialized');
  return database;
};
export const getDatabaseHandle = (): DB => db();

const mapTransaction = (row: Record<string, Scalar>): Transaction => ({
  id: text(row, 'id'),
  accountId: text(row, 'account_id'),
  amountMinor: number(row, 'amount_minor'),
  kind: text(row, 'kind') as Transaction['kind'],
  merchant: text(row, 'merchant'),
  category: text(row, 'category'),
  note: text(row, 'note'),
  categoryUserEdited: number(row, 'category_user_edited') === 1,
  occurredAt: number(row, 'occurred_at'),
  reportedBalanceMinor:
    value(row, 'reported_balance_minor') == null
      ? null
      : number(row, 'reported_balance_minor'),
  source: text(row, 'source') as Transaction['source'],
  confidence: number(row, 'confidence'),
  reviewStatus: text(row, 'review_status') as Transaction['reviewStatus'],
  referenceId: value(row, 'reference_id') == null ? null : text(row, 'reference_id'),
  notificationPackages: text(row, 'notification_packages').split(',').filter(Boolean),
  possibleDuplicate: number(row, 'possible_duplicate') === 1,
});

const mapSmsDuplicateRow = (row: Record<string, Scalar>): SmsDuplicateRow => ({
  id: text(row, 'id'),
  accountId: text(row, 'account_id'),
  amountMinor: number(row, 'amount_minor'),
  kind: text(row, 'kind'),
  merchant: text(row, 'merchant'),
  occurredAt: number(row, 'occurred_at'),
  reportedBalanceMinor:
    value(row, 'reported_balance_minor') == null
      ? null
      : number(row, 'reported_balance_minor'),
  sourceReceivedAt:
    value(row, 'source_received_at') == null
      ? null
      : number(row, 'source_received_at'),
  merchantUserEdited: number(row, 'merchant_user_edited') === 1,
  categoryUserEdited: number(row, 'category_user_edited') === 1,
  matchedNotificationId:
    value(row, 'matched_notification_id') == null
      ? null
      : text(row, 'matched_notification_id'),
  createdAt: number(row, 'created_at'),
});

export async function reconcileSmsDuplicates(): Promise<number> {
  const result = await db().execute(
    `SELECT * FROM transactions WHERE source = 'sms'
       AND duplicate_of IS NULL`,
  );
  const candidateLinks = findSmsDuplicateLinks(result.rows.map(mapSmsDuplicateRow));
  // A row with a split or debt is user-authored financial state. Never hide it
  // as a duplicate without also migrating those allocations explicitly.
  const protectedRows = await db().execute(
    `SELECT transaction_id FROM transaction_splits UNION
     SELECT transaction_id FROM obligations WHERE transaction_id IS NOT NULL UNION
     SELECT transaction_id FROM repayments WHERE transaction_id IS NOT NULL UNION
     SELECT transaction_id FROM ignored_auto_repayments UNION
     SELECT transaction_id FROM income_assignments UNION
     SELECT transaction_id FROM transaction_category_splits UNION
     SELECT id AS transaction_id FROM transactions
       WHERE category_user_edited = 1 OR trim(COALESCE(note, '')) <> '' UNION
     SELECT sms_id AS transaction_id FROM manual_duplicate_candidates`,
  );
  const protectedIds = new Set(protectedRows.rows.map(row => text(row, 'transaction_id')));
  const links = candidateLinks.filter(link => !protectedIds.has(link.duplicateId));
  if (links.length === 0) return 0;
  const rowsById = new Map(
    result.rows.map(row => {
      const mapped = mapSmsDuplicateRow(row);
      return [mapped.id, mapped] as const;
    }),
  );
  const groups = new Map<string, SmsDuplicateRow[]>();
  for (const { duplicateId, keeperId } of links) {
    const keeper = rowsById.get(keeperId);
    const duplicate = rowsById.get(duplicateId);
    if (!keeper || !duplicate) continue;
    if (!groups.has(keeperId)) groups.set(keeperId, [keeper]);
    groups.get(keeperId)!.push(duplicate);
  }
  await db().transaction(async tx => {
    for (const [keeperId, group] of groups) {
      const newest = newestBankSnapshot(group);
      if (newest && newest.id !== keeperId) {
        await tx.execute(
          `UPDATE transactions SET reported_balance_minor = ?,
           source_received_at = ?, occurred_at = ? WHERE id = ?`,
          [
            newest.reportedBalanceMinor,
            newest.sourceReceivedAt,
            newest.occurredAt,
            keeperId,
          ],
        );
      }
    }
    for (const { duplicateId, keeperId } of links) {
      await tx.execute(
        'UPDATE transactions SET duplicate_of = ? WHERE duplicate_of = ?',
        [keeperId, duplicateId],
      );
      await tx.execute(
        'UPDATE transactions SET duplicate_of = ? WHERE id = ?',
        [keeperId, duplicateId],
      );
    }
  });
  return links.length;
}

export async function getAllTransactions(): Promise<Transaction[]> {
  const [result, categorySplitRows] = await Promise.all([db().execute(
    `SELECT t.*, (SELECT GROUP_CONCAT(DISTINCT n.package_name) FROM notification_events n
      WHERE n.transaction_id = t.id) AS notification_packages,
      (SELECT COUNT(*) FROM transaction_category_splits c WHERE c.transaction_id = t.id) AS category_split_count,
      EXISTS(SELECT 1 FROM manual_duplicate_candidates m WHERE m.manual_id = t.id OR m.sms_id = t.id) AS possible_duplicate
     FROM transactions t WHERE t.duplicate_of IS NULL
     ORDER BY COALESCE(source_received_at, occurred_at) DESC, created_at DESC`,
  ), db().execute('SELECT transaction_id, category, amount_minor FROM transaction_category_splits')]);
  const categorySplits = new Map<string, Array<{ category: string; amountMinor: number }>>();
  for (const row of categorySplitRows.rows) {
    const transactionId = text(row, 'transaction_id');
    categorySplits.set(transactionId, [...(categorySplits.get(transactionId) ?? []), {
      category: text(row, 'category'), amountMinor: number(row, 'amount_minor'),
    }]);
  }
  return result.rows.map(row => ({ ...mapTransaction(row),
    categorySplitCount: number(row, 'category_split_count'),
    categorySplits: categorySplits.get(text(row, 'id')) ?? [],
  }));
}

export async function getAccounts(): Promise<Account[]> {
  const result = await db().execute(
    'SELECT * FROM accounts ORDER BY created_at',
  );
  return result.rows.map(row => ({
    id: text(row, 'id'),
    name: text(row, 'name'),
    lastFour: value(row, 'last_four') == null ? null : text(row, 'last_four'),
    type: text(row, 'type') as Account['type'],
    currency: text(row, 'currency'),
    openingBalanceMinor: number(row, 'opening_balance_minor'),
    reportedBalanceMinor:
      value(row, 'reported_balance_minor') == null
        ? null
        : number(row, 'reported_balance_minor'),
    minimumBalanceMinor:
      value(row, 'minimum_balance_minor') == null
        ? null
        : number(row, 'minimum_balance_minor'),
  }));
}

export type ManualTransactionInput = {
  accountId: string | null;
  amountMinor: number;
  kind: 'debit' | 'credit';
  merchant: string;
  category: string;
  occurredAt: number;
  referenceId?: string | null;
};

const manualCashAccountId = 'manual:cash';

function validateManualInput(input: ManualTransactionInput): void {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('Enter a positive amount');
  if (!input.merchant.trim()) throw new Error('Enter a vendor or person');
  if (!Number.isFinite(input.occurredAt) || input.occurredAt <= 0 || input.occurredAt > Date.now() + 5 * 60_000) throw new Error('Choose a valid past date');
  if (input.referenceId && input.referenceId.trim().length > 80) throw new Error('Reference is too long');
}

async function manualAccountId(input: ManualTransactionInput): Promise<string> {
  if (input.accountId != null) {
    const found = await db().execute("SELECT id FROM accounts WHERE id = ? AND type = 'bank'", [input.accountId]);
    if (!found.rows.length) throw new Error('Choose an existing bank account');
    return input.accountId;
  }
  await db().execute(`INSERT OR IGNORE INTO accounts
    (id, name, type, currency, opening_balance_minor, created_at)
    VALUES (?, 'Cash · reports only', 'cash', 'INR', 0, ?)`, [manualCashAccountId, Date.now()]);
  return manualCashAccountId;
}

async function validateManualCategory(category: string): Promise<void> {
  const result = await db().execute('SELECT name FROM categories WHERE name = ? COLLATE NOCASE', [category]);
  if (!result.rows.length) throw new Error('Choose an existing category');
}

async function manualHasLinks(transactionId: string): Promise<boolean> {
  const result = await db().execute(`SELECT id FROM obligations WHERE transaction_id = ? UNION
    SELECT transaction_id AS id FROM transaction_splits WHERE transaction_id = ? UNION
    SELECT transaction_id AS id FROM repayments WHERE transaction_id = ? UNION
    SELECT transaction_id AS id FROM ignored_auto_repayments WHERE transaction_id = ? UNION
    SELECT transaction_id AS id FROM transaction_category_splits WHERE transaction_id = ?`,
  [transactionId, transactionId, transactionId, transactionId, transactionId]);
  return result.rows.length > 0;
}

async function mergeManualIntoSms(manualId: string, smsId: string): Promise<void> {
  if (await manualHasLinks(manualId)) throw new Error('Remove shared-expense or repayment links before merging');
  const rows = await db().execute(`SELECT id, merchant, category, merchant_user_edited, category_user_edited FROM transactions
    WHERE id IN (?, ?) AND duplicate_of IS NULL`, [manualId, smsId]);
  const manual = rows.rows.find(row => text(row, 'id') === manualId);
  const sms = rows.rows.find(row => text(row, 'id') === smsId);
  if (!manual || !sms) throw new Error('Matching transactions are no longer available');
  await db().transaction(async tx => {
    const missingMerchant = text(sms, 'merchant') === 'Unknown merchant';
    const missingCategory = text(sms, 'category') === 'Other';
    if (missingMerchant || missingCategory) {
      await tx.execute(`UPDATE transactions SET merchant = ?, category = ?,
        merchant_user_edited = ?, category_user_edited = ?, review_status = 'confirmed' WHERE id = ?`,
      [missingMerchant ? text(manual, 'merchant') : text(sms, 'merchant'),
        missingCategory ? text(manual, 'category') : text(sms, 'category'),
        missingMerchant ? 1 : number(sms, 'merchant_user_edited'),
        missingCategory ? 1 : number(sms, 'category_user_edited'), smsId]);
    }
    await tx.execute(`INSERT OR IGNORE INTO income_assignments (transaction_id, month_key, created_at)
      SELECT ?, month_key, created_at FROM income_assignments WHERE transaction_id = ?`, [smsId, manualId]);
    await tx.execute('DELETE FROM income_assignments WHERE transaction_id = ?', [manualId]);
    await tx.execute('DELETE FROM manual_duplicate_candidates WHERE manual_id = ?', [manualId]);
    await tx.execute('UPDATE transactions SET duplicate_of = ? WHERE id = ?', [smsId, manualId]);
  });
}

async function flagManualMatches(smsId: string): Promise<void> {
  const smsRows = await db().execute("SELECT * FROM transactions WHERE id = ? AND source = 'sms' AND duplicate_of IS NULL", [smsId]);
  const sms = smsRows.rows[0];
  if (!sms) return;
  const manualRows = await db().execute(`SELECT m.* FROM transactions m
    WHERE m.source = 'manual' AND m.account_id = ? AND m.amount_minor = ? AND m.kind = ?
      AND m.duplicate_of IS NULL AND (ABS(m.occurred_at - ?) <= 7200000 OR
        (m.reference_id IS NOT NULL AND m.reference_id = ?))
      AND NOT EXISTS (SELECT 1 FROM manual_match_decisions d WHERE d.manual_id = m.id AND d.sms_id = ?)` ,
  [text(sms, 'account_id'), number(sms, 'amount_minor'), text(sms, 'kind'), number(sms, 'occurred_at'), text(sms, 'reference_id'), smsId]);
  const plan = planManualMatch(sms.reference_id == null ? null : text(sms, 'reference_id'),
    manualRows.rows.map(row => ({ id: text(row, 'id'), referenceId: row.reference_id == null ? null : text(row, 'reference_id') })));
  if (plan.exactId && !(await manualHasLinks(plan.exactId))) {
    await mergeManualIntoSms(plan.exactId, smsId);
    return;
  }
  for (const row of manualRows.rows) {
    await db().execute(`INSERT OR IGNORE INTO manual_duplicate_candidates (manual_id, sms_id, created_at)
      VALUES (?, ?, ?)`, [text(row, 'id'), smsId, Date.now()]);
  }
}

export async function createManualTransaction(input: ManualTransactionInput): Promise<string> {
  await initializeDatabase();
  validateManualInput(input);
  await validateManualCategory(input.category);
  const accountId = await manualAccountId(input);
  const transactionId = id('manual');
  await db().execute(`INSERT INTO transactions
    (id, account_id, amount_minor, kind, merchant, category, occurred_at, source,
      confidence, review_status, merchant_user_edited, category_user_edited, reference_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 1, 'confirmed', 1, 1, ?, ?)`,
  [transactionId, accountId, input.kind === 'debit' ? -input.amountMinor : input.amountMinor,
    input.kind, input.merchant.trim().slice(0, 80), input.category, input.occurredAt,
    input.referenceId?.trim() || null, Date.now()]);
  const smsRows = await db().execute(`SELECT id FROM transactions WHERE source = 'sms' AND account_id = ?
    AND amount_minor = ? AND kind = ? AND duplicate_of IS NULL
    AND (ABS(occurred_at - ?) <= 7200000 OR (reference_id IS NOT NULL AND reference_id = ?))`,
  [accountId, input.kind === 'debit' ? -input.amountMinor : input.amountMinor, input.kind, input.occurredAt, input.referenceId?.trim() ?? '']);
  for (const sms of smsRows.rows) await flagManualMatches(text(sms, 'id'));
  await reopenReviewDay(input.occurredAt);
  return transactionId;
}

export async function updateManualTransaction(transactionId: string, input: ManualTransactionInput): Promise<void> {
  await initializeDatabase();
  validateManualInput(input);
  await validateManualCategory(input.category);
  if (await manualHasLinks(transactionId)) throw new Error('Remove shared-expense or repayment links before editing this entry');
  const existing = await db().execute("SELECT occurred_at, merchant FROM transactions WHERE id = ? AND source = 'manual' AND duplicate_of IS NULL", [transactionId]);
  if (!existing.rows.length) throw new Error('Manual transaction not found');
  const accountId = await manualAccountId(input);
  const cleanedMerchant = input.merchant.trim().replace(/\s+/g, ' ').slice(0, 80);
  await db().transaction(async tx => {
    await tx.execute('DELETE FROM manual_duplicate_candidates WHERE manual_id = ?', [transactionId]);
    await tx.execute('DELETE FROM manual_match_decisions WHERE manual_id = ?', [transactionId]);
    if (input.kind !== 'credit') await tx.execute('DELETE FROM income_assignments WHERE transaction_id = ?', [transactionId]);
    if (cleanedMerchant !== text(existing.rows[0], 'merchant')) {
      await renameVendorInTransaction(tx, transactionId, cleanedMerchant);
    }
    await tx.execute(`UPDATE transactions SET account_id = ?, amount_minor = ?, kind = ?, merchant = ?, category = ?,
      category_user_edited = 1, occurred_at = ?, reference_id = ? WHERE id = ?`,
    [accountId, input.kind === 'debit' ? -input.amountMinor : input.amountMinor, input.kind,
      cleanedMerchant, input.category, input.occurredAt, input.referenceId?.trim() || null, transactionId]);
  });
  const smsRows = await db().execute(`SELECT id FROM transactions WHERE source = 'sms' AND account_id = ?
    AND amount_minor = ? AND kind = ? AND duplicate_of IS NULL
    AND (ABS(occurred_at - ?) <= 7200000 OR (reference_id IS NOT NULL AND reference_id = ?))`,
  [accountId, input.kind === 'debit' ? -input.amountMinor : input.amountMinor, input.kind, input.occurredAt, input.referenceId?.trim() ?? '']);
  for (const sms of smsRows.rows) await flagManualMatches(text(sms, 'id'));
  await reopenReviewDay(number(existing.rows[0], 'occurred_at'));
  await reopenReviewDay(input.occurredAt);
}

export async function deleteManualTransaction(transactionId: string): Promise<void> {
  await initializeDatabase();
  if (await manualHasLinks(transactionId)) throw new Error('Remove shared-expense or repayment links before deleting this entry');
  const existing = await db().execute("SELECT occurred_at FROM transactions WHERE id = ? AND source = 'manual' AND duplicate_of IS NULL", [transactionId]);
  if (!existing.rows.length) throw new Error('Manual transaction not found');
  await db().transaction(async tx => {
    await tx.execute('DELETE FROM manual_duplicate_candidates WHERE manual_id = ?', [transactionId]);
    await tx.execute('DELETE FROM manual_match_decisions WHERE manual_id = ?', [transactionId]);
    await tx.execute('DELETE FROM income_assignments WHERE transaction_id = ?', [transactionId]);
    await tx.execute('DELETE FROM transactions WHERE id = ?', [transactionId]);
  });
  await reopenReviewDay(number(existing.rows[0], 'occurred_at'));
}

export async function getManualDuplicateTargets(transactionId: string): Promise<Transaction[]> {
  const result = await db().execute(`SELECT t.* FROM manual_duplicate_candidates d
    JOIN transactions t ON t.id = d.sms_id WHERE d.manual_id = ?`, [transactionId]);
  return result.rows.map(mapTransaction);
}

export async function resolveManualDuplicate(manualId: string, smsId: string | null): Promise<void> {
  const candidates = await getManualDuplicateTargets(manualId);
  if (!candidates.length) throw new Error('No possible duplicate remains');
  if (smsId != null) {
    if (!candidates.some(item => item.id === smsId)) throw new Error('Matching bank SMS not found');
    await mergeManualIntoSms(manualId, smsId);
    return;
  }
  await db().transaction(async tx => {
    for (const candidate of candidates) await tx.execute(
      'INSERT OR IGNORE INTO manual_match_decisions (manual_id, sms_id) VALUES (?, ?)', [manualId, candidate.id]);
    await tx.execute('DELETE FROM manual_duplicate_candidates WHERE manual_id = ?', [manualId]);
  });
}

export async function getCategories(): Promise<string[]> {
  const result = await db().execute(
    'SELECT name FROM categories ORDER BY created_at, name COLLATE NOCASE',
  );
  return result.rows.map(row => text(row, 'name'));
}

export async function createCategory(name: string): Promise<string> {
  const cleaned = name.trim().replace(/\s+/g, ' ');
  if (!cleaned || cleaned.length > 32) {
    throw new Error('Enter a category name of up to 32 characters');
  }
  try {
    await db().execute(
      'INSERT INTO categories (name, created_at) VALUES (?, ?)',
      [cleaned, Date.now()],
    );
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) {
      throw new Error('That category already exists');
    }
    throw error;
  }
  return cleaned;
}

export async function setAccountMinimumBalance(
  accountId: string,
  amountMinor: number | null,
): Promise<void> {
  if (
    amountMinor != null &&
    (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
  ) {
    throw new Error('Enter a valid minimum balance');
  }
  const result = await db().execute(
    'UPDATE accounts SET minimum_balance_minor = ? WHERE id = ?',
    [amountMinor, accountId],
  );
  if (Number(result.rowsAffected ?? 0) !== 1) {
    throw new Error('Account not found');
  }
}

export async function setMonthlyBudget(
  amountMinor: number | null,
): Promise<void> {
  if (amountMinor == null) {
    await db().execute(
      "DELETE FROM app_settings WHERE key = 'monthly_budget_minor'",
    );
    return;
  }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Enter a monthly budget above zero');
  }
  await setAppSetting('monthly_budget_minor', String(amountMinor));
}

async function refreshAccountBankBalance(accountId: string): Promise<void> {
  await db().execute(
    `UPDATE accounts SET reported_balance_minor = (
       SELECT balance_minor FROM sms_balance_snapshots
       WHERE account_id = ? ORDER BY received_at DESC LIMIT 1
     ) WHERE id = ?`,
    [accountId, accountId],
  );
}

async function displayNameForVendor(rawMerchant: string): Promise<string> {
  const key = normalizedVendorKey(rawMerchant);
  if (!key) return rawMerchant;
  const result = await db().execute(
    'SELECT display_name FROM vendor_aliases WHERE source_key = ? LIMIT 1',
    [key],
  );
  return result.rows.length
    ? text(result.rows[0], 'display_name')
    : rawMerchant;
}

async function categoryForVendor(merchant: string): Promise<string | null> {
  const key = normalizedVendorKey(merchant);
  if (!key) return null;
  const result = await db().execute(
    'SELECT category FROM merchant_rules WHERE merchant_key = ? LIMIT 1', [key],
  );
  return result.rows.length ? text(result.rows[0], 'category') : null;
}

export async function getVendorDefaultCategory(merchant: string): Promise<string | null> {
  return categoryForVendor(merchant);
}

async function reopenReviewDay(timestamp: number): Promise<void> {
  const date = new Date(timestamp);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  await db().execute('DELETE FROM review_days WHERE day_key = ?', [day]);
}

export async function saveParsedTransaction(
  parsed: ParsedTransaction,
  fingerprint: string,
  receivedAt: number,
): Promise<boolean> {
  const accounts = await getAccounts();
  let account = accounts.find(item => item.lastFour === parsed.accountLastFour);
  if (!account) {
    const accountId = id('account');
    await db().execute(
      `INSERT INTO accounts
       (id, name, last_four, type, currency, opening_balance_minor,
        reported_balance_minor, created_at)
       VALUES (?, ?, ?, 'bank', 'INR', 0, ?, ?)`,
      [
        accountId,
        parsed.accountLastFour
          ? `Account •${parsed.accountLastFour}`
          : 'Unmatched account',
        parsed.accountLastFour,
        parsed.reportedBalanceMinor,
        Date.now(),
      ],
    );
    account = (await getAccounts()).find(item => item.id === accountId);
  }
  if (!account) return false;

  if (parsed.reportedBalanceMinor != null) {
    await db().execute(
      `INSERT INTO sms_balance_snapshots
       (source_fingerprint, account_id, amount_minor, kind, balance_minor, received_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_fingerprint) DO UPDATE SET
         account_id = excluded.account_id,
         amount_minor = excluded.amount_minor,
         kind = excluded.kind,
         balance_minor = excluded.balance_minor,
         received_at = excluded.received_at`,
      [
        fingerprint,
        account.id,
        parsed.amountMinor,
        parsed.kind,
        parsed.reportedBalanceMinor,
        receivedAt,
      ],
    );
    await refreshAccountBankBalance(account.id);
  }

  const displayMerchant = await displayNameForVendor(parsed.merchant);
  const ruleCategory = await categoryForVendor(displayMerchant);
  const resolvedCategory = ruleCategory ?? 'Other';
  const reviewStatus = ruleCategory ? 'confirmed' : importedReviewStatus(parsed.kind, parsed.merchant);
  const signedAmount =
    parsed.kind === 'credit' || parsed.kind === 'refund'
      ? parsed.amountMinor
      : -parsed.amountMinor;
  // Promote one notification-only candidate when the authoritative bank SMS
  // arrives. Never join two plausible same-amount payments automatically.
  const pendingNotification = await db().execute(
    `SELECT * FROM transactions WHERE source = 'notification'
     AND amount_minor = ? AND kind = ? AND duplicate_of IS NULL
     AND (reference_id = ? OR occurred_at BETWEEN ? AND ?)`,
    [signedAmount, parsed.kind, parsed.referenceId ?? '', receivedAt - 30 * 60_000, receivedAt + 30 * 60_000],
  );
  const notificationId = uniqueSourceMatch({ amountMinor: signedAmount, kind: parsed.kind,
    at: receivedAt, referenceId: parsed.referenceId, accountLastFour: parsed.accountLastFour },
    pendingNotification.rows.map(row => ({ id: text(row, 'id'), amountMinor: number(row, 'amount_minor'),
      kind: text(row, 'kind'), at: number(row, 'occurred_at'),
      referenceId: row.reference_id == null ? null : text(row, 'reference_id'),
      accountLastFour: row.source_account_last_four == null ? null : text(row, 'source_account_last_four') })));
  const existingFingerprint = await db().execute(
    'SELECT id FROM transactions WHERE source_fingerprint = ? LIMIT 1', [fingerprint]);
  if (notificationId && !existingFingerprint.rows.length) {
    const candidate = pendingNotification.rows.find(row => text(row, 'id') === notificationId)!;
    const txId = notificationId;
    const enrichedMerchant = number(candidate, 'merchant_user_edited') === 1 ||
      parsed.kind === 'credit' || displayMerchant === 'Unknown merchant'
      ? text(candidate, 'merchant') : displayMerchant;
    const enrichedCategory = await categoryForVendor(enrichedMerchant) ?? resolvedCategory;
    await db().execute(
      `UPDATE transactions SET account_id = ?, amount_minor = ?, kind = ?, merchant = ?,
       category = CASE WHEN category_user_edited = 1 THEN category ELSE ? END,
       occurred_at = ?, reported_balance_minor = ?, source = 'sms', reference_id = ?,
       source_fingerprint = ?, source_received_at = ?, confidence = ?,
       review_status = CASE WHEN category_user_edited = 1 THEN 'confirmed' ELSE ? END WHERE id = ?`,
      [account.id, signedAmount, parsed.kind, enrichedMerchant, enrichedCategory,
        parsed.occurredAt, parsed.reportedBalanceMinor, parsed.referenceId ?? null, fingerprint, receivedAt,
        Math.max(parsed.confidence, 0.85), enrichedCategory === 'Other' ? 'review' : 'confirmed', txId],
    );
    await reopenReviewDay(parsed.occurredAt);
    await flagManualMatches(txId);
    return false;
  }
  if (parsed.reportedBalanceMinor != null) {
    const bankDay = new Date(parsed.occurredAt);
    const bankDayStart = new Date(
      bankDay.getFullYear(),
      bankDay.getMonth(),
      bankDay.getDate(),
    ).getTime();
    const existingResult = await db().execute(
      `SELECT * FROM transactions
       WHERE source = 'sms'
         AND account_id = ? AND amount_minor = ? AND kind = ?
         AND (reported_balance_minor = ? OR reported_balance_minor IS NULL)
         AND (source_received_at BETWEEN ? AND ?
           OR (source_received_at IS NULL AND occurred_at >= ? AND occurred_at < ?))
       ORDER BY category_user_edited DESC, merchant_user_edited DESC,
         CASE WHEN matched_notification_id IS NOT NULL THEN 0 ELSE 1 END,
         CASE WHEN source_fingerprint = ? THEN 0 ELSE 1 END,
         created_at ASC`,
      [
        account.id,
        signedAmount,
        parsed.kind,
        parsed.reportedBalanceMinor,
        receivedAt - 60_000,
        receivedAt + 60_000,
        bankDayStart,
        bankDayStart + 24 * 60 * 60 * 1000,
        fingerprint,
      ],
    );
    const parsedRow: SmsDuplicateRow = {
      id: fingerprint,
      accountId: account.id,
      amountMinor: signedAmount,
      kind: parsed.kind,
      merchant: displayMerchant,
      occurredAt: parsed.occurredAt,
      reportedBalanceMinor: parsed.reportedBalanceMinor,
      sourceReceivedAt: receivedAt,
      merchantUserEdited: false,
      categoryUserEdited: false,
      matchedNotificationId: null,
      createdAt: receivedAt,
    };
    const existing = existingResult.rows.filter(row =>
      isSameSmsTransaction(mapSmsDuplicateRow(row), parsedRow),
    );
    if (existing.length > 0) {
      const keeperId = text(existing[0], 'id');
      await db().transaction(async tx => {
        await tx.execute(
          `UPDATE transactions SET
            source_fingerprint = CASE WHEN EXISTS (
              SELECT 1 FROM transactions AS other
              WHERE other.source_fingerprint = ? AND other.id <> ?
            ) THEN source_fingerprint ELSE ? END,
            source_received_at = ?, duplicate_of = NULL, reference_id = ?,
            occurred_at = ?, reported_balance_minor = ?, confidence = ?,
            merchant = CASE WHEN merchant_user_edited = 1 OR matched_notification_id IS NOT NULL
              THEN merchant ELSE ? END,
            category = CASE WHEN category_user_edited = 1 OR matched_notification_id IS NOT NULL
              THEN category ELSE ? END,
            review_status = CASE WHEN merchant_user_edited = 1 OR category_user_edited = 1
              THEN review_status WHEN matched_notification_id IS NOT NULL
              THEN 'review' ELSE ? END
           WHERE id = ?`,
          [
            fingerprint,
            keeperId,
            fingerprint,
            receivedAt,
            parsed.referenceId ?? null,
            parsed.occurredAt,
            parsed.reportedBalanceMinor,
            parsed.confidence,
            displayMerchant,
            resolvedCategory,
            reviewStatus,
            keeperId,
          ],
        );
        for (const row of existing.slice(1)) {
          await tx.execute(
            'UPDATE transactions SET duplicate_of = ? WHERE id = ?',
            [keeperId, text(row, 'id')],
          );
        }
      });
      if (text(existing[0], 'source_fingerprint') !== fingerprint) await reopenReviewDay(parsed.occurredAt);
      return false;
    }
  }
  try {
    const insertedId = id('tx');
    await db().execute(
      `INSERT INTO transactions
       (id, account_id, amount_minor, kind, merchant, category, occurred_at,
        reported_balance_minor, source, source_fingerprint, confidence,
        review_status, source_received_at, created_at, reference_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sms', ?, ?, ?, ?, ?, ?)`,
      [
        insertedId,
        account.id,
        signedAmount,
        parsed.kind,
        displayMerchant,
        resolvedCategory,
        parsed.occurredAt,
        parsed.reportedBalanceMinor,
        fingerprint,
        parsed.confidence,
        reviewStatus,
        receivedAt,
        Date.now(),
        parsed.referenceId ?? null,
      ],
    );
    await flagManualMatches(insertedId);
    await reopenReviewDay(parsed.occurredAt);
    return true;
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) {
      // Parser improvements must repair previously imported SMS rows instead
      // of leaving the first interpretation permanently in the ledger.
      await db().execute(
        `UPDATE transactions SET
          account_id = ?, amount_minor = ?, kind = ?,
          merchant = CASE WHEN merchant_user_edited = 1 OR matched_notification_id IS NOT NULL
            THEN merchant ELSE ? END,
          category = CASE WHEN category_user_edited = 1 OR matched_notification_id IS NOT NULL
            THEN category ELSE ? END,
          occurred_at = ?, reported_balance_minor = ?, source_received_at = ?, reference_id = ?,
          confidence = ?,
          review_status = CASE WHEN merchant_user_edited = 1 OR category_user_edited = 1
            THEN review_status WHEN matched_notification_id IS NOT NULL
            THEN 'review' ELSE ? END
         WHERE source_fingerprint = ?`,
        [
          account.id,
          signedAmount,
          parsed.kind,
          displayMerchant,
          resolvedCategory,
          parsed.occurredAt,
          parsed.reportedBalanceMinor,
          receivedAt,
          parsed.referenceId ?? null,
          parsed.confidence,
          reviewStatus,
          fingerprint,
        ],
      );
      return false;
    }
    throw error;
  }
}

export async function candidateSmsCredits(
  amountMinor: number,
  postedAt: number,
): Promise<string[]> {
  const windowMs = 30 * 60 * 1000;
  const result = await db().execute(
    `SELECT id FROM transactions
     WHERE source = 'sms' AND kind = 'credit' AND amount_minor = ?
       AND duplicate_of IS NULL
       AND source_received_at BETWEEN ? AND ?
       AND merchant IN ('Unknown merchant', 'Sender not provided', 'Money received')
       AND merchant_user_edited = 0 AND matched_notification_id IS NULL`,
    [amountMinor, postedAt - windowMs, postedAt + windowMs],
  );
  return result.rows.map(row => text(row, 'id'));
}

export async function isGpayNotificationMatched(
  notificationId: string,
): Promise<boolean> {
  const result = await db().execute(
    'SELECT id FROM transactions WHERE matched_notification_id = ? LIMIT 1',
    [notificationId],
  );
  return result.rows.length > 0;
}

export async function applyGpayAttribution(
  transactionId: string,
  notificationId: string,
  sender: string,
): Promise<boolean> {
  const displayMerchant = await displayNameForVendor(sender);
  const category = await categoryForVendor(displayMerchant) ?? 'Other';
  const result = await db().execute(
    `UPDATE transactions SET merchant = ?,
       category = CASE WHEN category_user_edited = 1 THEN category ELSE ? END,
       matched_notification_id = ?, confidence = 1,
       review_status = CASE WHEN category_user_edited = 1 THEN 'confirmed' ELSE ? END
     WHERE id = ? AND merchant IN ('Unknown merchant', 'Sender not provided', 'Money received')
       AND merchant_user_edited = 0 AND matched_notification_id IS NULL`,
    [displayMerchant, category, notificationId, category === 'Other' ? 'review' : 'confirmed', transactionId],
  );
  return Number(result.rowsAffected ?? 0) === 1;
}

export async function saveNotificationTransaction(event: NotificationTransaction): Promise<boolean> {
  const known = await db().execute('SELECT id FROM notification_events WHERE id = ? LIMIT 1', [event.id]);
  if (known.rows.length) return false;
  const signedAmount = event.kind === 'credit' ? event.amountMinor : -event.amountMinor;
  const possibleMatches = await db().execute(
    `SELECT t.*, a.last_four AS account_last_four FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     WHERE t.source = 'sms' AND t.kind = ? AND t.amount_minor = ?
     AND t.duplicate_of IS NULL AND (t.reference_id = ? OR
       COALESCE(t.source_received_at, t.occurred_at) BETWEEN ? AND ?)`,
    [event.kind, signedAmount, event.referenceId ?? '', event.postedAt - 30 * 60_000, event.postedAt + 30 * 60_000],
  );
  const smsMatchId = uniqueSourceMatch({ amountMinor: signedAmount, kind: event.kind,
    at: event.postedAt, referenceId: event.referenceId, accountLastFour: event.accountLastFour },
    possibleMatches.rows.map(row => ({ id: text(row, 'id'), amountMinor: number(row, 'amount_minor'),
      kind: text(row, 'kind'), at: row.source_received_at == null ? number(row, 'occurred_at') : number(row, 'source_received_at'),
      referenceId: row.reference_id == null ? null : text(row, 'reference_id'),
      accountLastFour: row.account_last_four == null ? null : text(row, 'account_last_four') })));
  const merchant = await displayNameForVendor(event.merchant);
  let txId: string;
  if (smsMatchId) {
    txId = smsMatchId;
    const smsRow = possibleMatches.rows.find(row => text(row, 'id') === txId)!;
    if (text(smsRow, 'merchant') === 'Unknown merchant') {
      const category = await categoryForVendor(merchant) ?? 'Other';
      await db().execute(
        `UPDATE transactions SET merchant = ?,
         category = CASE WHEN category_user_edited = 1 THEN category ELSE ? END,
         confidence = 1,
         review_status = CASE WHEN category_user_edited = 1 THEN 'confirmed' ELSE ? END
         WHERE id = ? AND merchant_user_edited = 0`,
        [merchant, category, category === 'Other' ? 'review' : 'confirmed', txId],
      );
      await reopenReviewDay(event.postedAt);
    }
  } else {
    const crossApp = await db().execute(
      `SELECT DISTINCT t.id FROM transactions t JOIN notification_events n ON n.transaction_id = t.id
       WHERE t.source = 'notification' AND t.amount_minor = ? AND t.kind = ?
       AND n.package_name <> ?
       AND (t.reference_id = ? OR t.reference_id IS NULL OR ? IS NULL)
       AND (t.source_account_last_four = ? OR t.source_account_last_four IS NULL OR ? IS NULL)
       AND ((? IS NOT NULL AND t.reference_id = ?) OR
         (t.merchant = ? COLLATE NOCASE AND t.occurred_at BETWEEN ? AND ?) OR
         ((t.merchant = 'Unknown merchant' OR ? = 'Unknown merchant')
           AND t.occurred_at BETWEEN ? AND ?))
       AND t.duplicate_of IS NULL`,
      [signedAmount, event.kind, event.packageName, event.referenceId, event.referenceId,
        event.accountLastFour, event.accountLastFour,
        event.referenceId, event.referenceId, merchant,
        event.postedAt - 5 * 60_000, event.postedAt + 5 * 60_000,
        merchant, event.postedAt - 2 * 60_000, event.postedAt + 2 * 60_000],
    );
    if (crossApp.rows.length === 1) {
      txId = text(crossApp.rows[0], 'id');
      const betterCategory = await categoryForVendor(merchant) ?? 'Other';
      await db().execute(
        `UPDATE transactions SET merchant = CASE WHEN merchant = 'Unknown merchant' THEN ? ELSE merchant END,
         category = CASE WHEN merchant = 'Unknown merchant' AND category_user_edited = 0 THEN ? ELSE category END,
         reference_id = COALESCE(reference_id, ?),
         source_account_last_four = COALESCE(source_account_last_four, ?)
         WHERE id = ? AND merchant_user_edited = 0`,
        [merchant, betterCategory, event.referenceId, event.accountLastFour, txId],
      );
      await db().execute(
        `INSERT INTO notification_events (id, package_name, merchant, amount_minor,
         kind, posted_at, transaction_id, reference_id, account_last_four) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [event.id, event.packageName, merchant, event.amountMinor, event.kind, event.postedAt, txId, event.referenceId, event.accountLastFour],
      );
      return false;
    }
    // Keep an unverified notification in an account with no known balance.
    // It contributes to activity, never to an authoritative bank balance.
    const notificationAccount = `notification:${event.packageName}`;
    await db().execute(
      `INSERT OR IGNORE INTO accounts (id, name, last_four, type, currency,
       opening_balance_minor, reported_balance_minor, created_at)
       VALUES (?, ?, NULL, 'wallet', 'INR', 0, NULL, ?)`,
      [notificationAccount, `Unverified · ${event.packageName.split('.').pop()}`, Date.now()],
    );
    txId = id('tx');
    const category = await categoryForVendor(merchant) ?? 'Other';
    await db().execute(
      `INSERT INTO transactions (id, account_id, amount_minor, kind, merchant, category,
       occurred_at, reported_balance_minor, source, source_fingerprint,
       confidence, review_status, source_received_at, created_at, reference_id,
       source_account_last_four)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'notification', ?, 0.65, ?, ?, ?, ?, ?)`,
      [txId, notificationAccount, signedAmount, event.kind, merchant, category,
        event.postedAt, event.id, 'review',
        event.postedAt, Date.now(), event.referenceId, event.accountLastFour],
    );
    await reopenReviewDay(event.postedAt);
  }
  await db().execute(
    `INSERT INTO notification_events (id, package_name, merchant, amount_minor,
     kind, posted_at, transaction_id, reference_id, account_last_four) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.id, event.packageName, merchant, event.amountMinor, event.kind, event.postedAt, txId, event.referenceId, event.accountLastFour],
  );
  return true;
}

export async function getPotentialDuplicateTargets(transactionId: string): Promise<Transaction[]> {
  const source = await db().execute('SELECT * FROM transactions WHERE id = ? AND source = ? AND duplicate_of IS NULL',
    [transactionId, 'notification']);
  if (!source.rows.length) return [];
  const row = source.rows[0];
  const candidates = await db().execute(
    `SELECT t.* FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.id <> ? AND t.duplicate_of IS NULL AND t.amount_minor = ? AND t.kind = ?
       AND COALESCE(t.source_received_at, t.occurred_at) BETWEEN ? AND ?
       AND (? IS NULL OR a.last_four IS NULL OR a.last_four = ?)
     ORDER BY CASE WHEN t.source = 'sms' THEN 0 ELSE 1 END, t.occurred_at DESC`,
    [transactionId, number(row, 'amount_minor'), text(row, 'kind'),
      number(row, 'occurred_at') - 30 * 60_000, number(row, 'occurred_at') + 30 * 60_000,
      row.source_account_last_four ?? null, row.source_account_last_four ?? null],
  );
  return candidates.rows.map(mapTransaction);
}

export async function resolveNotificationDuplicate(transactionId: string, targetId: string | null): Promise<void> {
  const source = await db().execute('SELECT * FROM transactions WHERE id = ? AND source = ? AND duplicate_of IS NULL',
    [transactionId, 'notification']);
  if (!source.rows.length) throw new Error('Unverified alert not found');
  const attached = await db().execute(
    `SELECT id FROM obligations WHERE transaction_id = ? UNION
     SELECT transaction_id AS id FROM transaction_splits WHERE transaction_id = ? UNION
     SELECT transaction_id AS id FROM repayments WHERE transaction_id = ? UNION
     SELECT transaction_id AS id FROM ignored_auto_repayments WHERE transaction_id = ? UNION
     SELECT transaction_id AS id FROM income_assignments WHERE transaction_id = ? UNION
     SELECT transaction_id AS id FROM transaction_category_splits WHERE transaction_id = ?`,
    [transactionId, transactionId, transactionId, transactionId, transactionId, transactionId]);
  if (attached.rows.length) throw new Error('This alert has a shared-expense link or custom income choice and cannot be merged automatically');
  if (targetId == null) {
    await db().execute("UPDATE transactions SET duplicate_of = 'ignored' WHERE id = ?", [transactionId]);
    return;
  }
  const targets = await getPotentialDuplicateTargets(transactionId);
  if (!targets.some(target => target.id === targetId)) throw new Error('Matching transaction not found');
  const merchant = text(source.rows[0], 'merchant');
  const category = merchant === 'Unknown merchant' ? 'Other' : await categoryForVendor(merchant) ?? 'Other';
  await db().transaction(async tx => {
    if (merchant !== 'Unknown merchant') {
      await tx.execute(`UPDATE transactions SET merchant = ?,
        category = CASE WHEN category_user_edited = 1 THEN category ELSE ? END,
        review_status = CASE WHEN category_user_edited = 1 THEN 'confirmed' ELSE ? END
        WHERE id = ? AND merchant = 'Unknown merchant' AND merchant_user_edited = 0`,
      [merchant, category, category === 'Other' ? 'review' : 'confirmed', targetId]);
    }
    await tx.execute('UPDATE notification_events SET transaction_id = ? WHERE transaction_id = ?', [targetId, transactionId]);
    await tx.execute('UPDATE transactions SET duplicate_of = ? WHERE id = ?', [targetId, transactionId]);
  });
}

export async function setTransferStatus(transactionId: string, asTransfer: boolean): Promise<void> {
  const result = await db().execute('SELECT amount_minor, kind FROM transactions WHERE id = ? AND duplicate_of IS NULL', [transactionId]);
  if (!result.rows.length) throw new Error('Transaction not found');
  const kind = text(result.rows[0], 'kind');
  if (!['debit', 'credit', 'transfer'].includes(kind)) throw new Error('This transaction type cannot be changed to a transfer');
  const attached = await db().execute(`SELECT transaction_id FROM transaction_splits WHERE transaction_id = ? UNION
    SELECT transaction_id FROM transaction_category_splits WHERE transaction_id = ? LIMIT 1`, [transactionId, transactionId]);
  if (attached.rows.length) throw new Error('Remove transaction splits before marking this as a transfer');
  const newKind = asTransfer ? 'transfer' : number(result.rows[0], 'amount_minor') < 0 ? 'debit' : 'credit';
  await db().execute('UPDATE transactions SET kind = ?, review_status = ? WHERE id = ?',
    [newKind, 'confirmed', transactionId]);
}

export async function getDashboard(
  loadedTransactions?: Transaction[],
): Promise<Dashboard> {
  const [accounts, transactions, latestSmsBalance, budgetSetting] = await Promise.all([
    getAccounts(),
    loadedTransactions ?? getAllTransactions(),
    db().execute(
      `SELECT account_id, balance_minor, received_at FROM sms_balance_snapshots
       ORDER BY received_at DESC LIMIT 1`,
    ),
    getAppSetting('monthly_budget_minor'),
  ]);
  // A balance is the bank's snapshot in its SMS, not a sum of imported
  // movements or a property of whichever duplicate row is visible.
  const snapshot = latestSmsBalance.rows[0];
  const latestReportedBalance = snapshot
    ? number(snapshot, 'balance_minor')
    : null;
  const monthlyBudgetMinor =
    budgetSetting != null && Number.isSafeInteger(Number(budgetSetting))
      ? Number(budgetSetting)
      : null;
  const accountProtections = accounts.map(account => ({
    accountId: account.id,
    name: account.name,
    lastFour: account.lastFour,
    balanceMinor: account.reportedBalanceMinor,
    minimumBalanceMinor: account.minimumBalanceMinor,
    aboveMinimumMinor:
      account.reportedBalanceMinor != null &&
      account.minimumBalanceMinor != null
        ? account.reportedBalanceMinor - account.minimumBalanceMinor
        : null,
  }));
  const calculatedBalance = accounts.reduce((total, account) => {
    const movement = transactions
      .filter(transaction => transaction.accountId === account.id)
      .reduce((sum, transaction) => sum + transaction.amountMinor, 0);
    return total + (account.id.startsWith('notification:') ? 0 : account.openingBalanceMinor + movement);
  }, 0);
  const balanceMinor = latestReportedBalance ?? calculatedBalance;
  const date = new Date();
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
  const current = transactions.filter(
    transaction =>
      transaction.occurredAt >= monthStart && transaction.occurredAt < monthEnd &&
      !(transaction.source === 'manual' && transaction.possibleDuplicate),
  );
  const incomeMinor = current
    .filter(transaction => transaction.amountMinor > 0)
    .reduce((sum, transaction) => sum + transaction.amountMinor, 0);
  const spentMinor = Math.abs(
    current
      .filter(
        transaction =>
          transaction.amountMinor < 0 && transaction.kind !== 'transfer',
      )
      .reduce((sum, transaction) => sum + transaction.amountMinor, 0),
  );
  const budgetPlan =
    monthlyBudgetMinor != null && monthlyBudgetMinor > 0
      ? calculateWeeklyBudgetPlan(monthlyBudgetMinor, spentMinor, date)
      : null;
  const categoryMap = new Map<string, number>();
  current
    .filter(transaction => transaction.amountMinor < 0)
    .forEach(transaction =>
      categoryMap.set(
        transaction.category,
        (categoryMap.get(transaction.category) ?? 0) +
          Math.abs(transaction.amountMinor),
      ),
    );
  const categories = [...categoryMap.entries()]
    .map(([category, amountMinor]) => ({ category, amountMinor }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const monthFormatter = new Intl.DateTimeFormat('en-IN', { month: 'short' });
  const months = Array.from({ length: 6 }, (_, offset) => {
    const month = new Date(date.getFullYear(), date.getMonth() - 5 + offset, 1);
    const end = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      1,
    ).getTime();
    const start = month.getTime();
    const amountMinor = Math.abs(
      transactions
        .filter(
          tx =>
            tx.occurredAt >= start && tx.occurredAt < end && tx.amountMinor < 0,
        )
        .reduce((sum, tx) => sum + tx.amountMinor, 0),
    );
    return { label: monthFormatter.format(month), amountMinor };
  });

  return {
    balanceMinor,
    balanceIsReported: latestReportedBalance != null,
    balanceAsOf: snapshot ? number(snapshot, 'received_at') : null,
    balanceAccountId: snapshot ? text(snapshot, 'account_id') : null,
    accountProtections,
    monthlyBudgetMinor,
    budgetRemainingMinor: budgetPlan?.remainingMinor ?? null,
    budgetOverageMinor: budgetPlan?.overBudgetMinor ?? null,
    dailyTargetMinor: budgetPlan?.dailyTargetMinor ?? null,
    weeklyPaceMinor: budgetPlan?.weeklyPaceMinor ?? null,
    budgetDaysRemaining: budgetPlan?.daysRemaining ?? null,
    incomeMinor,
    spentMinor,
    reviewCount: groupReviewTransactions(transactions).length,
    transactions: transactions.slice(0, 8),
    categories,
    months,
  };
}

export async function removeDemoData(): Promise<void> {
  await db().execute("DELETE FROM transactions WHERE source = 'demo'");
  await db().execute(
    `DELETE FROM accounts WHERE id NOT IN (
       SELECT account_id FROM transactions
       UNION SELECT account_id FROM sms_balance_snapshots
     )`,
  );
}

export async function wipeAndReinitializeDatabase(): Promise<void> {
  await initializeDatabase();
  await db().transaction(async tx => {
    await tx.execute('DELETE FROM manual_duplicate_candidates');
    await tx.execute('DELETE FROM manual_match_decisions');
    await tx.execute('DELETE FROM repayments');
    await tx.execute('DELETE FROM ignored_auto_repayments');
    await tx.execute('DELETE FROM income_assignments');
    await tx.execute('DELETE FROM obligations');
    await tx.execute('DELETE FROM split_people');
    await tx.execute('DELETE FROM transaction_splits');
    await tx.execute('DELETE FROM transaction_category_splits');
    await tx.execute('DELETE FROM savings_goals');
    await tx.execute('DELETE FROM savings_income_estimates');
    await tx.execute('DELETE FROM recurring_bills');
    await tx.execute('DELETE FROM review_days');
    await tx.execute('DELETE FROM notification_events');
    await tx.execute('DELETE FROM sms_balance_snapshots');
    await tx.execute('DELETE FROM transactions');
    await tx.execute('DELETE FROM merchant_rules');
    await tx.execute('DELETE FROM vendor_aliases');
    await tx.execute('DELETE FROM budgets');
    await tx.execute('DELETE FROM categories');
    await tx.execute('DELETE FROM accounts');
    await tx.execute('DELETE FROM app_settings');
    // A reset must not silently refill the ledger from historical SMS on the
    // next refresh or after a future parser-version change.
    await tx.execute(
      "INSERT INTO app_settings (key, value) VALUES ('auto_reimport_disabled', '1')",
    );
  });
  db().close();
  database = null;
  await initializeDatabase();
}

export async function getAppSetting(key: string): Promise<string | null> {
  const result = await db().execute(
    'SELECT value FROM app_settings WHERE key = ? LIMIT 1',
    [key],
  );
  return result.rows.length ? text(result.rows[0], 'value') : null;
}

export async function setAppSetting(
  key: string,
  settingValue: string,
): Promise<void> {
  await db().execute(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, settingValue],
  );
}

async function validCategoryName(category: string): Promise<string> {
  const result = await db().execute(
    'SELECT name FROM categories WHERE name = ? COLLATE NOCASE LIMIT 1', [category],
  );
  if (!result.rows.length) throw new Error('Choose a valid category');
  return text(result.rows[0], 'name');
}

// This is the only classification used by the ledger and all money reports.
export async function setTransactionCategory(transactionId: string, category: string): Promise<void> {
  const selected = await validCategoryName(category);
  await db().transaction(async tx => {
    const result = await tx.execute(
      `UPDATE transactions SET category = ?, category_user_edited = 1,
        review_status = CASE WHEN review_status = 'awaiting_sender' THEN 'awaiting_sender'
          ELSE 'confirmed' END
       WHERE id = ? AND duplicate_of IS NULL`,
      [selected, transactionId],
    );
    if (Number(result.rowsAffected ?? 0) !== 1) throw new Error('Transaction not found');
    await tx.execute('DELETE FROM transaction_category_splits WHERE transaction_id = ?', [transactionId]);
  });
}

export type TransactionCategorySplit = { category: string; amountMinor: number };

export async function setTransactionCategorySplits(
  transactionId: string,
  splits: TransactionCategorySplit[],
): Promise<void> {
  if (splits.length < 2) throw new Error('Choose at least two categories');
  const normalized = splits.map(item => ({ category: item.category.trim(), amountMinor: item.amountMinor }));
  if (normalized.some(item => !item.category || !Number.isSafeInteger(item.amountMinor) || item.amountMinor <= 0))
    throw new Error('Enter a positive amount for every category');
  if (new Set(normalized.map(item => item.category.toLocaleLowerCase())).size !== normalized.length)
    throw new Error('Choose each category only once');
  const [transactionRow, categoryRows] = await Promise.all([
    db().execute('SELECT amount_minor, kind FROM transactions WHERE id = ? AND duplicate_of IS NULL', [transactionId]),
    db().execute('SELECT name FROM categories'),
  ]);
  if (!transactionRow.rows.length) throw new Error('Transaction not found');
  const amountMinor = number(transactionRow.rows[0], 'amount_minor');
  if (amountMinor >= 0 || text(transactionRow.rows[0], 'kind') === 'transfer')
    throw new Error('Only expense transactions can be split by category');
  const known = new Map(categoryRows.rows.map(row => [text(row, 'name').toLocaleLowerCase(), text(row, 'name')]));
  const selected = normalized.map(item => ({ category: known.get(item.category.toLocaleLowerCase()), amountMinor: item.amountMinor }));
  if (selected.some(item => !item.category)) throw new Error('Choose an existing category');
  if (selected.reduce((sum, item) => sum + item.amountMinor, 0) !== Math.abs(amountMinor))
    throw new Error('Category amounts must equal the transaction total');
  await db().transaction(async tx => {
    await tx.execute('DELETE FROM transaction_category_splits WHERE transaction_id = ?', [transactionId]);
    for (const item of selected) await tx.execute(
      'INSERT INTO transaction_category_splits (transaction_id, category, amount_minor) VALUES (?, ?, ?)',
      [transactionId, item.category!, item.amountMinor],
    );
    await tx.execute(`UPDATE transactions SET category = ?, category_user_edited = 1,
      review_status = CASE WHEN review_status = 'awaiting_sender' THEN 'awaiting_sender' ELSE 'confirmed' END
      WHERE id = ?`, [selected[0].category!, transactionId]);
  });
}

export async function removeTransactionCategorySplits(transactionId: string): Promise<void> {
  await db().execute('DELETE FROM transaction_category_splits WHERE transaction_id = ?', [transactionId]);
}

export async function setTransactionNote(transactionId: string, note: string): Promise<void> {
  const cleanedNote = note.trim().slice(0, 500);
  const result = await db().execute(
    'UPDATE transactions SET note = ? WHERE id = ? AND duplicate_of IS NULL',
    [cleanedNote, transactionId],
  );
  if (Number(result.rowsAffected ?? 0) !== 1) throw new Error('Transaction not found');
}

// A vendor rule owns the classification of every matching transaction that
// has not been categorized by the user. Unverified alerts and unresolved
// manual duplicates keep their review status until checked individually.
async function applyVendorDefaultsInTransaction(
  tx: SqlTransaction, defaults: Map<string, string>,
): Promise<void> {
  if (defaults.size === 0) return;
  const eligible = await tx.execute(
    `SELECT id, merchant, review_status, category_user_edited FROM transactions
     WHERE duplicate_of IS NULL AND category_user_edited = 0
       AND NOT EXISTS (SELECT 1 FROM transaction_category_splits c WHERE c.transaction_id = transactions.id)`,
  );
  for (const row of eligible.rows) {
    const key = normalizedVendorKey(text(row, 'merchant'));
    const category = key ? defaults.get(key) : undefined;
    if (!key || !category) continue;
    if (!shouldApplyVendorDefault({
      merchant: text(row, 'merchant'),
      reviewStatus: text(row, 'review_status') as Transaction['reviewStatus'],
      categoryUserEdited: number(row, 'category_user_edited') === 1,
    }, key)) continue;
    await tx.execute(
      `UPDATE transactions SET category = ?,
       review_status = CASE
         WHEN source = 'notification' AND review_status <> 'confirmed' THEN review_status
         WHEN EXISTS (SELECT 1 FROM manual_duplicate_candidates m
           WHERE m.manual_id = transactions.id OR m.sms_id = transactions.id) THEN review_status
         ELSE 'confirmed' END
       WHERE id = ? AND duplicate_of IS NULL AND category_user_edited = 0`,
      [category, text(row, 'id')],
    );
  }
}

async function saveVendorDefaultInTransaction(
  tx: SqlTransaction, cleanedMerchant: string, key: string, category: string,
): Promise<void> {
  await tx.execute(
    `INSERT INTO merchant_rules (merchant_key, category, merchant_label, updated_at)
     VALUES (?, ?, ?, ?) ON CONFLICT(merchant_key) DO UPDATE SET
     category = excluded.category, merchant_label = excluded.merchant_label,
     updated_at = excluded.updated_at`,
    [key, category, cleanedMerchant, Date.now()],
  );
  await applyVendorDefaultsInTransaction(tx, new Map([[key, category]]));
}

export async function setVendorDefaultCategory(merchant: string, category: string): Promise<void> {
  const cleanedMerchant = merchant.trim().replace(/\s+/g, ' ').slice(0, 48);
  const key = normalizedVendorKey(cleanedMerchant);
  if (!key) throw new Error('Enter a specific vendor name first');
  const selected = await validCategoryName(category);
  await db().transaction(tx => saveVendorDefaultInTransaction(tx, cleanedMerchant, key, selected));
}

async function renameVendorInTransaction(tx: SqlTransaction, transactionId: string, cleanedMerchant: string): Promise<void> {
  const result = await tx.execute('SELECT * FROM transactions WHERE duplicate_of IS NULL');
  const rows = result.rows.map(mapTransaction);
  const selected = rows.find(row => row.id === transactionId);
  if (!selected) throw new Error('Transaction not found');
  const ids = vendorRenameIds(rows, transactionId);
  for (const idToUpdate of ids) {
    await tx.execute(
      `UPDATE transactions SET merchant = ?, merchant_user_edited = 1,
       review_status = CASE WHEN review_status = 'awaiting_sender' THEN 'review' ELSE review_status END
       WHERE id = ? AND duplicate_of IS NULL`,
      [cleanedMerchant, idToUpdate],
    );
  }
  const oldKey = normalizedVendorKey(selected.merchant);
  const newKey = normalizedVendorKey(cleanedMerchant);
  if (selected.merchant !== cleanedMerchant && oldKey && newKey) {
    const now = Date.now();
    await tx.execute('UPDATE vendor_aliases SET display_name = ?, updated_at = ? WHERE display_name = ? COLLATE NOCASE',
      [cleanedMerchant, now, selected.merchant]);
    await tx.execute(
      `INSERT INTO vendor_aliases (source_key, display_name, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET display_name = excluded.display_name,
         updated_at = excluded.updated_at`, [oldKey, cleanedMerchant, now],
    );
    await tx.execute(
      `INSERT OR IGNORE INTO merchant_rules (merchant_key, category, merchant_label, updated_at)
       SELECT ?, category, ?, ? FROM merchant_rules WHERE merchant_key = ?`,
      [newKey, cleanedMerchant, now, oldKey],
    );
  }
}

export async function renameVendorForTransaction(transactionId: string, merchant: string): Promise<void> {
  const cleanedMerchant = merchant.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!cleanedMerchant) throw new Error('Enter a sender or vendor name');
  await db().transaction(tx => renameVendorInTransaction(tx, transactionId, cleanedMerchant));
}

// Save the vendor identity and its future classification in one database
// transaction. A failed category or rename cannot leave a half-saved profile.
export async function saveVendorProfile(transactionId: string, merchant: string, category: string): Promise<void> {
  const cleanedMerchant = merchant.trim().replace(/\s+/g, ' ').slice(0, 48);
  const key = normalizedVendorKey(cleanedMerchant);
  if (!key) throw new Error('Enter a specific vendor name first');
  const selected = await validCategoryName(category);
  await db().transaction(async tx => {
    const current = await tx.execute('SELECT merchant FROM transactions WHERE id = ? AND duplicate_of IS NULL LIMIT 1',
      [transactionId]);
    if (!current.rows.length) throw new Error('Transaction not found');
    if (text(current.rows[0], 'merchant') !== cleanedMerchant) {
      await renameVendorInTransaction(tx, transactionId, cleanedMerchant);
    }
    await saveVendorDefaultInTransaction(tx, cleanedMerchant, key, selected);
  });
}
