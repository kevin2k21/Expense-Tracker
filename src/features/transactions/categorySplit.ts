export type CategorySplitDraft = { category: string; amount: string };
export type CategoryAllocation = { category: string; amountMinor: number };

const amountMinor = (input: string): number | null => {
  const normalized = input.trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const value = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

export function buildCategorySplit(
  totalMinor: number,
  availableCategories: string[],
  rows: CategorySplitDraft[],
): { allocations: CategoryAllocation[]; error: string | null } {
  if (rows.length < 2) return { allocations: [], error: 'Add at least two categories.' };
  const known = new Map(availableCategories.map(category => [category.toLocaleLowerCase(), category]));
  const allocations: CategoryAllocation[] = [];
  for (const row of rows) {
    const category = known.get(row.category.trim().toLocaleLowerCase());
    const parsed = amountMinor(row.amount);
    if (!category) return { allocations: [], error: 'Choose a category for every amount.' };
    if (parsed == null) return { allocations: [], error: 'Enter a positive amount with up to two decimal places.' };
    allocations.push({ category, amountMinor: parsed });
  }
  if (new Set(allocations.map(item => item.category.toLocaleLowerCase())).size !== allocations.length)
    return { allocations: [], error: 'Choose each category only once.' };
  const allocated = allocations.reduce((sum, item) => sum + item.amountMinor, 0);
  if (allocated !== totalMinor) return {
    allocations: [],
    error: `${allocated < totalMinor ? 'Allocate' : 'Remove'} ₹${(Math.abs(totalMinor - allocated) / 100).toFixed(2)} to match the transaction.`,
  };
  return { allocations, error: null };
}

export function personalCategoryAllocations(
  grossMinor: number,
  personalMinor: number,
  allocations: CategoryAllocation[],
): CategoryAllocation[] {
  if (!allocations.length || grossMinor <= 0 || personalMinor <= 0) return [];
  let assigned = 0;
  return allocations.map((item, index) => {
    const amount = index === allocations.length - 1
      ? personalMinor - assigned
      : Math.floor(item.amountMinor * personalMinor / grossMinor);
    assigned += amount;
    return { category: item.category, amountMinor: amount };
  });
}
