import { createBill, updateBill } from '../src/data/finance';
import { parseReminderTime } from '../src/features/notifications/reviewReminder';

const mockExecute = jest.fn(async () => ({ rows: [], rowsAffected: 1 }));
jest.mock('../src/data/database', () => ({
  getDatabaseHandle: () => ({ execute: mockExecute }),
}));

describe('recurring item usability', () => {
  beforeEach(() => mockExecute.mockClear());

  it('rejects invalid amounts and days before writing', async () => {
    await expect(createBill('Rent', NaN, 1, null)).rejects.toThrow('positive amount');
    await expect(createBill('Rent', 50_000, NaN, null)).rejects.toThrow('day from 1 to 31');
    await expect(createBill('Rent', 50_000, 2.5, null)).rejects.toThrow('day from 1 to 31');
    await expect(updateBill('bill-1', 'Rent', Infinity, 1)).rejects.toThrow('positive amount');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('edits a recurring item in place and preserves its receipt status and type', async () => {
    await updateBill('bill-1', '  Apartment rent  ', 125_000, 5);
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE recurring_bills SET name = ?, amount_minor = ?, due_day = ? WHERE id = ? AND active = 1',
      ['Apartment rent', 125_000, 5, 'bill-1']);
  });
});

describe('daily note reminder time', () => {
  it('accepts 24-hour times and rejects invalid drafts', () => {
    expect(parseReminderTime('22:30')).toEqual({ hour: 22, minute: 30 });
    expect(parseReminderTime(' 7:05 ')).toEqual({ hour: 7, minute: 5 });
    expect(parseReminderTime('24:00')).toBeNull();
    expect(parseReminderTime('20:60')).toBeNull();
    expect(parseReminderTime('abc')).toBeNull();
  });
});
