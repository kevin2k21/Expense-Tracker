export type ShareEntry = { name: string; amount: string };

export function parseShareAmount(value: string): number | null {
  const clean = value.trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) return null;
  const minor = Math.round(Number(clean) * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

export function buildSharedSplit(grossMinor: number, entries: ShareEntry[]): {
  people: Array<{ name: string; amountMinor: number }>;
  personalMinor: number;
  error: string | null;
} {
  const names = new Set<string>();
  const people: Array<{ name: string; amountMinor: number }> = [];
  if (!entries.length) return { people, personalMinor: grossMinor, error: 'Add at least one person.' };
  for (const entry of entries) {
    const name = entry.name.trim().replace(/\s+/g, ' ');
    const amountMinor = parseShareAmount(entry.amount);
    if (!name || amountMinor == null) return { people, personalMinor: grossMinor, error: 'Enter a name and positive share for each person.' };
    if (names.has(name.toLocaleLowerCase())) return { people, personalMinor: grossMinor, error: 'Each person must have a different name.' };
    names.add(name.toLocaleLowerCase());
    people.push({ name, amountMinor });
  }
  const othersMinor = people.reduce((sum, person) => sum + person.amountMinor, 0);
  if (othersMinor > grossMinor) return { people, personalMinor: grossMinor - othersMinor, error: 'Combined shares exceed the payment amount.' };
  return { people, personalMinor: grossMinor - othersMinor, error: null };
}
