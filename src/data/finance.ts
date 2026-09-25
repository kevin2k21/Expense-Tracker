import { getAccounts, getAllTransactions, getAppSetting, getDatabaseHandle, initializeDatabase, setAppSetting } from './database';
import type { Transaction } from '../types';
import { personalSpendingMinor, safeToSpendMinor as calculateSafeToSpend, splitPersonalMinor } from '../features/finance/accounting';
import { planAutomaticRepayments, type IncomingCredit, type SharedReceivable } from '../features/finance/automaticRepayments';
import { assignedIncomeMonth, monthKeyFor, totalAssignedIncome, validIncomeMonth } from '../features/finance/incomeMonth';
import { cashFlowSummaries, type CashFlowSummaries } from '../features/finance/cashFlow';
import { calculateSavingsGuide, dueMonthForDuration, type SavingsGuide } from '../features/finance/savingsPlan';
import { personalCategoryAllocations } from '../features/transactions/categorySplit';

const val = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0);
const str = (row: Record<string, unknown>, key: string) => String(row[key] ?? '');
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const dayKey = (time: number) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const median = (numbers: number[]) => {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
};
const expense = (tx: Transaction) => tx.amountMinor < 0 && tx.kind !== 'transfer';

export type Obligation = { id: string; person: string; direction: 'receivable' | 'payable';
  amountMinor: number; paidMinor: number; automaticPaidMinor: number; remainingMinor: number; personalMinor: number;
  transactionId: string | null; createdAt: number; category: string };
export type TransactionSplit = { personalMinor: number; people: Array<{ name: string; amountMinor: number }> };
export type IncomeCandidate = { id: string; merchant: string; occurredAt: number;
  amountMinor: number; assignedMonthKey: string | null };
export type Goal = { id: string; name: string; targetMinor: number; allocatedMinor: number;
  dueMonthKey: string | null };
export type Bill = { id: string; name: string; amountMinor: number; dueDay: number; accountId: string | null;
  kind: 'debit' | 'credit'; doneThisMonth: boolean };
export type ReviewDay = { day: string; count: number; flagged: number; completed: boolean };
export type Breakdown = { totalMinor: number; categories: Array<{ name: string; amountMinor: number; budgetMinor: number | null }>;
  merchants: Array<{ name: string; amountMinor: number }> };
export type FinanceSnapshot = {
  personalSpentMinor: number; bankOutflowMinor: number; incomeMinor: number;
  cashFlow: CashFlowSummaries | null;
  cashFlowAsOf: number;
  previousMonthSpentMinor: number; weekSpentMinor: number; previousWeekSpentMinor: number;
  todaySpentMinor: number; yesterdaySpentMinor: number; projectedMonthMinor: number;
  paceRatio: number | null; unusual: Array<{ label: string; amountMinor: number }>;
  baselineReady: boolean; categories: Array<{ name: string; amountMinor: number; budgetMinor: number | null }>;
  merchants: Array<{ name: string; amountMinor: number }>;
  breakdowns: { today: Breakdown; week: Breakdown; month: Breakdown };
  months: Array<{ label: string; amountMinor: number }>;
  goals: Goal[]; bills: Bill[];
  savingsGuide: SavingsGuide;
  obligations: Obligation[]; reviewDays: ReviewDay[];
  safeToSpendMinor: number | null; safePerDayMinor: number | null;
  primaryAccountId: string | null; primaryAccountName: string | null;
  primaryBalanceAsOf: number | null;
  primaryBalanceStale: boolean;
  repaymentSuggestions: Array<{ transactionId: string; obligationId: string; amountMinor: number }>;
  automaticMatches: Array<{ transactionId: string; obligationId: string; amountMinor: number }>;
  incomeCandidates: IncomeCandidate[];
};

export async function reconcileAutomaticRepayments(): Promise<number> {
  await initializeDatabase();
  let inserted = 0;
  await getDatabaseHandle().transaction(async tx => {
    const receivableRows = await tx.execute(`SELECT o.id, o.person, o.amount_minor,
      s.occurred_at AS expense_occurred_at, s.source_received_at AS expense_received_at,
      COALESCE((SELECT SUM(r.amount_minor) FROM repayments r WHERE r.obligation_id = o.id), 0) AS paid_minor
      FROM obligations o JOIN transactions s ON s.id = o.transaction_id
      WHERE o.direction = 'receivable' AND s.duplicate_of IS NULL AND s.kind = 'debit'`);
    const receivables: SharedReceivable[] = receivableRows.rows.map(row => ({
      id: str(row, 'id'), person: str(row, 'person'),
      remainingMinor: Math.max(0, val(row, 'amount_minor') - val(row, 'paid_minor')),
      expenseOccurredAt: val(row, 'expense_occurred_at'),
      expenseReceivedAt: row.expense_received_at == null ? null : val(row, 'expense_received_at'),
    })).filter(item => item.remainingMinor > 0);
    if (!receivables.length) return;
    const creditRows = await tx.execute(`SELECT t.id, t.merchant, t.amount_minor, t.occurred_at,
      t.source_received_at,
      COALESCE((SELECT SUM(r.amount_minor) FROM repayments r WHERE r.transaction_id = t.id), 0) AS applied_minor
      FROM transactions t
      WHERE t.duplicate_of IS NULL AND t.kind = 'credit' AND t.amount_minor > 0
        AND NOT EXISTS (SELECT 1 FROM manual_duplicate_candidates d WHERE d.manual_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM ignored_auto_repayments i WHERE i.transaction_id = t.id)
        AND (t.source = 'sms' OR
          (t.source = 'notification' AND t.review_status = 'confirmed'))`);
    const credits: IncomingCredit[] = creditRows.rows.map(row => ({
      id: str(row, 'id'), merchant: str(row, 'merchant'),
      amountMinor: val(row, 'amount_minor'), alreadyAppliedMinor: val(row, 'applied_minor'),
      occurredAt: val(row, 'occurred_at'),
      receivedAt: row.source_received_at == null ? null : val(row, 'source_received_at'),
    }));
    for (const match of planAutomaticRepayments(credits, receivables)) {
      await tx.execute(`INSERT INTO repayments
        (id, obligation_id, transaction_id, amount_minor, created_at, origin)
        VALUES (?, ?, ?, ?, ?, 'automatic')`,
      [uid('auto_repay'), match.obligationId, match.transactionId, match.amountMinor, Date.now()]);
      inserted += 1;
    }
  });
  return inserted;
}

export async function undoAutomaticRepayment(transactionId: string): Promise<void> {
  await initializeDatabase();
  const db = getDatabaseHandle();
  await db.transaction(async tx => {
    const linked = await tx.execute(`SELECT id FROM repayments
      WHERE transaction_id = ? AND origin = 'automatic' LIMIT 1`, [transactionId]);
    if (!linked.rows.length) throw new Error('No automatic match remains for this payment');
    await tx.execute('DELETE FROM repayments WHERE transaction_id = ? AND origin = ?', [transactionId, 'automatic']);
    await tx.execute(`INSERT OR IGNORE INTO ignored_auto_repayments (transaction_id, created_at)
      VALUES (?, ?)`, [transactionId, Date.now()]);
  });
}

export async function getFinanceSnapshot(now = Date.now()): Promise<FinanceSnapshot> {
  await initializeDatabase();
  const db = getDatabaseHandle();
  const [allTransactions, accounts, splitRows, obligationRows, repaymentRows,
    goalRows, billRows, budgetRows, reviewRows, rawRows, incomeAssignmentRows,
    primarySetting, monthlyBudgetSetting, expectedIncomeRows] = await Promise.all([
    getAllTransactions(), getAccounts(),
    db.execute('SELECT * FROM transaction_splits'), db.execute('SELECT * FROM obligations'),
    db.execute('SELECT * FROM repayments'), db.execute('SELECT * FROM savings_goals'),
    db.execute('SELECT * FROM recurring_bills WHERE active = 1'), db.execute('SELECT * FROM budgets'),
    db.execute('SELECT * FROM review_days'),
    db.execute("SELECT id, occurred_at, created_at, review_status FROM transactions WHERE duplicate_of IS NULL AND source <> 'demo'"),
    db.execute('SELECT transaction_id, month_key FROM income_assignments'),
    getAppSetting('primary_account_id'), getAppSetting('monthly_budget_minor'),
    db.execute('SELECT amount_minor FROM savings_income_estimates WHERE month_key = ?', [monthKeyFor(now)]),
  ]);
  const transactions = allTransactions.filter(tx => tx.source !== 'demo' &&
    !(tx.source === 'manual' && tx.possibleDuplicate) &&
    (tx.source !== 'notification' || tx.reviewStatus === 'confirmed'));
  const incomeAssignments = new Map<string, string | null>(incomeAssignmentRows.rows.map(row => [
    str(row, 'transaction_id'), row.month_key == null ? null : str(row, 'month_key'),
  ]));
  const splits = new Map(splitRows.rows.map(row => [str(row, 'transaction_id'), val(row, 'personal_minor')]));
  const repayments = new Map<string, number>();
  const automaticRepayments = new Map<string, number>();
  const automaticMatches: FinanceSnapshot['automaticMatches'] = [];
  const repaidByTransaction = new Map<string, number>();
  for (const row of repaymentRows.rows) {
    const obligationId = str(row, 'obligation_id');
    repayments.set(obligationId, (repayments.get(obligationId) ?? 0) + val(row, 'amount_minor'));
    if (str(row, 'origin') === 'automatic') {
      automaticRepayments.set(obligationId, (automaticRepayments.get(obligationId) ?? 0) + val(row, 'amount_minor'));
      if (row.transaction_id != null) automaticMatches.push({
        transactionId: str(row, 'transaction_id'), obligationId,
        amountMinor: val(row, 'amount_minor'),
      });
    }
    if (row.transaction_id != null) {
      const transactionId = str(row, 'transaction_id');
      repaidByTransaction.set(transactionId, (repaidByTransaction.get(transactionId) ?? 0) + val(row, 'amount_minor'));
    }
  }
  const obligations: Obligation[] = obligationRows.rows.map(row => {
    const amountMinor = val(row, 'amount_minor');
    const paidMinor = repayments.get(str(row, 'id')) ?? 0;
    return { id: str(row, 'id'), person: str(row, 'person'), direction: str(row, 'direction') as Obligation['direction'],
      amountMinor, paidMinor, automaticPaidMinor: automaticRepayments.get(str(row, 'id')) ?? 0,
      remainingMinor: Math.max(0, amountMinor - paidMinor),
      personalMinor: val(row, 'personal_minor'), transactionId: row.transaction_id == null ? null : str(row, 'transaction_id'),
      createdAt: val(row, 'created_at'), category: str(row, 'category') };
  });
  const personalAmount = (tx: Transaction) => personalSpendingMinor(tx, splits.get(tx.id), repaidByTransaction.get(tx.id) ?? 0);
  const categoryAmounts = (tx: Transaction, amount: number) => tx.categorySplits?.length
    ? personalCategoryAllocations(Math.abs(tx.amountMinor), amount, tx.categorySplits)
    : [{ category: tx.category, amountMinor: amount }];
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const nextMonth = new Date(new Date(now).getFullYear(), new Date(now).getMonth() + 1, 1).getTime();
  const previousMonth = new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 1, 1).getTime();
  const todayStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
  const weekStart = todayStart - ((new Date(now).getDay() + 6) % 7) * 86_400_000;
  const externalPersonal = obligations.filter(x => x.direction === 'payable' && x.transactionId == null);
  const sumPeriod = (start: number, end: number) => Math.max(0, transactions
    .filter(tx => tx.occurredAt >= start && tx.occurredAt < end)
    .reduce((sum, tx) => sum + personalAmount(tx), 0) + externalPersonal
    .filter(x => x.createdAt >= start && x.createdAt < end)
    .reduce((sum, x) => sum + x.personalMinor, 0));
  const personalSpentMinor = sumPeriod(monthStart, nextMonth);
  const months = Array.from({ length: 6 }, (_, offset) => {
    const first = new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 5 + offset, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 1);
    return { label: new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(first),
      amountMinor: sumPeriod(first.getTime(), last.getTime()) };
  });
  const bankAccountIds = new Set(accounts.filter(account => account.type === 'bank').map(account => account.id));
  const bankOutflowMinor = transactions.filter(tx => tx.occurredAt >= monthStart && tx.occurredAt < nextMonth &&
    tx.amountMinor < 0 && bankAccountIds.has(tx.accountId) &&
    (tx.source === 'sms' || tx.source === 'manual'))
    .reduce((sum, tx) => sum + Math.abs(tx.amountMinor), 0);
  const incomeCandidates: IncomeCandidate[] = transactions.filter(tx => tx.kind === 'credit' && tx.amountMinor > 0)
    .map(tx => ({ id: tx.id, merchant: tx.merchant, occurredAt: tx.occurredAt,
      amountMinor: Math.max(0, tx.amountMinor - (repaidByTransaction.get(tx.id) ?? 0)),
      assignedMonthKey: assignedIncomeMonth(tx.id, incomeAssignments),
    })).filter(item => item.amountMinor > 0)
    .sort((a, b) => b.occurredAt - a.occurredAt);
  const currentMonthKey = monthKeyFor(now);
  const incomeMinor = totalAssignedIncome(incomeCandidates, currentMonthKey);
  const categoryMap = new Map<string, number>();
  const merchantMap = new Map<string, number>();
  for (const tx of transactions.filter(x => x.occurredAt >= monthStart && x.occurredAt < nextMonth)) {
    const amount = personalAmount(tx);
    if (amount === 0) continue;
    for (const allocation of categoryAmounts(tx, amount))
      categoryMap.set(allocation.category, (categoryMap.get(allocation.category) ?? 0) + allocation.amountMinor);
    merchantMap.set(tx.merchant, (merchantMap.get(tx.merchant) ?? 0) + amount);
  }
  for (const item of externalPersonal.filter(x => x.createdAt >= monthStart && x.createdAt < nextMonth)) {
    categoryMap.set(item.category, (categoryMap.get(item.category) ?? 0) + item.personalMinor);
    merchantMap.set(item.person, (merchantMap.get(item.person) ?? 0) + item.personalMinor);
  }
  for (const [name, amount] of categoryMap) categoryMap.set(name, Math.max(0, amount));
  for (const [name, amount] of merchantMap) merchantMap.set(name, Math.max(0, amount));
  const budgets = new Map(budgetRows.rows.map(row => [str(row, 'category'), val(row, 'limit_minor')]));
  const categories = [...categoryMap].map(([name, amountMinor]) => ({ name, amountMinor, budgetMinor: budgets.get(name) ?? null }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
  for (const [name, budgetMinor] of budgets) if (!categoryMap.has(name)) categories.push({ name, amountMinor: 0, budgetMinor });
  const merchants = [...merchantMap].map(([name, amountMinor]) => ({ name, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor);
  const breakdownFor = (start: number, end: number): Breakdown => {
    const categoryTotals = new Map<string, number>();
    const merchantTotals = new Map<string, number>();
    for (const tx of transactions.filter(item => item.occurredAt >= start && item.occurredAt < end)) {
      const amount = personalAmount(tx);
      for (const allocation of categoryAmounts(tx, amount))
        categoryTotals.set(allocation.category, (categoryTotals.get(allocation.category) ?? 0) + allocation.amountMinor);
      merchantTotals.set(tx.merchant, (merchantTotals.get(tx.merchant) ?? 0) + amount);
    }
    for (const item of externalPersonal.filter(x => x.createdAt >= start && x.createdAt < end)) {
      categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + item.personalMinor);
      merchantTotals.set(item.person, (merchantTotals.get(item.person) ?? 0) + item.personalMinor);
    }
    return { totalMinor: sumPeriod(start, end),
      categories: [...categoryTotals].map(([name, amountMinor]) => ({ name, amountMinor: Math.max(0, amountMinor), budgetMinor: null }))
        .sort((a, b) => b.amountMinor - a.amountMinor),
      merchants: [...merchantTotals].map(([name, amountMinor]) => ({ name, amountMinor: Math.max(0, amountMinor) }))
        .sort((a, b) => b.amountMinor - a.amountMinor) };
  };
  const breakdowns = { today: breakdownFor(todayStart, now + 1), week: breakdownFor(weekStart, now + 1),
    month: { totalMinor: personalSpentMinor, categories, merchants } };
  const goals: Goal[] = goalRows.rows.map(row => ({ id: str(row, 'id'), name: str(row, 'name'),
    targetMinor: val(row, 'target_minor'), allocatedMinor: val(row, 'allocated_minor'),
    dueMonthKey: row.due_month_key == null ? null : str(row, 'due_month_key') }));
  const bills = billRows.rows.map(row => ({ id: str(row, 'id'), name: str(row, 'name'), amountMinor: val(row, 'amount_minor'),
    dueDay: val(row, 'due_day'), accountId: row.account_id == null ? null : str(row, 'account_id'),
    kind: str(row, 'kind') as Bill['kind'],
    doneThisMonth: str(row, 'last_done_month') === `${new Date(now).getFullYear()}-${String(new Date(now).getMonth() + 1).padStart(2, '0')}` }));
  const primary = accounts.find(x => x.id === primarySetting && x.type === 'bank') ??
    accounts.find(x => x.type === 'bank') ?? null;
  const cashFlow = cashFlowSummaries(allTransactions, primary?.id ?? null, now);
  const balanceRow = primary ? await db.execute(
    'SELECT received_at FROM sms_balance_snapshots WHERE account_id = ? ORDER BY received_at DESC LIMIT 1', [primary.id]) : null;
  const primaryBalanceAsOf = balanceRow?.rows.length ? val(balanceRow.rows[0], 'received_at') : null;
  const primaryBalanceStale = primaryBalanceAsOf == null || now - primaryBalanceAsOf > 48 * 60 * 60 * 1000;
  const daysInMonth = Math.round((nextMonth - monthStart) / 86_400_000);
  const elapsedDays = Math.max(1, new Date(now).getDate());
  const daysRemaining = Math.max(1, daysInMonth - elapsedDays + 1);
  const approvedBillsDue = bills.filter(bill => bill.kind === 'debit' && !bill.doneThisMonth &&
    (!bill.accountId || bill.accountId === primary?.id))
    .reduce((sum, bill) => sum + bill.amountMinor, 0);
  const monthlyBudget = monthlyBudgetSetting == null ? null : Number(monthlyBudgetSetting);
  const savingsGuide = calculateSavingsGuide({ goals, receivedIncomeMinor: incomeMinor,
    hasSelectedIncome: incomeCandidates.some(item => item.assignedMonthKey === currentMonthKey),
    expectedIncomeMinor: expectedIncomeRows.rows.length ? val(expectedIncomeRows.rows[0], 'amount_minor') : null,
    personalSpentMinor, monthlyBudgetMinor: monthlyBudget, today: new Date(now) });
  const safeToSpendMinor = calculateSafeToSpend({ bankBalanceMinor: primaryBalanceStale ? null : primary?.reportedBalanceMinor ?? null,
    minimumMinor: primary?.minimumBalanceMinor ?? 0,
    allocatedGoalsMinor: goals.reduce((sum, goal) => sum + goal.allocatedMinor, 0),
    upcomingBillsMinor: approvedBillsDue, monthlyBudgetMinor: monthlyBudget,
    personalSpentMinor });
  const rawByDay = new Map<string, { count: number; flagged: number; latest: number }>();
  for (const row of rawRows.rows) {
    const day = dayKey(val(row, 'occurred_at'));
    const current = rawByDay.get(day) ?? { count: 0, flagged: 0, latest: 0 };
    current.count += 1;
    if (str(row, 'review_status') !== 'confirmed') current.flagged += 1;
    current.latest = Math.max(current.latest, val(row, 'created_at'));
    rawByDay.set(day, current);
  }
  if (!rawByDay.has(dayKey(now))) rawByDay.set(dayKey(now), { count: 0, flagged: 0, latest: 0 });
  const completed = new Map(reviewRows.rows.map(row => [str(row, 'day_key'), val(row, 'completed_at')]));
  const reviewDays = [...rawByDay].map(([day, info]) => ({ day, count: info.count, flagged: info.flagged,
    completed: completed.has(day) && (completed.get(day) ?? 0) >= info.latest })).sort((a, b) => b.day.localeCompare(a.day));
  const baselineStart = todayStart - 28 * 86_400_000;
  const baselineTxs = transactions.filter(tx => expense(tx) && tx.occurredAt >= baselineStart && tx.occurredAt < todayStart);
  const baselineReady = baselineTxs.length >= 8 &&
    (Math.max(...baselineTxs.map(tx => tx.occurredAt)) - Math.min(...baselineTxs.map(tx => tx.occurredAt))) >= 14 * 86_400_000;
  const amounts = baselineTxs.map(tx => personalAmount(tx)).filter(x => x > 0);
  const typical = median(amounts);
  const unusual = baselineReady ? transactions.filter(tx => expense(tx) && tx.occurredAt >= monthStart &&
    personalAmount(tx) > Math.max(100_000, typical * 3)).map(tx => ({ label: tx.merchant, amountMinor: personalAmount(tx) })) : [];
  if (baselineReady) {
    const dailyBaseline = new Map<string, number>();
    for (const tx of baselineTxs) dailyBaseline.set(dayKey(tx.occurredAt),
      (dailyBaseline.get(dayKey(tx.occurredAt)) ?? 0) + personalAmount(tx));
    const typicalDay = median([...dailyBaseline.values()].filter(x => x > 0));
    const currentDays = new Map<string, number>();
    for (const tx of transactions.filter(item => item.occurredAt >= monthStart && item.occurredAt < nextMonth)) {
      currentDays.set(dayKey(tx.occurredAt), (currentDays.get(dayKey(tx.occurredAt)) ?? 0) + personalAmount(tx));
    }
    for (const [day, amountMinor] of currentDays) {
      if (amountMinor > Math.max(200_000, typicalDay * 2.5)) unusual.push({ label: `${day} daily total`, amountMinor });
    }
  }
  const repaymentSuggestions = transactions.filter(tx => tx.kind === 'credit' && !repaidByTransaction.has(tx.id)).flatMap(tx => {
    const matches = obligations.filter(obligation => obligation.direction === 'receivable' && obligation.remainingMinor > 0 &&
      obligation.person.toLowerCase() === tx.merchant.toLowerCase() && tx.amountMinor <= obligation.remainingMinor);
    return matches.length === 1 ? [{ transactionId: tx.id, obligationId: matches[0].id, amountMinor: tx.amountMinor }] : [];
  });
  return { personalSpentMinor, bankOutflowMinor, incomeMinor, cashFlow, cashFlowAsOf: now,
    previousMonthSpentMinor: sumPeriod(previousMonth, monthStart), weekSpentMinor: sumPeriod(weekStart, now + 1),
    previousWeekSpentMinor: sumPeriod(weekStart - 7 * 86_400_000, weekStart),
    todaySpentMinor: sumPeriod(todayStart, now + 1), yesterdaySpentMinor: sumPeriod(todayStart - 86_400_000, todayStart),
    projectedMonthMinor: Math.round(personalSpentMinor * daysInMonth / elapsedDays),
    paceRatio: monthlyBudget && monthlyBudget > 0 ? (personalSpentMinor / monthlyBudget) / (elapsedDays / daysInMonth) : null,
    unusual, baselineReady, categories, merchants, breakdowns, months, goals, bills, obligations, reviewDays,
    savingsGuide,
    safeToSpendMinor, safePerDayMinor: safeToSpendMinor == null ? null : Math.floor(safeToSpendMinor / daysRemaining),
    primaryAccountId: primary?.id ?? null, primaryAccountName: primary?.name ?? null, primaryBalanceAsOf, primaryBalanceStale,
    repaymentSuggestions, automaticMatches, incomeCandidates };
}

export async function setIncomeAssignment(
  transactionId: string,
  monthKey: string | null,
): Promise<void> {
  await initializeDatabase();
  const db = getDatabaseHandle();
  const result = await db.execute(`SELECT kind, amount_minor, source, review_status
    FROM transactions WHERE id = ? AND duplicate_of IS NULL`, [transactionId]);
  if (!result.rows.length || str(result.rows[0], 'kind') !== 'credit' || val(result.rows[0], 'amount_minor') <= 0 ||
    str(result.rows[0], 'source') === 'demo' ||
    (str(result.rows[0], 'source') === 'notification' && str(result.rows[0], 'review_status') !== 'confirmed')) {
    throw new Error('Choose a confirmed incoming credit');
  }
  if (monthKey === null) {
    await db.execute('DELETE FROM income_assignments WHERE transaction_id = ?', [transactionId]);
    return;
  }
  if (!validIncomeMonth(monthKey)) throw new Error('Invalid income month');
  await db.execute(`INSERT INTO income_assignments (transaction_id, month_key, created_at)
    VALUES (?, ?, ?) ON CONFLICT(transaction_id)
    DO UPDATE SET month_key = excluded.month_key, created_at = excluded.created_at`,
  [transactionId, monthKey, Date.now()]);
}

export async function setPrimaryAccount(accountId: string): Promise<void> {
  const accounts = await getAccounts();
  if (!accounts.some(account => account.id === accountId && account.type === 'bank'))
    throw new Error('Choose a bank account');
  await setAppSetting('primary_account_id', accountId);
}

export async function setCategoryBudget(category: string, amountMinor: number | null): Promise<void> {
  const db = getDatabaseHandle();
  if (amountMinor == null) { await db.execute('DELETE FROM budgets WHERE category = ?', [category]); return; }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('Enter a positive budget');
  await db.execute(`INSERT INTO budgets (id, category, limit_minor, month_key) VALUES (?, ?, ?, '*')
    ON CONFLICT(category) DO UPDATE SET limit_minor = excluded.limit_minor`, [uid('budget'), category, amountMinor]);
}

export async function createGoal(name: string, targetMinor: number, allocatedMinor: number, months: number): Promise<void> {
  if (!name.trim() || !Number.isSafeInteger(targetMinor) || targetMinor <= 0 ||
    !Number.isSafeInteger(allocatedMinor) || allocatedMinor < 0 || allocatedMinor > targetMinor) {
    throw new Error('Check goal values');
  }
  const dueMonthKey = dueMonthForDuration(new Date(), months);
  await getDatabaseHandle().execute(`INSERT INTO savings_goals
    (id, name, target_minor, allocated_minor, created_at, due_month_key) VALUES (?, ?, ?, ?, ?, ?)`,
  [uid('goal'), name.trim().slice(0, 60), targetMinor, allocatedMinor, Date.now(), dueMonthKey]);
}
export async function allocateGoal(id: string, allocatedMinor: number): Promise<void> {
  const db = getDatabaseHandle();
  const row = await db.execute('SELECT target_minor FROM savings_goals WHERE id = ?', [id]);
  if (!row.rows.length || !Number.isSafeInteger(allocatedMinor) || allocatedMinor < 0 ||
    allocatedMinor > val(row.rows[0], 'target_minor')) throw new Error('Check allocation');
  await db.execute('UPDATE savings_goals SET allocated_minor = ? WHERE id = ?', [allocatedMinor, id]);
}
export async function setGoalTarget(id: string, targetMinor: number): Promise<void> {
  const db = getDatabaseHandle();
  const row = await db.execute('SELECT allocated_minor FROM savings_goals WHERE id = ?', [id]);
  if (!row.rows.length || !Number.isSafeInteger(targetMinor) || targetMinor <= 0 ||
    targetMinor < val(row.rows[0], 'allocated_minor')) throw new Error('Target must cover the reserved amount');
  await db.execute('UPDATE savings_goals SET target_minor = ? WHERE id = ?', [targetMinor, id]);
}
export async function setGoalDeadline(id: string, months: number): Promise<void> {
  const dueMonthKey = dueMonthForDuration(new Date(), months);
  const result = await getDatabaseHandle().execute('UPDATE savings_goals SET due_month_key = ? WHERE id = ?', [dueMonthKey, id]);
  if (Number(result.rowsAffected ?? 0) !== 1) throw new Error('Goal not found');
}
export async function setExpectedSavingsIncome(monthKey: string, amountMinor: number | null): Promise<void> {
  if (!validIncomeMonth(monthKey) || monthKey !== monthKeyFor(Date.now())) {
    throw new Error('Choose the current month');
  }
  const db = getDatabaseHandle();
  if (amountMinor === null) {
    await db.execute('DELETE FROM savings_income_estimates WHERE month_key = ?', [monthKey]);
    return;
  }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('Enter an expected income above zero');
  await db.execute(`INSERT INTO savings_income_estimates (month_key, amount_minor) VALUES (?, ?)
    ON CONFLICT(month_key) DO UPDATE SET amount_minor = excluded.amount_minor`, [monthKey, amountMinor]);
}
export async function deleteGoal(id: string): Promise<void> {
  await getDatabaseHandle().execute('DELETE FROM savings_goals WHERE id = ?', [id]);
}
function validatedBill(name: string, amountMinor: number, dueDay: number): { name: string; amountMinor: number; dueDay: number } {
  const cleanName = name.trim();
  if (!cleanName || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
    !Number.isSafeInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new Error('Enter a name, positive amount, and day from 1 to 31');
  }
  return { name: cleanName.slice(0, 60), amountMinor, dueDay };
}

export async function createBill(name: string, amountMinor: number, dueDay: number, accountId: string | null, kind: 'debit' | 'credit' = 'debit'): Promise<void> {
  const bill = validatedBill(name, amountMinor, dueDay);
  await getDatabaseHandle().execute('INSERT INTO recurring_bills (id, name, amount_minor, due_day, account_id, active, created_at, kind) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    [uid('bill'), bill.name, bill.amountMinor, bill.dueDay, accountId, Date.now(), kind]);
}
export async function updateBill(id: string, name: string, amountMinor: number, dueDay: number): Promise<void> {
  const bill = validatedBill(name, amountMinor, dueDay);
  const result = await getDatabaseHandle().execute(
    'UPDATE recurring_bills SET name = ?, amount_minor = ?, due_day = ? WHERE id = ? AND active = 1',
    [bill.name, bill.amountMinor, bill.dueDay, id]);
  if (Number(result.rowsAffected ?? 0) !== 1) throw new Error('Recurring item not found');
}
export async function deleteBill(id: string): Promise<void> {
  await getDatabaseHandle().execute('DELETE FROM recurring_bills WHERE id = ?', [id]);
}
export async function markBillDone(id: string, done: boolean): Promise<void> {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await getDatabaseHandle().execute('UPDATE recurring_bills SET last_done_month = ? WHERE id = ?',
    [done ? monthKey : null, id]);
}
export async function markDayReviewed(day: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid day');
  await getDatabaseHandle().execute(`INSERT INTO review_days VALUES (?, ?)
    ON CONFLICT(day_key) DO UPDATE SET completed_at = excluded.completed_at`, [day, Date.now()]);
}

export async function getTransactionSplit(transactionId: string): Promise<TransactionSplit | null> {
  const db = getDatabaseHandle();
  const [split, people] = await Promise.all([
    db.execute('SELECT personal_minor FROM transaction_splits WHERE transaction_id = ?', [transactionId]),
    db.execute('SELECT person, amount_minor FROM split_people WHERE transaction_id = ? ORDER BY person COLLATE NOCASE', [transactionId]),
  ]);
  if (!split.rows.length) return null;
  return { personalMinor: val(split.rows[0], 'personal_minor'),
    people: people.rows.map(row => ({ name: str(row, 'person'), amountMinor: val(row, 'amount_minor') })) };
}

export async function splitTransaction(transactionId: string, people: Array<{ name: string; amountMinor: number }>): Promise<void> {
  const db = getDatabaseHandle();
  const result = await db.execute('SELECT amount_minor, kind, occurred_at, source, review_status FROM transactions WHERE id = ? AND duplicate_of IS NULL', [transactionId]);
  if (!result.rows.length || val(result.rows[0], 'amount_minor') >= 0 || str(result.rows[0], 'kind') !== 'debit' ||
    str(result.rows[0], 'source') === 'demo') throw new Error('Choose a confirmed debit payment');
  if (str(result.rows[0], 'source') === 'notification' && str(result.rows[0], 'review_status') !== 'confirmed')
    throw new Error('Confirm this notification before splitting it');
  const gross = Math.abs(val(result.rows[0], 'amount_minor'));
  const names = people.map(person => person.name.trim());
  const owed = people.reduce((sum, person) => sum + person.amountMinor, 0);
  if (!people.length || names.some(name => !name) || new Set(names.map(x => x.toLowerCase())).size !== names.length ||
    people.some(person => !Number.isSafeInteger(person.amountMinor) || person.amountMinor <= 0) || owed > gross) throw new Error('Invalid split');
  const personalMinor = splitPersonalMinor(gross, people.map(person => person.amountMinor));
  const existingRepayments = await db.execute(`SELECT r.id FROM repayments r JOIN obligations o ON o.id = r.obligation_id
    WHERE o.transaction_id = ? LIMIT 1`, [transactionId]);
  if (existingRepayments.rows.length) throw new Error('A repayment exists; this split cannot be replaced');
  await db.transaction(async tx => {
    await tx.execute('DELETE FROM obligations WHERE transaction_id = ?', [transactionId]);
    await tx.execute('DELETE FROM split_people WHERE transaction_id = ?', [transactionId]);
    await tx.execute(`INSERT INTO transaction_splits (transaction_id, personal_minor) VALUES (?, ?)
      ON CONFLICT(transaction_id) DO UPDATE SET personal_minor = excluded.personal_minor`, [transactionId, personalMinor]);
    for (const person of people) {
      await tx.execute('INSERT INTO split_people VALUES (?, ?, ?)', [transactionId, person.name.trim(), person.amountMinor]);
      await tx.execute(`INSERT INTO obligations (id, person, direction, amount_minor,
        personal_minor, transaction_id, created_at, category) VALUES (?, ?, ?, ?, 0, ?, ?, 'Other')`,
        [uid('debt'), person.name.trim(), 'receivable', person.amountMinor, transactionId, val(result.rows[0], 'occurred_at')]);
    }
  });
}
export async function removeTransactionSplit(transactionId: string): Promise<void> {
  const db = getDatabaseHandle();
  const existingRepayments = await db.execute(`SELECT r.id FROM repayments r JOIN obligations o ON o.id = r.obligation_id
    WHERE o.transaction_id = ? LIMIT 1`, [transactionId]);
  if (existingRepayments.rows.length) throw new Error('A repayment exists; this split cannot be removed');
  await db.transaction(async tx => {
    await tx.execute('DELETE FROM obligations WHERE transaction_id = ?', [transactionId]);
    await tx.execute('DELETE FROM split_people WHERE transaction_id = ?', [transactionId]);
    await tx.execute('DELETE FROM transaction_splits WHERE transaction_id = ?', [transactionId]);
  });
}
export async function addExpensePaidByOther(person: string, yourShareMinor: number, category = 'Other'): Promise<void> {
  if (!person.trim() || !Number.isSafeInteger(yourShareMinor) || yourShareMinor <= 0) throw new Error('Check expense');
  await getDatabaseHandle().execute(`INSERT INTO obligations (id, person, direction,
    amount_minor, personal_minor, transaction_id, created_at, category) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    [uid('debt'), person.trim(), 'payable', yourShareMinor, yourShareMinor, Date.now(), category]);
}
export async function recordRepayment(obligationId: string, amountMinor: number, transactionId: string | null): Promise<void> {
  const db = getDatabaseHandle();
  const result = await db.execute('SELECT amount_minor FROM obligations WHERE id = ?', [obligationId]);
  if (!result.rows.length) throw new Error('Debt not found');
  const paid = await db.execute('SELECT COALESCE(SUM(amount_minor), 0) AS paid FROM repayments WHERE obligation_id = ?', [obligationId]);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > val(result.rows[0], 'amount_minor') - val(paid.rows[0], 'paid')) throw new Error('Repayment exceeds balance');
  if (transactionId) {
    const tx = await db.execute('SELECT amount_minor FROM transactions WHERE id = ?', [transactionId]);
    if (!tx.rows.length || Math.abs(val(tx.rows[0], 'amount_minor')) < amountMinor) throw new Error('Payment amount does not match');
    const alreadyApplied = await db.execute('SELECT COALESCE(SUM(amount_minor), 0) AS paid FROM repayments WHERE transaction_id = ?', [transactionId]);
    if (val(alreadyApplied.rows[0], 'paid') + amountMinor > Math.abs(val(tx.rows[0], 'amount_minor'))) throw new Error('Payment already fully applied');
  }
  await db.execute(`INSERT INTO repayments
    (id, obligation_id, transaction_id, amount_minor, created_at, origin)
    VALUES (?, ?, ?, ?, ?, 'manual')`,
  [uid('repay'), obligationId, transactionId, amountMinor, Date.now()]);
}
