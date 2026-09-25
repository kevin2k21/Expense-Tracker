import { uniqueSourceMatch, type MatchCandidate } from '../src/features/transactions/match';

const base = { amountMinor: 21200, kind: 'credit', at: 1_000_000,
  referenceId: null, accountLastFour: '4242' };
const candidate = (id: string, changes: Partial<MatchCandidate> = {}): MatchCandidate =>
  ({ id, ...base, ...changes });

describe('cross-source transaction matching', () => {
  it('matches a single nearby payment', () => {
    expect(uniqueSourceMatch(base, [candidate('one', { at: 1_000_100 })])).toBe('one');
  });
  it('never merges two plausible same-amount payments', () => {
    expect(uniqueSourceMatch(base, [candidate('one'), candidate('two', { at: 1_000_500 })])).toBeNull();
  });
  it('uses an exact reference to select one of two same-amount payments', () => {
    expect(uniqueSourceMatch({ ...base, referenceId: '900000000001' }, [
      candidate('one', { referenceId: '900000000001', at: 2_000_000 }),
      candidate('two', { referenceId: '900000000002' }),
    ])).toBe('one');
  });
  it('does not match a different account or conflicting reference', () => {
    expect(uniqueSourceMatch({ ...base, referenceId: 'ABC123' }, [
      candidate('one', { accountLastFour: '8842', referenceId: 'ABC123' }),
      candidate('two', { referenceId: 'XYZ987' }),
    ])).toBeNull();
  });
});
