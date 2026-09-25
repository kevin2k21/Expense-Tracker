import { parseTransactionNotification } from '../src/features/notifications/transaction';

const notification = (title: string, body = '', packageName = 'com.google.android.apps.nbu.paisa.user') =>
  ({ id: 'event-1', title, body, packageName, postedAt: 1_789_577_000_000 });

describe('payment notification parser', () => {
  it('extracts the sender and amount from a GPay receipt', () => {
    expect(parseTransactionNotification(notification('TEST SENDER ALPHA paid you ₹300.00', 'vp and sample event for Sample Person day')))
      .toMatchObject({ kind: 'credit', merchant: 'TEST SENDER ALPHA', amountMinor: 30000 });
  });
  it('extracts an outgoing payment and a reference when present', () => {
    expect(parseTransactionNotification(notification('Paid ₹1,234.50 to Sample Food Court', 'RRN 900000000001', 'com.phonepe.app')))
      .toMatchObject({ kind: 'debit', merchant: 'Sample Food Court', amountMinor: 123450,
        referenceId: '900000000001', packageName: 'com.phonepe.app' });
  });
  it('parses a bank app alert without treating the beneficiary credit as income', () => {
    expect(parseTransactionNotification(notification('IDFC FIRST Bank',
      'Your A/c XX4242 debited by Rs. 200.00 on 16/09/26; SAMPLE PERSON credited. RRN 900000000001. Available balance Rs. 10,000.00.',
      'com.idfcfirstbank.mobile'))).toMatchObject({
      kind: 'debit', merchant: 'SAMPLE PERSON', amountMinor: 20000,
      referenceId: '900000000001', accountLastFour: '4242',
    });
  });
  it.each([
    'Make your 1st Vi recharge on Google Pay',
    'You earned a reward!',
    'Payment request from Sample User for ₹100.00',
    'Your account will be debited by ₹69.00',
    'Paid ₹100 to Sample User failed',
  ])('rejects non-transaction alert: %s', title => {
    expect(parseTransactionNotification(notification(title))).toBeNull();
  });
});
