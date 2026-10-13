import {describe, expect, test} from '@jest/globals';

import {openingLapIds, type Lap} from '@/src/data/sessions';
import {type SegmentTimes} from '@/src/analysis/segments';

import {toggle} from '@/src/state/lapSelection';

import {sessionGrid} from './grid';

// A race: 19 laps in stint 2, 3 in stint 1, one lap not flagged comparable but
// not slow either. The grid opens on every lap that is not slow, not on nothing.
function race(): Lap[] {
  const laps: Lap[] = [];
  for (let i = 0; i < 3; i++)
    laps.push({
      id: `a${i}`,
      stint: 1,
      comparable: true,
      timeS: 100 + i,
      reasons: [],
    } as unknown as Lap);
  for (let i = 0; i < 19; i++)
    laps.push({
      id: `b${i}`,
      stint: 2,
      comparable: true,
      timeS: 90 + i * 0.1,
      reasons: [],
    } as unknown as Lap);
  laps.push({
    id: 'x',
    stint: 2,
    comparable: false,
    timeS: 80,
    reasons: [],
  } as unknown as Lap);
  return laps;
}

const SESSION = {id: 's1', bestLapId: 'x', car: 'c', sessionType: 'race'};

const timesOf = (ids: string[]): SegmentTimes => ({
  segments: [{label: 'S1', range: null}],
  laps: ids.map((id, i) => ({
    id,
    stint: 2,
    comparable: true,
    timesS: [10 + i],
    label: id,
  })),
});

describe('grid opening set', () => {
  test('an empty URL selection gives medians over the racing stint', () => {
    const defaults = openingLapIds(race(), SESSION);
    expect(defaults).toHaveLength(23);
    const grid = sessionGrid(timesOf(race().map(l => l.id)), new Set(defaults));
    expect(grid.columns[0].n).toBe(23);
    expect(grid.columns[0].medianS).not.toBeNull();
  });

  test('one tap on the opening set removes exactly one lap', () => {
    const defaults = openingLapIds(race(), SESSION);
    const next = toggle(defaults, defaults[0]);
    expect(next).toHaveLength(defaults.length - 1);
    expect(next).not.toContain(defaults[0]);
  });

  test('a tap on the URL laps only changes those', () => {
    const defaults = openingLapIds(race(), SESSION);
    expect(toggle(['b0', 'b1'], 'b0')).toEqual(['b1']);
  });
});
