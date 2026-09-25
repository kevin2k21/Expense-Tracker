export function dayStart(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

export function shiftCalendarDay(day: Date, offset: number): Date {
  const shifted = dayStart(day);
  shifted.setDate(shifted.getDate() + offset);
  return shifted;
}

export function transactionsForDay<T extends { occurredAt: number }>(
  transactions: T[],
  day: Date,
): T[] {
  const from = dayStart(day).getTime();
  const until = shiftCalendarDay(day, 1).getTime();
  return transactions
    .filter(transaction => transaction.occurredAt >= from && transaction.occurredAt < until)
    .sort((a, b) => b.occurredAt - a.occurredAt);
}
