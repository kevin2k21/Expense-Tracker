export type ManualMatchCandidate = { id: string; referenceId: string | null };

export function planManualMatch(
  smsReferenceId: string | null,
  candidates: ManualMatchCandidate[],
): { exactId: string | null; reviewIds: string[] } {
  const exact = smsReferenceId ? candidates.filter(item => item.referenceId === smsReferenceId) : [];
  if (exact.length === 1) return { exactId: exact[0].id, reviewIds: [] };
  return { exactId: null, reviewIds: candidates.map(item => item.id) };
}
