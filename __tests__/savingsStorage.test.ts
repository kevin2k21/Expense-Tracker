import { createGoal, setExpectedSavingsIncome, setGoalDeadline, setGoalTarget } from '../src/data/finance';

const mockExecute = jest.fn(async (sql: string) => sql.includes('SELECT allocated_minor')
  ? { rows: [{ allocated_minor: 25_000 }], rowsAffected: 0 }
  : { rows: [], rowsAffected: 1 });

jest.mock('../src/data/database', () => ({
  getDatabaseHandle: () => ({ execute: mockExecute }),
}));

describe('savings data writes', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 18, 12));
    mockExecute.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('persists a new goal with its calendar-month deadline', async () => {
    await createGoal('Holiday', 300_000, 25_000, 3);
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('due_month_key'),
      expect.arrayContaining(['Holiday', 300_000, 25_000, '2026-11']));
    await setGoalDeadline('goal-1', 4);
    expect(mockExecute).toHaveBeenCalledWith('UPDATE savings_goals SET due_month_key = ? WHERE id = ?',
      ['2026-12', 'goal-1']);
  });

  it('persists target edits and rejects a target below reserved money', async () => {
    await setGoalTarget('goal-1', 150_000);
    expect(mockExecute).toHaveBeenCalledWith('UPDATE savings_goals SET target_minor = ? WHERE id = ?',
      [150_000, 'goal-1']);
    await expect(setGoalTarget('goal-1', 20_000)).rejects.toThrow('reserved amount');
  });

  it('stores or clears only the current month estimate', async () => {
    await setExpectedSavingsIncome('2026-09', 200_000);
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('savings_income_estimates'),
      ['2026-09', 200_000]);
    await setExpectedSavingsIncome('2026-09', null);
    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM savings_income_estimates WHERE month_key = ?', ['2026-09']);
    await expect(setExpectedSavingsIncome('2026-10', 100_000)).rejects.toThrow('current month');
  });
});
