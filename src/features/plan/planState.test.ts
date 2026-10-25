import {describe, expect, it} from '@jest/globals';

import {type Combo, undrivenCombo} from '@/src/workspace/planCombo';

import {
  pickerCombos,
  planState,
  planStateTitle,
  showsLapCards,
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
