import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { FinanceHub } from '../src/features/finance/FinanceHub';
import type { FinanceSnapshot } from '../src/data/finance';

jest.mock('../src/data/finance', () => ({
  setExpectedSavingsIncome: jest.fn().mockResolvedValue(undefined),
  setGoalDeadline: jest.fn().mockResolvedValue(undefined),
  setGoalTarget: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/native/TransactionSms', () => ({ TransactionSms: {} }));

const { setExpectedSavingsIncome } = jest.requireMock('../src/data/finance');
const baseGuide = {
  monthKey: '2026-09', status: 'ready' as const, incomeSource: 'estimate' as const,
  incomeMinor: 200_000, expectedIncomeMinor: 200_000, requiredSavingsMinor: 100_000,
  savingsShortfallMinor: 0, spendingOverageMinor: 0, remainingSpendingMinor: 80_000,
  dailyLimitMinor: 6_153, weeklyLimitMinor: 43_076, daysRemaining: 13,
  overdueGoals: 0, untimedGoals: 0,
};
const data = { safeToSpendMinor: null, safePerDayMinor: null, primaryAccountId: null,
  primaryBalanceAsOf: null, primaryBalanceStale: true, bills: [],
  goals: [{ id: 'goal-1', name: 'Holiday', targetMinor: 300_000,
    allocatedMinor: 0, dueMonthKey: '2026-11' }],
  savingsGuide: baseGuide } as unknown as FinanceSnapshot;

function renderGuide(snapshot = data) {
  return renderer.create(<FinanceHub data={snapshot} transactions={[]} accounts={[]} categories={[]}
    onChanged={jest.fn()} onOpenTransaction={jest.fn()} requestedMode="Planning" />);
}

function visibleText(tree: renderer.ReactTestRenderer) {
  return tree.root.findAllByType(Text).map(node => node.props.children).flat(Infinity).join(' ');
}

describe('savings guidance in Planning', () => {
  it('labels estimates, shows both limits and lets the user update expected income', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderGuide(); });
    expect(visibleText(tree)).toContain('Estimates');
    expect(visibleText(tree)).toContain('Spend per day from today');
    expect(visibleText(tree)).toContain('Spend over the next 7 days');
    const field = tree.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'Expected income this month (₹)');
    expect(field?.props.value).toBe('2000');
    await act(async () => {
      field?.props.onChangeText('2500');
    });
    const saveLabel = tree.root.findAllByType(Text).find(node => node.props.children === 'Save expected income');
    expect(saveLabel).toBeDefined();
    let saveAction = saveLabel?.parent;
    while (saveAction && typeof saveAction.props.onPress !== 'function') saveAction = saveAction.parent;
    expect(saveAction).toBeDefined();
    await act(async () => { await saveAction?.props.onPress(); });
    expect(setExpectedSavingsIncome).toHaveBeenCalledWith('2026-09', 250_000);
  });

  it('hides the estimate editor when selected income is used', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderGuide({ ...data,
      savingsGuide: { ...baseGuide, incomeSource: 'received', expectedIncomeMinor: 200_000 } }); });
    expect(visibleText(tree)).toContain('Based on received income');
    expect(tree.root.findAllByType(TextInput).some(node =>
      node.props.accessibilityLabel === 'Expected income this month (₹)')).toBe(false);
  });

  it('layers planning tools behind focused section tabs', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderGuide(); });
    expect(visibleText(tree)).not.toContain('Goal target (₹)');
    const goalsLabel = tree.root.findAllByType(Text).find(node => node.props.children === 'Goals');
    expect(goalsLabel).toBeDefined();
    let goalsTab = goalsLabel?.parent;
    while (goalsTab && typeof goalsTab.props.onPress !== 'function') goalsTab = goalsTab.parent;
    await act(async () => { goalsTab?.props.onPress(); });
    expect(visibleText(tree)).toContain('Savings goals');
    expect(tree.root.findAllByType(TextInput).some(node => node.props.accessibilityLabel === 'Goal target (₹)')).toBe(true);
    expect(visibleText(tree)).not.toContain('Spending limits for your goals');
  });
});
