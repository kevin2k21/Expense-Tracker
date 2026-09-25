import {
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
});
