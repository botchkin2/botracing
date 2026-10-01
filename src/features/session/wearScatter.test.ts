import {describe, expect, it} from '@jest/globals';

import type {PerWheel} from '@/src/analysis/tyres';
import type {Lap} from '@/src/data/sessions';
import {toLaps} from '@/src/data/sessions/adapters';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {
  buildWearScatter,
  MIN_SCATTER_LAPS,
  WEAR_SCATTER_KEY,
  wearLaps,
} from './wearScatter';

const all = (v: number): PerWheel => ({FL: v, FR: v, RL: v, RR: v});
const clean = {
  draftS: 0,
  trafficAheadS: 0,
  trafficBehindS: 0,
  blueFlagS: 0,
  passesMade: 0,
  passesSuffered: 0,
  passesMadeAll: 0,
  passesSufferedAll: 0,
  battleS: 0,
  overtakes: 0,
};

const tyres = (over: Partial<NonNullable<Lap['tyres']>> = {}) => ({
  v: 2,
  wearPct: all(97),
  pressureKpa: all(160),
  hotPressureKpa: null,
  rubberC: null,
  carcassC: null,
  changed: null,
  ...over,
});

const lap = (i: number, over: Partial<Lap> = {}): Lap => ({
  ...toLaps([{...fixture.laps[0], newTyres: false}])[0],
  id: `l${i}`,
  lapIndex: i,
  timeS: 90 + i * 0.1,
  comparable: true,
  fuel: {green: true, startL: 60 - i} as Lap['fuel'],
  traffic: null,
  tyres: tyres({wearPct: all(100 - i)}),
  ...over,
});

describe('wearLaps', () => {
  it('lost wear is 100 minus the mean of the four wheels', () => {
    const l = lap(3, {
      tyres: tyres({wearPct: {FL: 96, FR: 96, RL: 94, RR: 94}}),
    });
    expect(wearLaps([l], false)[0].lostPct).toBe(5);
  });

  it('leaves out non-green, untimed, and dead-sensor laps', () => {
    const dead = lap(4, {
      tyres: tyres({pressureKpa: {FL: 160, FR: null, RL: 160, RR: 160}}),
    });
    const laps = [
      lap(1),
      lap(2, {fuel: {green: false, startL: 50} as Lap['fuel']}),
      lap(3, {timeS: null}),
      dead,
    ];
    expect(wearLaps(laps, false).map(l => l.lapId)).toEqual(['l1']);
  });

  it('with a field keeps clean laps only; without one, every green lap', () => {
    const free = lap(1, {traffic: clean});
    const busy = lap(2, {traffic: {...clean, trafficAheadS: 3}});
    const unknown = lap(3);
    expect(wearLaps([free, busy, unknown], true).map(l => l.lapId)).toEqual([
      'l1',
    ]);
    expect(wearLaps([free, busy, unknown], false)).toHaveLength(3);
  });

  it('a faster-class overtake makes a lap not clean', () => {
    const l = lap(1, {traffic: {...clean, overtakes: 1}});
    expect(wearLaps([l], true)).toEqual([]);
  });
});

describe('buildWearScatter', () => {
  it('is null under the floor', () => {
    const few = Array.from({length: MIN_SCATTER_LAPS - 1}, (_, i) =>
      lap(i + 1),
    );
    expect(buildWearScatter(few, false)).toBeNull();
  });

  it('draws one panel with a line and the shared axes', () => {
    const laps = Array.from({length: 8}, (_, i) => lap(i + 1));
    const m = buildWearScatter(laps, false);
    expect(m?.panels).toHaveLength(1);
    expect(m?.panels[0].fit).not.toBeNull();
    expect(m?.panels[0].note).toMatch(/s per 1 % lost · 8 laps/);
    expect(m?.xDomain[0]).toBe(0);
    expect(m?.cleanOnly).toBe(false);
  });

  it('the key says track changes are not separated and no cause is shown', () => {
    expect(WEAR_SCATTER_KEY).toMatch(
      /Track changes over the race are not separated/,
    );
    expect(WEAR_SCATTER_KEY).toMatch(/not that one causes the other/);
  });
});
