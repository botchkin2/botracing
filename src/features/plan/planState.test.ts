import {describe, expect, it} from '@jest/globals';

import {type Combo} from './model';
import {
  pickerCombos,
  planState,
  planStateTitle,
  resolveCombo,
  showsLapCards,
  undrivenCombo,
} from './planState';

const driven = (key: string): Combo => ({
  key,
  sim: 'lmu',
  trackId: 'T1',
  track: 'Sebring',
  label: 'Sebring · A',
  car: 'A',
  sessions: [{id: 's'} as Combo['sessions'][number]],
});

describe('undrivenCombo', () => {
  it('reads an LMU key', () => {
    const c = undrivenCombo('Spa|Ferrari 499P');
    expect(c).toMatchObject({sim: 'lmu', trackId: 'Spa', car: 'Ferrari 499P'});
    expect(c?.sessions).toEqual([]);
  });
  it('reads a sim prefix', () => {
    expect(undrivenCombo('iracing:Spa|Car')).toMatchObject({
      sim: 'iracing',
      trackId: 'Spa',
    });
  });
  it('rejects a key that is not track|car', () => {
    expect(undrivenCombo('Spa')).toBeNull();
    expect(undrivenCombo('|Car')).toBeNull();
    expect(undrivenCombo('Spa|')).toBeNull();
  });
});

describe('resolveCombo', () => {
  const a = driven('T1|A');
  it('finds a driven combo', () => {
    expect(resolveCombo([a], 'T1|A', null)).toBe(a);
  });
  it('opens an empty combo for a key he never drove, not the default', () => {
    const c = resolveCombo([a], 'T9|B', a);
    expect(c?.trackId).toBe('T9');
    expect(c?.sessions).toEqual([]);
  });
  it('uses the default with no key, and for a malformed key', () => {
    expect(resolveCombo([a], null, a)).toBe(a);
    expect(resolveCombo([a], 'junk', a)).toBe(a);
  });
});

describe('pickerCombos', () => {
  const a = driven('T1|A');
  it('adds the undriven combo in force', () => {
    const u = undrivenCombo('T9|B') as Combo;
    expect(pickerCombos([a], u)).toEqual([u, a]);
    expect(pickerCombos([a], a)).toEqual([a]);
  });
});

describe('planState', () => {
  const a = driven('T1|A');
  const u = undrivenCombo('T9|B') as Combo;
  it('names each state', () => {
    expect(planState({combo: u, planLaps: 0, rulesKnown: false})).toBe(
      'undriven',
    );
    expect(planState({combo: a, planLaps: 0, rulesKnown: true})).toBe(
      'no-laps',
    );
    expect(planState({combo: a, planLaps: null, rulesKnown: false})).toBe(
      'needs-fuel',
    );
    expect(planState({combo: a, planLaps: 12, rulesKnown: true})).toBe('ready');
  });
  it('titles the undriven state with the track and car, no sentence', () => {
    expect(planStateTitle('undriven', u)).toBe('No sessions at T9 in B');
    expect(planStateTitle('ready', a)).toBeNull();
  });
  it('draws lap cards only when ready', () => {
    expect(showsLapCards('ready')).toBe(true);
    expect(showsLapCards('undriven')).toBe(false);
    expect(showsLapCards('no-laps')).toBe(false);
  });
});
