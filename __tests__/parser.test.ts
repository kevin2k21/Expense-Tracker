import { parseTransactionSms } from '../src/features/sms/parser';
import type { PendingSms } from '../src/types';

const sms = (body: string): PendingSms => ({
  id: 'fixture',
  sender: 'HDFCBK',
  body,
  receivedAt: new Date('2026-09-16T10:00:00Z').getTime(),
});

describe('transaction SMS parser', () => {
  it('parses an Indian debit alert and its reported balance', () => {
    const parsed = parseTransactionSms(
      sms('Rs.850.00 debited from A/c XX1204 at SWIGGY. Avl Bal: Rs.24,350.00'),
    );
    expect(parsed).toMatchObject({
      amountMinor: 85000,
      kind: 'debit',
      accountLastFour: '1204',
      reportedBalanceMinor: 2435000,
      category: 'Other',
    });
    expect(parsed?.merchant.toLowerCase()).toContain('swiggy');
  });

  it('takes credit amount from the bank SMS but reserves sender for GPay', () => {
    const parsed = parseTransactionSms(
      sms('INR 45,000.00 credited to A/c XX8842 from ACME PAYROLL via NEFT. Avl Bal Rs. 51,000.00'),
    );
    expect(parsed).toMatchObject({
      amountMinor: 4500000,
      kind: 'credit',
      merchant: 'Unknown merchant',
      category: 'Other',
      accountLastFour: '8842',
    });
  });

  it('takes credit amount and balance from the same SMS', () => {
    const parsed = parseTransactionSms(
      sms(
        'Your A/c XX4242 credited by Rs. 2,500.00 on 16/09/26 by TEST SENDER EPSILON. RRN 900000000003. Available balance Rs. 12,345.67.',
      ),
    );

    expect(parsed).toMatchObject({
      amountMinor: 250000,
      kind: 'credit',
      merchant: 'Unknown merchant',
      category: 'Other',
      accountLastFour: '4242',
      reportedBalanceMinor: 1234567,
    });
  });

  it('does not use SMS transfer metadata as the sender name', () => {
    const parsed = parseTransactionSms(
      sms(
        'INR 750.00 received in A/c XX4242 from TEST SENDER ZETA via UPI. Avl Bal Rs. 13,095.67',
      ),
    );

    expect(parsed).toMatchObject({
      kind: 'credit',
      merchant: 'Unknown merchant',
      category: 'Other',
    });
  });

  it('marks an IDFC credit with no sender as needing a name', () => {
    const parsed = parseTransactionSms(
      sms(
        'Your A/C XXXXX004242 is credited with INR 212.00 on 15/09/26 10:34. Your new balance is INR 10,000.00. Team IDFC FIRST Bank',
      ),
    );

    expect(parsed).toMatchObject({
      amountMinor: 21200,
      kind: 'credit',
      merchant: 'Unknown merchant',
      category: 'Other',
      accountLastFour: '4242',
      reportedBalanceMinor: 1000000,
    });
  });

  it('reads the newest IDFC credit balance rather than only its amount', () => {
    expect(
      parseTransactionSms(
        sms(
          'Your A/C XXXXX004242 is credited with INR 100.00 on 16/09/26 23:28. Your new balance is INR 10,100.00. Team IDFC FIRST Bank',
        ),
      ),
    ).toMatchObject({
      amountMinor: 10000,
      kind: 'credit',
      accountLastFour: '4242',
      reportedBalanceMinor: 1010000,
    });
  });

  it('rejects OTP and failed-transaction messages', () => {
    expect(
      parseTransactionSms(sms('OTP 441923 for INR 3,000 purchase.')),
    ).toBeNull();
    expect(
      parseTransactionSms(
        sms('Transaction failed for Rs.1,200 due to insufficient balance.'),
      ),
    ).toBeNull();
  });

  it('uses the received date when an SMS contains an impossible calendar date', () => {
    const parsed = parseTransactionSms(sms(
      'Rs.850.00 debited from A/c XX1204 at SWIGGY on 31/02/26. Avl Bal: Rs.24,350.00',
    ));
    expect(parsed?.occurredAt).toBe(sms('').receivedAt);
  });

  it('rejects money values that cannot be represented safely in minor units', () => {
    expect(parseTransactionSms(sms(
      'Rs.999999999999999.00 debited from A/c XX1204 at SWIGGY. Avl Bal: Rs.24,350.00',
    ))).toBeNull();
    expect(parseTransactionSms(sms(
      'Rs.850.00 debited from A/c XX1204 at SWIGGY. Avl Bal: Rs.999999999999999.00',
    ))).toBeNull();
  });

  it.each([
    'Hi, a payment of Rs 825 is due on 30-AUG-26 for your Airtel Mobile. To pay via Airtel Thanks App.',
    'Your account will be debited with Rs 69.00 towards SPOTIFY INDIA PVT LTD for the Create Mandate on 21/08/2026. Pause mandate to stop execution. IDFC FIRST Bank',
    'Buy new Airtel Wi-Fi with zero installation charges. Plans start at Rs. 499. Buy now.',
    'You will be charged a maintenance fee of Rs 50 due to inactivity. Make any payment to avoid the fee.',
    'Thanks for shopping at SPAR. Amount Paid Rs 317.50. View ebill.',
    'Your A/c XX4242 will be debited by Rs. 69.00. Available balance Rs. 10,000.00.',
  ])('rejects a message that is not a completed bank balance alert: %s', body => {
    expect(parseTransactionSms(sms(body))).toBeNull();
  });

  it('accepts a completed bank credit even when the bank omits the balance', () => {
    expect(parseTransactionSms(sms(
      'INR 45,000.00 credited to A/c XX8842 from ACME PAYROLL via NEFT.',
    ))).toMatchObject({
      amountMinor: 4500000,
      kind: 'credit',
      accountLastFour: '8842',
      reportedBalanceMinor: null,
    });
  });

  it.each([
    [
      'INR 1,249.50 spent on HDFC Bank Card ending 4321 at AMAZON on 18-Sep-2026. Ref No AB12CD3456',
      { amountMinor: 124950, kind: 'debit', accountLastFour: '4321', merchant: 'AMAZON', referenceId: 'AB12CD3456' },
    ],
    [
      'Rs 499 deducted from account no. XX9988 towards NETFLIX dated 17-09-2026. Closing Bal INR 8,501.25',
      { amountMinor: 49900, kind: 'debit', accountLastFour: '9988', merchant: 'NETFLIX', reportedBalanceMinor: 850125 },
    ],
    [
      'Your card ending with 7755 was charged INR 2,000 at HOTEL TAJ on 2026-09-15. Transaction ID TXN778899',
      { amountMinor: 200000, kind: 'debit', accountLastFour: '7755', merchant: 'HOTEL TAJ', referenceId: 'TXN778899' },
    ],
    [
      'INR 750.00 deposited in your account **2468 via IMPS. Current balance is INR 4,250.00. UTR IMPS1234567',
      { amountMinor: 75000, kind: 'credit', accountLastFour: '2468', reportedBalanceMinor: 425000, referenceId: 'IMPS1234567' },
    ],
  ])('parses common balance-free and cross-bank formats: %s', (body, expected) => {
    expect(parseTransactionSms(sms(body))).toMatchObject(expected);
  });

  it('chooses the transaction amount when a balance appears first', () => {
    expect(parseTransactionSms(sms(
      'Available balance INR 9,000.00. INR 250.00 debited from A/c XX1234 at CAFE.',
    ))).toMatchObject({ amountMinor: 25000, reportedBalanceMinor: 900000 });
  });

  it('parses the IDFC beneficiary-credit debit format correctly', () => {
    const parsed = parseTransactionSms(
      sms(
        'Your A/c XX4242 debited by Rs. 200.00 on 16/09/26; SAMPLE PERSON credited. RRN 900000000001. Available balance Rs. 10,000.00. Team IDFC FIRST Bank',
      ),
    );

    expect(parsed).toMatchObject({
      amountMinor: 20000,
      kind: 'debit',
      merchant: 'SAMPLE PERSON',
      accountLastFour: '4242',
      reportedBalanceMinor: 1000000,
      category: 'Other',
    });
    expect(new Date(parsed!.occurredAt).getFullYear()).toBe(2026);
    expect(new Date(parsed!.occurredAt).getMonth()).toBe(8);
    expect(new Date(parsed!.occurredAt).getDate()).toBe(16);
  });

  it('does not turn a named beneficiary credit into income', () => {
    expect(
      parseTransactionSms(
        sms(
          'Your A/c XX4242 debited by Rs. 100.00 on 16/09/26; SAMPLE  PAYEE credited. RRN 900000000004. Available balance Rs. 10,000.00. Team IDFC FIRST Bank',
        ),
      ),
    ).toMatchObject({
      amountMinor: 10000,
      kind: 'debit',
      merchant: 'SAMPLE PAYEE',
      reportedBalanceMinor: 1000000,
    });
  });

  it('uses the UPI handle as the merchant when an IDFC debit names one', () => {
    expect(
      parseTransactionSms(
        sms(
          'Your A/c XX4242 debited by Rs. 200.00 on 16/09/26; sample.payee@okbank credited. RRN 900000000005. Available balance Rs. 10,100.00. Team IDFC FIRST Bank',
        ),
      ),
    ).toMatchObject({
      kind: 'debit',
      merchant: 'sample.payee@okbank',
      category: 'Other',
    });
  });

  it('does not cut off a merchant handle ending in @upi', () => {
    expect(
      parseTransactionSms(
        sms(
          'Your A/c XX4242 debited by Rs. 120.00 on 16/09/26; sample@upi credited. Available balance Rs. 9,980.00.',
        ),
      ),
    ).toMatchObject({ merchant: 'sample@upi' });
  });

  it('keeps a debit without any payee as Unknown merchant', () => {
    expect(
      parseTransactionSms(
        sms(
          'Your A/C XXXXX004242 is debited by INR 105.00 on 13/09/25 20:19. New Bal :INR 11,411.08. Team IDFC FIRST Bank',
        ),
      ),
    ).toMatchObject({ kind: 'debit', merchant: 'Unknown merchant' });
  });

  it('does not mistake coffee for a bank fee', () => {
    const parsed = parseTransactionSms(
      sms(
        'Your A/c XX4242 debited by Rs. 155.00 on 15/09/26; EXAMPLE COFFEE credited. RRN 900000000006. Available balance Rs. 10,200.00.',
      ),
    );
    expect(parsed).toMatchObject({
      kind: 'debit',
      merchant: 'EXAMPLE COFFEE',
      category: 'Other',
    });
  });

  it('normalizes Sample food court when the bank SMS says foot court', () => {
    const parsed = parseTransactionSms(
      sms(
        "Your A/c XX4242 debited by Rs. 180.00 on 16/09/26; SAMPLE FOOT COURT credited. RRN 900000000002. Available balance Rs. 9,820.00.",
      ),
    );
    expect(parsed).toMatchObject({
      merchant: "SAMPLE FOOD COURT",
      category: 'Other',
      kind: 'debit',
    });
  });

  it.each([
    [
      'Rs.500.00 withdrawn from A/c XX4242 at ATM on 12/09/26. Avl Bal Rs.25,000.00',
      'withdrawal',
      'Other',
    ],
    [
      'Rs.25.00 charged as fee on A/c XX4242. Available balance Rs.24,975.00',
      'fee',
      'Other',
    ],
    [
      'Refund of INR 299.00 credited to A/c XX4242 from AMAZON. Avl Bal Rs.25,274.00',
      'refund',
      'Other',
    ],
  ])('parses common bank event: %s', (body, kind, category) => {
    expect(parseTransactionSms(sms(body))).toMatchObject({ kind, category });
  });
});
