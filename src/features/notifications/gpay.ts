export type PendingGpayNotification = {
  id: string;
  packageName?: string;
  title: string;
  body?: string;
  postedAt: number;
};

export type GpayReceipt = {
  id: string;
  sender: string;
  amountMinor: number;
  postedAt: number;
};

export function parseGpayReceipt(
  notification: PendingGpayNotification,
): GpayReceipt | null {
  const title = notification.title.replace(/\s+/g, ' ').trim();
  const match = title.match(
    /^(.+?)\s+paid you\s+(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.\d{1,2})?)$/i,
  );
  if (!match) return null;
  const sender = match[1].trim().slice(0, 48);
  const amountMinor = Math.round(Number(match[2].replace(/,/g, '')) * 100);
  if (!sender || !Number.isSafeInteger(amountMinor) || amountMinor <= 0)
    return null;
  return { id: notification.id, sender, amountMinor, postedAt: notification.postedAt };
}

export function unambiguousMatches(
  matches: Array<{ receiptId: string; candidates: string[] }>,
): Map<string, string> {
  const candidateUseCount = new Map<string, number>();
  for (const { candidates } of matches) {
    for (const transactionId of candidates) {
      candidateUseCount.set(
        transactionId,
        (candidateUseCount.get(transactionId) ?? 0) + 1,
      );
    }
  }
  return new Map(
    matches
      .filter(
        match =>
          match.candidates.length === 1 &&
          candidateUseCount.get(match.candidates[0]) === 1,
      )
      .map(match => [match.receiptId, match.candidates[0]]),
  );
}
