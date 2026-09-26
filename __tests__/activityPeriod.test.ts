import {
  calendarPeriodLabel,
  calendarPeriodRange,
  dayStart,
  shiftCalendarDay,
  transactionsForDay,
} from '../src/features/transactions/period';

const at = (day: number, hour = 12) => new Date(2026, 8, day, hour).getTime();

describe('Home daily activity', () => {
  const selected = new Date(2026, 8, 17, 12);
  const rows = [
    { id: 'future', occurredAt: at(18) },
    { id: 'today', occurredAt: at(17, 10) },
    { id: 'midnight', occurredAt: at(17, 0) },
    { id: 'yesterday', occurredAt: at(16) },
  ];

  it('uses local midnight and calendar-day navigation', () => {
    expect(dayStart(selected).getTime()).toBe(new Date(2026, 8, 17).getTime());
    expect(shiftCalendarDay(selected, -1).getTime()).toBe(new Date(2026, 8, 16).getTime());
    expect(shiftCalendarDay(new Date(2026, 8, 1), -1).getTime()).toBe(new Date(2026, 7, 31).getTime());
  });

  it('shows only transactions on the selected day, newest first', () => {
    expect(transactionsForDay(rows, selected).map(row => row.id)).toEqual(['today', 'midnight']);
    expect(transactionsForDay(rows, shiftCalendarDay(selected, -1)).map(row => row.id)).toEqual(['yesterday']);
  });

  it('builds calendar day, Monday-to-Sunday week, and month ranges', () => {
    const reference = new Date(2026, 8, 26, 18);

    expect(calendarPeriodRange('today', reference)).toEqual({
      start: new Date(2026, 8, 26),
      end: new Date(2026, 8, 27),
    });
    expect(calendarPeriodRange('week', reference)).toEqual({
      start: new Date(2026, 8, 21),
      end: new Date(2026, 8, 28),
    });
    expect(calendarPeriodRange('month', reference)).toEqual({
      start: new Date(2026, 8, 1),
      end: new Date(2026, 9, 1),
    });
  });

  it('moves between complete calendar periods and formats their labels', () => {
    const reference = new Date(2026, 8, 26, 18);

    expect(calendarPeriodRange('today', reference, -1).start).toEqual(new Date(2026, 8, 25));
    expect(calendarPeriodRange('week', reference, -1).start).toEqual(new Date(2026, 8, 14));
    expect(calendarPeriodRange('month', reference, -1).start).toEqual(new Date(2026, 7, 1));
    expect(calendarPeriodLabel('today', reference)).toBe('September 26 · Saturday');
    expect(calendarPeriodLabel('week', reference)).toBe('September 21 – 27');
    expect(calendarPeriodLabel('month', reference)).toBe('September 2026');
  });
});
