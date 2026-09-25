import {
  calculateDefaultDailyTarget,
  calculateMaximumDailySpending,
  calculateWeeklyBudgetPlan,
  resolveDailySpendingSnapshot,
} from '../src/features/budget/plan';

describe('weekly budget plan', () => {
  it('defaults to money above the minimum spread across the days left in the month', () => {
    expect(
      calculateDefaultDailyTarget(3_000_000, new Date(2026, 8, 17)),
    ).toBe(214_285);
    expect(
      calculateDefaultDailyTarget(2_800_000, new Date(2026, 1, 10)),
    ).toBe(147_368);
  });

  it('spreads the available balance across a partial final week', () => {
    expect(
      calculateDefaultDailyTarget(1_000_000, new Date(2026, 8, 29)),
    ).toBe(500_000);
  });

  it('does not recommend spending when the balance is below the minimum', () => {
    expect(
      calculateDefaultDailyTarget(-100_000, new Date(2026, 8, 17)),
    ).toBe(0);
  });

  it('uses the monthly budget as the month-end reserve when it is set', () => {
    expect(
      calculateMaximumDailySpending(
        5_500_000,
        2_700_000,
        1_000_000,
        new Date(2026, 8, 21),
      ),
    ).toBe(280_000);
  });

  it('falls back to the account minimum when no monthly budget is set', () => {
    expect(
      calculateMaximumDailySpending(
        5_500_000,
        null,
        1_000_000,
        new Date(2026, 8, 21),
      ),
    ).toBe(450_000);
  });

  it('cannot calculate a daily maximum without a balance and reserve', () => {
    expect(
      calculateMaximumDailySpending(null, 2_700_000, null, new Date(2026, 8, 21)),
    ).toBeNull();
    expect(
      calculateMaximumDailySpending(5_500_000, null, null, new Date(2026, 8, 21)),
    ).toBeNull();
  });

  it('keeps the same daily maximum until the next calendar day', () => {
    const first = resolveDailySpendingSnapshot(
      null,
      5_500_000,
      2_700_000,
      1_000_000,
      'bank:1234',
      new Date(2026, 8, 21, 0, 1),
    );
    const laterThatDay = resolveDailySpendingSnapshot(
      first,
      4_500_000,
      2_700_000,
      1_000_000,
      'bank:1234',
      new Date(2026, 8, 21, 18, 0),
    );
    const nextDay = resolveDailySpendingSnapshot(
      laterThatDay,
      4_500_000,
      2_700_000,
      1_000_000,
      'bank:1234',
      new Date(2026, 8, 22, 0, 1),
    );

    expect(first?.amountMinor).toBe(280_000);
    expect(laterThatDay?.amountMinor).toBe(280_000);
    expect(nextDay?.amountMinor).toBe(200_000);
  });

  it('spreads the unspent monthly budget over the days left', () => {
    expect(
      calculateWeeklyBudgetPlan(2000000, 800000, new Date(2026, 8, 17)),
    ).toEqual({
      remainingMinor: 1200000,
      overBudgetMinor: 0,
      dailyTargetMinor: 85714,
      weeklyTargetMinor: 600000,
      weeklyPaceMinor: 329412,
      daysRemaining: 14,
    });
  });

  it('never recommends more than the amount remaining in the last week', () => {
    const plan = calculateWeeklyBudgetPlan(
      1000000,
      900000,
      new Date(2026, 8, 29),
    );
    expect(plan.weeklyTargetMinor).toBe(100000);
    expect(plan.daysRemaining).toBe(2);
  });

  it('shows zero allowance and the overage once the budget is spent', () => {
    const plan = calculateWeeklyBudgetPlan(
      1000000,
      1200000,
      new Date(2026, 8, 17),
    );
    expect(plan.remainingMinor).toBe(0);
    expect(plan.overBudgetMinor).toBe(200000);
    expect(plan.weeklyTargetMinor).toBe(0);
  });
});
