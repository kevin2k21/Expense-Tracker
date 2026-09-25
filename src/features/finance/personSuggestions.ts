import { normalizedVendorKey } from '../../data/reviewGroups';

const normalize = (value: string) => value.normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

export function suggestPeople(
  query: string,
  knownNames: string[],
  selectedNames: string[] = [],
  limit = 5,
): string[] {
  const needle = normalize(query);
  if (!needle || limit <= 0) return [];
  const selected = new Set(selectedNames.map(normalize));
  const candidates = new Map<string, { name: string; count: number; rank: number }>();
  for (const rawName of knownNames) {
    const name = rawName.trim().replace(/\s+/g, ' ');
    const key = normalizedVendorKey(name);
    if (!key || selected.has(key)) continue;
    const rank = key.startsWith(needle) ? 0 :
      key.split(' ').some(word => word.startsWith(needle)) ? 1 :
        key.includes(needle) ? 2 : -1;
    if (rank < 0) continue;
    const existing = candidates.get(key);
    if (existing) existing.count += 1;
    else candidates.set(key, { name, count: 1, rank });
  }
  return [...candidates.values()]
    .sort((a, b) => a.rank - b.rank || b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(item => item.name);
}
