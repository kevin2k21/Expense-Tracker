import type { Transaction } from '../../types';
import { calendarPeriodRange } from './period';

export type ActivityPeriod = 'all' | 'today' | 'week' | 'month';
export type TransactionFilter = 'All' | 'Expenses' | 'Income' | 'Review';
export type HomeMoneyView = 'spending' | 'income' | 'netflow';

export function paginateActivityRows<T>(
  rows: T[],
  requestedPage: number,
  pageSize = 10,
): { rows: T[]; page: number; pageCount: number; total: number } {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(rows.length / safePageSize));
  const page = Math.min(Math.max(0, Math.floor(requestedPage)), pageCount - 1);
  return {
    rows: rows.slice(page * safePageSize, (page + 1) * safePageSize),
    page,
    pageCount,
    total: rows.length,
  };
}

export function filterActivityByType<T extends Transaction>(rows: T[], filter: TransactionFilter): T[] {
  if (filter === 'All' || filter === 'Review') return rows;
  return rows.filter(tx => filter === 'Expenses' ? tx.amountMinor < 0 : tx.amountMinor > 0);
}

export function filterActivityRows<T extends Transaction>(rows: T[], options: {
  query: string;
  accountId: string | null;
  period: ActivityPeriod;
  now: number;
  peopleByTransaction?: Map<string, string[]>;
}): T[] {
  const date = new Date(options.now);
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const month = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const weekDate = new Date(today);
  weekDate.setDate(weekDate.getDate() - ((date.getDay() + 6) % 7));
  const start = options.period === 'today' ? today : options.period === 'week' ? weekDate.getTime() :
    options.period === 'month' ? month : Number.NEGATIVE_INFINITY;
  const query = options.query.trim().toLocaleLowerCase();
  return rows.filter(item => item.occurredAt >= start && (options.period === 'all' || item.occurredAt <= options.now) &&
    (options.accountId == null || item.accountId === options.accountId) &&
    (!query || item.merchant.toLocaleLowerCase().includes(query) ||
      item.note?.toLocaleLowerCase().includes(query) ||
      (options.peopleByTransaction?.get(item.id) ?? []).some(name => name.toLocaleLowerCase().includes(query))));
}

export function filterHomeActivityRows<T extends Transaction>(
  rows: T[],
  period: Exclude<ActivityPeriod, 'all'>,
  view: HomeMoneyView,
  now: number,
  periodOffset = 0,
): T[] {
  const range = calendarPeriodRange(period, new Date(now), periodOffset);
  const end = periodOffset === 0 ? Math.min(range.end.getTime(), now + 1) : range.end.getTime();
  return rows.filter(tx => tx.occurredAt >= range.start.getTime() && tx.occurredAt < end)
    .filter(tx => tx.source !== 'demo' &&
    !(tx.source === 'manual' && tx.possibleDuplicate) &&
    (tx.source !== 'notification' || tx.reviewStatus === 'confirmed') &&
    (view === 'spending' ? tx.amountMinor < 0 :
      view === 'income' ? tx.amountMinor > 0 : tx.amountMinor !== 0))
    .sort((left, right) => right.occurredAt - left.occurredAt);
}

export function homeActivityPage<T extends Transaction>(
  rows: T[],
  period: Exclude<ActivityPeriod, 'all'>,
  view: HomeMoneyView,
  now: number,
  requestedPage: number,
  pageSize = 5,
  periodOffset = 0,
): { rows: T[]; page: number; pageCount: number; total: number } {
  const filtered = filterHomeActivityRows(rows, period, view, now, periodOffset);
  return paginateActivityRows(filtered, requestedPage, pageSize);
}
