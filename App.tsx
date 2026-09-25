import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  createCategory,
  getCategories,
  getAppSetting,
  getVendorDefaultCategory,
  getDashboard,
  getAllTransactions,
  getPotentialDuplicateTargets,
  getAccounts,
  getManualDuplicateTargets,
  initializeDatabase,
  removeDemoData,
  resolveNotificationDuplicate,
  resolveManualDuplicate,
  setTransferStatus,
  renameVendorForTransaction,
  saveVendorProfile,
  setTransactionCategory,
  setTransactionCategorySplits,
  setTransactionNote,
  setAccountMinimumBalance,
  setMonthlyBudget,
  setAppSetting,
} from './src/data/database';
import { getCaptureHealth, type CaptureHealth } from './src/data/captureHealth';
import {
  getFinanceSnapshot,
  getTransactionSplit,
  reconcileAutomaticRepayments,
  recordRepayment,
  removeTransactionSplit,
  setIncomeAssignment,
  splitTransaction,
  undoAutomaticRepayment,
  type Breakdown,
  type FinanceSnapshot,
  type IncomeCandidate,
  type TransactionSplit,
} from './src/data/finance';
import {
  calculateWeeklyBudgetPlan,
  resolveDailySpendingSnapshot,
} from './src/features/budget/plan';
import { FinanceHub } from './src/features/finance/FinanceHub';
import { groupPendingExpenses } from './src/features/finance/pending';
import { suggestPeople } from './src/features/finance/personSuggestions';
import { buildSharedSplit, parseShareAmount } from './src/features/finance/sharedSplit';
import { ManualEntryEditor } from './src/features/transactions/ManualEntryEditor';
import { buildCategorySplit } from './src/features/transactions/categorySplit';
import {
  filterActivityByType,
  filterActivityRows,
  filterHomeActivityRows,
  homeActivityPage,
  paginateActivityRows,
  type ActivityPeriod,
  type HomeMoneyView,
  type TransactionFilter,
} from './src/features/transactions/activitySearch';
import { compareMonthlyIncomeAndSpending, monthKeyFor, recentIncomeCandidates, sortIncomeCandidatesByAmount, totalAssignedIncome } from './src/features/finance/incomeMonth';
import { cashFlowTransactions, summarizeCashFlow, type CashFlowPeriod, type CashFlowSummary } from './src/features/finance/cashFlow';
import { parseReminderTime } from './src/features/notifications/reviewReminder';
import {
  groupVendorTransactions,
  groupVendorsNeedingReview,
  isUnidentifiedCredit,
  normalizedVendorKey,
  type VendorGroup,
} from './src/data/reviewGroups';
import {
  importRecentInbox,
  resetLocalData,
  syncSmsData,
} from './src/features/sms/importer';
import { TransactionSms } from './src/native/TransactionSms';
import type { Account, Dashboard, Transaction } from './src/types';
import { Icon, type IconName } from './src/ui/Icon';
import { ProgressBar, ScreenHeader, SectionHeader, Surface } from './src/ui/primitives';
import { colors, radii, shadows, spacing, typeScale } from './src/ui/theme';

const C = {
  ...colors,
  orange: '#C9793D',
  red: colors.danger,
};
type Tab = 'home' | 'transactions' | 'finance' | 'analytics';
type Route = Tab | 'settings';
const money = (n: number, compact = false) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: compact ? 0 : 2,
    notation: compact ? 'compact' : 'standard',
  }).format(n / 100);
const ageLabel = (time: number) => {
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  return minutes < 60 ? `${minutes} min ago` : minutes < 1440
    ? `${Math.floor(minutes / 60)} hr ago` : `${Math.floor(minutes / 1440)} day${minutes >= 2880 ? 's' : ''} ago`;
};

const getDailySpendingForToday = async (
  balanceMinor: number | null,
  monthlyBudgetMinor: number | null,
  minimumBalanceMinor: number | null,
  accountId: string | null,
  today: Date,
): Promise<number | null> => {
  const saved = await getAppSetting('daily_spending_snapshot_v1');
  let existing: unknown = null;
  try {
    existing = saved == null ? null : JSON.parse(saved);
  } catch {
    // Invalid cached data is replaced below.
  }
  const snapshot = resolveDailySpendingSnapshot(
    existing,
    balanceMinor,
    monthlyBudgetMinor,
    minimumBalanceMinor,
    accountId,
    today,
  );
  if (snapshot == null) return null;
  const serialized = JSON.stringify(snapshot);
  if (serialized !== saved) {
    await setAppSetting('daily_spending_snapshot_v1', serialized);
  }
  return snapshot.amountMinor;
};
const catColor = (name: string) =>
  ({
    Food: C.orange,
    Shopping: C.purple,
    Transport: C.blue,
    Bills: '#70B89B',
    Health: '#E17478',
    Entertainment: '#E5BD52',
    Laundry: '#5AAFC4',
  }[name] ??
  ['#5AAFC4', '#AA8CD8', '#DB9073', '#79B396', '#CCA954'][
    [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 5
  ]);

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <PaisaApp />
    </SafeAreaProvider>
  );
}

function PaisaApp() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Route>('home');
  const [transactionFilter, setTransactionFilter] =
    useState<TransactionFilter>('All');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [finance, setFinance] = useState<FinanceSnapshot | null>(null);
  const [captureHealth, setCaptureHealth] = useState<CaptureHealth | null>(null);
  const [planMode, setPlanMode] = useState<'Planning' | 'Shared' | 'Review'>('Planning');
  const [focusedTransactionId, setFocusedTransactionId] = useState<string | null>(null);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const resetInProgress = useRef(false);
  const vendorReviewCount = useMemo(
    () => groupVendorsNeedingReview(transactions).length,
    [transactions],
  );
  const knownPeople = useMemo(() => [
    ...transactions.filter(tx => tx.source !== 'demo').map(tx => tx.merchant),
    ...(finance?.obligations.map(item => item.person) ?? []),
  ], [transactions, finance?.obligations]);
  const refresh = useCallback((spinner = false): Promise<void> => {
    if (resetInProgress.current) return Promise.resolve();
    if (refreshInFlight.current) return refreshInFlight.current;
    const work = (async () => {
      if (spinner) setRefreshing(true);
      try {
        await initializeDatabase();
        await syncSmsData();
        await reconcileAutomaticRepayments();
        const t = await getAllTransactions();
        const [d, categories, financeSnapshot, accountRows, health] = await Promise.all([
          getDashboard(t.filter(tx => tx.source !== 'demo')),
          getCategories(),
          getFinanceSnapshot(),
          getAccounts(),
          getCaptureHealth(),
        ]);
        const primaryAccount = accountRows.find(account => account.id === financeSnapshot.primaryAccountId) ?? null;
        const today = new Date();
        const plan = d.monthlyBudgetMinor != null
          ? calculateWeeklyBudgetPlan(d.monthlyBudgetMinor, financeSnapshot.personalSpentMinor, today)
          : null;
        const dailyTarget = await getDailySpendingForToday(
          primaryAccount?.reportedBalanceMinor ?? null,
          d.monthlyBudgetMinor,
          primaryAccount?.minimumBalanceMinor ?? null,
          primaryAccount?.id ?? null,
          today,
        );
        setDashboard({ ...d, balanceMinor: primaryAccount?.reportedBalanceMinor ?? null,
          balanceIsReported: primaryAccount?.reportedBalanceMinor != null,
          balanceAsOf: financeSnapshot.primaryBalanceAsOf,
          balanceAccountId: primaryAccount?.id ?? null,
          spentMinor: financeSnapshot.personalSpentMinor, incomeMinor: financeSnapshot.incomeMinor,
          budgetRemainingMinor: plan?.remainingMinor ?? null, budgetOverageMinor: plan?.overBudgetMinor ?? null,
          dailyTargetMinor: dailyTarget,
          weeklyPaceMinor: plan?.weeklyPaceMinor ?? null,
          categories: financeSnapshot.categories.map(item => ({ category: item.name, amountMinor: item.amountMinor })),
          months: financeSnapshot.months });
        setTransactions(t);
        setFinance(financeSnapshot);
        setAccounts(accountRows);
        setCaptureHealth(health);
        setAvailableCategories(categories);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to open local data');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    })();
    refreshInFlight.current = work;
    work.then(() => {
      refreshInFlight.current = null;
    });
    return work;
  }, []);
  const resetData = useCallback(async (): Promise<void> => {
    if (resetInProgress.current) return;
    resetInProgress.current = true;
    try {
      if (refreshInFlight.current) await refreshInFlight.current;
      await resetLocalData();
      setTab('home');
      setTransactionFilter('All');
    } finally {
      resetInProgress.current = false;
    }
    await refresh();
  }, [refresh]);
  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, 15000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [tab]);
  if (loading)
    return (
      <View style={s.center}>
        <View style={s.logo}>
          <Text style={s.logoText}>₹</Text>
        </View>
        <Text style={s.loadingTitle}>Opening your private ledger</Text>
        <ActivityIndicator color={C.primary} style={s.loader} />
      </View>
    );
  if (error || !dashboard)
    return (
      <View style={s.center}>
        <Text style={s.errorIcon}>!</Text>
        <Text style={s.loadingTitle}>Couldn’t open Expense Tracker</Text>
        <Text style={s.errorText}>{error}</Text>
        <Button label="Try again" onPress={() => refresh()} />
      </View>
    );
  const content = {
    home: (
      <Home
        d={dashboard}
        finance={finance}
        accounts={accounts}
        captureHealth={captureHealth}
        transactions={transactions}
        knownPeople={knownPeople}
        categories={availableCategories}
        vendorReviewCount={vendorReviewCount}
        onChanged={() => refresh()}
        onOpenSettings={() => setTab('settings')}
        onOpenPlan={() => { setPlanMode('Planning'); setTab('finance'); }}
        onReview={() => {
          setTransactionFilter('Review');
          setTab('transactions');
        }}
        onDailyReview={() => { setPlanMode('Review'); setTab('finance'); }}
        onOpenActivity={() => {
          setTransactionFilter('All');
          setTab('transactions');
        }}
      />
    ),
    transactions: (
      <Transactions
        rows={transactions}
        finance={finance}
        accounts={accounts}
        knownPeople={knownPeople}
        categories={availableCategories}
        initialFilter={transactionFilter}
        focusedTransactionId={focusedTransactionId}
        onCloseFocused={() => setFocusedTransactionId(null)}
        onFilterChange={setTransactionFilter}
        onOpenSettings={() => setTab('settings')}
        onChanged={() => refresh()}
      />
    ),
    analytics: (
      <Analytics d={dashboard} finance={finance} transactions={transactions}
        onOpenSettings={() => setTab('settings')} onOpenHome={() => setTab('home')}
        onOpenPlan={() => { setPlanMode('Planning'); setTab('finance'); }}
        onOpenTransaction={transactionId => { setFocusedTransactionId(transactionId); setTab('transactions'); }} />
    ),
    finance: finance ? (
      <FinanceHub data={finance} transactions={transactions} accounts={accounts}
        categories={availableCategories} onChanged={() => refresh()} requestedMode={planMode}
        onOpenSettings={() => setTab('settings')}
        onOpenTransaction={transactionId => {
          setFocusedTransactionId(transactionId);
          setTransactionFilter('All');
          setTab('transactions');
        }} />
    ) : null,
    settings: (
      <Settings
        d={dashboard}
        health={captureHealth}
        categories={availableCategories}
        onChanged={() => refresh()}
        onReset={resetData}
        onBack={() => setTab('home')}
      />
    ),
  }[tab];
  return (
    <View style={[s.app, { paddingTop: insets.top }]}>
      {tab === 'transactions' ? <View style={s.activityScreen}>{content}</View> : <ScrollView
        style={s.mainScroll}
        ref={scrollRef}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => refresh(true)}
            tintColor={C.primary}
          />
        }
      >
        {content}
      </ScrollView>}
      {tab !== 'settings' && <TabBar selected={tab} onSelect={next => {
        if (next === 'finance') setPlanMode('Planning');
        setTab(next);
      }} bottom={insets.bottom} />}
    </View>
  );
}

function Header({ eyebrow, title, onProfile, onBack }: {
  eyebrow: string;
  title: string;
  onProfile?: () => void;
  onBack?: () => void;
}) {
  return <ScreenHeader eyebrow={eyebrow} title={title} onProfile={onProfile} onBack={onBack} />;
}

function Home({
  d,
  finance,
  accounts,
  captureHealth,
  transactions,
  knownPeople,
  categories,
  vendorReviewCount,
  onChanged,
  onOpenSettings,
  onOpenPlan,
  onReview,
  onDailyReview,
  onOpenActivity,
}: {
  d: Dashboard;
  finance: FinanceSnapshot | null;
  accounts: Account[];
  captureHealth: CaptureHealth | null;
  transactions: Transaction[];
  knownPeople: string[];
  categories: string[];
  vendorReviewCount: number;
  onChanged: () => Promise<void> | void;
  onOpenSettings: () => void;
  onOpenPlan: () => void;
  onReview: () => void;
  onDailyReview: () => void;
  onOpenActivity: () => void;
}) {
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualEditing, setManualEditing] = useState<Transaction | null>(null);
  const [moneyView, setMoneyView] = useState<HomeMoneyView>('spending');
  const [snapshotPeriod, setSnapshotPeriod] = useState<CashFlowPeriod>('today');
  const [activityPage, setActivityPage] = useState(0);
  const homeAsOf = finance?.cashFlowAsOf ?? Date.now();
  const periodTransactions = filterHomeActivityRows(
    transactions,
    snapshotPeriod,
    'netflow',
    homeAsOf,
  );
  const pagedActivity = homeActivityPage(
    transactions,
    snapshotPeriod,
    moneyView,
    homeAsOf,
    activityPage,
  );
  const spendingCategories = new Map<string, number>();
  for (const tx of periodTransactions.filter(item => item.amountMinor < 0)) {
    spendingCategories.set(tx.category,
      (spendingCategories.get(tx.category) ?? 0) + Math.abs(tx.amountMinor));
  }
  const snapshot: Breakdown = {
    totalMinor: periodTransactions.filter(tx => tx.amountMinor < 0)
      .reduce((sum, tx) => sum + Math.abs(tx.amountMinor), 0),
    categories: [...spendingCategories].map(([name, amountMinor]) => ({
      name,
      amountMinor,
      budgetMinor: null,
    })).sort((left, right) => right.amountMinor - left.amountMinor),
    merchants: [],
  };
  const creditedTransactions = periodTransactions.filter(tx => tx.amountMinor > 0);
  const netFlow = summarizeCashFlow(periodTransactions);
  const currentAccount = d.accountProtections.find(
    account => account.accountId === d.balanceAccountId,
  );
  const currentMonthKey = monthKeyFor(Date.now());
  const hasSelectedIncome = finance?.incomeCandidates.some(
    item => item.assignedMonthKey === currentMonthKey,
  ) ?? false;
  const incomeComparison = compareMonthlyIncomeAndSpending(
    d.incomeMinor, d.spentMinor, hasSelectedIncome,
  );
  const missedReviewDays = finance?.reviewDays.filter(day => !day.completed).length ?? 0;
  const missingNoteCount = transactions.filter(tx => tx.source !== 'demo' && tx.reviewStatus === 'confirmed' &&
    tx.kind !== 'transfer' && !(tx.note ?? '').trim()).length;
  const upcomingBillCount = finance?.bills.filter(item => !item.doneThisMonth && item.kind === 'debit').length ?? 0;
  const attentionCount = missingNoteCount + vendorReviewCount + missedReviewDays + upcomingBillCount;
  const budgetProgress = d.monthlyBudgetMinor && d.monthlyBudgetMinor > 0
    ? Math.min(1, d.spentMinor / d.monthlyBudgetMinor) : 0;
  const captureWarning = captureHealth?.smsPermission !== 'granted' ? 'SMS detection is off' :
    captureHealth.selectedApps > 0 && captureHealth.notificationAccess !== 'granted' ? 'Payment-app alerts are off' :
      captureHealth.pendingSms + captureHealth.pendingNotifications > 0 ? 'Transaction alerts are waiting to be processed' : null;
  return (
    <>
      <Header eyebrow="Your money today" title="Overview" onProfile={onOpenSettings} />
      <View style={s.balanceCard}>
        <View style={s.balanceTop}>
          <Text style={s.darkMuted}>{finance?.safeToSpendMinor == null ? 'BANK BALANCE' : 'SAFE TO SPEND'}</Text>
          <View style={s.privatePill}>
            <Text style={s.privateText}>● LOCAL ONLY</Text>
          </View>
        </View>
        <Text style={s.balance}>{finance?.safeToSpendMinor == null
          ? d.balanceMinor == null ? 'Unavailable' : money(d.balanceMinor)
          : money(finance.safeToSpendMinor)}</Text>
        <Text style={s.balanceCaption}>
          {finance?.safeToSpendMinor != null
            ? `${finance.safePerDayMinor == null ? 'Based on your available balance' : `${money(finance.safePerDayMinor)} per day`} · after goals, minimums and upcoming bills`
            : d.balanceIsReported && d.balanceAsOf
            ? `${Date.now() - d.balanceAsOf! > 48 * 60 * 60 * 1000 ? 'Stale bank SMS' : 'Bank SMS'} · ${ageLabel(d.balanceAsOf!)} · ${new Date(d.balanceAsOf!).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}`
            : d.balanceIsReported
              ? 'Bank-reported balance · timestamp unavailable'
            : 'No bank-reported balance for the primary account'}
        </Text>
        <View style={s.summaryRow}>
          <Metric label="INCOME THIS MONTH" value={d.incomeMinor} positive />
          <View style={s.summaryDivider} />
          <Metric label="SPENT THIS MONTH" value={d.spentMinor} />
        </View>
        <Pressable onPress={() => setIncomeOpen(true)} accessibilityRole="button"
          style={s.manageIncomeButton}>
          <Text style={s.manageIncomeText}>Choose income transactions ›</Text>
        </Pressable>
      </View>
      {captureHealth && captureWarning && <Pressable onPress={onOpenSettings} accessibilityRole="button"
        style={s.captureWarning}><Text style={s.captureWarningText}>{captureWarning} · Check settings ›</Text></Pressable>}
      <View style={s.homeActions}>
        <Pressable onPress={() => { setManualEditing(null); setManualOpen(true); }} accessibilityRole="button"
          style={({ pressed }) => [s.quickAdd, pressed && s.pressed]}>
          <Icon name="plus" size={18} color={C.primary} />
          <Text style={s.quickAddText}>Add transaction</Text>
        </Pressable>
        <Pressable onPress={onOpenActivity} accessibilityRole="button"
          style={({ pressed }) => [s.secondaryAction, pressed && s.pressed]}>
          <Icon name="activity" size={18} color={C.primary} />
          <Text style={s.secondaryActionText}>View activity</Text>
        </Pressable>
      </View>
      <Section title="Needs attention" action={attentionCount ? `${attentionCount} ITEMS` : 'ALL CLEAR'} />
      <Surface style={s.attentionCard}>
        {missingNoteCount > 0 && <AttentionRow icon="note" title="Add transaction notes"
          detail={`${missingNoteCount} transaction${missingNoteCount === 1 ? '' : 's'} without context`}
          onPress={onOpenActivity} />}
        {vendorReviewCount > 0 && <AttentionRow icon="alert" title="Review vendor categories"
          detail={`${vendorReviewCount} vendor group${vendorReviewCount === 1 ? '' : 's'} need classification`}
          onPress={onReview} />}
        {missedReviewDays > 0 && <AttentionRow icon="calendar" title="Finish daily review"
          detail={`${missedReviewDays} day${missedReviewDays === 1 ? '' : 's'} waiting`}
          onPress={onDailyReview} />}
        {upcomingBillCount > 0 && <AttentionRow icon="calendar" title="Upcoming commitments"
          detail={`${upcomingBillCount} bill${upcomingBillCount === 1 ? '' : 's'} not marked paid`}
          onPress={onOpenPlan} />}
        {attentionCount === 0 && <View style={s.allClear}>
          <View style={s.allClearIcon}><Text style={s.allClearMark}>✓</Text></View>
          <View style={s.flex}><Text style={s.reviewTitle}>You’re caught up</Text>
            <Text style={s.reviewText}>No transactions or bills need attention today.</Text></View>
        </View>}
      </Surface>
      <Pressable onPress={() => setIncomeOpen(true)} accessibilityRole="button"
        accessibilityLabel="Income versus spending this month. Choose income transactions"
        style={s.incomeComparisonCard}>
        <Text style={s.planLabel}>INCOME VS SPENDING · THIS MONTH</Text>
        <Text style={[s.incomeComparisonValue,
          incomeComparison.status === 'shortfall' && s.incomeComparisonShortfall]}>
          {incomeComparison.status === 'unavailable'
            ? 'Select income to compare'
            : incomeComparison.status === 'even'
              ? 'Break-even'
              : `${money(Math.abs(incomeComparison.differenceMinor ?? 0))} ${incomeComparison.status}`}
        </Text>
        <Text style={s.incomeComparisonNote}>
          {incomeComparison.status === 'unavailable'
            ? 'Choose which credited transactions count as income to see your monthly surplus or shortfall.'
            : 'Selected income minus your personal spending. This is not your bank balance.'}
        </Text>
      </Pressable>
      {finance && finance.savingsGuide.status !== 'no_goals' &&
      <Pressable onPress={onOpenPlan} accessibilityRole="button"
        accessibilityLabel="Open savings goals and spending limits" style={s.incomeComparisonCard}>
        <Text style={s.planLabel}>SAVINGS GOALS · SPENDING GUIDE</Text>
        {finance.savingsGuide.status === 'ready' ? <>
          <Text style={s.incomeComparisonValue}>
            {money(finance.savingsGuide.dailyLimitMinor ?? 0)} / day · {money(finance.savingsGuide.weeklyLimitMinor ?? 0)} / 7 days
          </Text>
          <Text style={s.incomeComparisonNote}>
            {finance.savingsGuide.incomeSource === 'estimate' ? 'Estimates' : 'Based on received income'}
            {' · '}{money(finance.savingsGuide.requiredSavingsMinor)} to save this month
            {finance.savingsGuide.savingsShortfallMinor > 0
              ? ` · ${money(finance.savingsGuide.savingsShortfallMinor)} income shortfall` : ''}
            {finance.savingsGuide.spendingOverageMinor > 0
              ? ` · ${money(finance.savingsGuide.spendingOverageMinor)} over spending limit` : ''}
            {finance.savingsGuide.overdueGoals > 0 ? ' · Overdue goal included' : ''}
          </Text>
        </> : <>
          <Text style={s.incomeComparisonValue}>Add expected income</Text>
          <Text style={s.incomeComparisonNote}>
            Choose received income or enter an estimate in your money plan.
          </Text>
        </>}
      </Pressable>}
      <Pressable
        onPress={onOpenSettings}
        style={({ pressed }) => [s.planCard, pressed && s.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Set account minimum balance and monthly budget"
      >
        <View style={s.planItem}>
          <Text style={s.planLabel}>ABOVE ACCOUNT MINIMUM</Text>
          <Text
            style={[
              s.planValue,
              currentAccount?.aboveMinimumMinor != null &&
                currentAccount.aboveMinimumMinor < 0 &&
                s.planDanger,
            ]}
          >
            {currentAccount?.aboveMinimumMinor == null
              ? 'Set minimum'
              : currentAccount.aboveMinimumMinor < 0
                ? `${money(Math.abs(currentAccount.aboveMinimumMinor))} below`
                : `${money(currentAccount.aboveMinimumMinor)} above`}
          </Text>
          <Text style={s.planHint}>
            {currentAccount?.lastFour
              ? `Account •${currentAccount.lastFour}`
              : 'Configure each account in Settings'}
          </Text>
        </View>
        <View style={s.planItem}>
          <Text style={s.planLabel}>MAXIMUM DAILY SPENDING</Text>
          <Text style={s.planValue}>
            {d.dailyTargetMinor == null
              ? d.balanceMinor == null
                ? 'Balance unavailable'
                : 'Set minimum'
              : `${money(d.dailyTargetMinor)} / day`}
          </Text>
          <Text style={s.planHint}>
            {d.monthlyBudgetMinor != null
              ? `Keeps ${money(d.monthlyBudgetMinor)} reserved through month end`
              : 'Stays above your minimum through month end'}
          </Text>
        </View>
      </Pressable>
      {d.monthlyBudgetMinor != null && <Surface style={s.monthlyProgressCard}>
        <View style={s.monthlyProgressTop}>
          <View><Text style={s.planLabel}>MONTHLY PROGRESS</Text>
            <Text style={s.monthlyProgressValue}>{money(d.spentMinor)} spent</Text></View>
          <Text style={s.monthlyProgressMeta}>{Math.round(budgetProgress * 100)}%</Text>
        </View>
        <ProgressBar progress={budgetProgress} />
        <Text style={s.incomeComparisonNote}>{money(Math.max(0, d.monthlyBudgetMinor - d.spentMinor))} remaining of {money(d.monthlyBudgetMinor)}</Text>
      </Surface>}
      <Section title="Money snapshot" action="CHOOSE A VIEW" />
      <View style={s.homePeriodRow}>
        {([
          ['today', 'Daily'],
          ['week', 'This week'],
          ['month', 'This month'],
        ] as const).map(([value, label]) => (
          <Pressable
            key={value}
            onPress={() => { setSnapshotPeriod(value); setActivityPage(0); }}
            accessibilityRole="button"
            accessibilityState={{ selected: snapshotPeriod === value }}
            style={[s.filterPill, snapshotPeriod === value && s.filterActive]}
          >
            <Text style={[s.filterText, snapshotPeriod === value && s.filterTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.homeMetricRow}>
        {([['spending', 'Spending'], ['income', 'Income'], ['netflow', 'Net flow']] as const).map(([value, label]) =>
          <Pressable key={value} onPress={() => { setMoneyView(value); setActivityPage(0); }} accessibilityRole="button"
            accessibilityState={{ selected: moneyView === value }}
            style={[s.homeMetricPill, moneyView === value && s.filterActive]}>
            <Text style={[s.filterText, moneyView === value && s.filterTextActive]}>{label}</Text>
          </Pressable>)}
      </View>
      {moneyView === 'spending' ? <View style={s.card}>
        <CategorySnapshot breakdown={snapshot} />
      </View> : moneyView === 'income' ? <IncomeSnapshot rows={creditedTransactions} period={snapshotPeriod} /> :
        <CashFlowCard summary={netFlow} accountName="All accounts" onChooseAccount={onOpenPlan} />}
      <Section title="Activity" action={`${pagedActivity.total} TRANSACTIONS`} />
      <View style={s.cardFlat}>
        {pagedActivity.rows.map((tx, i) => (
          <TransactionRow
            key={tx.id}
            tx={tx}
            last={i === pagedActivity.rows.length - 1}
            onPress={() => setSelected(tx)}
          />
        ))}
        {pagedActivity.total === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>{moneyView === 'spending' ? 'No debited transactions' :
              moneyView === 'income' ? 'No credited transactions' : 'No transactions'}</Text>
            <Text style={s.emptyText}>Try another time period or view.</Text>
          </View>
        )}
      </View>
      {pagedActivity.pageCount > 1 && <View style={s.activityPagination}>
        <Pressable onPress={() => setActivityPage(Math.max(0, pagedActivity.page - 1))}
          disabled={pagedActivity.page === 0} accessibilityRole="button"
          accessibilityState={{ disabled: pagedActivity.page === 0 }}
          style={[s.paginationButton, pagedActivity.page === 0 && s.paginationButtonDisabled]}>
          <Text style={s.paginationButtonText}>‹ Previous</Text>
        </Pressable>
        <Text style={s.paginationLabel}>Page {pagedActivity.page + 1} of {pagedActivity.pageCount}</Text>
        <Pressable onPress={() => setActivityPage(Math.min(pagedActivity.pageCount - 1, pagedActivity.page + 1))}
          disabled={pagedActivity.page === pagedActivity.pageCount - 1} accessibilityRole="button"
          accessibilityState={{ disabled: pagedActivity.page === pagedActivity.pageCount - 1 }}
          style={[s.paginationButton, pagedActivity.page === pagedActivity.pageCount - 1 && s.paginationButtonDisabled]}>
          <Text style={s.paginationButtonText}>Next ›</Text>
        </Pressable>
      </View>}
      <Pressable onPress={onOpenActivity} accessibilityRole="button" style={s.homeActivityLink}>
        <Text style={s.homeActivityLinkText}>View all activity →</Text>
      </Pressable>
      <CategoryEditor
        transaction={selected}
        knownPeople={knownPeople}
        categories={categories}
        vendorGroup={groupVendorTransactions(transactions).find(group => group.transactions.some(tx => tx.id === selected?.id))}
        onSelectTransaction={setSelected}
        onClose={() => setSelected(null)}
        onSaved={onChanged}
        onEditManual={tx => { setSelected(null); setManualEditing(tx); setManualOpen(true); }}
      />
      <ManualEntryEditor visible={manualOpen} transaction={manualEditing} accounts={accounts} categories={categories}
        onClose={() => setManualOpen(false)} onSaved={onChanged} />
      <IncomeMonthEditor visible={incomeOpen} candidates={finance?.incomeCandidates ?? []}
        onClose={() => setIncomeOpen(false)} onChanged={onChanged} />
    </>
  );
}
function IncomeMonthEditor({
  visible,
  candidates,
  onClose,
  onChanged,
}: {
  visible: boolean;
  candidates: IncomeCandidate[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  useEffect(() => {
    if (visible) setSearch('');
  }, [visible]);
  const now = Date.now();
  const monthKey = monthKeyFor(now);
  const monthLabel = new Date(now).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const monthName = (key: string) => {
    const [year, number] = key.split('-').map(Number);
    return new Date(year, number - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  };
  const total = totalAssignedIncome(candidates, monthKey);
  const recent = sortIncomeCandidatesByAmount(recentIncomeCandidates(candidates, now));
  const recentIds = new Set(recent.map(item => item.id));
  const olderSelected = candidates.filter(item => item.assignedMonthKey === monthKey && !recentIds.has(item.id));
  const query = search.trim().toLocaleLowerCase();
  const filtered = [...recent.map(candidate => ({ candidate, older: false })),
    ...olderSelected.map(candidate => ({ candidate, older: true }))]
    .filter(({ candidate }) => candidate.merchant.toLocaleLowerCase().includes(query));
  const change = async (id: string, assignment: string | null) => {
    setSavingId(id);
    try {
      await setIncomeAssignment(id, assignment);
      await onChanged();
    } catch (error) {
      Alert.alert('Could not update income', error instanceof Error ? error.message : 'Please try again.');
    } finally { setSavingId(null); }
  };
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={[s.incomeModal, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 12 }]}>
      <View style={s.incomeModalHeader}>
        <View><Text style={s.eyebrow}>MONTHLY INCOME</Text><Text style={s.pageTitle}>Choose credits</Text></View>
        <Pressable onPress={onClose} accessibilityRole="button" style={s.smallButton}>
          <Text style={s.smallButtonText}>Done</Text>
        </Pressable>
      </View>
      <View style={s.incomeTotalCard}>
        <Text style={s.planLabel}>INCOME COUNTED IN {monthLabel.toLocaleUpperCase()}</Text>
        <Text style={s.incomeTotalValue}>{money(total)}</Text>
        <Text style={s.pendingNote}>Credits are not counted automatically. Choose this month's income below; the total resets on the 1st. Bank balances stay unchanged.</Text>
      </View>
      <TextInput value={search} onChangeText={setSearch} placeholder="Search credits by sender or vendor"
        placeholderTextColor="#9DA8A1" style={s.incomeSearch} accessibilityLabel="Search income credits" />
      <Text style={s.incomeWindowNote}>Choose credits received from today back 30 days, including last month's credits.</Text>
      <FlatList data={filtered} keyExtractor={item => item.candidate.id} extraData={`${monthKey}:${savingId}`}
        keyboardShouldPersistTaps="handled" contentContainerStyle={s.incomeList}
        ListEmptyComponent={<Text style={s.emptyText}>No eligible incoming credits found.</Text>}
        renderItem={({ item: row }) => {
          const item = row.candidate;
          const selected = item.assignedMonthKey === monthKey;
          const status = row.older ? `Selected earlier for ${monthLabel}` : item.assignedMonthKey == null
            ? 'Not counted as income' : `Counted in ${monthName(item.assignedMonthKey)}`;
          return <View style={s.incomeCandidate}>
            <Pressable onPress={row.older ? undefined : () => change(item.id, selected ? null : monthKey)}
              disabled={savingId != null || row.older} accessibilityRole={row.older ? 'text' : 'checkbox'}
              accessibilityState={row.older ? undefined : { checked: selected }} style={s.incomeCandidateMain}>
              {!row.older && <View style={[s.incomeCheckbox, selected && s.incomeCheckboxSelected]}>
                {selected && <Text style={s.incomeCheckmark}>✓</Text>}
              </View>}
              <View style={s.flex}>
                <Text style={s.pendingPersonName} numberOfLines={1}>{item.merchant}</Text>
                <Text style={s.pendingMeta}>{new Date(item.occurredAt).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })} · {status}</Text>
              </View>
              <Text style={s.pendingPersonAmount}>{money(item.amountMinor)}</Text>
            </Pressable>
            {row.older && <Pressable disabled={savingId != null}
              onPress={() => change(item.id, null)}
              accessibilityRole="button" style={s.incomeResetButton}>
              <Text style={s.incomeResetText}>Remove from this month's income</Text>
            </Pressable>}
          </View>;
        }} />
    </View>
  </Modal>;
}
function Metric({
  label,
  value,
  positive = false,
}: {
  label: string;
  value: number;
  positive?: boolean;
}) {
  return (
    <View style={s.flex}>
      <Text style={s.darkMuted}>{label}</Text>
      <Text style={s.metricValue}>
        {positive ? '+' : '−'}
        {money(value)}
      </Text>
    </View>
  );
}

function InsightMetric({ label, value, tone = 'default' }: {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'danger';
}) {
  return <View style={s.insightMetric}>
    <Text style={s.insightMetricLabel}>{label}</Text>
    <Text numberOfLines={1} adjustsFontSizeToFit style={[s.insightMetricValue,
      tone === 'positive' && s.positive, tone === 'danger' && s.planDanger]}>{value}</Text>
  </View>;
}

function CashFlowCard({ summary, accountName, onChooseAccount, onInflow, onOutflow }: {
  summary: CashFlowSummary | null;
  accountName: string | null;
  onChooseAccount: () => void;
  onInflow?: () => void;
  onOutflow?: () => void;
}) {
  if (!summary) return <View style={s.cashFlowCard}>
    <Text style={s.cashFlowValue}>Choose a primary bank</Text>
    <Text style={s.cashFlowNote}>Cash flow is available once a bank account is selected.</Text>
    <Pressable onPress={onChooseAccount} accessibilityRole="button" style={s.cashFlowAction}>
      <Text style={s.homeActivityLinkText}>Open money plan ›</Text>
    </Pressable>
  </View>;
  const netLabel = summary.netMinor > 0 ? 'net inflow' : summary.netMinor < 0 ? 'net outflow' : 'net movement';
  return <View style={s.cashFlowCard}>
    <Text style={s.planLabel}>{accountName?.toUpperCase() ?? 'PRIMARY BANK'} · RECORDED MOVEMENTS</Text>
    <Text style={[s.cashFlowValue, summary.netMinor < 0 && s.cashFlowNegative]}>
      {summary.netMinor > 0 ? '+' : summary.netMinor < 0 ? '−' : ''}{money(Math.abs(summary.netMinor))} {netLabel}
    </Text>
    <View style={s.cashFlowTotals}>
      <Pressable onPress={onInflow} disabled={!onInflow} accessibilityRole={onInflow ? 'button' : undefined}
        style={s.flex}><Text style={s.cashFlowCaption}>MONEY IN{onInflow ? ' ›' : ''}</Text>
        <Text style={s.cashFlowIn}>+{money(summary.inflowMinor)}</Text></Pressable>
      <Pressable onPress={onOutflow} disabled={!onOutflow} accessibilityRole={onOutflow ? 'button' : undefined}
        style={s.flex}><Text style={s.cashFlowCaption}>MONEY OUT{onOutflow ? ' ›' : ''}</Text>
        <Text style={s.cashFlowOut}>−{money(summary.outflowMinor)}</Text></Pressable>
    </View>
    <Text style={s.cashFlowNote}>Includes tracked bank transfers and repayments. Not your bank balance or personal spending.</Text>
  </View>;
}

function IncomeSnapshot({ rows, period }: {
  rows: Transaction[];
  period: CashFlowPeriod;
}) {
  const totalMinor = rows.reduce((sum, item) => sum + Math.max(0, item.amountMinor), 0);
  const visible = [...rows].sort((left, right) => right.amountMinor - left.amountMinor).slice(0, 4);
  return <View style={s.cashFlowCard}>
    <Text style={s.planLabel}>CREDITED TRANSACTIONS · {period === 'today' ? 'TODAY' :
      period === 'week' ? 'THIS WEEK' : 'THIS MONTH'}</Text>
    <Text style={s.cashFlowValue}>+{money(totalMinor)}</Text>
    <Text style={s.cashFlowNote}>All confirmed credits received during this period.</Text>
    {visible.length ? <View style={s.incomeSnapshotList}>{visible.map(item =>
      <View key={item.id} style={s.incomeSnapshotRow}>
        <Text style={s.incomeSnapshotName} numberOfLines={1}>{item.merchant}</Text>
        <Text style={s.incomeSnapshotAmount}>+{money(item.amountMinor)}</Text>
      </View>)}
      {rows.length > visible.length && <Text style={s.cashFlowNote}>+ {rows.length - visible.length} more credit{rows.length - visible.length === 1 ? '' : 's'}</Text>}
    </View> : <Text style={s.cashFlowNote}>No credited transactions in this period.</Text>}
  </View>;
}

function CategorySnapshot({ breakdown }: { breakdown: Breakdown }) {
  const visible = breakdown.categories.filter(item => item.amountMinor > 0).slice(0, 4),
    ringTotal = Math.max(breakdown.totalMinor, breakdown.categories.reduce((sum, item) => sum + Math.max(0, item.amountMinor), 0)),
    circ = 2 * Math.PI * 42;
  let offset = 0;
  return (
    <View style={s.snapshot}>
      <View style={s.donutWrap}>
        <Svg width={116} height={116} viewBox="0 0 116 116">
          <Circle
            cx="58"
            cy="58"
            r="42"
            stroke={C.line}
            strokeWidth="14"
            fill="none"
          />
          {visible.map(x => {
            const seg = ringTotal
              ? (x.amountMinor / ringTotal) * circ
              : 0;
            const el = (
              <Circle
                key={x.name}
                cx="58"
                cy="58"
                r="42"
                stroke={catColor(x.name)}
                strokeWidth="14"
                fill="none"
                strokeDasharray={`${seg} ${circ - seg}`}
                strokeDashoffset={-offset}
                rotation="-90"
                origin="58, 58"
              />
            );
            offset += seg;
            return el;
          })}
        </Svg>
        <View style={s.donutCenter}>
          <Text style={s.donutValue}>{money(breakdown.totalMinor, true)}</Text>
          <Text style={s.donutLabel}>SPENT</Text>
        </View>
      </View>
      <View style={s.legend}>
        {visible.map(x => (
          <View key={x.name} style={s.legendRow}>
            <View
              style={[s.legendDot, { backgroundColor: catColor(x.name) }]}
            />
            <Text style={s.legendLabel}>{x.name}</Text>
            <Text style={s.legendValue}>{money(x.amountMinor, true)}</Text>
          </View>
        ))}
        {visible.length === 0 && <Text style={s.legendLabel}>No spending in this period</Text>}
      </View>
    </View>
  );
}

function Transactions({
  rows,
  finance,
  accounts,
  knownPeople,
  categories,
  initialFilter,
  focusedTransactionId,
  onCloseFocused,
  onFilterChange,
  onOpenSettings,
  onChanged,
}: {
  rows: Transaction[];
  finance: FinanceSnapshot | null;
  accounts: Account[];
  knownPeople: string[];
  categories: string[];
  initialFilter: TransactionFilter;
  focusedTransactionId: string | null;
  onCloseFocused: () => void;
  onFilterChange: (filter: TransactionFilter) => void;
  onOpenSettings: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [view, setView] = useState<'transactions' | 'pending'>('transactions');
  const [filter, setFilter] = useState<TransactionFilter>(initialFilter);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<ActivityPeriod>('all');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualEditing, setManualEditing] = useState<Transaction | null>(null);
  useEffect(() => setFilter(initialFilter), [initialFilter]);
  useEffect(() => { if (initialFilter === 'Review') setView('transactions'); }, [initialFilter]);
  const peopleByTransaction = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const obligation of finance?.obligations ?? []) {
      if (!obligation.transactionId) continue;
      result.set(obligation.transactionId, [...(result.get(obligation.transactionId) ?? []), obligation.person]);
    }
    return result;
  }, [finance?.obligations]);
  const filtered = useMemo(() => filterActivityRows(
    filterActivityByType(rows, filter),
    { query: search, accountId, period, now: Date.now(), peopleByTransaction }),
  [filter, rows, search, accountId, period, peopleByTransaction]);
  const vendorGroups = useMemo(() => groupVendorsNeedingReview(filtered), [filtered]);
  const pagedTransactions = useMemo(() => paginateActivityRows(filtered, page), [filtered, page]);
  const pagedVendorGroups = useMemo(() => paginateActivityRows(vendorGroups, page), [vendorGroups, page]);
  const activePage = filter === 'Review' ? pagedVendorGroups : pagedTransactions;
  useEffect(() => setPage(0), [view, filter, search, period, accountId]);
  const allVendorGroups = useMemo(() => groupVendorTransactions(rows), [rows]);
  const vendorByTransactionId = useMemo(() => {
    const lookup = new Map<string, VendorGroup>();
    for (const group of allVendorGroups) for (const tx of group.transactions) lookup.set(tx.id, group);
    return lookup;
  }, [allVendorGroups]);
  const hasActiveFilters = filter !== 'All' || search.trim().length > 0 ||
    period !== 'all' || accountId !== null;
  const clearFilters = () => {
    setFilter('All');
    onFilterChange('All');
    setSearch('');
    setPeriod('all');
    setAccountId(null);
  };
  const pendingCount = groupPendingExpenses(finance?.obligations ?? [], rows).length;
  const [selected, setSelected] = useState<Transaction | null>(null);
  useEffect(() => {
    if (focusedTransactionId) setSelected(rows.find(row => row.id === focusedTransactionId) ?? null);
  }, [focusedTransactionId, rows]);
  return (
    <View style={s.activityBody}>
      <View style={s.activityHeader}>
        <View style={s.flex}>
          <Text style={s.eyebrow}>YOUR MONEY HISTORY</Text>
          <Text style={s.pageTitle}>Activity</Text>
        </View>
        <View style={s.activityHeaderActions}>
          <Pressable onPress={() => { setManualEditing(null); setManualOpen(true); }} accessibilityRole="button"
            accessibilityLabel="Add transaction" style={({ pressed }) => [s.activityAdd, pressed && s.pressed]}>
            <Icon name="plus" size={18} color={C.surface} /><Text style={s.activityAddText}>Add</Text></Pressable>
          <Pressable onPress={onOpenSettings} accessibilityRole="button" accessibilityLabel="Open settings"
            style={({ pressed }) => [s.activityProfile, pressed && s.pressed]}><Text style={s.avatarText}>E</Text></Pressable>
        </View>
      </View>
      <View style={s.activityTabs}>
        {([
          ['transactions', 'Transactions'],
          ['pending', `Pending${pendingCount ? ` (${pendingCount})` : ''}`],
        ] as const).map(([item, label]) => (
          <Pressable key={item} onPress={() => setView(item)} accessibilityRole="tab"
            accessibilityState={{ selected: view === item }}
            style={[s.activityTab, view === item && s.activityTabActive]}>
            <Text style={[s.activityTabText, view === item && s.activityTabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {view === 'pending' ? <ScrollView contentContainerStyle={s.activityListContent}>
        <PendingExpenses finance={finance} rows={rows} onChanged={onChanged}
          onOpenTransaction={transaction => setSelected(transaction)} />
      </ScrollView> : <>
      <View style={s.activityControls}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.activityChipRow}>
          {(['All', 'Expenses', 'Income', 'Review'] as const).map(x => (
            <Pressable key={x} onPress={() => { setFilter(x); onFilterChange(x); }}
              accessibilityRole="button" accessibilityState={{ selected: filter === x }}
              style={[s.filterPill, filter === x && s.filterActive]}>
              <Text style={[s.filterText, filter === x && s.filterTextActive]}>{x}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={s.activitySearchWrap}><Icon name="search" size={19} color={C.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search merchant, note or person"
            placeholderTextColor={C.muted} style={s.activitySearch} accessibilityLabel="Search transactions" />
        </View>
        <Text style={s.activityFilterLabel}>DATE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.activityChipRow}>
          {([['all', 'Any date'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month']] as const).map(([key, label]) =>
            <Pressable key={key} onPress={() => setPeriod(key)} accessibilityRole="button" accessibilityState={{ selected: period === key }}
              style={[s.filterPill, period === key && s.filterActive]}><Text style={[s.filterText, period === key && s.filterTextActive]}>{label}</Text></Pressable>)}
        </ScrollView>
        {accounts.length > 1 && <>
          <Text style={s.activityFilterLabel}>ACCOUNT</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.activityChipRow}>
            <Pressable onPress={() => setAccountId(null)} accessibilityRole="button" accessibilityState={{ selected: accountId == null }}
              style={[s.filterPill, accountId == null && s.filterActive]}><Text style={[s.filterText, accountId == null && s.filterTextActive]}>All accounts</Text></Pressable>
            {accounts.map(account => <Pressable key={account.id} onPress={() => setAccountId(account.id)} accessibilityRole="button"
              accessibilityState={{ selected: accountId === account.id }} style={[s.filterPill, accountId === account.id && s.filterActive]}>
              <Text style={[s.filterText, accountId === account.id && s.filterTextActive]}>{account.name}</Text></Pressable>)}
          </ScrollView>
        </>}
      </View>
      <View style={s.activityResultRow}>
        <Text style={s.resultCount}>
          {activePage.total === 0 ? '0' : `${activePage.page * 10 + 1}–${Math.min((activePage.page + 1) * 10, activePage.total)} OF ${activePage.total}`} {filter === 'Review' ? 'VENDORS' : 'TRANSACTIONS'}
        </Text>
        {hasActiveFilters && <Pressable onPress={clearFilters} accessibilityRole="button"
          accessibilityLabel="Clear transaction filters" style={s.activityClearFilters}>
          <Text style={s.activityClearFiltersText}>Clear filters</Text>
        </Pressable>}
      </View>
      {filter === 'Review' ? <FlatList data={pagedVendorGroups.rows} keyExtractor={item => item.key} style={s.activityList}
        contentContainerStyle={s.activityListContent} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<View style={s.card}><Empty title={rows.length ? 'Nothing needs review' : 'No transactions yet'}
          detail={rows.length ? 'All matching payments are classified. Try another search, date or account if needed.' : 'Add a transaction to start reviewing vendors.'}
          action={rows.length ? 'Clear filters' : 'Add transaction'}
          onAction={rows.length ? clearFilters : () => { setManualEditing(null); setManualOpen(true); }} /></View>}
        ListFooterComponent={<ActivityPagination page={pagedVendorGroups.page} pageCount={pagedVendorGroups.pageCount} onPage={setPage} />}
        renderItem={({ item, index }) => <View style={s.activityListRow}><VendorGroupRow group={item}
          last={index === pagedVendorGroups.rows.length - 1} onPress={() => setSelected(item.representative)} /></View>} /> :
      <FlatList data={pagedTransactions.rows} keyExtractor={item => item.id} style={s.activityList}
        contentContainerStyle={s.activityListContent} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<View style={s.card}><Empty
          title={rows.length === 0 ? 'No transactions yet' : 'No matching transactions'}
          detail={rows.length === 0
              ? 'Add a transaction manually, or enable transaction alerts in Settings.'
              : 'Try another search, date, account, or transaction type.'}
          action={rows.length === 0 ? 'Add transaction' : hasActiveFilters ? 'Clear filters' : undefined}
          onAction={rows.length === 0 ? () => { setManualEditing(null); setManualOpen(true); } :
            hasActiveFilters ? clearFilters : undefined} /></View>}
        ListFooterComponent={<ActivityPagination page={pagedTransactions.page} pageCount={pagedTransactions.pageCount} onPage={setPage} />}
        renderItem={({ item, index }) => <View style={s.activityListRow}><TransactionRow tx={item}
          last={index === pagedTransactions.rows.length - 1} onPress={() => setSelected(item)} /></View>} />}
      </>}
      <CategoryEditor
        transaction={selected}
        knownPeople={knownPeople}
        categories={categories}
        vendorGroup={vendorByTransactionId.get(selected?.id ?? '')}
        onSelectTransaction={setSelected}
        onClose={() => { setSelected(null); onCloseFocused(); }}
        onSaved={onChanged}
        onEditManual={tx => { setSelected(null); setManualEditing(tx); setManualOpen(true); }}
      />
      <ManualEntryEditor visible={manualOpen} transaction={manualEditing} accounts={accounts} categories={categories}
        onClose={() => setManualOpen(false)} onSaved={onChanged} />
    </View>
  );
}

function ActivityPagination({ page, pageCount, onPage }: {
  page: number; pageCount: number; onPage: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return <View style={s.activityPagination}>
    <Pressable onPress={() => onPage(page - 1)} disabled={page === 0} accessibilityRole="button"
      accessibilityLabel="Previous transaction page" accessibilityState={{ disabled: page === 0 }}
      style={[s.paginationButton, page === 0 && s.paginationButtonDisabled]}>
      <Text style={s.paginationButtonText}>‹ Previous</Text>
    </Pressable>
    <Text style={s.paginationLabel}>Page {page + 1} of {pageCount}</Text>
    <Pressable onPress={() => onPage(page + 1)} disabled={page === pageCount - 1} accessibilityRole="button"
      accessibilityLabel="Next transaction page" accessibilityState={{ disabled: page === pageCount - 1 }}
      style={[s.paginationButton, page === pageCount - 1 && s.paginationButtonDisabled]}>
      <Text style={s.paginationButtonText}>Next ›</Text>
    </Pressable>
  </View>;
}
function PendingExpenses({
  finance,
  rows,
  onChanged,
  onOpenTransaction,
}: {
  finance: FinanceSnapshot | null;
  rows: Transaction[];
  onChanged: () => Promise<void> | void;
  onOpenTransaction: (transaction: Transaction) => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const groups = groupPendingExpenses(finance?.obligations ?? [], rows);
  const toCollect = groups.flatMap(group => group.obligations)
    .filter(item => item.direction === 'receivable')
    .reduce((sum, item) => sum + item.remainingMinor, 0);
  const toPay = groups.flatMap(group => group.obligations)
    .filter(item => item.direction === 'payable')
    .reduce((sum, item) => sum + item.remainingMinor, 0);
  const rowsById = new Map(rows.map(row => [row.id, row]));
  const settled = (finance?.obligations ?? [])
    .filter(item => item.remainingMinor === 0 && item.paidMinor > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
  const obligationsById = new Map((finance?.obligations ?? []).map(item => [item.id, item]));
  const automaticByCredit = new Map<string, { amountMinor: number; obligationIds: string[] }>();
  for (const match of finance?.automaticMatches ?? []) {
    const current = automaticByCredit.get(match.transactionId) ?? { amountMinor: 0, obligationIds: [] };
    current.amountMinor += match.amountMinor;
    current.obligationIds.push(match.obligationId);
    automaticByCredit.set(match.transactionId, current);
  }
  const saveRepayment = async (id: string) => {
    const amountMinor = parseShareAmount(amounts[id] ?? '');
    if (amountMinor == null) {
      Alert.alert('Enter an amount', 'Enter the amount that was actually repaid.');
      return;
    }
    setSavingId(id);
    try {
      await recordRepayment(id, amountMinor, null);
      setAmounts(current => ({ ...current, [id]: '' }));
      await onChanged();
    } catch (error) {
      Alert.alert('Could not record repayment', error instanceof Error ? error.message : 'Please check the amount.');
    } finally {
      setSavingId(null);
    }
  };
  const undoMatch = (transactionId: string) => Alert.alert(
    'Undo automatic repayment?',
    'The amount will become pending again. This incoming payment will not be matched automatically in the future.',
    [
      { text: 'Cancel' },
      { text: 'Undo match', style: 'destructive', onPress: async () => {
        setSavingId(transactionId);
        try { await undoAutomaticRepayment(transactionId); await onChanged(); }
        catch (error) { Alert.alert('Could not undo match', error instanceof Error ? error.message : 'Please try again.'); }
        finally { setSavingId(null); }
      } },
    ],
  );
  return <>
    <View style={s.pendingSummary}>
      <View style={s.flex}><Text style={s.planLabel}>OTHERS OWE YOU</Text><Text style={s.pendingSummaryValue}>{money(toCollect)}</Text></View>
      <View style={s.flex}><Text style={s.planLabel}>YOU OWE OTHERS</Text><Text style={s.pendingSummaryValue}>{money(toPay)}</Text></View>
    </View>
    <Text style={s.resultCount}>{groups.length} PENDING EXPENSE{groups.length === 1 ? '' : 'S'}</Text>
    {groups.length === 0 && <View style={s.card}><Text style={s.emptyTitle}>Nothing pending</Text>
      <Text style={s.emptyText}>Open a debit transaction and choose “Share this expense” to track who owes you.</Text></View>}
    {groups.map(group => {
      const tx = group.transaction;
      const date = new Date(tx?.occurredAt ?? group.obligations[0].createdAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
      const ownShare = tx ? Math.max(0, Math.abs(tx.amountMinor) - group.originalMinor) : null;
      return <View key={group.id} style={s.pendingCard}>
        <Pressable disabled={!tx} onPress={() => tx && onOpenTransaction(tx)} accessibilityRole={tx ? 'button' : undefined}>
          <Text style={s.pendingTitle}>{tx?.merchant ?? `Expense paid by ${group.obligations[0].person}`}{tx ? ' ›' : ''}</Text>
          <Text style={s.pendingMeta}>{date}{tx ? ` · Bank payment ${money(Math.abs(tx.amountMinor))}` : ' · Manually recorded'}</Text>
          {ownShare != null && <Text style={s.pendingMeta}>Your share {money(ownShare)} · Others’ shares {money(group.originalMinor)}</Text>}
        </Pressable>
        {group.obligations.map(item => <View key={item.id} style={s.pendingPerson}>
          <View style={s.pendingPersonTop}>
            <Text style={s.pendingPersonName}>{item.direction === 'receivable' ? `${item.person} owes you` : `You owe ${item.person}`}</Text>
            <Text style={s.pendingPersonAmount}>{money(item.remainingMinor)}</Text>
          </View>
          <Text style={s.pendingMeta}>{money(item.paidMinor)} repaid of {money(item.amountMinor)}
            {item.automaticPaidMinor > 0 ? ` · ${money(item.automaticPaidMinor)} matched automatically` : ''}</Text>
          <View style={s.pendingRepaymentRow}>
            <TextInput value={amounts[item.id] ?? ''}
              onChangeText={value => setAmounts(current => ({ ...current, [item.id]: value }))}
              placeholder="Amount repaid (₹)" placeholderTextColor="#9DA8A1"
              accessibilityLabel={`Amount repaid by ${item.person} in rupees`}
              keyboardType="decimal-pad" style={s.pendingRepaymentInput} />
            <Pressable onPress={() => saveRepayment(item.id)} disabled={savingId != null}
              accessibilityRole="button" style={[s.smallButton, savingId != null && s.saveCategoryButtonDisabled]}>
              <Text style={s.smallButtonText}>{savingId === item.id ? 'Saving…' : 'Record'}</Text>
            </Pressable>
          </View>
          <Text style={s.pendingNote}>Matching incoming credits are applied automatically. Record only cash or off-ledger repayments here.</Text>
        </View>)}
      </View>;
    })}
    {settled.length > 0 && <>
      <Section title="Recently settled" action="PAID" />
      <View style={s.cardFlat}>{settled.map((item, index) => <View key={item.id}
        style={[s.pendingSettledRow, index !== settled.length - 1 && s.txBorder]}>
        <View style={s.flex}>
          <Text style={s.pendingPersonName}>{item.direction === 'receivable' ? `${item.person} paid you` : `Paid ${item.person}`}</Text>
          <Text style={s.pendingMeta}>{item.transactionId ? rowsById.get(item.transactionId)?.merchant ?? 'Shared expense' : 'Manually recorded expense'}
            {item.automaticPaidMinor > 0 ? ' · Automatically matched' : ' · Recorded repayment'}</Text>
        </View>
        <Text style={s.pendingPersonAmount}>{money(item.amountMinor)}</Text>
      </View>)}</View>
    </>}
    {automaticByCredit.size > 0 && <>
      <Section title="Automatic matches" action={`${automaticByCredit.size} PAYMENTS`} />
      {[...automaticByCredit].map(([transactionId, match]) => {
        const credit = rowsById.get(transactionId);
        const person = obligationsById.get(match.obligationIds[0])?.person ?? credit?.merchant ?? 'Someone';
        const sources = [...new Set(match.obligationIds.map(id => {
          const expenseId = obligationsById.get(id)?.transactionId;
          return expenseId ? rowsById.get(expenseId)?.merchant ?? 'Shared expense' : 'Shared expense';
        }))];
        return <View key={transactionId} style={s.pendingCard}>
          <Text style={s.pendingTitle}>{person} repaid {money(match.amountMinor)}</Text>
          <Text style={s.pendingMeta}>Applied to {sources.join(', ')}
            {credit ? ` · ${new Date(credit.occurredAt).toLocaleDateString('en-IN')}` : ''}</Text>
          <Pressable onPress={() => undoMatch(transactionId)} disabled={savingId != null}
            accessibilityRole="button" style={[s.smallButton, s.undoMatchButton, savingId != null && s.saveCategoryButtonDisabled]}>
            <Text style={s.smallButtonText}>{savingId === transactionId ? 'Undoing…' : 'Undo automatic match'}</Text>
          </Pressable>
        </View>;
      })}
    </>}
  </>;
}
function VendorGroupRow({ group, last, onPress }: {
  group: VendorGroup; last: boolean; onPress: () => void;
}) {
  const merchant = group.representative.merchant;
  return <Pressable onPress={onPress} accessibilityRole="button"
    accessibilityLabel={`${merchant}, ${group.count} transactions, ${group.needsReview} need review`}
    style={[s.txRow, !last && s.txBorder]}>
    <View style={[s.merchantIcon, { backgroundColor: `${catColor(group.representative.category)}22` }]}>
      <Text style={[s.merchantInitial, { color: catColor(group.representative.category) }]}>{merchant[0]?.toUpperCase()}</Text>
    </View>
    <View style={s.flex}>
      <View style={s.txTitleRow}><Text style={s.txTitle} numberOfLines={1}>{merchant}</Text>
        {group.needsReview > 0 && <View style={s.reviewDot} />}</View>
      <Text style={s.txMeta}>{group.count} transaction{group.count === 1 ? '' : 's'}
        {group.needsReview > 0 ? ` · ${group.needsReview} need review` : ''}
        {group.unverifiedCount > 0 ? ` · ${group.unverifiedCount} excluded from totals` : ''}</Text>
    </View>
    <View style={s.txRight}>
      {group.outgoingMinor > 0 && <Text style={s.txAmount}>−{money(group.outgoingMinor)}</Text>}
      {group.incomingMinor > 0 && <Text style={[s.txAmount, s.positive]}>+{money(group.incomingMinor)}</Text>}
      <Text style={s.classifyHint}>Name / default ›</Text>
    </View>
  </Pressable>;
}

function TransactionRow({
  tx,
  last,
  onPress,
  groupCount,
  groupTotalMinor,
}: {
  tx: Transaction;
  last: boolean;
  onPress?: () => void;
  groupCount?: number;
  groupTotalMinor?: number;
}) {
  const displayedAmount = groupTotalMinor ?? tx.amountMinor;
  const expense = displayedAmount < 0;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[s.txRow, !last && s.txBorder]}
    >
      <View
        style={[
          s.merchantIcon,
          { backgroundColor: `${catColor(tx.category)}22` },
        ]}
      >
        <Text style={[s.merchantInitial, { color: catColor(tx.category) }]}>
          {tx.merchant[0]?.toUpperCase()}
        </Text>
      </View>
      <View style={s.flex}>
        <View style={s.txTitleRow}>
          <Text style={s.txTitle} numberOfLines={1}>
            {tx.merchant}
          </Text>
          {tx.reviewStatus === 'review' && <View style={s.reviewDot} />}
        </View>
        <Text style={s.txMeta}>
          {tx.possibleDuplicate ? 'Possible duplicate · ' : ''}
          {tx.reviewStatus === 'awaiting_sender' ? 'Awaiting sender · ' : ''}
          {groupCount && groupCount > 1 ? `${groupCount} payments · ` : ''}
          {tx.source === 'notification' && tx.reviewStatus !== 'confirmed' ? 'Unverified alert · ' : ''}
          {tx.source === 'manual' ? 'Manual · ' : tx.source === 'sms' ? 'Bank SMS · ' : 'App alert · '}
          {tx.categorySplitCount && tx.categorySplitCount > 1 ? `${tx.categorySplitCount} categories` : tx.category} ·{' '}
          {new Intl.DateTimeFormat('en-IN', {
            day: 'numeric',
            month: 'short',
          }).format(tx.occurredAt)}
        </Text>
        {tx.note ? <Text style={s.txNote} numberOfLines={1}>Note: {tx.note}</Text> : null}
      </View>
      <View style={s.txRight}>
        <Text style={[s.txAmount, !expense && s.positive]}>
          {expense ? '−' : '+'}
          {money(Math.abs(displayedAmount))}
        </Text>
        {onPress && (
          <Text style={s.classifyHint}>
            {tx.reviewStatus === 'confirmed'
              ? 'Edit ›'
              : tx.reviewStatus === 'awaiting_sender'
                ? 'Add name ›'
                : 'Classify / edit ›'}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function CategoryEditor({
  transaction,
  knownPeople,
  categories,
  vendorGroup,
  onSelectTransaction,
  onClose,
  onSaved,
  onEditManual,
}: {
  transaction: Transaction | null;
  knownPeople: string[];
  categories: string[];
  vendorGroup?: VendorGroup;
  onSelectTransaction: (transaction: Transaction) => void;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onEditManual: (transaction: Transaction) => void;
}) {
  const [category, setCategory] = useState('Other');
  const [vendorCategory, setVendorCategory] = useState<string | null>(null);
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicateTargets, setDuplicateTargets] = useState<Transaction[]>([]);
  const [manualTargets, setManualTargets] = useState<Transaction[]>([]);
  const [existingSplit, setExistingSplit] = useState<TransactionSplit | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['Other']);
  const [categorySplitRows, setCategorySplitRows] = useState<Array<{ key: string; category: string; amount: string }>>([]);
  const [noteOpen, setNoteOpen] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shareRows, setShareRows] = useState<Array<{ key: string; name: string; amount: string }>>([]);
  const [activePersonKey, setActivePersonKey] = useState<string | null>(null);
  const cleanedMerchant = merchant.trim().replace(/\s+/g, ' ');
  const nameChanged =
    transaction != null && cleanedMerchant !== transaction.merchant;
  const noteChanged = transaction != null && note.trim() !== (transaction.note ?? '');
  const categoryChanged = transaction != null && selectedCategories.length === 1 &&
    (category !== transaction.category || Boolean(transaction.categorySplits?.length));
  const transactionId = transaction?.id;
  const merchantForDefault = transaction?.merchant;
  const selectedCategory = transaction?.category;
  const selectedCategorySplits = transaction?.categorySplits;
  const requiresMoreOptions = Boolean(transaction && (transaction.possibleDuplicate ||
    transaction.reviewStatus !== 'confirmed' || transaction.merchant === 'Unknown merchant' ||
    isUnidentifiedCredit(transaction.kind, transaction.merchant)));
  const shareEligible = transaction?.kind === 'debit' && transaction.amountMinor < 0 &&
    transaction.source !== 'demo' && (transaction.source !== 'notification' || transaction.reviewStatus === 'confirmed');
  const splitPreview = transaction ? buildSharedSplit(Math.abs(transaction.amountMinor), shareRows) : null;
  const categorySplitEligible = transaction != null && transaction.amountMinor < 0 &&
    transaction.kind !== 'transfer' && transaction.source !== 'demo';
  const categorySplitPreview = transaction ? buildCategorySplit(
    Math.abs(transaction.amountMinor), categories,
    categorySplitRows.map(row => ({ category: row.category, amount: row.amount })),
  ) : null;
  useEffect(() => {
    if (transactionId) {
      setCategory(selectedCategory ?? 'Other');
      setVendorCategory(null);
      setMerchant(
        ['Unknown merchant', 'Sender not provided', 'Money received'].includes(merchantForDefault ?? '')
          ? ''
          : merchantForDefault ?? '',
      );
      setNote(transaction?.note ?? '');
      setNoteOpen(true);
      setCategorySplitRows((selectedCategorySplits ?? []).map((item, index) => ({
        key: `${index}-${item.category}`, category: item.category, amount: String(item.amountMinor / 100),
      })));
      setSelectedCategories(selectedCategorySplits?.length
        ? selectedCategorySplits.map(item => item.category)
        : [selectedCategory ?? 'Other']);
      setMoreOpen(requiresMoreOptions);
      setSaveError(null);
    }
  }, [transactionId, merchantForDefault, selectedCategory, selectedCategorySplits, transaction?.note, requiresMoreOptions]);
  useEffect(() => {
    let active = true;
    if (merchantForDefault) {
      getVendorDefaultCategory(merchantForDefault).then(defaultCategory => {
        if (active) setVendorCategory(defaultCategory);
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [transactionId, merchantForDefault]);
  useEffect(() => {
    let active = true;
    setExistingSplit(null);
    setShareOpen(false);
    setShareRows([]);
    setActivePersonKey(null);
    if (transactionId) {
      getTransactionSplit(transactionId).then(split => {
        if (!active) return;
        setExistingSplit(split);
        if (split) setShareRows(split.people.map((person, index) => ({
          key: `${index}-${person.name}`,
          name: person.name,
          amount: String(person.amountMinor / 100),
        })));
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [transactionId]);
  useEffect(() => {
    let active = true;
    setDuplicateTargets([]);
    if (transaction?.source === 'notification') {
      getPotentialDuplicateTargets(transaction.id).then(targets => {
        if (active) setDuplicateTargets(targets);
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [transaction?.id, transaction?.source]);
  useEffect(() => {
    let active = true;
    setManualTargets([]);
    if (transaction?.source === 'manual' && transaction.possibleDuplicate) {
      getManualDuplicateTargets(transaction.id).then(targets => {
        if (active) setManualTargets(targets);
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [transaction?.id, transaction?.source, transaction?.possibleDuplicate]);
  const resolveAlert = async (targetId: string | null) => {
    if (!transaction) return;
    setSaving(true);
    try {
      await resolveNotificationDuplicate(transaction.id, targetId);
      await onSaved();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not resolve alert');
    } finally { setSaving(false); }
  };
  const resolveManual = async (targetId: string | null) => {
    if (!transaction) return;
    setSaving(true);
    try { await resolveManualDuplicate(transaction.id, targetId); await onSaved(); onClose(); }
    catch (cause) { setSaveError(cause instanceof Error ? cause.message : 'Could not resolve duplicate'); }
    finally { setSaving(false); }
  };
  const saveName = async () => {
    if (!transaction) return;
    setSaving(true);
    try {
      await renameVendorForTransaction(transaction.id, merchant);
      await onSaved();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save transaction');
    } finally {
      setSaving(false);
    }
  };
  const toggleTransactionCategory = (item: string) => {
    if (!categorySplitEligible) {
      setCategory(item);
      setSelectedCategories([item]);
      return;
    }
    const selected = selectedCategories.includes(item);
    if (selected && selectedCategories.length === 1) return;
    const next = selected ? selectedCategories.filter(categoryName => categoryName !== item) :
      [...selectedCategories, item];
    const total = Math.abs(transaction!.amountMinor);
    const each = Math.floor(total / next.length);
    setSelectedCategories(next);
    setCategory(next[0]);
    setCategorySplitRows(next.map((categoryName, index) => ({
      key: `category-${categoryName}`,
      category: categoryName,
      amount: String((each + (index === next.length - 1 ? total - each * next.length : 0)) / 100),
    })));
    setSaveError(null);
  };
  const saveCategory = async () => {
    if (!transaction) return;
    setSaving(true);
    try {
      await setTransactionCategory(transaction.id, category);
      await onSaved();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not classify transaction');
    } finally { setSaving(false); }
  };
  const saveNote = async () => {
    if (!transaction) return;
    setSaving(true);
    try {
      await setTransactionNote(transaction.id, note);
      await onSaved();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save note');
    } finally { setSaving(false); }
  };
  const saveVendorCategory = async () => {
    if (!transaction || !vendorCategory) return;
    setSaving(true);
    try {
      await saveVendorProfile(transaction.id, merchant, vendorCategory);
      await onSaved();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save vendor default');
    } finally { setSaving(false); }
  };
  const saveShared = async () => {
    if (!transaction || !splitPreview) return;
    if (splitPreview.error) { setSaveError(splitPreview.error); return; }
    setSaving(true);
    try {
      await splitTransaction(transaction.id, splitPreview.people);
      await onSaved();
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save shared expense');
    } finally { setSaving(false); }
  };
  const removeShared = async () => {
    if (!transaction) return;
    setSaving(true);
    try {
      await removeTransactionSplit(transaction.id);
      await onSaved();
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not remove shared expense');
    } finally { setSaving(false); }
  };
  const saveCategorySplit = async () => {
    if (!transaction || !categorySplitPreview || categorySplitPreview.error) {
      setSaveError(categorySplitPreview?.error ?? 'Could not split this transaction'); return;
    }
    setSaving(true);
    try {
      await setTransactionCategorySplits(transaction.id, categorySplitPreview.allocations);
      await onSaved();
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save category split');
    } finally { setSaving(false); }
  };
  return (
    <Modal visible={transaction != null} transparent animationType="slide">
      <View style={s.modalBackdrop}>
        <Pressable style={s.modalDismissArea} onPress={onClose} />
        <View style={s.categorySheet}>
          <View style={s.sheetHandle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={s.sheetEyebrow}>
            {transaction?.reviewStatus === 'confirmed'
              ? 'EDIT TRANSACTION'
              : 'REVIEW TRANSACTION'}
          </Text>
          <Text style={s.sheetTitle}>{transaction?.merchant}</Text>
          {transaction && <View style={s.transactionSummary}>
            <Text style={[s.transactionSummaryAmount, transaction.amountMinor > 0 && s.positive]}>
              {transaction.amountMinor < 0 ? '−' : '+'}{money(Math.abs(transaction.amountMinor))}
            </Text>
            <Text style={s.transactionSummaryMeta}>
              {new Date(transaction.occurredAt).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric',
              })} · {transaction.category}
            </Text>
          </View>}
          <Pressable onPress={() => setNoteOpen(open => !open)} accessibilityRole="button"
            accessibilityState={{ expanded: noteOpen }} style={s.compactEditorToggle}>
            <View style={s.flex}>
              <Text style={s.compactEditorTitle}>Note</Text>
              <Text style={s.compactEditorPreview} numberOfLines={1}>
                {transaction?.note || 'Add a note to this transaction'}
              </Text>
            </View>
            <Icon name="chevron" size={18} color={C.muted} />
          </Pressable>
          {noteOpen && <View style={s.compactEditorBody}>
            <TextInput value={note} onChangeText={setNote}
              placeholder="Add a note about this transaction"
              placeholderTextColor="#9DA8A1" multiline maxLength={500}
              textAlignVertical="top" accessibilityLabel="Transaction note"
              style={[s.merchantInput, s.transactionNoteInput]} />
            <View style={s.noteFooter}>
              <Text style={s.noteCount}>{note.length}/500</Text>
              <Pressable onPress={saveNote} disabled={saving || !noteChanged}
                accessibilityRole="button"
                style={[s.noteSaveButton, (saving || !noteChanged) && s.saveCategoryButtonDisabled]}>
                <Text style={s.noteSaveButtonText}>{saving ? 'Saving…' : note.trim() ? 'Save note' : 'Remove note'}</Text>
              </Pressable>
            </View>
          </View>}
          <Text style={s.inputLabel}>{categorySplitEligible ? 'CATEGORIES' : 'CATEGORY'}</Text>
          {categorySplitEligible && <Text style={s.categorySelectionHelp}>
            Select more than one category to split this transaction.
          </Text>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.transactionCategoryRow}>
            {categories.map(item => (
              <Pressable key={item} onPress={() => toggleTransactionCategory(item)}
                style={[s.categoryChip, categorySplitEligible && s.categoryCheckboxChip,
                  selectedCategories.includes(item) && s.categoryChipSelected]}
                accessibilityRole={categorySplitEligible ? 'checkbox' : 'radio'}
                accessibilityState={categorySplitEligible
                  ? { checked: selectedCategories.includes(item) }
                  : { selected: selectedCategories.includes(item) }}>
                {categorySplitEligible && <View style={[s.categoryCheckbox,
                  selectedCategories.includes(item) && s.categoryCheckboxSelected]}>
                  {selectedCategories.includes(item) && <Text style={s.categoryCheckboxMark}>✓</Text>}
                </View>}
                <Text style={[s.categoryChipText, selectedCategories.includes(item) && s.categoryChipTextSelected]}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {selectedCategories.length > 1 && <View style={s.categorySplitPanel}>
            <Text style={s.compactEditorTitle}>Split {money(Math.abs(transaction?.amountMinor ?? 0))}</Text>
            {categorySplitRows.map(row => <View key={row.key} style={s.categorySplitAmountLine}>
              <Text style={s.categorySplitAmountLabel} numberOfLines={1}>{row.category}</Text>
              <TextInput value={row.amount} placeholder="₹0.00" placeholderTextColor="#9DA8A1"
                onChangeText={amount => setCategorySplitRows(current => current.map(entry =>
                  entry.category === row.category ? { ...entry, amount } : entry))}
                keyboardType="decimal-pad" accessibilityLabel={`${row.category} amount`}
                style={[s.merchantInput, s.categorySplitAmountInput]} />
            </View>)}
            {categorySplitPreview?.error && <Text style={s.inputError}>{categorySplitPreview.error}</Text>}
            <Pressable onPress={saveCategorySplit} disabled={saving || Boolean(categorySplitPreview?.error)}
              style={[s.saveCategoryButton, (saving || Boolean(categorySplitPreview?.error)) && s.saveCategoryButtonDisabled]}>
              <Text style={s.saveCategoryText}>{saving ? 'Saving…' : `Save split across ${selectedCategories.length} categories`}</Text>
            </Pressable>
          </View>}
          {selectedCategories.length === 1 && categoryChanged && <Pressable onPress={saveCategory} disabled={saving}
            style={[s.saveCategoryButton, saving && s.saveCategoryButtonDisabled]}
            accessibilityRole="button">
            <Text style={s.saveCategoryText}>{saving ? 'Saving…' : `Save as ${category}`}</Text>
          </Pressable>}
          <Pressable onPress={() => setMoreOpen(open => !open)} accessibilityRole="button"
            accessibilityState={{ expanded: moreOpen }} style={s.compactEditorToggle}>
            <View style={s.flex}>
              <Text style={s.compactEditorTitle}>More options</Text>
              <Text style={s.compactEditorPreview} numberOfLines={1}>Vendor, shared expense, source and transfer</Text>
            </View>
            <Text style={s.chevron}>{moreOpen ? '⌃' : '›'}</Text>
          </Pressable>
          {moreOpen && <View style={s.moreOptionsBody}>
          {transaction && <Text style={s.sheetHelp}>
            {transaction.source === 'manual' ? 'Manual entry · does not change bank-reported balance' :
              `${transaction.source === 'sms' ? 'Bank SMS' : 'App notification · unverified balance'} · ${Math.round(transaction.confidence * 100)}% parser confidence`}
            {transaction.notificationPackages?.length ? ` · ${transaction.notificationPackages.join(', ')}` : ''}
            {transaction.referenceId ? ` · Ref ${transaction.referenceId}` : ''}
            {transaction.reportedBalanceMinor != null ? ` · Bank balance ${money(transaction.reportedBalanceMinor)}` : ''}
          </Text>}
          {vendorGroup && <Text style={s.sheetHelp}>
            {vendorGroup.count} transaction{vendorGroup.count === 1 ? '' : 's'} from this vendor
            {vendorGroup.outgoingMinor > 0 ? ` · paid ${money(vendorGroup.outgoingMinor)}` : ''}
            {vendorGroup.incomingMinor > 0 ? ` · received ${money(vendorGroup.incomingMinor)}` : ''}
            {vendorGroup.unverifiedCount > 0 ? ` · ${vendorGroup.unverifiedCount} unverified or possible duplicate excluded` : ''}
          </Text>}
          {transaction?.source === 'manual' && <Pressable onPress={() => onEditManual(transaction)}
            accessibilityRole="button" style={s.categoryChip}><Text style={s.categoryChipText}>Edit amount, account or date ›</Text></Pressable>}
          {transaction?.possibleDuplicate && <View style={s.duplicateNotice}>
            <Text style={s.reviewTitle}>Possible duplicate</Text>
            <Text style={s.sheetHelp}>{transaction.source === 'manual'
              ? 'This manual bank entry is temporarily excluded from reports until you decide whether it matches a bank SMS.'
              : 'A nearby manual bank entry may describe this same payment. Review the manual entry to resolve it.'}</Text>
            {manualTargets.map(target => <Pressable key={target.id} disabled={saving}
              onPress={() => resolveManual(target.id)} accessibilityRole="button" style={s.categoryChip}>
              <Text style={s.categoryChipText}>Merge with bank SMS · {money(Math.abs(target.amountMinor))} · {target.merchant}</Text>
            </Pressable>)}
            {manualTargets.length > 0 && <Pressable disabled={saving} onPress={() => resolveManual(null)}
              accessibilityRole="button" style={s.categoryChip}><Text style={s.categoryChipText}>Keep both transactions</Text></Pressable>}
          </View>}
          <Text style={s.inputLabel}>SENDER OR VENDOR</Text>
          <TextInput
            value={merchant}
            onChangeText={setMerchant}
            placeholder="Enter the name"
            placeholderTextColor="#9DA8A1"
            autoCapitalize="words"
            maxLength={48}
            style={s.merchantInput}
          />
          <Text style={s.sheetHelp}>
            {transaction && isUnidentifiedCredit(transaction.kind, transaction.merchant)
              ? 'This bank alert did not include a sender. Add one now, then classify it separately.'
              : transaction?.merchant === 'Unknown merchant'
                ? 'This bank alert did not identify a merchant. Add one now, then classify it separately.'
                : 'Renaming this vendor updates past transactions with the same name and future imports. Categories stay unchanged.'}
          </Text>
          {nameChanged && <Pressable onPress={saveName} disabled={saving || !cleanedMerchant}
            accessibilityRole="button" style={[s.saveCategoryButton, (saving || !cleanedMerchant) && s.saveCategoryButtonDisabled]}>
            <Text style={s.saveCategoryText}>{saving ? 'Saving…' : 'Save name only'}</Text>
          </Pressable>}
          <Text style={s.inputLabel}>DEFAULT CATEGORY FOR THIS VENDOR</Text>
          <Text style={s.sheetHelp}>Applies to every payment from this vendor whose category you have not chosen manually, including past payments. Eligible payments leave Review. Unverified alerts and possible duplicates still need a separate check.</Text>
          <View style={s.categoryGrid}>
            {categories.map(item => <Pressable key={item} onPress={() => setVendorCategory(item)}
              accessibilityRole="radio" accessibilityState={{ selected: vendorCategory === item }}
              style={[s.categoryChip, vendorCategory === item && s.categoryChipSelected]}>
              <Text style={[s.categoryChipText, vendorCategory === item && s.categoryChipTextSelected]}>{item}</Text>
            </Pressable>)}
          </View>
          <CategoryCreator onCreated={async name => { setVendorCategory(name); await onSaved(); }} />
          <Text style={s.sheetHelp}>{vendorCategory
            ? `Selected default: ${vendorCategory}`
            : 'No vendor default yet. New payments will need review.'}</Text>
          <Pressable onPress={saveVendorCategory}
            disabled={saving || !vendorCategory || !normalizedVendorKey(cleanedMerchant)}
            accessibilityRole="button"
            style={[s.saveCategoryButton,
              (saving || !vendorCategory || !normalizedVendorKey(cleanedMerchant)) && s.saveCategoryButtonDisabled]}>
            <Text style={s.saveCategoryText}>{saving ? 'Saving…' : nameChanged ? 'Save name and default category' : 'Save vendor default'}</Text>
          </Pressable>
          {vendorGroup && vendorGroup.count > 1 && <>
            <Text style={s.inputLabel}>TRANSACTIONS FROM THIS VENDOR</Text>
            <Text style={s.sheetHelp}>Open a payment to edit its own category, amount or shared split.</Text>
            {vendorGroup.transactions.map(item => <Pressable key={item.id} onPress={() => onSelectTransaction(item)}
              accessibilityRole="button" style={s.categoryChip}>
              <Text style={s.categoryChipText}>{new Date(item.occurredAt).toLocaleDateString('en-IN')} · {money(Math.abs(item.amountMinor))} · {item.category}{item.reviewStatus !== 'confirmed' ? ' · needs review' : ''}</Text>
            </Pressable>)}
          </>}
          {transaction?.source === 'notification' && <View>
            <Text style={s.inputLabel}>APP NOTIFICATION</Text>
            <Text style={s.sheetHelp}>{transaction.reviewStatus === 'confirmed'
              ? 'This alert currently counts in reports. Merge or ignore it if it is a duplicate.'
              : 'This alert is excluded from budgets until you confirm it. If it is the same payment as a bank SMS, merge it below.'}</Text>
            {duplicateTargets.map(target => <Pressable key={target.id} disabled={saving}
              onPress={() => resolveAlert(target.id)} style={s.categoryChip}>
              <Text style={s.categoryChipText}>Merge with {target.merchant} · {money(Math.abs(target.amountMinor))} ({target.source})</Text>
            </Pressable>)}
            <Pressable disabled={saving} onPress={() => Alert.alert('Ignore this alert?',
              'It will disappear from activity and will not count in reports.', [
                { text: 'Cancel' }, { text: 'Ignore', style: 'destructive', onPress: () => resolveAlert(null) },
              ])} style={s.categoryChip}>
              <Text style={s.categoryChipText}>Ignore this alert</Text>
            </Pressable>
          </View>}
          {transaction && ['debit', 'credit', 'transfer'].includes(transaction.kind) && <Pressable
            disabled={saving} onPress={async () => {
              setSaving(true);
              try { await setTransferStatus(transaction.id, transaction.kind !== 'transfer'); await onSaved(); onClose(); }
              catch (e) { setSaveError(e instanceof Error ? e.message : 'Could not update transfer'); }
              finally { setSaving(false); }
            }} style={s.categoryChip}>
            <Text style={s.categoryChipText}>{transaction.kind === 'transfer'
              ? 'Count as an ordinary payment' : 'Mark as own-account transfer'}</Text>
          </Pressable>}
          {shareEligible && <View style={s.sharedEditor}>
            <Pressable onPress={() => {
              setShareOpen(current => !current);
              if (!shareRows.length) setShareRows([{ key: 'first', name: '', amount: '' }]);
            }} accessibilityRole="button" style={s.sharedEditorToggle}>
              <Text style={s.sharedEditorTitle}>{existingSplit ? 'Edit shared expense' : 'Share this expense'}</Text>
              <Text style={s.chevron}>{shareOpen ? '⌃' : '›'}</Text>
            </Pressable>
            {existingSplit && !shareOpen && <Text style={s.pendingMeta}>
              Your share {money(existingSplit.personalMinor)} · {existingSplit.people.length} other{existingSplit.people.length === 1 ? '' : 's'}
            </Text>}
            {shareOpen && <>
              <Text style={s.sheetHelp}>Payment {money(Math.abs(transaction!.amountMinor))}. Enter what each person owes; your share is the remainder. Save vendor or category edits separately below.</Text>
              {shareRows.map(row => <View key={row.key} style={s.sharedPersonBlock}>
                <View style={s.sharedPersonRow}>
                  <TextInput value={row.name} placeholder="Person" placeholderTextColor="#9DA8A1"
                    onFocus={() => setActivePersonKey(row.key)}
                    onChangeText={name => {
                      setActivePersonKey(row.key);
                      setShareRows(current => current.map(item => item.key === row.key ? { ...item, name } : item));
                    }}
                    autoCapitalize="words" style={[s.merchantInput, s.sharedNameInput]} />
                  <TextInput value={row.amount} placeholder="Share ₹" placeholderTextColor="#9DA8A1"
                    onFocus={() => setActivePersonKey(null)}
                    onChangeText={amount => setShareRows(current => current.map(item => item.key === row.key ? { ...item, amount } : item))}
                    keyboardType="decimal-pad" style={[s.merchantInput, s.sharedAmountInput]} />
                  <Pressable onPress={() => {
                    setActivePersonKey(null);
                    setShareRows(current => current.filter(item => item.key !== row.key));
                  }} accessibilityRole="button" accessibilityLabel={`Remove ${row.name || 'person'}`} style={s.sharedRemove}>
                    <Text style={s.sharedRemoveText}>×</Text>
                  </Pressable>
                </View>
                {activePersonKey === row.key && suggestPeople(row.name, knownPeople,
                  shareRows.filter(item => item.key !== row.key).map(item => item.name)).length > 0 &&
                  <View style={s.personSuggestionList}>
                    <Text style={s.personSuggestionLabel}>FROM YOUR TRANSACTIONS</Text>
                    {suggestPeople(row.name, knownPeople,
                      shareRows.filter(item => item.key !== row.key).map(item => item.name)).map(name =>
                      <Pressable key={name} onPress={() => {
                        setShareRows(current => current.map(item => item.key === row.key ? { ...item, name } : item));
                        setActivePersonKey(null);
                      }} accessibilityRole="button" style={s.personSuggestion}>
                        <Text style={s.personSuggestionText}>{name}</Text>
                      </Pressable>)}
                  </View>}
              </View>)}
              <View style={s.sharedActions}>
                <Pressable onPress={() => setShareRows(current => [...current, {
                  key: `${Date.now()}-${Math.random()}`, name: '', amount: '',
                }])} style={s.sharedActionButton}><Text style={s.sharedActionText}>+ Add person</Text></Pressable>
                <Pressable onPress={() => {
                  const equalMinor = Math.floor(Math.abs(transaction!.amountMinor) / (shareRows.length + 1));
                  setShareRows(current => current.map(item => ({ ...item, amount: String(equalMinor / 100) })));
                }} disabled={!shareRows.length} style={s.sharedActionButton}><Text style={s.sharedActionText}>Split evenly</Text></Pressable>
              </View>
              <Text style={s.sharedTotal}>Your share: {splitPreview && !splitPreview.error ? money(splitPreview.personalMinor) : '—'}</Text>
              {splitPreview?.error && <Text style={s.inputError}>{splitPreview.error}</Text>}
              <Pressable onPress={saveShared} disabled={saving || Boolean(splitPreview?.error)}
                style={[s.saveCategoryButton, (saving || Boolean(splitPreview?.error)) && s.saveCategoryButtonDisabled]}>
                <Text style={s.saveCategoryText}>{saving ? 'Saving…' : 'Save shared expense'}</Text>
              </Pressable>
              {existingSplit && <Pressable disabled={saving}
                onPress={() => Alert.alert('Remove shared expense?', 'This removes pending shares. It is unavailable once a repayment has been recorded.', [
                  { text: 'Cancel' }, { text: 'Remove', style: 'destructive', onPress: removeShared },
                ])} style={s.removeGoalButton}>
                <Text style={s.removeGoalText}>Remove shared split</Text>
              </Pressable>}
            </>}
          </View>}
          <Text style={s.inputLabel}>CREATE A CATEGORY</Text>
          <CategoryCreator onCreated={async name => { setCategory(name); await onSaved(); }} />
          </View>}
          {saveError && <Text style={s.inputError}>{saveError}</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CategoryCreator({
  onCreated,
}: {
  onCreated: (name: string) => Promise<void> | void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await createCategory(name);
      await onCreated(created);
      setName('');
      setExpanded(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create category');
    } finally {
      setSaving(false);
    }
  };
  if (!expanded) {
    return (
      <Pressable
        onPress={() => setExpanded(true)}
        style={s.categoryCreateToggle}
        accessibilityRole="button"
      >
        <Text style={s.categoryCreateText}>+ Create a category</Text>
      </Pressable>
    );
  }
  return (
    <View style={s.categoryCreateForm}>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Category name"
        placeholderTextColor="#9DA8A1"
        autoCapitalize="words"
        maxLength={32}
        style={s.categoryCreateInput}
      />
      <Pressable
        onPress={save}
        disabled={saving || !name.trim()}
        style={[s.categoryCreateButton, (!name.trim() || saving) && s.saveCategoryButtonDisabled]}
        accessibilityRole="button"
      >
        <Text style={s.categoryCreateButtonText}>{saving ? 'Saving…' : 'Add'}</Text>
      </Pressable>
      <Pressable onPress={() => { setExpanded(false); setError(null); }}>
        <Text style={s.categoryCreateCancel}>Cancel</Text>
      </Pressable>
      {error && <Text style={s.inputError}>{error}</Text>}
    </View>
  );
}

/* eslint-disable react-native/no-inline-styles -- chart geometry is data-driven. */
function Analytics({
  d,
  finance,
  transactions,
  onOpenSettings,
  onOpenHome,
  onOpenPlan,
  onOpenTransaction,
}: {
  d: Dashboard;
  finance: FinanceSnapshot | null;
  transactions: Transaction[];
  onOpenSettings: () => void;
  onOpenHome: () => void;
  onOpenPlan: () => void;
  onOpenTransaction: (transactionId: string) => void;
}) {
  const [period, setPeriod] = useState<CashFlowPeriod>('month');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedMerchant, setSelectedMerchant] = useState<string | null>(null);
  const [cashFlowSide, setCashFlowSide] = useState<'inflow' | 'outflow' | null>(null);
  const max = Math.max(...d.months.map(x => x.amountMinor), 1);
  const selectedIncome = finance?.incomeCandidates.some(item => item.assignedMonthKey === monthKeyFor(Date.now())) ?? false;
  const comparison = compareMonthlyIncomeAndSpending(d.incomeMinor, d.spentMinor, selectedIncome);
  const breakdown = finance?.breakdowns[period];
  const cashFlow = finance?.cashFlow?.[period] ?? null;
  const cashFlowRows = cashFlowTransactions(transactions, finance?.primaryAccountId ?? null, period, finance?.cashFlowAsOf ?? Date.now());
  const cashFlowDrillRows = cashFlowRows.filter(tx => cashFlowSide === 'inflow' ? tx.amountMinor > 0 : tx.amountMinor < 0);
  const drillRows = filterActivityRows(transactions, { query: '', accountId: null, period, now: Date.now() })
    .filter(tx => tx.amountMinor < 0 && tx.kind !== 'transfer' &&
      !(tx.source === 'manual' && tx.possibleDuplicate) &&
      (tx.source !== 'notification' || tx.reviewStatus === 'confirmed') &&
      (selectedCategory ? tx.category === selectedCategory ||
        tx.categorySplits?.some(split => split.category === selectedCategory) :
        selectedMerchant ? tx.merchant === selectedMerchant : false));
  return (
    <>
      <Header eyebrow="Understand your spending" title="Insights" onProfile={onOpenSettings} />
      <View style={s.analyticsHero}>
        <Text style={s.analyticsLabel}>INCOME VS SPENDING · THIS MONTH</Text>
        <Text style={s.analyticsValue}>{comparison.status === 'unavailable' ? 'Select income to compare' :
          comparison.status === 'even' ? 'Break-even' : `${money(Math.abs(comparison.differenceMinor ?? 0))} ${comparison.status}`}</Text>
        <Text style={s.analyticsSub}>Selected income minus your personal spending · not your bank balance</Text>
        {comparison.status === 'unavailable' && <Pressable onPress={onOpenHome} accessibilityRole="button"
          style={s.analyticsIncomeLink}><Text style={s.manageIncomeText}>Choose income on Home ›</Text></Pressable>}
      </View>
      <View style={s.insightsMetricRow}>
        <InsightMetric label="Income" value={money(d.incomeMinor, true)} tone="positive" />
        <InsightMetric label="Spent" value={money(d.spentMinor, true)} />
        <InsightMetric label="Net" value={money(d.incomeMinor - d.spentMinor, true)}
          tone={d.incomeMinor - d.spentMinor >= 0 ? 'positive' : 'danger'} />
      </View>
      <Section title="Spending breakdown" action="YOUR SHARE" />
      <View style={s.homePeriodRow}>{([['today', 'Today'], ['week', 'This week'], ['month', 'This month']] as const).map(([key, label]) =>
        <Pressable key={key} onPress={() => { setPeriod(key); setSelectedCategory(null); setSelectedMerchant(null); setCashFlowSide(null); }}
          accessibilityRole="button" accessibilityState={{ selected: period === key }}
          style={[s.filterPill, period === key && s.filterActive]}><Text style={[s.filterText, period === key && s.filterTextActive]}>{label}</Text></Pressable>)}</View>
      {breakdown && <View style={s.card}><CategorySnapshot breakdown={breakdown} /></View>}
      <Section title="Tracked net cash flow" action={finance?.primaryAccountName ?? 'PRIMARY BANK'} />
      <CashFlowCard summary={cashFlow} accountName={finance?.primaryAccountName ?? null}
        onChooseAccount={onOpenPlan} onInflow={() => setCashFlowSide('inflow')}
        onOutflow={() => setCashFlowSide('outflow')} />
      <Section title="Spending pace" action="THIS MONTH" />
      <View style={s.card}>
        <Text style={s.guideDetail}>Projected month end · {money(finance?.projectedMonthMinor ?? 0)}</Text>
        <Text style={s.guideDetail}>This week / last week · {money(finance?.weekSpentMinor ?? 0)} / {money(finance?.previousWeekSpentMinor ?? 0)}</Text>
        <Text style={s.guideDetail}>{finance?.paceRatio == null ? 'Set a budget to compare spending pace.' :
          finance.paceRatio > 1 ? `${Math.round((finance.paceRatio - 1) * 100)}% faster than budget pace` :
            `${Math.round((1 - finance.paceRatio) * 100)}% slower than budget pace`}</Text>
      </View>
      <Section title="Weekly spending guide" action="THIS MONTH" />
      <Pressable
        onPress={onOpenSettings}
        style={({ pressed }) => [s.card, pressed && s.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Edit monthly spending budget"
      >
        {d.monthlyBudgetMinor == null ? (
          <>
            <Text style={s.guideValue}>Set a monthly budget</Text>
            <Text style={s.guideDetail}>
              Then we’ll show how much you can spend each day for the rest of
              the month.
            </Text>
          </>
        ) : (
          <>
            <Text style={s.planLabel}>AIM TO SPEND NO MORE THAN</Text>
            <Text style={s.guideValue}>
              {money(Math.floor(
                (d.budgetRemainingMinor ?? 0) /
                Math.max(1, d.budgetDaysRemaining ?? 1),
              ))} / day
            </Text>
            <Text style={s.guideDetail}>
              {d.budgetOverageMinor
                ? `Over budget by ${money(d.budgetOverageMinor)} this month.`
                : `${money(d.budgetRemainingMinor ?? 0)} left of ${money(d.monthlyBudgetMinor)} · ${d.budgetDaysRemaining} days left`}
            </Text>
            <Text style={s.guideDetail}>
              Your spending pace so far: {money(d.weeklyPaceMinor ?? 0)} / week
            </Text>
          </>
        )}
      </Pressable>
      <Section title="Monthly spending" action="6 MONTHS" />
      <View style={s.card}>
        <View style={s.barChart}>
          {d.months.map((x, i) => (
            <View key={`${x.label}-${i}`} style={s.barColumn}>
              <View style={s.barTrack}>
                <View
                  style={[
                    s.bar,
                    {
                      height: Math.max(8, (x.amountMinor / max) * 112),
                      backgroundColor:
                        i === d.months.length - 1 ? C.primary : '#C9D4CD',
                    },
                  ]}
                />
              </View>
              <Text style={s.barLabel}>{x.label}</Text>
            </View>
          ))}
        </View>
      </View>
      <Section title="Top merchants" action={period.toUpperCase()} />
      <View style={s.card}>{(breakdown?.merchants ?? []).slice(0, 10).map(item =>
        <Pressable key={item.name} onPress={() => { setSelectedMerchant(item.name); setSelectedCategory(null); }}
          accessibilityRole="button" style={s.analyticsDrillRow}>
          <Text style={s.categoryName}>{item.name}</Text><Text style={s.categoryAmount}>{money(item.amountMinor)} ›</Text>
        </Pressable>)}{!breakdown?.merchants.length && <Text style={s.emptyText}>No merchants in this period.</Text>}</View>
      <Section title="Unusual spending" action="THIS MONTH" />
      <View style={s.card}>{!finance?.baselineReady ? <Text style={s.guideDetail}>Insufficient history. At least 8 payments across two weeks are needed.</Text> :
        finance.unusual.length ? finance.unusual.map((item, index) => <Text key={`${item.label}-${index}`} style={s.guideDetail}>
          {item.label} · {money(item.amountMinor)}</Text>) : <Text style={s.guideDetail}>Nothing unusual this month.</Text>}</View>
      {(selectedCategory || selectedMerchant) && <>
        <Section title={selectedCategory ?? selectedMerchant ?? ''} action="TRANSACTIONS" />
        <View style={s.card}>{drillRows.map(tx => <Pressable key={tx.id} onPress={() => onOpenTransaction(tx.id)}
          accessibilityRole="button" style={s.analyticsDrillRow}><Text style={s.categoryName}>{tx.merchant}</Text>
          <Text style={s.categoryAmount}>{money(Math.abs(tx.amountMinor))} ›</Text></Pressable>)}
          <Text style={s.guideDetail}>Amounts shown here are full payment amounts; shared spending totals use only your share.</Text>
          <Pressable onPress={() => { setSelectedCategory(null); setSelectedMerchant(null); }} accessibilityRole="button">
            <Text style={s.homeActivityLinkText}>Close breakdown</Text></Pressable></View>
      </>}
      <Section title="By category" action={`${d.categories.length} GROUPS`} />
      <View style={s.card}>
        {d.categories.map(x => (
          <Pressable key={x.category} onPress={() => { setSelectedCategory(x.category); setSelectedMerchant(null); }}
            accessibilityRole="button" accessibilityLabel={`View ${x.category} transactions`} style={s.categoryLine}>
            <View
              style={[
                s.categoryGlyph,
                { backgroundColor: catColor(x.category) },
              ]}
            />
            <View style={s.flex}>
              <View style={s.categoryTop}>
                <Text style={s.categoryName}>{x.category}</Text>
                <Text style={s.categoryAmount}>{money(x.amountMinor)}</Text>
              </View>
              <View style={s.progressTrack}>
                <View
                  style={[
                    s.progressFill,
                    {
                      width: `${
                        d.spentMinor
                          ? Math.round((x.amountMinor / d.spentMinor) * 100)
                          : 0
                      }%`,
                      backgroundColor: catColor(x.category),
                    },
                  ]}
                />
              </View>
            </View>
            <Text style={s.categoryPercent}>
              {d.spentMinor
                ? Math.round((x.amountMinor / d.spentMinor) * 100)
                : 0}
              %
            </Text>
          </Pressable>
        ))}
      </View>
      <CashFlowTransactionsModal side={cashFlowSide} rows={cashFlowDrillRows}
        accountName={finance?.primaryAccountName ?? null}
        onClose={() => setCashFlowSide(null)}
        onOpenTransaction={transactionId => { setCashFlowSide(null); onOpenTransaction(transactionId); }} />
    </>
  );
}
/* eslint-enable react-native/no-inline-styles */

function CashFlowTransactionsModal({ side, rows, accountName, onClose, onOpenTransaction }: {
  side: 'inflow' | 'outflow' | null;
  rows: Transaction[];
  accountName: string | null;
  onClose: () => void;
  onOpenTransaction: (transactionId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  return <Modal visible={side != null} animationType="slide" onRequestClose={onClose}>
    <View style={[s.cashFlowModal, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 12 }]}>
      <View style={s.cashFlowModalHeader}>
        <View style={s.flex}>
          <Text style={s.eyebrow}>TRACKED NET CASH FLOW</Text>
          <Text style={s.cashFlowModalTitle}>{side === 'inflow' ? 'Money in' : 'Money out'}</Text>
          <Text style={s.cashFlowNote}>{accountName ?? 'Primary bank'} · {rows.length} recorded movement{rows.length === 1 ? '' : 's'}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" style={s.cashFlowModalClose}>
          <Text style={s.cashFlowModalCloseText}>Close</Text>
        </Pressable>
      </View>
      <FlatList data={rows} keyExtractor={item => item.id} contentContainerStyle={s.cashFlowList}
        ListEmptyComponent={<View style={s.card}><Text style={s.emptyText}>No recorded bank movements in this period.</Text></View>}
        renderItem={({ item }) => <View style={s.cashFlowListItem}>
          <TransactionRow tx={item} last onPress={() => onOpenTransaction(item.id)} />
        </View>} />
    </View>
  </Modal>;
}

type MoneyGoalTarget =
  | { kind: 'budget'; currentMinor: number | null }
  | {
      kind: 'minimum';
      accountId: string;
      accountName: string;
      currentMinor: number | null;
    };

function Settings({
  d,
  health,
  categories,
  onChanged,
  onReset,
  onBack,
}: {
  d: Dashboard;
  health: CaptureHealth | null;
  categories: string[];
  onChanged: () => Promise<void> | void;
  onReset: () => Promise<void>;
  onBack: () => void;
}) {
  const [permission, setPermission] = useState('Checking…'),
    [notificationAccess, setNotificationAccess] = useState('Checking…'),
    [busy, setBusy] = useState(false);
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [appChoices, setAppChoices] = useState<Array<{ packageName: string; label: string }>>([]);
  const [appSearch, setAppSearch] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState('22:00');
  const savedReminderTime = useRef({ hour: 22, minute: 0 });
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [goalTarget, setGoalTarget] = useState<MoneyGoalTarget | null>(null);
  const check = useCallback(
    async () => {
      try {
        const [sms, notifications, packages, choices, reminder] = await Promise.all([
          TransactionSms.getPermissionStatus(),
          TransactionSms.getNotificationAccessStatus(),
          TransactionSms.getNotificationPackages(),
          TransactionSms.getNotificationAppChoices(),
          TransactionSms.getReviewReminder(),
        ]);
        setPermission(sms);
        setNotificationAccess(notifications);
        setSelectedPackages(packages);
        setAppChoices(choices);
        setReminderEnabled(reminder.enabled);
        setReminderTime(`${String(reminder.hour).padStart(2, '0')}:${String(reminder.minute).padStart(2, '0')}`);
        savedReminderTime.current = { hour: reminder.hour, minute: reminder.minute };
        setSettingsError(null);
      } catch (cause) {
        setSettingsError(cause instanceof Error ? cause.message : 'Could not read device settings.');
        setPermission('Unavailable');
        setNotificationAccess('Unavailable');
      }
    },
    [],
  );
  useEffect(() => {
    check();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        check();
      }
    });
    return () => subscription.remove();
  }, [check]);
  const enable = async () => {
    try { setPermission(await TransactionSms.requestPermission()); }
    catch (cause) { Alert.alert('Could not request SMS access', cause instanceof Error ? cause.message : 'Please try again.'); }
  };
  const togglePackage = async (packageName: string) => {
    const next = selectedPackages.includes(packageName) ? selectedPackages.filter(item => item !== packageName) :
      [...selectedPackages, packageName];
    try { await TransactionSms.setNotificationPackages(next); setSelectedPackages(next); }
    catch (e) { Alert.alert('Could not save source', e instanceof Error ? e.message : 'Try again.'); }
  };
  const saveReminder = async (enabled: boolean) => {
    const time = enabled ? parseReminderTime(reminderTime) : savedReminderTime.current;
    if (!time) {
      Alert.alert('Invalid time', 'Use 24-hour format, for example 22:00.'); return;
    }
    try {
      if (enabled && !(await TransactionSms.requestNotificationPermission())) {
        Alert.alert('Notifications disabled', 'Allow notifications to receive the daily note reminder.'); return;
      }
      await TransactionSms.configureReviewReminder(enabled, time.hour, time.minute);
      savedReminderTime.current = time;
      setReminderTime(`${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`);
      setReminderEnabled(enabled);
    } catch (cause) {
      Alert.alert('Could not update reminder', cause instanceof Error ? cause.message : 'Please try again.');
    }
  };
  const importSms = async () => {
    setBusy(true);
    try {
      const r = await importRecentInbox(90);
      await onChanged();
      Alert.alert(
        r.remaining > 0 ? 'Import still processing' : 'Import complete',
        `${r.imported} transactions added. ${r.ignored} messages ignored.` +
          (r.remaining > 0 ? ` ${r.remaining} SMS messages remain queued and will process when the app refreshes.` : '') +
          (r.scanLimitReached ? ' The inbox scan reached its 5,000-message limit; older messages may remain unscanned.' : ''),
      );
    } catch (e) {
      Alert.alert(
        'Import failed',
        e instanceof Error ? e.message : 'Check SMS permission.',
      );
    } finally {
      setBusy(false);
    }
  };
  const clear = () =>
    Alert.alert('Remove sample activity?', 'Imported transactions will stay.', [
      { text: 'Cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try { await removeDemoData(); await onChanged(); }
          catch (cause) { Alert.alert('Could not remove samples', cause instanceof Error ? cause.message : 'Please try again.'); }
        },
      },
    ]);
  const confirmReset = () =>
    Alert.alert(
      'Wipe all Expense Tracker data?',
      'This permanently deletes every transaction, balance, account, budget, goal, bill, shared expense, review record, custom category, saved vendor name, and queued alert. It also turns off selected notification sources and the daily note reminder. Your phone’s SMS inbox is not deleted. Old messages will not be imported again unless you tap Import.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe and restart',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await onReset();
              Alert.alert('Reset complete', 'Your local ledger is empty. New bank alerts will be recorded as they arrive.');
            } catch (e) {
              Alert.alert(
                'Reset failed',
                e instanceof Error ? e.message : 'Your data could not be reset.',
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  return (
    <>
      <Header eyebrow="Private by design" title="Settings" onBack={onBack} />
      <View style={s.privacyCard}>
        <View style={s.privacyIcon}><Icon name="settings" size={22} color={C.action} /></View>
        <Text style={s.privacyTitle}>Your data stays here.</Text>
        <Text style={s.privacyText}>
          No account, backend, cloud sync, advertising SDK, or financial-data
          upload.
        </Text>
      </View>
      {settingsError && <View style={s.card}>
        <Text style={s.inputError}>{settingsError}</Text>
        <Button label="Retry device settings" onPress={() => { check(); }} />
      </View>}
      <Section title="Detection health" action="ON DEVICE" />
      <View style={s.card}>
        <View style={s.healthRow}><Text style={s.settingTitle}>SMS detection</Text><Text style={s.settingDetail}>{health?.smsPermission ?? 'Checking…'}</Text></View>
        <View style={s.healthRow}><Text style={s.settingTitle}>App notifications</Text><Text style={s.settingDetail}>
          {health?.notificationAccess ?? 'Checking…'} · {health?.selectedApps ?? 0} selected</Text></View>
        <View style={s.healthRow}><Text style={s.settingTitle}>Alerts waiting</Text><Text style={s.settingDetail}>
          {health ? `${health.pendingSms} SMS · ${health.pendingNotifications} notifications` : 'Checking…'}</Text></View>
        <View style={s.healthRow}><Text style={s.settingTitle}>Last processed</Text><Text style={s.settingDetail}>
          {health?.lastProcessedAt ? new Date(health.lastProcessedAt).toLocaleString('en-IN') : 'No alerts processed yet'}</Text></View>
        <View style={s.healthRow}><Text style={s.settingTitle}>Latest bank balance</Text><Text style={s.settingDetail}>
          {health?.latestBankBalanceAt ? `${ageLabel(health.latestBankBalanceAt)} · ${new Date(health.latestBankBalanceAt).toLocaleString('en-IN')}` : 'No bank balance received yet'}</Text></View>
        <Text style={s.guideDetail}>Choose SMS and notification permissions below if detection is off.</Text>
      </View>
      <Section title="Spending controls" action="YOUR TARGETS" />
      <View style={s.card}>
        <Setting
          title="Monthly spending budget"
          detail={
            d.monthlyBudgetMinor == null
              ? 'Set a monthly limit to get a weekly spending target'
              : `${money(d.monthlyBudgetMinor)} per calendar month`
          }
          action={d.monthlyBudgetMinor == null ? 'Set' : 'Edit'}
          onPress={() =>
            setGoalTarget({ kind: 'budget', currentMinor: d.monthlyBudgetMinor })
          }
        />
        {d.accountProtections.filter(account => account.accountId !== 'manual:cash').map(account => (
          <React.Fragment key={account.accountId}>
            <View style={s.settingDivider} />
            <Setting
              title={`Minimum · ${account.name}`}
              detail={
                account.minimumBalanceMinor == null
                  ? 'No minimum set'
                  : `${money(account.minimumBalanceMinor)} minimum · ${
                      account.aboveMinimumMinor == null
                        ? 'waiting for bank SMS'
                        : account.aboveMinimumMinor < 0
                          ? `${money(Math.abs(account.aboveMinimumMinor))} below`
                          : `${money(account.aboveMinimumMinor)} above`
                    }`
              }
              action={account.minimumBalanceMinor == null ? 'Set' : 'Edit'}
              onPress={() =>
                setGoalTarget({
                  kind: 'minimum',
                  accountId: account.accountId,
                  accountName: account.name,
                  currentMinor: account.minimumBalanceMinor,
                })
              }
            />
          </React.Fragment>
        ))}
        {d.accountProtections.length === 0 && (
          <Text style={s.settingDetail}>
            Import a bank SMS to set a minimum for that account.
          </Text>
        )}
      </View>
      <Section title="Categories" action={`${categories.length} AVAILABLE`} />
      <View style={s.card}>
        <Text style={s.settingDetail}>
          Known vendors reuse your chosen category. New vendors start in Other.
        </Text>
        <View style={s.categoryGrid}>
          {categories.map(name => (
            <View key={name} style={s.categoryChip}>
              <Text style={s.categoryChipText}>{name}</Text>
            </View>
          ))}
        </View>
        <CategoryCreator onCreated={() => onChanged()} />
      </View>
      <Section title="SMS connection" action={permission.toUpperCase()} />
      <View style={s.card}>
        <Setting
          title="SMS access"
          detail="Read bank alerts and capture new transactions"
          action="Enable"
          onPress={enable}
        />
        <View style={s.settingDivider} />
        <Setting
          title="Import last 90 days"
          detail="Scanned locally; messages never leave this phone"
          action={busy ? 'Working…' : 'Import'}
          onPress={busy ? undefined : importSms}
        />
      </View>
      <Section title="Transaction alerts" action={notificationAccess.toUpperCase()} />
      <View style={s.card}>
        <Setting
          title="Notification access"
          detail="Read payment alerts only from the apps selected below"
          action={notificationAccess === 'granted' ? 'Enabled' : 'Enable'}
          onPress={
            notificationAccess === 'granted'
              ? undefined
              : () => TransactionSms.openNotificationAccessSettings().catch(cause =>
                Alert.alert('Could not open settings', cause instanceof Error ? cause.message : 'Please try again.'))
          }
        />
        <TextInput placeholder="Search installed apps" value={appSearch} onChangeText={setAppSearch}
          style={s.categoryCreateInput} placeholderTextColor={C.muted} />
        {appChoices.filter(app => selectedPackages.includes(app.packageName) ||
          (appSearch.length >= 2 && `${app.label} ${app.packageName}`.toLowerCase().includes(appSearch.toLowerCase())))
          .slice(0, 25).map(app => <Setting key={app.packageName} title={app.label}
            detail={app.packageName} action={selectedPackages.includes(app.packageName) ? 'On' : 'Off'}
            onPress={() => togglePackage(app.packageName)} />)}
        {appSearch.length < 2 && selectedPackages.length === 0 &&
          <Text style={s.settingDetail}>Search for your payment apps and switch them on.</Text>}
      </View>
      <Section title="Daily note reminder" action={reminderEnabled ? 'ON' : 'OFF'} />
      <View style={s.card}>
        <Text style={s.settingDetail}>Local reminder around this time (24-hour format):</Text>
        <TextInput value={reminderTime} onChangeText={setReminderTime} placeholder="22:00"
          style={s.categoryCreateInput} keyboardType="numbers-and-punctuation"
          accessibilityLabel="Daily transaction note reminder time" />
        {reminderEnabled && <Setting title="Reminder time" detail="Apply the time shown above"
          action="Save time" onPress={() => saveReminder(true)} />}
        <Setting title="Note reminder" detail="Sent every day, even when every vendor is already classified"
          action={reminderEnabled ? 'Turn off' : 'Enable'} onPress={() => saveReminder(!reminderEnabled)} />
        {reminderEnabled && <Setting title="Snooze" detail="Postpone today's note reminder for 30 minutes"
          action="30 min" onPress={() => TransactionSms.snoozeReviewReminder(30).catch(cause =>
            Alert.alert('Could not snooze reminder', cause instanceof Error ? cause.message : 'Please try again.'))} />}
      </View>
      <Section title="Data" action="ON DEVICE" />
      <View style={s.card}>
        <Setting
          title="Remove sample activity"
          detail="Keep imported transactions"
          action="Remove"
          onPress={busy ? undefined : clear}
        />
        <View style={s.settingDivider} />
        <Setting
          title="Wipe database and start fresh"
          detail="Deletes all local ledger data and pending imports. Does not delete SMS from your phone."
          action={busy ? 'Working…' : 'Wipe'}
          onPress={busy ? undefined : confirmReset}
        />
      </View>
      <Text style={s.footnote}>
        Expense Tracker {health?.appVersion ?? '…'} · Local-only Android
      </Text>
      <MoneyGoalEditor
        target={goalTarget}
        onClose={() => setGoalTarget(null)}
        onSaved={onChanged}
      />
    </>
  );
}

function MoneyGoalEditor({
  target,
  onClose,
  onSaved,
}: {
  target: MoneyGoalTarget | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setAmount(
      target?.currentMinor == null ? '' : (target.currentMinor / 100).toFixed(2),
    );
    setError(null);
  }, [target]);
  const persist = async (remove = false) => {
    if (!target) return;
    const cleaned = amount.trim().replace(/,/g, '');
    const minor = Math.round(Number(cleaned) * 100);
    if (
      !remove &&
      (!/^\d+(?:\.\d{1,2})?$/.test(cleaned) ||
        !Number.isSafeInteger(minor) ||
        (target.kind === 'budget' && minor === 0))
    ) {
      setError('Enter a valid rupee amount with up to two decimal places.');
      return;
    }
    setSaving(true);
    try {
      if (target.kind === 'budget') {
        await setMonthlyBudget(remove ? null : minor);
      } else {
        await setAccountMinimumBalance(
          target.accountId,
          remove ? null : minor,
        );
      }
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal visible={target != null} transparent animationType="slide">
      <View style={s.modalBackdrop}>
        <Pressable style={s.modalDismissArea} onPress={onClose} />
        <View style={s.categorySheet}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetEyebrow}>SPENDING CONTROLS</Text>
          <Text style={s.sheetTitle}>
            {target?.kind === 'budget'
              ? 'Monthly budget'
              : `Minimum for ${target?.accountName ?? 'account'}`}
          </Text>
          <Text style={s.inputLabel}>AMOUNT IN RUPEES</Text>
          <TextInput
            value={amount}
            onChangeText={value => {
              setAmount(value);
              setError(null);
            }}
            placeholder="e.g. 10000.00"
            placeholderTextColor="#9DA8A1"
            keyboardType="decimal-pad"
            style={s.merchantInput}
            accessibilityLabel="Amount in rupees"
          />
          <Text style={s.sheetHelp}>
            {target?.kind === 'budget'
              ? 'This amount is reserved from your primary bank balance before the daily maximum is calculated.'
              : 'Your account cushion is the latest SMS balance minus this minimum.'}
          </Text>
          {error && <Text style={s.inputError}>{error}</Text>}
          <Pressable
            onPress={() => persist()}
            disabled={saving}
            style={s.saveCategoryButton}
          >
            <Text style={s.saveCategoryText}>
              {saving ? 'Saving…' : 'Save target'}
            </Text>
          </Pressable>
          {target?.currentMinor != null && (
            <Pressable
              onPress={() => persist(true)}
              disabled={saving}
              style={s.removeGoalButton}
            >
              <Text style={s.removeGoalText}>Remove target</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}
function Setting({
  title,
  detail,
  action,
  onPress,
}: {
  title: string;
  detail: string;
  action: string;
  onPress?: () => void;
}) {
  return (
    <View style={s.settingRow}>
      <View style={s.flex}>
        <Text style={s.settingTitle}>{title}</Text>
        <Text style={s.settingDetail}>{detail}</Text>
      </View>
      <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button"
        accessibilityLabel={`${title}: ${action}`} style={s.smallButton}>
        <Text style={s.smallButtonText}>{action}</Text>
      </Pressable>
    </View>
  );
}
function Section({ title, action }: { title: string; action: string }) {
  return <SectionHeader title={title} meta={action} />;
}
function AttentionRow({ icon, title, detail, onPress }: {
  icon: IconName; title: string; detail: string; onPress: () => void;
}) {
  return <Pressable onPress={onPress} accessibilityRole="button"
    accessibilityLabel={`${title}. ${detail}`} style={({ pressed }) => [s.attentionRow, pressed && s.pressed]}>
    <View style={s.attentionIcon}><Icon name={icon} size={19} color={C.action} /></View>
    <View style={s.flex}><Text style={s.reviewTitle}>{title}</Text><Text style={s.reviewText}>{detail}</Text></View>
    <Icon name="chevron" size={18} color={C.subtle} />
  </Pressable>;
}
function Empty({ title, detail, action, onAction }: {
  title: string; detail: string; action?: string; onAction?: () => void;
}) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyText}>{detail}</Text>
      {action && onAction && <Pressable onPress={onAction} accessibilityRole="button"
        style={s.emptyAction}><Text style={s.emptyActionText}>{action}</Text></Pressable>}
    </View>
  );
}
function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={s.button} onPress={onPress} accessibilityRole="button">
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
function TabBar({
  selected,
  onSelect,
  bottom,
}: {
  selected: Tab;
  onSelect: (t: Tab) => void;
  bottom: number;
}) {
  const tabs: Array<{ id: Tab; icon: IconName; label: string }> = [
    { id: 'home', icon: 'home', label: 'Home' },
    { id: 'transactions', icon: 'activity', label: 'Activity' },
    { id: 'finance', icon: 'plan', label: 'Plan' },
    { id: 'analytics', icon: 'insights', label: 'Insights' },
  ];
  return (
    <View style={[s.tabBar, { paddingBottom: Math.max(bottom, 10) }]}>
      {tabs.map(x => (
        <Pressable key={x.id} style={s.tab} onPress={() => onSelect(x.id)}
          accessibilityRole="tab" accessibilityLabel={x.label} accessibilityState={{ selected: selected === x.id }}>
          <View
            style={[s.tabIconWrap, selected === x.id && s.tabIconActiveWrap]}
          >
            <Icon name={x.icon} size={21} color={selected === x.id ? C.primary : C.muted} />
          </View>
          <Text style={[s.tabLabel, selected === x.id && s.tabLabelActive]}>
            {x.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.canvas },
  mainScroll: { flex: 1 },
  activityScreen: { flex: 1, paddingHorizontal: spacing.xl },
  activityBody: { flex: 1 },
  activityHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg },
  activityHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  activityAdd: { backgroundColor: C.primary, borderRadius: radii.md, paddingHorizontal: spacing.md, minHeight: 44, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  activityAddText: { color: C.surface, fontSize: typeScale.caption, fontWeight: '800' },
  activityProfile: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.limeSoft, borderWidth: 1, borderColor: '#DCE9BB', alignItems: 'center', justifyContent: 'center' },
  activityControls: { backgroundColor: C.surface, borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: C.lineSoft, ...shadows.card },
  activityChipRow: { paddingRight: 4 },
  activityFilterLabel: { color: C.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginTop: 1 },
  activitySearchWrap: { backgroundColor: C.canvas, borderRadius: radii.md, paddingLeft: spacing.md, flexDirection: 'row', alignItems: 'center' },
  activitySearch: { flex: 1, paddingHorizontal: spacing.sm, minHeight: 44, color: C.ink },
  activityList: { flex: 1 },
  activityListContent: { paddingBottom: spacing.xxl },
  activityListRow: { backgroundColor: C.surface, paddingHorizontal: spacing.md },
  flex: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.canvas,
    padding: 28,
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 28, fontWeight: '800', color: C.lime },
  loadingTitle: {
    marginTop: 20,
    fontSize: 20,
    fontWeight: '700',
    color: C.ink,
  },
  loader: { marginTop: 18 },
  errorIcon: { fontSize: 28, fontWeight: '900', color: C.red },
  errorText: { color: C.muted, textAlign: 'center', marginVertical: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 18,
    paddingBottom: 24,
  },
  eyebrow: {
    fontSize: typeScale.caption,
    fontWeight: '800',
    letterSpacing: 1.6,
    color: C.action,
  },
  pageTitle: {
    fontSize: typeScale.display,
    lineHeight: 38,
    fontWeight: '800',
    color: C.ink,
    letterSpacing: -0.7,
    marginTop: 4,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: C.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: C.primary, fontWeight: '900', fontSize: 16 },
  balanceCard: {
    backgroundColor: C.primary,
    borderRadius: radii.xl,
    padding: spacing.xxl,
    ...shadows.card,
  },
  balanceTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  darkMuted: {
    color: '#A9BBB4',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  privatePill: {
    backgroundColor: '#2B5145',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  privateText: {
    color: C.lime,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  balance: {
    color: '#FFF',
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1.4,
    marginTop: 18,
  },
  balanceCaption: { color: '#A9BBB4', fontSize: 12, marginTop: 5 },
  captureWarning: { backgroundColor: C.warningSoft, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.md },
  captureWarningText: { color: C.warning, fontSize: typeScale.caption, fontWeight: '700' },
  homeActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  quickAdd: { flex: 1, backgroundColor: C.lime, borderRadius: radii.md, padding: spacing.md, alignItems: 'center', justifyContent: 'center', minHeight: 48, flexDirection: 'row', gap: spacing.sm },
  quickAddText: { color: C.primary, fontWeight: '800', fontSize: typeScale.label },
  secondaryAction: { flex: 1, backgroundColor: C.surface, borderRadius: radii.md, padding: spacing.md, alignItems: 'center', justifyContent: 'center', minHeight: 48, flexDirection: 'row', gap: spacing.sm, borderWidth: 1, borderColor: C.line },
  secondaryActionText: { color: C.primary, fontWeight: '800', fontSize: typeScale.label },
  attentionCard: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  attentionRow: { flexDirection: 'row', alignItems: 'center', minHeight: 68, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  attentionIcon: { width: 38, height: 38, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: C.limeSoft },
  allClear: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  allClearIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: C.limeSoft },
  allClearMark: { color: C.action, fontWeight: '900', fontSize: 18 },
  planCard: {
    backgroundColor: C.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: C.lineSoft,
    ...shadows.card,
  },
  planItem: { flex: 1, paddingRight: 8 },
  planLabel: {
    color: C.muted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  planValue: {
    color: C.primary,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 6,
  },
  planDanger: { color: C.red },
  planHint: { color: C.muted, fontSize: 10, marginTop: 4 },
  incomeComparisonCard: { backgroundColor: C.surface, borderRadius: radii.lg, padding: spacing.lg, marginTop: spacing.md, borderWidth: 1, borderColor: C.lineSoft, ...shadows.card },
  incomeComparisonValue: { color: C.primary, fontSize: 21, fontWeight: '800', marginTop: 8 },
  incomeComparisonShortfall: { color: C.red },
  incomeComparisonNote: { color: C.muted, fontSize: 11, marginTop: 5, lineHeight: 16 },
  monthlyProgressCard: { marginTop: spacing.md },
  monthlyProgressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  monthlyProgressValue: { color: C.ink, fontSize: typeScale.body, fontWeight: '800', marginTop: spacing.xs },
  monthlyProgressMeta: { color: C.action, fontSize: typeScale.heading, fontWeight: '900' },
  cashFlowCard: { backgroundColor: C.surface, borderRadius: radii.lg, padding: spacing.lg, borderWidth: 1, borderColor: C.lineSoft, ...shadows.card },
  cashFlowValue: { color: C.primary, fontSize: 21, fontWeight: '800', marginTop: 8 },
  cashFlowNegative: { color: C.red },
  cashFlowTotals: { flexDirection: 'row', gap: 16, borderTopWidth: 1, borderTopColor: C.line, marginTop: 15, paddingTop: 13 },
  cashFlowCaption: { color: C.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  cashFlowIn: { color: C.primary, fontSize: 14, fontWeight: '800', marginTop: 5 },
  cashFlowOut: { color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 5 },
  cashFlowNote: { color: C.muted, fontSize: 11, lineHeight: 16, marginTop: 11 },
  cashFlowAction: { alignSelf: 'flex-start', marginTop: 12, minHeight: 44, justifyContent: 'center' },
  incomeSnapshotList: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 14, paddingTop: 4 },
  incomeSnapshotRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 8 },
  incomeSnapshotName: { flex: 1, color: C.ink, fontSize: 12, fontWeight: '700' },
  incomeSnapshotAmount: { color: C.primary, fontSize: 12, fontWeight: '800' },
  cashFlowModal: { flex: 1, backgroundColor: C.canvas, paddingHorizontal: 20 },
  cashFlowModalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  cashFlowModalTitle: { color: C.ink, fontSize: 27, fontWeight: '800', marginTop: 4 },
  cashFlowModalClose: { backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  cashFlowModalCloseText: { color: C.surface, fontSize: 12, fontWeight: '800' },
  cashFlowList: { paddingBottom: 22 },
  cashFlowListItem: { backgroundColor: C.surface, borderRadius: 16, marginBottom: 8, paddingHorizontal: 10 },
  healthRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderBottomColor: C.line, borderBottomWidth: 1 },
  analyticsIncomeLink: { alignSelf: 'flex-start', marginTop: 10 },
  analyticsDrillRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'center', paddingVertical: 13, borderBottomColor: C.line, borderBottomWidth: 1, minHeight: 48 },
  summaryRow: {
    flexDirection: 'row',
    marginTop: 26,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#315449',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: '#315449',
    marginHorizontal: 18,
  },
  metricValue: { color: '#FFF', fontSize: 15, fontWeight: '700', marginTop: 5 },
  manageIncomeButton: { alignSelf: 'flex-start', marginTop: 14, paddingVertical: 4 },
  manageIncomeText: { color: C.lime, fontSize: 11, fontWeight: '800' },
  incomeModal: { flex: 1, backgroundColor: C.canvas, paddingHorizontal: 20 },
  incomeModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  incomeTotalCard: { backgroundColor: C.lime, borderRadius: 20, padding: 18, marginBottom: 14 },
  incomeTotalValue: { color: C.primary, fontSize: 29, fontWeight: '900', marginTop: 6 },
  incomeSearch: { backgroundColor: C.surface, borderRadius: 14, color: C.ink, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 },
  incomeWindowNote: { color: C.muted, fontSize: 12, marginBottom: 12, lineHeight: 18 },
  incomeList: { paddingBottom: 24 },
  incomeCandidate: { backgroundColor: C.surface, borderRadius: 16, padding: 13, marginBottom: 9 },
  incomeCandidateMain: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  incomeCheckbox: { width: 23, height: 23, borderRadius: 7, borderWidth: 1.5, borderColor: '#B2BDB5', alignItems: 'center', justifyContent: 'center' },
  incomeCheckboxSelected: { backgroundColor: C.primary, borderColor: C.primary },
  incomeCheckmark: { color: C.lime, fontSize: 14, fontWeight: '900' },
  incomeResetButton: { alignSelf: 'flex-start', marginLeft: 34, paddingTop: 10 },
  incomeResetText: { color: C.primary, fontSize: 11, fontWeight: '800' },
  duplicateNotice: { backgroundColor: '#FFF3E6', borderRadius: 14, padding: 12, marginVertical: 12 },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF6E9',
    borderRadius: 18,
    padding: 14,
    marginTop: 16,
  },
  pressed: { opacity: 0.72 },
  reviewIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFDDAE',
    marginRight: 12,
  },
  reviewTitle: { color: C.ink, fontWeight: '700', fontSize: 13 },
  reviewText: { color: C.muted, fontSize: 11, marginTop: 2 },
  chevron: { fontSize: 24, color: C.muted },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 28,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
  sectionAction: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: C.muted,
  },
  card: { backgroundColor: C.surface, borderRadius: radii.lg, padding: spacing.lg, borderWidth: 1, borderColor: C.lineSoft, ...shadows.card },
  cardFlat: {
    backgroundColor: C.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: C.lineSoft,
    ...shadows.card,
  },
  snapshot: { flexDirection: 'row', alignItems: 'center' },
  donutWrap: {
    width: 116,
    height: 116,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutCenter: { position: 'absolute', alignItems: 'center' },
  donutValue: { fontSize: 16, fontWeight: '800', color: C.ink },
  donutLabel: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
    color: C.muted,
    marginTop: 2,
  },
  legend: { flex: 1, marginLeft: 20 },
  legendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 3, marginRight: 8 },
  legendLabel: { flex: 1, fontSize: 12, color: C.muted },
  legendValue: { fontSize: 12, fontWeight: '700', color: C.ink },
  txRow: { minHeight: 74, flexDirection: 'row', alignItems: 'center' },
  txBorder: { borderBottomWidth: 1, borderBottomColor: C.line },
  merchantIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  merchantInitial: { fontWeight: '900', fontSize: 16 },
  txTitleRow: { flexDirection: 'row', alignItems: 'center' },
  txTitle: { fontSize: 14, fontWeight: '700', color: C.ink, flexShrink: 1 },
  txMeta: { fontSize: 11, color: C.muted, marginTop: 4 },
  txNote: { fontSize: 11, color: C.primary, marginTop: 4, fontStyle: 'italic' },
  txAmount: { fontSize: 13, fontWeight: '800', color: C.ink },
  txRight: { alignItems: 'flex-end', marginLeft: 8, flexShrink: 0, maxWidth: '42%' },
  classifyHint: {
    color: C.muted,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 5,
  },
  positive: { color: '#278064' },
  reviewDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.orange,
    marginLeft: 6,
  },
  filterRow: { flexDirection: 'row', marginBottom: 22 },
  activityTabs: { flexDirection: 'row', backgroundColor: '#EAEFEB', borderRadius: radii.lg, padding: spacing.xs, marginBottom: spacing.md },
  activityTab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: radii.md },
  activityTabActive: { backgroundColor: C.surface, ...shadows.card },
  activityTabText: { color: C.muted, fontSize: 12, fontWeight: '800' },
  activityTabTextActive: { color: C.primary },
  pendingSummary: { flexDirection: 'row', backgroundColor: C.lime, borderRadius: 20, padding: 18, marginBottom: 20, gap: 12 },
  pendingSummaryValue: { color: C.primary, fontSize: 18, fontWeight: '900', marginTop: 5 },
  pendingCard: { backgroundColor: C.surface, borderRadius: 20, padding: 17, marginBottom: 12 },
  pendingTitle: { color: C.ink, fontSize: 16, fontWeight: '800' },
  pendingMeta: { color: C.muted, fontSize: 11, marginTop: 5 },
  pendingPerson: { borderTopColor: C.line, borderTopWidth: 1, marginTop: 14, paddingTop: 12 },
  pendingPersonTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pendingPersonName: { color: C.ink, fontSize: 13, fontWeight: '700', flex: 1 },
  pendingPersonAmount: { color: C.primary, fontSize: 14, fontWeight: '900' },
  pendingSettledRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  undoMatchButton: { alignSelf: 'flex-start', marginTop: 12 },
  pendingRepaymentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  pendingRepaymentInput: { flex: 1, backgroundColor: C.canvas, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, color: C.ink },
  pendingNote: { color: C.muted, fontSize: 10, lineHeight: 14, marginTop: 8 },
  homeMetricRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  homeMetricPill: { flex: 1, minHeight: 44, borderRadius: radii.md, borderWidth: 1, borderColor: C.line,
    backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  homePeriodRow: { flexDirection: 'row', marginBottom: 12 },
  activityPagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.md },
  paginationButton: { backgroundColor: C.surface, borderRadius: radii.md, paddingHorizontal: spacing.md, minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  paginationButtonDisabled: { opacity: 0.35 },
  paginationButtonText: { color: C.primary, fontSize: 12, fontWeight: '800' },
  paginationLabel: { color: C.muted, fontSize: 12, fontWeight: '700' },
  dayNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  dayArrow: {
    width: 38,
    height: 34,
    borderRadius: 11,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayArrowDisabled: { opacity: 0.35 },
  dayArrowText: { color: C.primary, fontSize: 25, lineHeight: 29 },
  dayLabel: { color: C.ink, fontSize: 13, fontWeight: '800' },
  homeActivityLink: { alignSelf: 'flex-end', paddingVertical: 12, paddingHorizontal: 4 },
  homeActivityLinkText: { color: C.primary, fontSize: 12, fontWeight: '800' },
  filterPill: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: C.surface,
  },
  filterActive: { backgroundColor: C.primary, borderColor: C.primary },
  filterText: { fontSize: 11, fontWeight: '700', color: C.muted },
  filterTextActive: { color: '#FFF' },
  resultCount: {
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: '800',
    color: C.muted,
    marginBottom: 10,
  },
  activityResultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activityClearFilters: { paddingHorizontal: 8, paddingVertical: 8, marginBottom: 6 },
  activityClearFiltersText: { fontSize: 12, fontWeight: '800', color: C.primary },
  analyticsHero: { backgroundColor: C.limeSoft, borderRadius: radii.xl, padding: spacing.xxl, borderWidth: 1, borderColor: '#DDE9BE' },
  analyticsLabel: {
    fontSize: 10,
    letterSpacing: 1.3,
    fontWeight: '800',
    color: '#54702B',
  },
  analyticsValue: {
    fontSize: 34,
    fontWeight: '900',
    color: C.primary,
    marginTop: 7,
  },
  analyticsSub: { fontSize: 11, color: '#54702B', marginTop: 3 },
  insightsMetricRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  insightMetric: { flex: 1, backgroundColor: C.surface, borderRadius: radii.md, padding: spacing.md, borderWidth: 1, borderColor: C.lineSoft, ...shadows.card },
  insightMetricLabel: { color: C.muted, fontSize: typeScale.caption, fontWeight: '700' },
  insightMetricValue: { color: C.ink, fontSize: typeScale.body, fontWeight: '900', marginTop: spacing.xs },
  guideValue: {
    color: C.primary,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 6,
  },
  guideDetail: { color: C.muted, fontSize: 12, marginTop: 7, lineHeight: 17 },
  barChart: {
    height: 154,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  barColumn: {
    flex: 1,
    height: 145,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barTrack: { height: 116, justifyContent: 'flex-end' },
  bar: { width: 22, borderRadius: 7 },
  barLabel: { fontSize: 9, color: C.muted, marginTop: 8, fontWeight: '600' },
  categoryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 9,
  },
  categoryGlyph: { width: 9, height: 36, borderRadius: 5, marginRight: 12 },
  categoryTop: { flexDirection: 'row', justifyContent: 'space-between' },
  categoryName: { fontSize: 12, fontWeight: '700', color: C.ink },
  categoryAmount: { fontSize: 11, fontWeight: '700', color: C.ink },
  progressTrack: {
    height: 4,
    backgroundColor: C.line,
    borderRadius: 3,
    marginTop: 7,
    overflow: 'hidden',
  },
  progressFill: { height: 4, borderRadius: 3 },
  categoryPercent: {
    width: 36,
    textAlign: 'right',
    fontSize: 10,
    fontWeight: '700',
    color: C.muted,
    marginLeft: 8,
  },
  privacyCard: { backgroundColor: C.limeSoft, borderRadius: radii.xl, padding: spacing.xxl, borderWidth: 1, borderColor: '#DDE9BE' },
  privacyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  privacyTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: C.primary,
    marginTop: 8,
  },
  privacyText: { fontSize: 12, lineHeight: 18, color: '#557068', marginTop: 6 },
  settingRow: { flexDirection: 'row', alignItems: 'center', minHeight: 72 },
  settingDivider: { height: 1, backgroundColor: C.line },
  settingTitle: { fontSize: 13, fontWeight: '700', color: C.ink },
  settingDetail: {
    fontSize: 10,
    lineHeight: 14,
    color: C.muted,
    marginTop: 4,
    paddingRight: 12,
  },
  smallButton: {
    backgroundColor: '#EDF0EA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallButtonText: { fontSize: 10, fontWeight: '800', color: C.primary },
  footnote: {
    fontSize: 10,
    color: C.muted,
    textAlign: 'center',
    marginTop: 28,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(13, 27, 21, 0.38)',
  },
  modalDismissArea: { flex: 1 },
  categorySheet: {
    backgroundColor: C.canvas,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    maxHeight: '88%',
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 30,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 3,
    backgroundColor: '#C8CEC9',
    marginBottom: 22,
  },
  sheetEyebrow: {
    color: C.muted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  sheetTitle: { color: C.ink, fontSize: 24, fontWeight: '800', marginTop: 5 },
  transactionSummary: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8, marginBottom: 12 },
  transactionSummaryAmount: { color: C.ink, fontSize: 18, fontWeight: '900' },
  transactionSummaryMeta: { color: C.muted, fontSize: 11, marginLeft: 12 },
  compactEditorToggle: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface,
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginTop: 8, borderWidth: 1, borderColor: C.line },
  compactEditorTitle: { color: C.ink, fontSize: 13, fontWeight: '800' },
  compactEditorPreview: { color: C.muted, fontSize: 11, marginTop: 3, paddingRight: 12 },
  compactEditorBody: { paddingTop: 10, paddingHorizontal: 2 },
  moreOptionsBody: { borderLeftWidth: 2, borderLeftColor: C.line, paddingLeft: 12, marginLeft: 8, paddingBottom: 4 },
  inputLabel: {
    color: C.muted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 16,
    marginBottom: 7,
  },
  merchantInput: {
    backgroundColor: C.surface,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 14,
    color: C.ink,
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  transactionNoteInput: { minHeight: 92, fontWeight: '400', lineHeight: 20 },
  noteFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 },
  noteCount: { color: C.muted, fontSize: 10 },
  noteSaveButton: { backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center' },
  noteSaveButtonText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
  transactionCategoryRow: { paddingRight: 12, marginHorizontal: -4 },
  sheetHelp: { color: C.muted, fontSize: 12, marginTop: 5, marginBottom: 18 },
  sharedEditor: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 18, paddingTop: 14, marginBottom: 18 },
  sharedEditorToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  sharedEditorTitle: { color: C.primary, fontSize: 15, fontWeight: '800' },
  sharedPersonBlock: { marginBottom: 9 },
  sharedPersonRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sharedNameInput: { flex: 1, minWidth: 90, fontSize: 12, paddingHorizontal: 9 },
  sharedAmountInput: { width: 100, fontSize: 12, paddingHorizontal: 9 },
  sharedRemove: { width: 30, alignItems: 'center' },
  sharedRemoveText: { color: C.red, fontSize: 26 },
  personSuggestionList: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.line, marginTop: 4, overflow: 'hidden' },
  personSuggestionLabel: { color: C.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 4 },
  personSuggestion: { paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line },
  personSuggestionText: { color: C.ink, fontSize: 12, fontWeight: '700' },
  sharedActions: { flexDirection: 'row', gap: 12, marginTop: 4, marginBottom: 14 },
  sharedActionButton: { paddingVertical: 7 },
  sharedActionText: { color: C.primary, fontSize: 11, fontWeight: '800' },
  sharedTotal: { color: C.ink, fontSize: 14, fontWeight: '800', marginBottom: 12 },
  categorySelectionHelp: { color: C.muted, fontSize: 11, marginBottom: 5 },
  categorySplitPanel: { backgroundColor: C.surface, borderRadius: 16, padding: 12, marginTop: 10 },
  categorySplitAmountLine: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 9 },
  categorySplitAmountLabel: { flex: 1, color: C.ink, fontSize: 12, fontWeight: '700' },
  categorySplitAmountInput: { width: 120, fontSize: 13, minHeight: 42, paddingVertical: 7 },
  inputError: { color: C.red, fontSize: 12, marginBottom: 8 },
  removeGoalButton: { alignItems: 'center', paddingVertical: 14 },
  removeGoalText: { color: C.red, fontSize: 12, fontWeight: '700' },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  categoryChip: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    margin: 4,
  },
  categoryCheckboxChip: { flexDirection: 'row', alignItems: 'center' },
  categoryCheckbox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5,
    borderColor: C.muted, alignItems: 'center', justifyContent: 'center', marginRight: 7 },
  categoryCheckboxSelected: { backgroundColor: C.lime, borderColor: C.lime },
  categoryCheckboxMark: { color: C.primary, fontSize: 11, fontWeight: '900' },
  categoryChipSelected: { backgroundColor: C.primary, borderColor: C.primary },
  categoryChipText: { color: C.ink, fontSize: 12, fontWeight: '700' },
  categoryChipTextSelected: { color: '#FFF' },
  categoryCreateToggle: { alignSelf: 'flex-start', paddingVertical: 14 },
  categoryCreateText: { color: C.primary, fontSize: 12, fontWeight: '800' },
  categoryCreateForm: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 12,
  },
  categoryCreateInput: {
    flex: 1,
    minWidth: 120,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    backgroundColor: C.surface,
    color: C.ink,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  categoryCreateButton: {
    marginLeft: 8,
    borderRadius: 12,
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  categoryCreateButtonText: { color: C.surface, fontSize: 12, fontWeight: '800' },
  categoryCreateCancel: { color: C.muted, fontSize: 11, padding: 10 },
  vendorRuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E9F0EC',
    borderRadius: 18,
    padding: 14,
    marginTop: 18,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#AAB5AE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxSelected: { backgroundColor: C.primary, borderColor: C.primary },
  checkmark: { color: C.lime, fontSize: 14, fontWeight: '900' },
  vendorRuleTitle: { color: C.ink, fontSize: 12, fontWeight: '800' },
  vendorRuleText: {
    color: C.muted,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 3,
  },
  saveCategoryButton: {
    backgroundColor: C.lime,
    borderRadius: 17,
    alignItems: 'center',
    paddingVertical: 15,
    marginTop: 14,
  },
  saveCategoryButtonDisabled: { opacity: 0.45 },
  saveCategoryText: { color: C.primary, fontSize: 13, fontWeight: '900' },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: C.ink },
  emptyText: {
    fontSize: 11,
    color: C.muted,
    textAlign: 'center',
    marginTop: 5,
  },
  emptyAction: { marginTop: 18, paddingHorizontal: 16, paddingVertical: 11,
    backgroundColor: C.primary, borderRadius: 12, minHeight: 44, justifyContent: 'center' },
  emptyActionText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  button: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  buttonText: { color: '#FFF', fontWeight: '800' },
  tabBar: {
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    backgroundColor: C.surface,
    flexDirection: 'row',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: C.lineSoft,
    ...shadows.navigation,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 54 },
  tabIconWrap: {
    width: 34,
    height: 28,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconActiveWrap: { backgroundColor: C.limeSoft },
  tabLabel: { fontSize: 11, color: C.muted, marginTop: 3, fontWeight: '700' },
  tabLabelActive: { color: C.primary },
});
