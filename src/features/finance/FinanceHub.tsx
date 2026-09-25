import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Account, Transaction } from '../../types';
import type { FinanceSnapshot } from '../../data/finance';
import { addExpensePaidByOther, allocateGoal, createBill, createGoal, deleteBill, deleteGoal, markBillDone, markDayReviewed,
  recordRepayment, setCategoryBudget, setExpectedSavingsIncome, setGoalDeadline, setGoalTarget as updateGoalTarget, setPrimaryAccount, splitTransaction, updateBill } from '../../data/finance';
import { monthlySavingsForGoal, monthsThroughDeadline } from './savingsPlan';
import { groupVendorTransactions } from '../../data/reviewGroups';
import { colors, radii, shadows, spacing, typeScale } from '../../ui/theme';
import { ScreenHeader } from '../../ui/primitives';

const rupees = (minor: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);
const parseMinor = (input: string) => Math.round(Number(input.replace(/,/g, '')) * 100);
type Mode = 'Planning' | 'Shared' | 'Review';
type PlanningSection = 'Overview' | 'Goals' | 'Budgets' | 'Recurring';

export function FinanceHub({ data, transactions, accounts, categories, onChanged, onOpenTransaction, requestedMode, onOpenSettings }: {
  data: FinanceSnapshot; transactions: Transaction[]; accounts: Account[]; categories: string[];
  onChanged: () => Promise<void> | void; onOpenTransaction: (transactionId: string) => void; requestedMode: Mode;
  onOpenSettings?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(requestedMode);
  const [planningSection, setPlanningSection] = useState<PlanningSection>('Overview');
  useEffect(() => setMode(requestedMode), [requestedMode]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [budgetCategory, setBudgetCategory] = useState(categories[0] ?? 'Other');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalAllocated, setGoalAllocated] = useState('0');
  const [goalMonths, setGoalMonths] = useState('3');
  const [goalEdits, setGoalEdits] = useState<Record<string, string>>({});
  const [targetEdits, setTargetEdits] = useState<Record<string, string>>({});
  const [deadlineEdits, setDeadlineEdits] = useState<Record<string, string>>({});
  const [expectedIncomeText, setExpectedIncomeText] = useState('');
  useEffect(() => setExpectedIncomeText(data.savingsGuide.expectedIncomeMinor == null ? '' :
    String(data.savingsGuide.expectedIncomeMinor / 100)),
  [data.savingsGuide.expectedIncomeMinor, data.savingsGuide.monthKey]);
  const [billName, setBillName] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [billDay, setBillDay] = useState('1');
  const [billKind, setBillKind] = useState<'debit' | 'credit'>('debit');
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [editingBillName, setEditingBillName] = useState('');
  const [editingBillAmount, setEditingBillAmount] = useState('');
  const [editingBillDay, setEditingBillDay] = useState('');
  const [calendarDay, setCalendarDay] = useState<number | null>(null);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [splitText, setSplitText] = useState('');
  const [splitSearch, setSplitSearch] = useState('');
  const [payer, setPayer] = useState('');
  const [payerAmount, setPayerAmount] = useState('');
  const [payerCategory, setPayerCategory] = useState('Other');
  const [repaymentAmounts, setRepaymentAmounts] = useState<Record<string, string>>({});
  const run = async (operation: () => Promise<void>, success?: () => void) => {
    try { await operation(); success?.(); await onChanged(); }
    catch (error) { Alert.alert('Could not save', error instanceof Error ? error.message : 'Please check your values.'); }
  };
  const dayRows = selectedDay ? transactions.filter(tx => {
    const d = new Date(tx.occurredAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === selectedDay;
  }) : [];
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const calendarDays = Array.from({ length: daysInMonth }, (_, index) => index + 1);
  return <View style={s.page}>
    <ScreenHeader eyebrow="Plan with confidence" title="Money plan" onProfile={onOpenSettings} />
    <View style={s.tabs}>{(['Planning', 'Shared', 'Review'] as Mode[]).map(item =>
      <Pressable key={item} onPress={() => setMode(item)} accessibilityRole="tab"
        accessibilityState={{ selected: mode === item }} style={[s.tab, mode === item && s.activeTab]}>
        <Text style={[s.tabText, mode === item && s.activeTabText]}>{item === 'Planning' ? 'Plan' : item}</Text>
      </Pressable>)}</View>
    {mode === 'Planning' && <>
      <View style={s.sectionTabs}>{(['Overview', 'Goals', 'Budgets', 'Recurring'] as PlanningSection[]).map(item =>
        <Pressable key={item} onPress={() => setPlanningSection(item)} accessibilityRole="tab"
          accessibilityState={{ selected: planningSection === item }}
          style={[s.sectionTab, planningSection === item && s.sectionTabActive]}>
          <Text style={[s.sectionTabText, planningSection === item && s.sectionTabTextActive]}>{item}</Text>
        </Pressable>)}</View>
      {planningSection === 'Overview' && <>
      <View style={s.hero}><Text style={s.heroLabel}>SAFE TO SPEND</Text>
        <Text style={s.heroValue}>{data.safeToSpendMinor == null ? 'Unavailable' : rupees(data.safeToSpendMinor)}</Text>
        <Text style={s.heroNote}>{data.safePerDayMinor == null ? 'Waiting for a recent bank-reported balance' :
          `${rupees(data.safePerDayMinor)} per day for the rest of this month`}</Text></View>
      <Heading text="This month" />
      <View style={s.card}>
        <Text style={s.rowLabel}>Spending limits for your goals</Text>
        <Text style={s.note}>{data.savingsGuide.status === 'no_goals'
          ? 'Add a goal with a deadline, or set months for an existing goal, to see spending limits.'
          : data.savingsGuide.status === 'needs_income'
            ? 'Choose this month’s income on Home or enter an expected income below to see estimates.'
            : `${data.savingsGuide.incomeSource === 'estimate' ? 'Estimates' : 'Based on received income'} · ${rupees(data.savingsGuide.incomeMinor ?? 0)} income this month`}</Text>
        {data.savingsGuide.status !== 'no_goals' &&
          <Line label="Save toward goals this month" value={rupees(data.savingsGuide.requiredSavingsMinor)} />}
        {data.savingsGuide.status === 'ready' && <>
          <Line label="Spend per day from today" value={rupees(data.savingsGuide.dailyLimitMinor ?? 0)} />
          <Line label="Spend over the next 7 days" value={rupees(data.savingsGuide.weeklyLimitMinor ?? 0)} />
          <Line label="Total left to spend this month" value={rupees(data.savingsGuide.remainingSpendingMinor ?? 0)} />
          {data.savingsGuide.savingsShortfallMinor > 0 &&
            <Text style={s.note}>Income is {rupees(data.savingsGuide.savingsShortfallMinor)} below this month’s savings requirement.</Text>}
          {data.savingsGuide.spendingOverageMinor > 0 &&
            <Text style={s.note}>Spending is {rupees(data.savingsGuide.spendingOverageMinor)} over this month’s limit.</Text>}
          <Text style={s.note}>Based on personal spending, with your monthly budget applied when it is stricter. This is separate from bank safe-to-spend.</Text>
        </>}
        {data.savingsGuide.overdueGoals > 0 &&
          <Text style={s.note}>{data.savingsGuide.overdueGoals} overdue goal{data.savingsGuide.overdueGoals === 1 ? '' : 's'}: the remaining target is included as catch-up savings this month.</Text>}
        {data.savingsGuide.untimedGoals > 0 &&
          <Text style={s.note}>{data.savingsGuide.untimedGoals} goal{data.savingsGuide.untimedGoals === 1 ? '' : 's'} without a deadline are excluded from these limits.</Text>}
        {data.savingsGuide.status !== 'no_goals' && data.savingsGuide.incomeSource !== 'received' && <>
          <Field label="Expected income this month (₹)" value={expectedIncomeText} onChange={setExpectedIncomeText} keyboard="numeric" />
          <Action label="Save expected income" onPress={() => run(() =>
            setExpectedSavingsIncome(data.savingsGuide.monthKey, parseMinor(expectedIncomeText)))} />
          {data.savingsGuide.expectedIncomeMinor != null &&
            <Action label="Clear expected income" onPress={() => run(() =>
              setExpectedSavingsIncome(data.savingsGuide.monthKey, null))} />}
        </>}
        {data.savingsGuide.incomeSource === 'received' && data.savingsGuide.expectedIncomeMinor != null &&
          <Text style={s.note}>Your saved income estimate is ignored now that income is selected.</Text>}
      </View></>}
      {planningSection === 'Goals' && <>
      <Heading text="Savings goals" />
      <View style={s.card}>{data.goals.map(goal => <View key={goal.id} style={s.debt}>
        <Text style={s.rowLabel}>{goal.name} · {rupees(goal.allocatedMinor)} of {rupees(goal.targetMinor)}</Text>
        <Text style={s.note}>{goal.dueMonthKey
          ? `Due ${new Date(Number(goal.dueMonthKey.slice(0, 4)), Number(goal.dueMonthKey.slice(5)) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}${monthsThroughDeadline(new Date(), goal.dueMonthKey) < 1 ? ' · Overdue' : ''} · ${rupees(monthlySavingsForGoal(goal, new Date()))} needed this month`
          : 'No deadline yet · excluded from spending limits'}</Text>
        <Field label="Goal target (₹)" value={targetEdits[goal.id] ?? String(goal.targetMinor / 100)}
          onChange={value => setTargetEdits(current => ({ ...current, [goal.id]: value }))} keyboard="numeric" />
        <Action label="Update target" onPress={() => run(() =>
          updateGoalTarget(goal.id, parseMinor(targetEdits[goal.id] ?? String(goal.targetMinor / 100))))} />
        <Field label="Reserved amount (₹)" value={goalEdits[goal.id] ?? String(goal.allocatedMinor / 100)}
          onChange={value => setGoalEdits(current => ({ ...current, [goal.id]: value }))} keyboard="numeric" />
        <Action label="Update allocation" onPress={() => run(() => allocateGoal(goal.id, parseMinor(goalEdits[goal.id] ?? String(goal.allocatedMinor / 100))))} />
        <Field label="Months from now to reach this goal" value={deadlineEdits[goal.id] ?? ''}
          onChange={value => setDeadlineEdits(current => ({ ...current, [goal.id]: value }))} keyboard="numeric" />
        <Action label={goal.dueMonthKey ? 'Change deadline' : 'Set deadline'} onPress={() => run(
          () => setGoalDeadline(goal.id, Number(deadlineEdits[goal.id] ?? '')),
          () => setDeadlineEdits(current => ({ ...current, [goal.id]: '' })))} />
        <Action label="Remove goal" onPress={() => Alert.alert('Remove goal?', 'This does not move bank money.', [
          { text: 'Cancel' }, { text: 'Remove', style: 'destructive', onPress: () => run(() => deleteGoal(goal.id)) }])} />
      </View>)}
        <Field label="New goal" value={goalName} onChange={setGoalName} />
        <Field label="Target (₹)" value={goalTarget} onChange={setGoalTarget} keyboard="numeric" />
        <Field label="Already reserved (₹)" value={goalAllocated} onChange={setGoalAllocated} keyboard="numeric" />
        <Field label="Months to reach goal (1–120)" value={goalMonths} onChange={setGoalMonths} keyboard="numeric" />
        <Action label="Create goal" onPress={() => run(() => createGoal(goalName, parseMinor(goalTarget),
          parseMinor(goalAllocated), Number(goalMonths)),
          () => { setGoalName(''); setGoalTarget(''); setGoalAllocated('0'); setGoalMonths('3'); })} />
        <Text style={s.note}>Reserved amounts track your progress. Saving or editing a goal does not move money.</Text>
      </View></>}
      {planningSection === 'Budgets' && <>
      <Heading text="Primary account" />
      <View style={s.card}>{accounts.filter(account => account.type === 'bank').map(account =>
        <Action key={account.id} label={`${account.id === data.primaryAccountId ? '✓ ' : ''}${account.name}`}
          onPress={() => run(() => setPrimaryAccount(account.id))} />)}
        <Text style={s.note}>Balance reported {data.primaryBalanceAsOf ? new Date(data.primaryBalanceAsOf).toLocaleString('en-IN') : 'never'}{data.primaryBalanceStale ? ' · stale' : ''}.
          Savings and upcoming approved bills are reserved before the budget cap.</Text></View>
      <Heading text="Category budgets" />
      <View style={s.card}><View style={s.pills}>{categories.map(category => <Action key={category}
        label={`${category === budgetCategory ? '✓ ' : ''}${category}`} onPress={() => setBudgetCategory(category)} />)}</View>
        <Field label="Monthly limit (₹)" value={budgetAmount} onChange={setBudgetAmount} keyboard="numeric" />
        <Action label="Save category budget" onPress={() => run(() => setCategoryBudget(budgetCategory, parseMinor(budgetAmount)), () => setBudgetAmount(''))} /></View></>}
      {planningSection === 'Recurring' && <>
      <Heading text="Financial calendar" />
      <View style={s.card}>
        <Text style={s.note}>{new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date())} · approved bills and expected income</Text>
        <View style={s.calendar}>{calendarDays.map(day => {
          const items = data.bills.filter(bill => Math.min(bill.dueDay, daysInMonth) === day);
          return <Pressable key={day} onPress={() => setCalendarDay(day)} style={[s.calendarCell, calendarDay === day && s.calendarSelected]}>
            <Text style={s.calendarDay}>{day}</Text>
            <Text style={s.calendarMarker}>{items.some(item => item.kind === 'debit') ? '●' : ''}{items.some(item => item.kind === 'credit') ? '●' : ''}</Text>
          </Pressable>;
        })}</View>
        {calendarDay && data.bills.filter(bill => Math.min(bill.dueDay, daysInMonth) === calendarDay).map(bill =>
          <Line key={bill.id} label={`${bill.kind === 'credit' ? 'Expected income' : 'Bill'} · ${bill.name}`} value={rupees(bill.amountMinor)} />)}
      </View>
      <Heading text="Recurring items" />
      <View style={s.card}>
        <Text style={s.note}>Only items you add appear in the calendar. Upcoming expenses reserve money in bank safe-to-spend; expected income does not count in the savings guide until you select the received credit on Home.</Text>
        {data.bills.map(bill => <View key={bill.id} style={s.debt}>
        <Text style={s.rowLabel}>{bill.kind === 'credit' ? 'Income' : 'Bill'} · {bill.name} · day {bill.dueDay}{'\n'}{rupees(bill.amountMinor)}</Text>
        <Action label={bill.doneThisMonth ? '✓ Done this month · undo' : bill.kind === 'credit' ? 'Mark received' : 'Mark paid'}
          onPress={() => run(() => markBillDone(bill.id, !bill.doneThisMonth))} />
        {editingBillId === bill.id ? <>
          <Field label="Edit item name" value={editingBillName} onChange={setEditingBillName} />
          <Field label="Edit amount (₹)" value={editingBillAmount} onChange={setEditingBillAmount} keyboard="numeric" />
          <Field label="Edit day of month (1–31)" value={editingBillDay} onChange={setEditingBillDay} keyboard="numeric" />
          <Action label="Save changes" onPress={() => run(() => updateBill(bill.id, editingBillName,
            parseMinor(editingBillAmount), Number(editingBillDay)), () => setEditingBillId(null))} />
          <Action label="Cancel editing" onPress={() => setEditingBillId(null)} />
        </> : <Action label="Edit recurring item" onPress={() => {
          setEditingBillId(bill.id);
          setEditingBillName(bill.name);
          setEditingBillAmount(String(bill.amountMinor / 100));
          setEditingBillDay(String(bill.dueDay));
        }} />}
        <Action label="Remove recurring item" onPress={() => Alert.alert('Remove recurring item?', bill.name, [
          { text: 'Cancel' }, { text: 'Remove', style: 'destructive', onPress: () => run(() => deleteBill(bill.id)) }])} />
      </View>)}
        <View style={s.pills}><Action label={`${billKind === 'debit' ? '✓ ' : ''}Expense`} onPress={() => setBillKind('debit')} />
          <Action label={`${billKind === 'credit' ? '✓ ' : ''}Expected income`} onPress={() => setBillKind('credit')} /></View>
        <Field label="Item name" value={billName} onChange={setBillName} />
        <Field label="Amount (₹)" value={billAmount} onChange={setBillAmount} keyboard="numeric" />
        <Field label="Day of month (1–31)" value={billDay} onChange={setBillDay} keyboard="numeric" />
        <Action label="Add recurring item" onPress={() => run(() => createBill(billName, parseMinor(billAmount), Number(billDay), data.primaryAccountId, billKind),
          () => { setBillName(''); setBillAmount(''); })} />
      </View></>}
    </>}
    {mode === 'Shared' && <>
      <View style={s.hero}><Text style={s.heroLabel}>PAID FOR FRIENDS THIS MONTH</Text>
        <Text style={s.heroValue}>{rupees(data.obligations.filter(x => x.direction === 'receivable' &&
          new Date(x.createdAt).getMonth() === new Date().getMonth() &&
          new Date(x.createdAt).getFullYear() === new Date().getFullYear())
          .reduce((sum, x) => sum + x.amountMinor, 0))}</Text>
        <Text style={s.heroNote}>Tracked separately from your own spending and the full bank outflow.</Text></View>
      <View style={s.card}>
        <Line label="Others owe you" value={rupees(data.obligations.filter(x => x.direction === 'receivable').reduce((sum, x) => sum + x.remainingMinor, 0))} />
        <Line label="You owe others" value={rupees(data.obligations.filter(x => x.direction === 'payable').reduce((sum, x) => sum + x.remainingMinor, 0))} />
        <Line label="Repayments recorded" value={rupees(data.obligations.reduce((sum, x) => sum + x.paidMinor, 0))} />
      </View>
      <Heading text="Split a payment" />
      <View style={s.card}><Text style={s.note}>Choose a debit, then enter each friend’s share as Name:amount, separated by commas.</Text>
        <Field label="Search older payments by merchant" value={splitSearch} onChange={setSplitSearch} />
        {transactions.filter(tx => tx.amountMinor < 0 && tx.kind === 'debit' && tx.source !== 'demo' &&
          (tx.source !== 'notification' || tx.reviewStatus === 'confirmed') &&
          (!splitSearch || tx.merchant.toLowerCase().includes(splitSearch.toLowerCase())))
          .slice(0, splitSearch ? 50 : 20).map(tx =>
          <Action key={tx.id} label={`${splitId === tx.id ? '✓ ' : ''}${tx.merchant} · ${rupees(-tx.amountMinor)}`}
            onPress={() => setSplitId(tx.id)} />)}
        <Field label="Example: Person A:100, Person B:50" value={splitText} onChange={setSplitText} />
        <Action label="Save split" onPress={() => run(async () => {
          if (!splitId) throw new Error('Choose a payment');
          const people = splitText.split(',').map(part => { const [name, amount] = part.split(':');
            return { name: name?.trim() ?? '', amountMinor: parseMinor(amount ?? '') }; });
          await splitTransaction(splitId, people);
        }, () => { setSplitText(''); setSplitId(null); })} /></View>
      <Heading text="Someone paid for you" />
      <View style={s.card}><Field label="Person" value={payer} onChange={setPayer} />
        <Field label="Your share (₹)" value={payerAmount} onChange={setPayerAmount} keyboard="numeric" />
        <View style={s.pills}>{categories.map(category => <Action key={category}
          label={`${category === payerCategory ? '✓ ' : ''}${category}`} onPress={() => setPayerCategory(category)} />)}</View>
        <Action label="Record what you owe" onPress={() => run(() => addExpensePaidByOther(payer, parseMinor(payerAmount), payerCategory),
          () => { setPayer(''); setPayerAmount(''); })} /></View>
      <Heading text="Amounts to settle" />
      <View style={s.card}>{data.obligations.filter(x => x.remainingMinor > 0).map(item => <View key={item.id} style={s.debt}>
        <Text style={s.rowLabel}>{item.direction === 'receivable' ? `${item.person} owes you` : `You owe ${item.person}`}</Text>
        <Text style={s.rowValue}>{rupees(item.remainingMinor)} of {rupees(item.amountMinor)}</Text>
        <Field label="Partial repayment (₹)" value={repaymentAmounts[item.id] ?? ''}
          onChange={value => setRepaymentAmounts(current => ({ ...current, [item.id]: value }))} keyboard="numeric" />
        <Action label="Record cash / off-ledger repayment" onPress={() => run(() => recordRepayment(item.id,
          parseMinor(repaymentAmounts[item.id] ?? ''), null), () => setRepaymentAmounts(current => ({ ...current, [item.id]: '' })))} />
        {transactions.filter(tx => tx.merchant.toLowerCase() === item.person.toLowerCase() &&
          (item.direction === 'receivable' ? tx.amountMinor > 0 : tx.amountMinor < 0) &&
          Math.abs(tx.amountMinor) <= item.remainingMinor).slice(0, 3).map(tx =>
            <Action key={tx.id} label={`Link ${rupees(Math.abs(tx.amountMinor))} ${item.direction === 'receivable' ? 'received' : 'paid'} on ${new Date(tx.occurredAt).toLocaleDateString('en-IN')}`}
              onPress={() => run(() => recordRepayment(item.id, Math.abs(tx.amountMinor), tx.id))} />)}
      </View>)}</View>
      <Heading text="Suggested matches" />
      <View style={s.card}>{data.repaymentSuggestions.length ? data.repaymentSuggestions.map(item => {
        const debt = data.obligations.find(x => x.id === item.obligationId);
        return <Action key={`${item.transactionId}-${item.obligationId}`}
          label={`Confirm ${rupees(item.amountMinor)} from ${debt?.person ?? 'friend'}`}
          onPress={() => run(() => recordRepayment(item.obligationId, item.amountMinor, item.transactionId))} />;
      }) : <Text style={s.note}>No unambiguous repayment suggestions.</Text>}</View>
    </>}
    {mode === 'Review' && <>
      <Heading text="Days to review" />
      <View style={s.card}>{data.reviewDays.filter(day => !day.completed).map(day => <Action key={day.day}
        label={`${day.day} · ${day.count} payments${day.flagged ? ` · ${day.flagged} need attention` : ''}`}
        onPress={() => setSelectedDay(day.day)} />)}</View>
      {selectedDay && <><Heading text={selectedDay} /><View style={s.card}>{groupVendorTransactions(dayRows).map(group =>
        <Action key={group.key} label={`${group.needsReview ? '● ' : ''}${group.representative.merchant} · ${group.count} transaction${group.count === 1 ? '' : 's'}${group.outgoingMinor ? ` · paid ${rupees(group.outgoingMinor)}` : ''}${group.incomingMinor ? ` · received ${rupees(group.incomingMinor)}` : ''}${group.unverifiedCount ? ` · ${group.unverifiedCount} unverified` : ''}`}
          onPress={() => onOpenTransaction(group.representative.id)} />)}
        <Action label="Mark this day reviewed" onPress={() => run(async () => {
          await markDayReviewed(selectedDay);
        }, () => setSelectedDay(null))} />
      </View></>}
      <Heading text="Reviewed days" /><View style={s.card}>{data.reviewDays.filter(day => day.completed).slice(0, 15).map(day =>
        <Line key={day.day} label={day.day} value={`${day.count} checked`} />)}</View>
    </>}
  </View>;
}

function Heading({ text }: { text: string }) { return <Text style={s.heading}>{text}</Text>; }
function Line({ label, value }: { label: string; value: string }) { return <View style={s.row}>
  <Text style={s.rowLabel}>{label}</Text><Text style={s.rowValue}>{value}</Text></View>; }
function Action({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable onPress={onPress} accessibilityRole="button" style={s.action}>
  <Text style={s.actionText}>{label}</Text></Pressable>; }
function Field({ label, value, onChange, keyboard }: { label: string; value: string; onChange: (value: string) => void; keyboard?: 'numeric' }) {
  return <View style={s.field}><Text style={s.note}>{label}</Text><TextInput value={value} onChangeText={onChange}
    accessibilityLabel={label}
    keyboardType={keyboard} style={s.input} placeholder={label} placeholderTextColor="#809087" /></View>;
}
const s = StyleSheet.create({
  page: { paddingTop: spacing.lg, paddingBottom: spacing.xxxl },
  eyebrow: { color: colors.action, letterSpacing: 1.3, fontSize: typeScale.caption, fontWeight: '800' },
  title: { fontSize: typeScale.display, lineHeight: 38, fontWeight: '800', letterSpacing: -0.7, color: colors.ink, marginTop: spacing.xs, marginBottom: spacing.xl },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg, backgroundColor: '#EAEFEB', borderRadius: radii.lg, padding: spacing.xs },
  tab: { flex: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  activeTab: { backgroundColor: colors.surface, ...shadows.card },
  tabText: { color: colors.muted, fontSize: typeScale.label, fontWeight: '700' }, activeTabText: { color: colors.primary },
  sectionTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  sectionTab: { borderRadius: radii.pill, paddingHorizontal: spacing.md, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  sectionTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sectionTabText: { color: colors.muted, fontSize: typeScale.caption, fontWeight: '800' },
  sectionTabTextActive: { color: colors.surface },
  hero: { backgroundColor: colors.primary, borderRadius: radii.xl, padding: spacing.xxl, ...shadows.card },
  heroLabel: { color: colors.lime, fontSize: typeScale.caption, letterSpacing: 1.3, fontWeight: '800' },
  heroValue: { color: colors.surface, fontSize: typeScale.display, fontWeight: '800', letterSpacing: -0.6, marginTop: spacing.sm },
  heroNote: { color: '#D7E5DC', marginTop: spacing.sm, lineHeight: 20 },
  heading: { fontSize: typeScale.heading, lineHeight: 25, color: colors.ink, fontWeight: '800', marginTop: spacing.xxl, marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.lineSoft, marginBottom: spacing.md, ...shadows.card },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  rowLabel: { flex: 1, color: colors.ink, fontSize: typeScale.label, fontWeight: '700' },
  rowValue: { color: colors.action, fontSize: typeScale.label, fontWeight: '800', textAlign: 'right' },
  note: { color: colors.muted, fontSize: typeScale.label, lineHeight: 20, marginVertical: spacing.xs },
  action: { backgroundColor: colors.limeSoft, paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radii.md, marginVertical: spacing.xs, minHeight: 44, justifyContent: 'center' },
  actionText: { color: colors.primary, fontSize: typeScale.label, fontWeight: '800' },
  field: { marginTop: spacing.md },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, paddingHorizontal: spacing.md, minHeight: 46, color: colors.ink, backgroundColor: colors.canvas },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  debt: { marginVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: spacing.lg },
  calendar: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  calendarCell: { width: '14.28%', alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: radii.sm },
  calendarSelected: { backgroundColor: colors.lime }, calendarDay: { color: colors.ink, fontWeight: '700' },
  calendarMarker: { color: colors.warning, fontSize: 9, height: 11 },
});
