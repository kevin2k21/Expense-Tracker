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

export type CalendarPeriod = 'today' | 'week' | 'month';

export type CalendarPeriodRange = {
  start: Date;
  end: Date;
};

export function calendarPeriodRange(
  period: CalendarPeriod,
  reference: Date,
  offset = 0,
): CalendarPeriodRange {
  if (period === 'today') {
    const start = shiftCalendarDay(reference, offset);
    return { start, end: shiftCalendarDay(start, 1) };
  }

  if (period === 'week') {
    const start = dayStart(reference);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }

  const start = new Date(reference.getFullYear(), reference.getMonth() + offset, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return { start, end };
}

const monthName = (date: Date) => new Intl.DateTimeFormat('en-IN', {
  month: 'long',
}).format(date);

export function calendarPeriodLabel(
  period: CalendarPeriod,
  reference: Date,
  offset = 0,
): string {
  const { start, end } = calendarPeriodRange(period, reference, offset);
  if (period === 'today') {
    const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'long' }).format(start);
    return `${monthName(start)} ${start.getDate()} · ${weekday}`;
  }
  if (period === 'month') return `${monthName(start)} ${start.getFullYear()}`;

  const last = shiftCalendarDay(end, -1);
  if (start.getFullYear() !== last.getFullYear()) {
    return `${monthName(start)} ${start.getDate()}, ${start.getFullYear()} – ${monthName(last)} ${last.getDate()}, ${last.getFullYear()}`;
  }
  if (start.getMonth() !== last.getMonth()) {
    return `${monthName(start)} ${start.getDate()} – ${monthName(last)} ${last.getDate()}`;
  }
  return `${monthName(start)} ${start.getDate()} – ${last.getDate()}`;
}
