import { suggestPeople } from '../src/features/finance/personSuggestions';

describe('shared-expense person suggestions', () => {
  const vendors = [
    'Sample Food Court', 'Example Person', 'Sample Food Court', 'Unknown merchant',
    'K Sample', 'Example Sample Store', 'Example Person', 'Sample',
  ];

  it('recommends ledger names as letters are typed, with prefixes first', () => {
    expect(suggestPeople('sam', vendors)).toEqual([
      'Sample Food Court', 'Sample', 'Example Sample Store', 'K Sample',
    ]);
  });

  it('deduplicates names and excludes generic or already selected entries', () => {
    expect(suggestPeople('person', vendors, ['Example Person'])).not.toContain('Example Person');
    expect(suggestPeople('unknown', vendors)).toEqual([]);
    expect(suggestPeople('example person', vendors)).toEqual(['Example Person']);
  });

  it('handles case, spaces, and empty queries', () => {
    expect(suggestPeople('  FOOD ', vendors)).toEqual(['Sample Food Court']);
    expect(suggestPeople('', vendors)).toEqual([]);
  });
});
