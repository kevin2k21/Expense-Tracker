import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { FinanceHub } from '../src/features/finance/FinanceHub';
import type { FinanceSnapshot } from '../src/data/finance';
import type { Transaction } from '../src/types';

jest.mock('../src/native/TransactionSms', () => ({ TransactionSms: {} }));
jest.mock('../src/data/finance', () => ({}));

const payment = (id: string, merchant: string, amountMinor: number): Transaction => ({
  id, merchant, amountMinor, accountId: 'bank', kind: amountMinor < 0 ? 'debit' : 'credit',
  category: 'Other', occurredAt: new Date(2026, 8, 18).getTime(),
  reportedBalanceMinor: null, source: 'sms', confidence: 1, reviewStatus: 'review',
});

it('shows one review action with a combined amount for a vendor on a selected day', async () => {
  const openTransaction = jest.fn();
  const data = { savingsGuide: { expectedIncomeMinor: null, monthKey: '2026-09' },
    reviewDays: [{ day: '2026-09-18', count: 3, flagged: 3, completed: false }] } as unknown as FinanceSnapshot;
  const rows = [payment('three', 'Other Shop', -2000), payment('one', 'Corner Shop', -10000),
    payment('two', 'corner-shop', -5000)];
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<FinanceHub data={data} transactions={rows} accounts={[]} categories={[]}
      onChanged={jest.fn()} onOpenTransaction={openTransaction} requestedMode="Review" />);
  });
  const dayText = tree.root.findAllByType(Text).find(node =>
    String(node.props.children).includes('2026-09-18 · 3 payments'));
  let dayAction = dayText?.parent;
  while (dayAction && typeof dayAction.props.onPress !== 'function') dayAction = dayAction.parent;
  expect(dayAction).toBeDefined();
  await act(async () => { dayAction?.props.onPress(); });
  const vendorTexts = tree.root.findAllByType(Text).filter(node =>
    String(node.props.children).includes('Corner Shop · 2 transactions'));
  expect(vendorTexts).toHaveLength(1);
  expect(vendorTexts[0].props.children).toContain('paid ₹150.00');
  const reviewLabels = tree.root.findAllByType(Text).map(node => String(node.props.children));
  expect(reviewLabels.findIndex(label => label.includes('Corner Shop · 2 transactions')))
    .toBeLessThan(reviewLabels.findIndex(label => label.includes('Other Shop · 1 transaction')));
  let vendorAction = vendorTexts[0].parent;
  while (vendorAction && typeof vendorAction.props.onPress !== 'function') vendorAction = vendorAction.parent;
  await act(async () => { vendorAction?.props.onPress(); });
  expect(openTransaction).toHaveBeenCalledWith('one');
});
