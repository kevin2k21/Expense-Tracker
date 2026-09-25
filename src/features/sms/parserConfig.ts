import type { SmsParserConfig } from './parserContract';
import { parseTransactionSms as sampleIndianBankParser } from './parser';

/**
 * Parser selection for this fork.
 *
 * The bundled Indian-bank parser makes the repository runnable as-is. To use
 * another parser, import it here and replace only `parse`. Keep the contract in
 * parserContract.ts and give every parser revision a new `version` value.
 */
export const smsParserConfig = {
  version: 'sample-indian-bank-v1',
  parse: sampleIndianBankParser,
} satisfies SmsParserConfig;
