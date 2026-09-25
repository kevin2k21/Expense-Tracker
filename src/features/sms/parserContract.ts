import type { ParsedTransaction, PendingSms } from '../../types';

/**
 * The only contract between SMS capture and transaction persistence.
 *
 * A parser must be deterministic and local: return a normalized transaction
 * when the message is a completed transaction, or null when it should be
 * ignored. The importer owns queue acknowledgement and database writes.
 */
export type TransactionSmsParser = (
  sms: PendingSms,
) => ParsedTransaction | null;

export type SmsParserConfig = {
  /**
   * Change this value whenever parsing behaviour changes. The app uses it to
   * safely re-read historical SMS and repair already-imported records.
   */
  version: string;
  parse: TransactionSmsParser;
};
