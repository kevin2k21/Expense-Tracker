import { monthKeyFor, validIncomeMonth } from './incomeMonth';

export type TimedSavingsGoal = {
  targetMinor: number;
  allocatedMinor: number;
  dueMonthKey: string | null;
};

export type SavingsGuide = {
  monthKey: string;
  status: 'no_goals' | 'needs_income' | 'ready';
  incomeSource: 'received' | 'estimate' | null;
  incomeMinor: number | null;
  expectedIncomeMinor: number | null;
  requiredSavingsMinor: number;
  savingsShortfallMinor: number;
  spendingOverageMinor: number;
  remainingSpendingMinor: number | null;
  dailyLimitMinor: number | null;
  weeklyLimitMinor: number | null;
  daysRemaining: number;
  overdueGoals: number;
  untimedGoals: number;
};

export function dueMonthForDuration(today: Date, months: number): string {
  if (!Number.isSafeInteger(months) || months < 1 || months > 120) {
    throw new Error('Enter a number of months from 1 to 120');
  }
  return monthKeyFor(new Date(today.getFullYear(), today.getMonth() + months - 1, 1).getTime());
}

export function monthsThroughDeadline(today: Date, dueMonthKey: string): number {
  if (!validIncomeMonth(dueMonthKey)) throw new Error('Invalid goal deadline');
  const [year, month] = dueMonthKey.split('-').map(Number);
  return (year - today.getFullYear()) * 12 + month - (today.getMonth() + 1) + 1;
}

export function monthlySavingsForGoal(goal: TimedSavingsGoal, today: Date): number {
  if (!goal.dueMonthKey) return 0;
  const remaining = Math.max(0, goal.targetMinor - goal.allocatedMinor);
  return Math.ceil(remaining / Math.max(1, monthsThroughDeadline(today, goal.dueMonthKey)));
}

export function calculateSavingsGuide(input: {
  goals: TimedSavingsGoal[];
  receivedIncomeMinor: number;
  hasSelectedIncome: boolean;
  expectedIncomeMinor: number | null;
  personalSpentMinor: number;
  monthlyBudgetMinor: number | null;
  today: Date;
}): SavingsGuide {
  const { goals, today } = input;
  const monthKey = monthKeyFor(today.getTime());
  const outstandingTimedGoals = goals.filter(goal =>
    goal.dueMonthKey !== null && goal.targetMinor > goal.allocatedMinor);
  const requiredSavingsMinor = outstandingTimedGoals.reduce(
    (sum, goal) => sum + monthlySavingsForGoal(goal, today), 0);
  const overdueGoals = outstandingTimedGoals.filter(goal =>
    monthsThroughDeadline(today, goal.dueMonthKey!) < 1).length;
  const untimedGoals = goals.filter(goal =>
    goal.dueMonthKey === null && goal.targetMinor > goal.allocatedMinor).length;
  const incomeSource = input.hasSelectedIncome ? 'received' :
    input.expectedIncomeMinor !== null ? 'estimate' : null;
  const incomeMinor = incomeSource === 'received' ? input.receivedIncomeMinor :
    incomeSource === 'estimate' ? input.expectedIncomeMinor : null;
  const daysRemaining = Math.round((Date.UTC(today.getFullYear(), today.getMonth() + 1, 1) -
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
  const status = outstandingTimedGoals.length === 0 ? 'no_goals' :
    incomeMinor === null ? 'needs_income' : 'ready';
  const incomeBasedCap = incomeMinor === null ? null : Math.max(0, incomeMinor - requiredSavingsMinor);
  const spendingCap = incomeBasedCap === null ? null : input.monthlyBudgetMinor === null ? incomeBasedCap :
    Math.min(incomeBasedCap, input.monthlyBudgetMinor);
  const remainingSpendingMinor = status !== 'ready' || spendingCap === null ? null :
    Math.max(0, spendingCap - input.personalSpentMinor);
  return {
    monthKey, status, incomeSource, incomeMinor,
    expectedIncomeMinor: input.expectedIncomeMinor,
    requiredSavingsMinor,
    savingsShortfallMinor: incomeMinor === null ? 0 : Math.max(0, requiredSavingsMinor - incomeMinor),
    spendingOverageMinor: spendingCap === null ? 0 : Math.max(0, input.personalSpentMinor - spendingCap),
    remainingSpendingMinor,
    dailyLimitMinor: remainingSpendingMinor === null ? null : Math.floor(remainingSpendingMinor / daysRemaining),
    weeklyLimitMinor: remainingSpendingMinor === null ? null :
      Math.min(remainingSpendingMinor, Math.floor(remainingSpendingMinor * 7 / daysRemaining)),
    daysRemaining, overdueGoals, untimedGoals,
  };
}
