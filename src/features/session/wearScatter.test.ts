import {describe, expect, it} from '@jest/globals';

import type {PerWheel} from '@/src/analysis/tyres';
import type {Lap} from '@/src/data/sessions';
import {toLaps} from '@/src/data/sessions/adapters';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {
  buildWearScatter,
  flaggedCount,
  MIN_SCATTER_LAPS,
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
  overtakes: [] as NonNullable<Lap['traffic']>['overtakes'],
  aheadSpans: [],
  blueSpans: [],
  draftSpans: [],
  passMarks: [],
  fieldLapM: null,
};

const tyres = (over: Partial<NonNullable<Lap['tyres']>> = {}) => ({
  v: 2,
  wearPct: all(97),
  pressureKpa: all(160),
  hotPressureKpa: null,
  treadC: null,
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
    expect(wearLaps([l])[0].lostPct).toBe(5);
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
    expect(wearLaps(laps).map(l => l.lapId)).toEqual(['l1']);
  });

  it('keeps every green lap, tow and traffic or not: they are flags, never a filter', () => {
    const free = lap(1, {traffic: clean});
    const busy = lap(2, {traffic: {...clean, trafficAheadS: 3}});
    const towed = lap(3, {traffic: {...clean, draftS: 20}});
    const passed = lap(4, {
      traffic: {...clean, overtakes: [{cls: 'GT3', atM: 100}]},
    });
    const unknown = lap(5);
    expect(
      wearLaps([free, busy, towed, passed, unknown]).map(l => l.lapId),
    ).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
  });

  it('counts the laps with traffic or a blue flag among those it uses, null without a field', () => {
    const free = lap(1, {traffic: clean});
    const busy = lap(2, {traffic: {...clean, trafficAheadS: 3}});
    const towed = lap(3, {traffic: {...clean, draftS: 6}});
    const used = new Set(['l1', 'l2']);
    expect(flaggedCount([free, busy], used)).toBe(1);
    // A tow-only lap is flagged: the footer names tow.
    expect(flaggedCount([free, towed], new Set(['l1', 'l3']))).toBe(1);
    expect(flaggedCount([lap(1), lap(2)], used)).toBeNull();
    // A lap the panels do not use is not counted.
    expect(flaggedCount([free, busy], new Set(['l1']))).toBe(0);
  });
});

describe('buildWearScatter', () => {
  it('is null under the floor', () => {
    const few = Array.from({length: MIN_SCATTER_LAPS - 1}, (_, i) =>
      lap(i + 1),
    );
    expect(buildWearScatter(few)).toBeNull();
  });

  it('draws one panel with a line and the shared axes', () => {
    const laps = Array.from({length: 8}, (_, i) => lap(i + 1));
    const m = buildWearScatter(laps);
    expect(m?.panels).toHaveLength(1);
    expect(m?.panels[0].fit).not.toBeNull();
    expect(m?.panels[0].note).toBe('8 laps');
    expect(m?.headline).toBe('No number · fewer than 10 laps');
    expect(m?.xDomain[0]).toBe(0);
    expect(m?.flagged).toBeNull();
  });

  it('one stint with wear and fuel locked together has no number, and says why', () => {
    const laps = Array.from({length: 12}, (_, i) => lap(i + 1));
    expect(buildWearScatter(laps)?.headline).toMatch(
      /^No number · wear and fuel fall together/,
    );
  });

  it('a fit shows its standard error, and a note when wear and fuel move together', () => {
    // Two stints on carried tyres; a fixed zig-zag on the times.
    const two = [
      ...Array.from({length: 10}, (_, i) => [i + 1, 60 - 3 * i]),
      ...Array.from({length: 10}, (_, i) => [i + 15, 60 - 3 * i]),
    ].map(([n, f], i) =>
      lap(n, {
        timeS: 90 + 0.05 * (n - 1) + 0.03 * f + (i % 2 === 0 ? 0.02 : -0.02),
        fuel: {green: true, startL: f} as Lap['fuel'],
        tyres: tyres({wearPct: all(100 - (n - 1))}),
      }),
    );
    const h = buildWearScatter(two)?.headline ?? '';
    expect(h).toMatch(/^\+0\.0\d\d ± 0\.\d{3} s per 1 % lost, fuel held fixed/);
    expect(h).not.toContain('loose');
  });
});
