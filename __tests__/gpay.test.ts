import {
  parseGpayReceipt,
  unambiguousMatches,
} from '../src/features/notifications/gpay';

const notification = (title: string) => ({
  id: 'fixture',
  title,
  postedAt: new Date('2026-09-16T10:00:00Z').getTime(),
});

describe('GPay credit notification parser', () => {
  it.each([
    ['TEST SENDER ALPHA paid you ₹300.00', 'TEST SENDER ALPHA', 30000],
    ['TEST SENDER GAMMA paid you ₹100.00', 'TEST SENDER GAMMA', 10000],
    ['TEST SENDER BETA paid you ₹200.00', 'TEST SENDER BETA', 20000],
    ['TEST SENDER DELTA paid you ₹3,441.00', 'TEST SENDER DELTA', 344100],
    ['  TEST   SENDER   BETA paid you ₹ 200.00  ', 'TEST SENDER BETA', 20000],
  ])('extracts the sender and amount from %s', (title, sender, amountMinor) => {
    expect(parseGpayReceipt(notification(title))).toMatchObject({
      sender,
      amountMinor,
    });
  });

  it.each([
    'Make your 1st Vi recharge on Google Pay',
    'You earned a reward!',
    'Did your recent payment go smoothly?',
    'Sample User requested ₹300.00',
  ])('ignores non-credit notification: %s', title => {
    expect(parseGpayReceipt(notification(title))).toBeNull();
  });

  it('does not guess when two receipts or credits could match', () => {
    expect(
      unambiguousMatches([
        { receiptId: 'a', candidates: ['sms-1'] },
        { receiptId: 'b', candidates: ['sms-1', 'sms-2'] },
        { receiptId: 'c', candidates: ['sms-3'] },
      ]),
    ).toEqual(new Map([['c', 'sms-3']]));
  });
});
