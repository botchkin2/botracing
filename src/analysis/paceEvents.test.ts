import {describe, expect, it} from '@jest/globals';

import {
  EVENT_GUARD_S,
  MIN_EVENT_LAPS,
  type PaceLap,
  paceEvents,
  smoothPace,
} from './paceEvents';

// A seeded rhythm so the synthetic drivers are the same on every run.
function rng(seed: number) {
  let s = seed;
  const next = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  // Standard normal by Box-Muller.
  return () =>
    Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
}

const BASES = [10, 12, 9, 14, 11, 20]; // start straight, five sections: 76 s

type Spec = {
  stint: number;
  laps: number;
  /** Seconds a corner loses at random (the driver's level). */
  noise: number;
  /** Seconds the stint gets quicker per lap (fuel). */
  fadePerLap?: number;
  /** A tyre knee: from this lap the laps slow by `kneePerLap` each. */
  knee?: {at: number; perLap: number};
};

function driver(specs: Spec[], seed = 7): PaceLap[] {
  const z = rng(seed);
  const out: PaceLap[] = [];
  for (const sp of specs)
    for (let i = 0; i < sp.laps; i++) {
      const pace =
        1 -
        ((sp.fadePerLap ?? 0) * i) / 76 +
        (sp.knee && i >= sp.knee.at
          ? ((i - sp.knee.at) * sp.knee.perLap) / 76
          : 0);
      const sections = BASES.map(b =>
        Math.max(0.1, b * pace + sp.noise * Math.abs(z())),
      );
      out.push({
        id: `s${sp.stint}l${i}`,
        stint: sp.stint,
        stintLap: i,
        lapTime: sections.reduce((a, b) => a + b, 0),
        sections,
      });
    }
  return out;
}

/** The lap with `extraS` added to one section (a mistake), keeping the sections adding up to the lap time. */
const withMistake = (l: PaceLap, section: number, extraS: number): PaceLap => ({
  ...l,
  lapTime: l.lapTime + extraS,
  sections: (l.sections as number[]).map((t, s) =>
    s === section ? t + extraS : t,
  ),
});

const ids = (laps: readonly PaceLap[]) => paceEvents(laps).map(e => e.id);

describe('paceEvents', () => {
  it('judges nothing under the minimum number of laps', () => {
    const laps = driver([{stint: 1, laps: MIN_EVENT_LAPS - 1, noise: 0.03}]);
    laps[3] = withMistake(laps[3], 2, 9);
    expect(ids(laps)).toEqual([]);
  });

  it('drops a single-section mistake of a very consistent driver, and none of their clean laps', () => {
    const laps = driver([{stint: 1, laps: 25, noise: 0.03, fadePerLap: 0.05}]);
    laps[10] = withMistake(laps[10], 3, 1.5);
    expect(ids(laps)).toEqual([laps[10].id]);
  });

  it("scales with the driver: a messy driver's scatter is not an event, a big mistake still is", () => {
    const laps = driver(
      [{stint: 1, laps: 25, noise: 0.35, fadePerLap: 0.05}],
      11,
    );
    const clean = ids(laps).length;
    expect(clean).toBeLessThanOrEqual(2); // at most a couple of the 25 clean laps
    laps[12] = withMistake(laps[12], 4, 9);
    expect(ids(laps)).toContain(laps[12].id);
    // 1.5 s sits inside this driver's own scatter.
    const mild = driver(
      [{stint: 1, laps: 25, noise: 0.35, fadePerLap: 0.05}],
      11,
    );
    mild[12] = withMistake(mild[12], 4, 1.5);
    expect(ids(mild)).not.toContain(mild[12].id);
  });

  it('follows a tyre knee and keeps a slower patch of three laps in a row', () => {
    const laps = driver([
      {
        stint: 1,
        laps: 24,
        noise: 0.03,
        fadePerLap: 0.04,
        knee: {at: 16, perLap: 0.25},
      },
    ]);
    expect(ids(laps)).toEqual([]);
    // Three laps 3% slower, one after the other: a change of pace, not events.
    const patch = driver([{stint: 1, laps: 24, noise: 0.03}]).map((l, i) =>
      i >= 10 && i <= 12
        ? {
            ...l,
            lapTime: l.lapTime * 1.03,
            sections: (l.sections as number[]).map(t => t * 1.03),
          }
        : l,
    );
    expect(ids(patch)).toEqual([]);
  });

  it('drops a lap 22 s slow in a stint of two laps, which a trend through its own laps would keep', () => {
    const laps = [
      ...driver([{stint: 1, laps: 24, noise: 0.03}]),
      ...driver([{stint: 2, laps: 2, noise: 0.03}], 5),
    ];
    const bad = laps.length - 1;
    laps[bad] = withMistake(laps[bad], 3, 22);
    expect(ids(laps)).toEqual([laps[bad].id]);
  });

  it('uses the lap time as the pace when a lap has no sections: same curve, same test, no line', () => {
    const laps = driver([
      {stint: 1, laps: 24, noise: 0.03, fadePerLap: 0.05},
    ]).map(l => ({
      ...l,
      sections: null,
    }));
    laps[8] = {...laps[8], lapTime: laps[8].lapTime + 4};
    expect(ids(laps)).toEqual([laps[8].id]);
    // Sections that do not line up count as none.
    const mixed = driver([{stint: 1, laps: 24, noise: 0.03}]);
    mixed[3] = {...mixed[3], sections: [1, 2]};
    mixed[9] = {...mixed[9], lapTime: mixed[9].lapTime + 4};
    expect(ids(mixed)).toEqual([mixed[9].id]);
  });

  it('has a limit of at least the guard, and says how far each event is over it', () => {
    const laps = driver([{stint: 1, laps: 24, noise: 0}]);
    laps[5] = withMistake(laps[5], 1, 0.4);
    const [e] = paceEvents(laps);
    expect(e.id).toBe(laps[5].id);
    expect(e.limitS).toBeCloseTo(EVENT_GUARD_S, 6);
    expect(e.residualS).toBeCloseTo(0.4, 1);
  });

  it('is empty without laps', () => {
    expect(paceEvents([])).toEqual([]);
  });
});

describe('smoothPace', () => {
  it('follows a straight fade exactly, ends included', () => {
    const f = Array.from({length: 9}, (_, i) => 1 - i * 0.01);
    smoothPace(f).forEach((v, i) => expect(v).toBeCloseTo(f[i], 9));
  });

  it('keeps a run of three in the curve and ignores one or two', () => {
    const base = Array(11).fill(1);
    const one = [...base];
    one[5] = 1.1;
    expect(smoothPace(one)[5]).toBe(1);
    const three = [...base];
    for (const i of [4, 5, 6]) three[i] = 1.1;
    expect(smoothPace(three)[5]).toBeCloseTo(1.1, 9);
  });

  it('is the median under five laps', () => {
    expect(smoothPace([1, 5])).toEqual([3, 3]);
    expect(smoothPace([1, 2, 9])).toEqual([2, 2, 2]);
  });
});
