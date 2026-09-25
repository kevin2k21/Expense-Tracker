import type {
  ParsedTransaction,
  PendingSms,
  TransactionKind,
} from '../../types';
import type { TransactionSmsParser } from './parserContract';

const NON_TRANSACTION = [
  /\botp\b/i,
  /one[ -]time password/i,
  /verification code/i,
  /payment request/i,
  /collect request/i,
  /(?:transaction|txn|payment|purchase|transfer)\s+(?:has\s+)?(?:failed|declined|cancelled|canceled|rejected|unsuccessful)/i,
  /(?:failed|declined|cancelled|canceled|rejected|unsuccessful)\s+(?:transaction|txn|payment|purchase|transfer)/i,
  /insufficient (?:funds|balance)/i,
  /\b(?:will|would|may|shall)\s+be\s+(?:debited|charged|deducted|credited)\b/i,
  /\b(?:scheduled|pending|processing)\b/i,
  /\b(?:payment|bill|amount)\b.{0,25}\b(?:is\s+)?due\b/i,
  /\bdue\s+(?:on|by)\b/i,
  /\b(?:create|created|set up|setup|pause|cancel)\s+(?:an?\s+)?mandate\b/i,
  /\b(?:autopay|auto-pay)\b.{0,30}\b(?:mandate|upcoming|scheduled)\b/i,
  /\b(?:offer|cashback offer|reward|coupon|sale)\b/i,
];

const MONEY_SOURCE =
  '(?:₹|inr|rs\\.?|rupees?)\\s*[:=-]?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
const MONEY = new RegExp(MONEY_SOURCE, 'gi');

const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

const parseMoney = (value: string): number | null => {
  const major = Number(value.replace(/,/g, ''));
  const minor = Math.round(major * 100);
  return Number.isFinite(major) && Number.isSafeInteger(minor) && minor > 0
    ? minor
    : null;
};

const KIND_WORDS: Record<TransactionKind, RegExp> = {
  refund: /\b(?:refund(?:ed)?|reversal|reversed)\b/i,
  withdrawal: /\b(?:withdrawn|withdrawal|cash\s+withdrawal|atm\s+cash)\b/i,
  fee: /\b(?:fee|fees|charge|charges|charged|penalty)\b/i,
  credit: /\b(?:credited|received|deposited)\b/i,
  debit: /\b(?:debited|spent|purchase(?:d)?|paid|sent|deducted|used|charged)\b/i,
  transfer: /\btransferred\b/i,
};

const findKind = (body: string): TransactionKind | null => {
  if (KIND_WORDS.refund.test(body)) return 'refund';
  if (KIND_WORDS.withdrawal.test(body)) return 'withdrawal';
  // A charge is classified as a fee only when it is explicitly described as
  // one. "Charged at a merchant" remains an ordinary debit.
  if (/\b(?:fee|fees|charges|penalty)\b/i.test(body)) return 'fee';
  // In "Your A/c debited ...; PAYEE credited", credited describes the payee.
  if (/(?:your\s+)?(?:a\/?c|acct|account|card)\b.{0,45}\b(?:debited|deducted)\b/i.test(body))
    return 'debit';
  if (KIND_WORDS.credit.test(body)) return 'credit';
  if (KIND_WORDS.debit.test(body)) return 'debit';
  return null;
};

type MoneyMatch = { minor: number | null; index: number; end: number };

const moneyMatches = (body: string): MoneyMatch[] =>
  [...body.matchAll(MONEY)].map(match => ({
    minor: parseMoney(match[1]),
    index: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));

const findAmount = (body: string, kind: TransactionKind): number | null => {
  const values = moneyMatches(body);
  if (!values.length) return null;
  const kindWords = KIND_WORDS[kind];
  let best: { minor: number | null; score: number } | null = null;

  for (const value of values) {
    const before = body.slice(Math.max(0, value.index - 55), value.index);
    const after = body.slice(value.end, Math.min(body.length, value.end + 55));
    let score = 0;
    if (kindWords.test(before) || kindWords.test(after)) score += 6;
    if (/\b(?:amount|txn|transaction)\b/i.test(before)) score += 1;
    if (/\b(?:avl|available|closing|current|new|ledger)\s+(?:a\/?c\s+)?bal(?:ance)?\b[^.;]{0,18}$/i.test(before))
      score -= 10;
    if (/\bbal(?:ance)?\b/i.test(after.slice(0, 18))) score -= 5;
    // The first amount is the conventional transaction amount when otherwise tied.
    score -= value.index / Math.max(body.length, 1);
    if (!best || score > best.score) best = { minor: value.minor, score };
  }
  return best?.minor ?? null;
};

const findBalance = (body: string): number | null => {
  const patterns = [
    new RegExp(
      `(?:avl\\.?|available|closing|current|new|ledger)\\s*(?:a\\/?c\\s*)?bal(?:ance)?\\s*(?:is)?\\s*[:=-]?\\s*${MONEY_SOURCE}`,
      'i',
    ),
    new RegExp(`bal(?:ance)?\\s+(?:is\\s+)?${MONEY_SOURCE}`, 'i'),
    new RegExp(`${MONEY_SOURCE}\\s*(?:is\\s+)?(?:the\\s+)?(?:avl\\.?|available|closing|current)\\s+bal(?:ance)?`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return parseMoney(match[1]);
  }
  return null;
};

const findAccountLastFour = (body: string): string | null => {
  const patterns = [
    /\b(?:a\/?c|acct|account|card)(?:\s*(?:no\.?|number|ending(?:\s+in)?|ending\s+with))?[\s:#*xX.-]*(?:[\d*xX.-]*?)(\d{4})\b/i,
    /\b(?:ending|ends)\s+(?:in|with)\s+[*xX-]*(\d{4})\b/i,
    /(?:[*xX]{2,}|\.{2,})\s*(\d{4})\b/,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }
  return null;
};

const cleanMerchant = (value: string) =>
  value
    .replace(
      /\s+(?:on|dated|using|via|ref|rrn|utr|txn|transaction|upi|imps|neft|rtgs|avl|available|closing|current|new|bal(?:ance)?)\b.*$/i,
      '',
    )
    .replace(/\s+(?:from|for)\s+(?:a\/?c|acct|account|card)\b.*$/i, '')
    .replace(/[^a-z0-9@_&.' -]/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[. :;-]+|[. :;-]+$/g, '')
    .replace(/\bfoot court\b/gi, match =>
      match === match.toUpperCase() ? 'FOOD COURT' : 'Food Court',
    )
    .trim()
    .slice(0, 48);

const findMerchant = (body: string, kind: TransactionKind): string => {
  // Credit sender names are enriched from a matched payment notification. SMS
  // "from" fields are often transfer remarks or bank names, so do not guess.
  if (kind === 'credit') return 'Unknown merchant';
  const patterns = [
    /;\s*([a-z0-9][a-z0-9._+-]*@[a-z0-9._-]+)\s+credited\b/i,
    /;\s*([a-z0-9][a-z0-9&.' -]{1,60}?)\s+credited\b/i,
    /\b(?:towards|at|to|merchant|payee)\b\s*[:=-]?\s*([a-z0-9][a-z0-9@_&.' -]{1,60})/i,
    /\b(?:vpa|upi id)\s*[:=-]?\s*([a-z0-9@._-]{3,60})/i,
    /\binfo\s*[:=-]\s*([a-z0-9][a-z0-9@_&.' -]{1,60})/i,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) {
      const merchant = cleanMerchant(match[1]);
      if (merchant && !/^(?:your|the)\s+(?:a\/?c|account|card)$/i.test(merchant)) return merchant;
    }
  }
  if (kind === 'withdrawal') return 'ATM withdrawal';
  if (kind === 'fee') return 'Bank charges';
  if (kind === 'refund') return 'Refund';
  return 'Unknown merchant';
};

const monthNumber = (value: string): number | null => {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) return numeric - 1;
  const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const index = names.indexOf(value.slice(0, 3).toLowerCase());
  return index >= 0 ? index : null;
};

const validDate = (day: number, month: number, year: number, fallback: number): number => {
  const fullYear = year < 100 ? 2000 + year : year;
  const parsed = new Date(fullYear, month, day, 12);
  return parsed.getFullYear() === fullYear && parsed.getMonth() === month && parsed.getDate() === day
    ? parsed.getTime()
    : fallback;
};

const findOccurredAt = (body: string, fallback: number): number => {
  const dayFirst = body.match(
    /\b(?:on|dated|date)?\s*(\d{1,2})[/-]([a-z]{3,9}|\d{1,2})[/-](\d{2,4})\b/i,
  );
  if (dayFirst) {
    const month = monthNumber(dayFirst[2]);
    if (month != null) return validDate(Number(dayFirst[1]), month, Number(dayFirst[3]), fallback);
  }
  const yearFirst = body.match(/\b(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (yearFirst) return validDate(Number(yearFirst[3]), Number(yearFirst[2]) - 1, Number(yearFirst[1]), fallback);
  return fallback;
};

const findReference = (body: string): string | null =>
  body.match(
    /\b(?:RRN|UTR|UPI\s*(?:ref(?:erence)?|txn)|ref(?:erence)?(?:\s*(?:no|number))?|transaction\s*id|txn\s*id)\s*[:#.-]?\s*([a-z0-9][a-z0-9-]{5,39})\b/i,
  )?.[1]?.toUpperCase() ?? null;

export const parseTransactionSms: TransactionSmsParser = (
  sms: PendingSms,
): ParsedTransaction | null => {
  const body = normalize(sms.body);
  if (!body || NON_TRANSACTION.some(pattern => pattern.test(body))) return null;

  const kind = findKind(body);
  if (kind == null) return null;
  const amountMinor = findAmount(body, kind);
  if (amountMinor == null) return null;

  const accountLastFour = findAccountLastFour(body);
  const reportedBalanceMinor = findBalance(body);
  const hasBalanceAmount = new RegExp(
    `\\b(?:avl\\.?|available|closing|current|new|ledger)?\\s*(?:a\\/?c\\s+)?bal(?:ance)?\\b.{0,20}${MONEY_SOURCE}`,
    'i',
  ).test(body);
  if (hasBalanceAmount && reportedBalanceMinor == null) return null;
  const referenceId = findReference(body);
  const hasAccountLanguage = /\b(?:a\/?c|acct|account|card)\b/i.test(body);
  const hasBankRail = /\b(?:upi|imps|neft|rtgs|nach|pos|atm)\b/i.test(body);
  const completed = KIND_WORDS[kind].test(body);

  // Accept balance-free card/bank alerts, but require evidence that this is an
  // authoritative financial alert rather than a merchant receipt or advert.
  if (!completed || !(accountLastFour || reportedBalanceMinor != null || hasAccountLanguage || (referenceId && hasBankRail)))
    return null;

  const merchant = findMerchant(body, kind);
  let confidence = 0.5;
  if (merchant !== 'Unknown merchant') confidence += 0.12;
  if (accountLastFour) confidence += 0.12;
  if (reportedBalanceMinor != null) confidence += 0.12;
  if (referenceId) confidence += 0.08;
  if (hasBankRail) confidence += 0.06;

  return {
    amountMinor,
    kind,
    merchant,
    category: 'Other',
    accountLastFour,
    reportedBalanceMinor,
    occurredAt: findOccurredAt(body, sms.receivedAt),
    confidence: Math.min(confidence, 1),
    referenceId,
  };
};
