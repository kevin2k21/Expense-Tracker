import { assignedIncomeMonth, compareMonthlyIncomeAndSpending, incomeWindowStart, monthKeyFor, recentIncomeCandidates, selectedIncomeForPeriod, sortIncomeCandidatesByAmount, totalAssignedIncome, validIncomeMonth } from '../src/features/finance/incomeMonth';

describe('income month assignment', () => {
  const august31 = new Date(2026, 7, 31, 23, 0).getTime();

  it('leaves every unselected credit out of income', () => {
    expect(monthKeyFor(august31)).toBe('2026-08');
    expect(assignedIncomeMonth('salary', new Map())).toBeNull();
  });

  it('can count an August credit in September without changing its date', () => {
    const assignments = new Map<string, string | null>([['salary', '2026-09']]);
    expect(assignedIncomeMonth('salary', assignments)).toBe('2026-09');
    expect(monthKeyFor(august31)).toBe('2026-08');
  });

  it('can leave one credit unselected while another is selected', () => {
    const assignments = new Map<string, string | null>([['reimbursement', null]]);
    expect(assignedIncomeMonth('reimbursement', assignments)).toBeNull();
    expect(assignedIncomeMonth('salary', assignments)).toBeNull();
  });

  it('counts each selected credit in exactly its assigned month', () => {
    const credits = [
      { assignedMonthKey: '2026-09', amountMinor: 50_000 }, // August pay moved to September
      { assignedMonthKey: '2026-09', amountMinor: 10_000 }, // September pay
      { assignedMonthKey: '2026-08', amountMinor: 2_000 },
      { assignedMonthKey: null, amountMinor: 5_000 },
    ];
    expect(totalAssignedIncome(credits, '2026-09')).toBe(60_000);
    expect(totalAssignedIncome(credits, '2026-08')).toBe(2_000);
    expect(totalAssignedIncome(credits, '2026-10')).toBe(0);
  });

  it('uses assignment for the month view and actual receipt date for day and week views', () => {
    const now = new Date(2026, 8, 18, 18).getTime();
    const credits = [
      { id: 'august-pay', occurredAt: august31, assignedMonthKey: '2026-09' },
      { id: 'this-week', occurredAt: new Date(2026, 8, 16).getTime(), assignedMonthKey: '2026-09' },
      { id: 'today', occurredAt: new Date(2026, 8, 18, 12).getTime(), assignedMonthKey: '2026-09' },
      { id: 'unselected', occurredAt: new Date(2026, 8, 18, 13).getTime(), assignedMonthKey: null },
    ];
    expect(selectedIncomeForPeriod(credits, 'month', now).map(item => item.id))
      .toEqual(['august-pay', 'this-week', 'today']);
    expect(selectedIncomeForPeriod(credits, 'week', now).map(item => item.id))
      .toEqual(['this-week', 'today']);
    expect(selectedIncomeForPeriod(credits, 'today', now).map(item => item.id))
      .toEqual(['today']);
  });

  it('shows only credits from the local date 30 days ago through now', () => {
    const now = new Date(2026, 8, 18, 14, 30).getTime();
    const start = new Date(2026, 7, 19).getTime();
    expect(incomeWindowStart(now)).toBe(start);
    const credits = [
      { id: 'before', occurredAt: start - 1 },
      { id: 'first', occurredAt: start },
      { id: 'august-pay', occurredAt: august31 },
      { id: 'today', occurredAt: now },
      { id: 'future', occurredAt: now + 1 },
    ];
    expect(recentIncomeCandidates(credits, now).map(item => item.id))
      .toEqual(['first', 'august-pay', 'today']);
  });

  it('sorts selectable credits by highest amount, then newest date', () => {
    const credits = [
      { id: 'small', amountMinor: 100, occurredAt: 30 },
      { id: 'older-large', amountMinor: 500, occurredAt: 10 },
      { id: 'newer-large', amountMinor: 500, occurredAt: 20 },
    ];
    expect(sortIncomeCandidatesByAmount(credits).map(item => item.id))
      .toEqual(['newer-large', 'older-large', 'small']);
    expect(credits.map(item => item.id)).toEqual(['small', 'older-large', 'newer-large']);
  });

  it('validates calendar month keys', () => {
    expect(validIncomeMonth('2026-09')).toBe(true);
    expect(validIncomeMonth('2026-13')).toBe(false);
    expect(validIncomeMonth('2026-9')).toBe(false);
  });

  it('does not report a shortfall until income is selected', () => {
    expect(compareMonthlyIncomeAndSpending(0, 50_000, false))
      .toEqual({ status: 'unavailable', differenceMinor: null });
  });

  it('shows the monthly surplus, shortfall, or break-even amount', () => {
    expect(compareMonthlyIncomeAndSpending(100_000, 60_000, true))
      .toEqual({ status: 'surplus', differenceMinor: 40_000 });
    expect(compareMonthlyIncomeAndSpending(40_000, 60_000, true))
      .toEqual({ status: 'shortfall', differenceMinor: -20_000 });
    expect(compareMonthlyIncomeAndSpending(60_000, 60_000, true))
      .toEqual({ status: 'even', differenceMinor: 0 });
  });
});
