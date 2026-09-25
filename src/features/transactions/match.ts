export type MatchTarget = { amountMinor: number; kind: string; at: number;
  referenceId?: string | null; accountLastFour?: string | null };
export type MatchCandidate = MatchTarget & { id: string };

export function uniqueSourceMatch(target: MatchTarget, candidates: MatchCandidate[], windowMs = 30 * 60_000): string | null {
  const compatible = candidates.filter(candidate => candidate.amountMinor === target.amountMinor &&
    candidate.kind === target.kind &&
    (!target.accountLastFour || !candidate.accountLastFour || candidate.accountLastFour === target.accountLastFour) &&
    (!target.referenceId || !candidate.referenceId || candidate.referenceId === target.referenceId));
  const exact = target.referenceId ? compatible.filter(candidate => candidate.referenceId === target.referenceId) : [];
  if (exact.length > 0) return exact.length === 1 ? exact[0].id : null;
  const timed = compatible.filter(candidate => Math.abs(candidate.at - target.at) <= windowMs);
  return timed.length === 1 ? timed[0].id : null;
}
