export type WeeklyBudgetPlan = {
  remainingMinor: number;
  overBudgetMinor: number;
  dailyTargetMinor: number;
  weeklyTargetMinor: number;
  weeklyPaceMinor: number;
  daysRemaining: number;
};

export type DailySpendingSnapshot = {
  day: string;
  accountId: string;
  reserveKind: 'budget' | 'minimum';
  reserveMinor: number;
  amountMinor: number;
};

const localDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function calculateDefaultDailyTarget(
  aboveMinimumMinor: number,
  today: Date,
): number {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
  const daysRemaining = Math.max(
    1,
    Math.round(
      (Date.UTC(year, month + 1, 1) - Date.UTC(year, month, day)) /
        86_400_000,
    ),
  );
  const availableMinor = Math.max(0, aboveMinimumMinor);
  return Math.floor(availableMinor / daysRemaining);
}

export function calculateMaximumDailySpending(
  balanceMinor: number | null,
  monthlyBudgetMinor: number | null,
  minimumBalanceMinor: number | null,
  today: Date,
): number | null {
  const reserveMinor = monthlyBudgetMinor ?? minimumBalanceMinor;
  if (balanceMinor == null || reserveMinor == null) return null;
  return calculateDefaultDailyTarget(balanceMinor - reserveMinor, today);
}

export function resolveDailySpendingSnapshot(
  existing: unknown,
  balanceMinor: number | null,
  monthlyBudgetMinor: number | null,
  minimumBalanceMinor: number | null,
  accountId: string | null,
  today: Date,
): DailySpendingSnapshot | null {
  const reserveKind = monthlyBudgetMinor != null ? 'budget' : 'minimum';
  const reserveMinor = monthlyBudgetMinor ?? minimumBalanceMinor;
  if (accountId == null || reserveMinor == null) return null;

  const day = localDayKey(today);
  if (existing != null && typeof existing === 'object') {
    const snapshot = existing as Partial<DailySpendingSnapshot>;
    if (
      snapshot.day === day &&
      snapshot.accountId === accountId &&
      snapshot.reserveKind === reserveKind &&
      snapshot.reserveMinor === reserveMinor &&
      Number.isSafeInteger(snapshot.amountMinor) &&
      (snapshot.amountMinor ?? -1) >= 0
    ) {
      return snapshot as DailySpendingSnapshot;
    }
  }

  const amountMinor = calculateMaximumDailySpending(
    balanceMinor,
    monthlyBudgetMinor,
    minimumBalanceMinor,
    today,
  );
  return amountMinor == null
    ? null
    : { day, accountId, reserveKind, reserveMinor, amountMinor };
}

export function calculateWeeklyBudgetPlan(
  monthlyBudgetMinor: number,
  spentThisMonthMinor: number,
  today: Date,
): WeeklyBudgetPlan {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
  const daysRemaining = Math.max(
    1,
    Math.round(
      (Date.UTC(year, month + 1, 1) - Date.UTC(year, month, day)) /
        86_400_000,
    ),
  );
  const remainingMinor = Math.max(0, monthlyBudgetMinor - spentThisMonthMinor);
  return {
    remainingMinor,
    overBudgetMinor: Math.max(0, spentThisMonthMinor - monthlyBudgetMinor),
    dailyTargetMinor: Math.floor(remainingMinor / daysRemaining),
    weeklyTargetMinor: Math.min(
      remainingMinor,
      Math.floor((remainingMinor * 7) / daysRemaining),
    ),
    weeklyPaceMinor: Math.round((spentThisMonthMinor * 7) / day),
    daysRemaining,
  };
}
