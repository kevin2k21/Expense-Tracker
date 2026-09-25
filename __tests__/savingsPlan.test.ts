import { calculateSavingsGuide, dueMonthForDuration, monthlySavingsForGoal, monthsThroughDeadline } from '../src/features/finance/savingsPlan';

const september18 = new Date(2026, 8, 18, 12);
const goal = (targetMinor: number, allocatedMinor: number, dueMonthKey: string | null) =>
  ({ targetMinor, allocatedMinor, dueMonthKey });

const guide = (overrides: Partial<Parameters<typeof calculateSavingsGuide>[0]> = {}) =>
  calculateSavingsGuide({
    goals: [goal(300_000, 0, '2026-11')], receivedIncomeMinor: 200_000,
    hasSelectedIncome: true, expectedIncomeMinor: null, personalSpentMinor: 20_000,
    monthlyBudgetMinor: null, today: september18, ...overrides,
  });

describe('savings spending guide', () => {
  it('counts the current month and crosses year boundaries', () => {
    expect(dueMonthForDuration(september18, 3)).toBe('2026-11');
    expect(dueMonthForDuration(new Date(2026, 11, 20), 3)).toBe('2027-02');
    expect(monthsThroughDeadline(september18, '2026-11')).toBe(3);
    expect(monthsThroughDeadline(new Date(2027, 0, 1), '2026-11')).toBe(-1);
    expect(() => dueMonthForDuration(september18, 0)).toThrow();
    expect(() => dueMonthForDuration(september18, 121)).toThrow();
  });

  it('combines outstanding goals and rounds each monthly contribution up', () => {
    const goals = [goal(100_001, 1, '2026-11'), goal(60_001, 0, '2026-10'),
      goal(200_000, 200_000, '2026-09'), goal(90_000, 0, null)];
    expect(monthlySavingsForGoal(goals[0], september18)).toBe(33_334);
    const result = guide({ goals });
    expect(result.requiredSavingsMinor).toBe(63_335);
    expect(result.untimedGoals).toBe(1);
    expect(result.overdueGoals).toBe(0);
  });

  it('requires all remaining savings from overdue goals this month', () => {
    const result = guide({ goals: [goal(150_000, 20_000, '2026-08')] });
    expect(result.requiredSavingsMinor).toBe(130_000);
    expect(result.overdueGoals).toBe(1);
  });

  it('uses an estimate only until any income is selected', () => {
    const estimate = guide({ hasSelectedIncome: false, expectedIncomeMinor: 300_000 });
    expect(estimate.status).toBe('ready');
    expect(estimate.incomeSource).toBe('estimate');
    expect(estimate.remainingSpendingMinor).toBe(180_000);
    const received = guide({ receivedIncomeMinor: 120_000, expectedIncomeMinor: 300_000 });
    expect(received.incomeSource).toBe('received');
    expect(received.remainingSpendingMinor).toBe(0);
    expect(received.savingsShortfallMinor).toBe(0);
    expect(guide({ hasSelectedIncome: false }).status).toBe('needs_income');
  });

  it('applies the stricter budget after reserving savings and past spending', () => {
    const result = guide({ monthlyBudgetMinor: 70_000 });
    expect(result.requiredSavingsMinor).toBe(100_000);
    expect(result.remainingSpendingMinor).toBe(50_000);
    expect(result.daysRemaining).toBe(13);
    expect(result.dailyLimitMinor).toBe(Math.floor(50_000 / 13));
    expect(result.weeklyLimitMinor).toBe(Math.floor(50_000 * 7 / 13));
  });

  it('shows zero limits and shortfalls when the goal or spending is unaffordable', () => {
    const result = guide({ receivedIncomeMinor: 80_000, personalSpentMinor: 25_000 });
    expect(result.savingsShortfallMinor).toBe(20_000);
    expect(result.spendingOverageMinor).toBe(25_000);
    expect(result.dailyLimitMinor).toBe(0);
    expect(result.weeklyLimitMinor).toBe(0);
  });

  it('caps the next-seven-days amount at the remaining monthly amount', () => {
    const result = guide({ today: new Date(2026, 8, 30, 12), personalSpentMinor: 99_900 });
    expect(result.daysRemaining).toBe(1);
    expect(result.remainingSpendingMinor).toBe(100);
    expect(result.dailyLimitMinor).toBe(100);
    expect(result.weeklyLimitMinor).toBe(100);
  });

  it('does not show a limit when no outstanding timed goal exists', () => {
    const result = guide({ goals: [goal(100_000, 100_000, '2026-11'), goal(50_000, 0, null)] });
    expect(result.status).toBe('no_goals');
    expect(result.dailyLimitMinor).toBeNull();
    expect(result.untimedGoals).toBe(1);
  });
});
