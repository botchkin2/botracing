import {describe, expect, it} from '@jest/globals';

import {chaseInputsAt, type InputTrace, LIVE_MAX_OFFSET_M, livePedalsAt, samePedals} from './chaseInputsAt';

// A 50 Hz-ish recording at 55 m/s: a sample about every 1.1 m, throttle ramping, a brake pulse, the wheel sweeping.
const distanceM = Array.from({length: 400}, (_, i) => 100 + i * 1.1);
const channel = (f: (i: number) => number) => ({distanceM, values: distanceM.map((_, i) => f(i))});
const trace: InputTrace = {
  stepM: 5,
  recordedFromM: distanceM[0],
  recordedToM: distanceM[distanceM.length - 1],
  samples: {
    speedKph: channel(() => 200),
    throttlePct: channel(i => Math.min(100, i / 2)),
    brakePct: channel(i => (i > 200 && i < 220 ? 80 : 0)),
    steeringPct: channel(i => Math.sin(i / 20) * 40),
    gear: channel(() => 4),
    pathLateralM: {distanceM: [], values: []},
    trackEdgeM: {distanceM: [], values: []},
  },
};

describe('chaseInputsAt', () => {
  it('reads each channel at the recorded sample nearest the distance', () => {
    const at = chaseInputsAt(trace, distanceM[10] + 0.3);
    expect(at).toEqual({throttlePct: 5, brakePct: 0, steeringPct: Math.sin(10 / 20) * 40});
    expect(chaseInputsAt(trace, distanceM[10] + 0.8)?.throttlePct).toBe(5.5);
  });

  it('moves at the recording rate, not at the 5 m grid', () => {
    const seen = new Set<number>();
    for (let d = 200; d < 205; d += 0.25) seen.add(chaseInputsAt(trace, d)?.steeringPct ?? NaN);
    expect(seen.size).toBeGreaterThan(3);
  });

  it('is null outside what the lap recorded, and for a distance that is not a number', () => {
    expect(chaseInputsAt(trace, 0)).toBeNull();
    expect(chaseInputsAt(trace, 5000)).toBeNull();
    expect(chaseInputsAt(trace, NaN)).toBeNull();
  });

  it('is null when a channel has no samples', () => {
    const bare: InputTrace = {...trace, samples: {...trace.samples, steeringPct: {distanceM: [], values: []}}};
    expect(chaseInputsAt(bare, 200)).toBeNull();
  });
});

describe('livePedalsAt', () => {
  it('reads the frame near the 5 Hz anchor, for the player only', () => {
    expect(livePedalsAt(trace, {lapDistM: 300, player: true}, 290)).not.toBeNull();
    expect(livePedalsAt(trace, {lapDistM: 300, player: false}, 290)).toBeNull();
  });

  it('leaves a frame that is on another stretch to the 5 Hz inputs', () => {
    expect(livePedalsAt(trace, {lapDistM: 300, player: true}, 300 - LIVE_MAX_OFFSET_M)).not.toBeNull();
    expect(livePedalsAt(trace, {lapDistM: 300, player: true}, 300 - LIVE_MAX_OFFSET_M - 1)).toBeNull();
    expect(livePedalsAt(trace, {lapDistM: 10, player: true}, 300)).toBeNull();
    expect(livePedalsAt(trace, {lapDistM: NaN, player: true}, 300)).toBeNull();
  });

  it('only ever gives finite pedals', () => {
    for (const d of [100, 100.01, 250.5, 539.9, 540]) {
      const p = livePedalsAt(trace, {lapDistM: d, player: true}, d);
      if (p) for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('samePedals', () => {
  it('compares the three values, and null with null', () => {
    const a = {throttlePct: 1, brakePct: 2, steeringPct: 3};
    expect(samePedals(a, {...a})).toBe(true);
    expect(samePedals(a, {...a, steeringPct: 4})).toBe(false);
    expect(samePedals(null, null)).toBe(true);
    expect(samePedals(a, null)).toBe(false);
  });
});
