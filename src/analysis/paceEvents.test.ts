import {describe, expect, it} from '@jest/globals';

import {
  EVENT_GUARD_S,
  MIN_CURVE_LAPS,
  MIN_EVENT_LAPS,
  type PaceLap,
  judgedPace,
  paceEvents,
  sectionTimesOf,
  slowLapIds,
  smallSampleFactor,
  smoothPace,
} from './paceEvents';
import {median} from './setStats';

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

describe('one rule at every size (decision 2026-10-12)', () => {
  it('judges a session of five laps: a lap 9 s slow is slow', () => {
    const laps = driver([{stint: 1, laps: MIN_EVENT_LAPS, noise: 0.03}]);
    laps[2] = withMistake(laps[2], 3, 9);
    expect(ids(laps)).toEqual([laps[2].id]);
  });

  it('judges nothing in a session of four laps: with so few there is no pace', () => {
    const laps = driver([{stint: 1, laps: MIN_EVENT_LAPS - 1, noise: 0.03}]);
    laps[2] = withMistake(laps[2], 3, 9);
    expect(ids(laps)).toEqual([]);
    expect(slowLapIds(laps).size).toBe(0);
  });

  it('corrects the sigma of a few laps upward: the limit at 5 laps is 1.206 times the plain one', () => {
    expect(smallSampleFactor(5)).toBeCloseTo(1.206, 3);
    expect(smallSampleFactor(9)).toBeCloseTo(1.107, 3);
    expect(smallSampleFactor(10)).toBeCloseTo(10 / 9.2, 6);
    expect(smallSampleFactor(40)).toBeCloseTo(40 / 39.2, 6);
  });

  it('has slow laps as the ids of the events', () => {
    const laps = driver([{stint: 1, laps: 20, noise: 0.03}]);
    laps[7] = withMistake(laps[7], 2, 5);
    expect([...slowLapIds(laps)]).toEqual([laps[7].id]);
  });

  it("builds a lap's sections from the start straight and the sections, or none", () => {
    expect(sectionTimesOf(10, [20, 30])).toEqual([10, 20, 30]);
    expect(sectionTimesOf(null, [20, 30])).toBeNull();
    expect(sectionTimesOf(10, [20, null])).toBeNull();
    expect(sectionTimesOf(10, [])).toBeNull();
  });
});

describe('a stint too short for a curve', () => {
  // Twelve laps in one stint, then a lone lap in a stint of its own: `x` times
  // the session's pace (its sections and lap time both scaled).
  const withLone = (x: number): PaceLap[] => {
    const long = driver([{stint: 1, laps: 12, noise: 0.05}]);
    const lone: PaceLap = {
      id: 'lone',
      stint: 2,
      stintLap: 0,
      lapTime: 76 * x,
      sections: BASES.map(b => b * x),
    };
    return [...long, lone];
  };

  it('a lone lap 2 % off the session pace is slow, and one at pace is not', () => {
    expect(MIN_CURVE_LAPS).toBe(3);
    expect(slowLapIds(withLone(1.02)).has('lone')).toBe(true);
    expect(slowLapIds(withLone(1)).has('lone')).toBe(false);
  });

  it('a pair of laps is judged the same way', () => {
    const laps = withLone(1.02);
    const pair = [
      ...laps.slice(0, -1),
      {...laps[laps.length - 1], id: 'a'},
      {...laps[laps.length - 1], id: 'b', stintLap: 1},
    ];
    expect([...slowLapIds(pair)].sort()).toEqual(['a', 'b']);
  });

  it('the session limit does not depend on how slow the short stint is', () => {
    // A real event in the long stint reports the limit; the lone lap adds a
    // residual of 0 to it whatever its pace.
    const limit = (x: number) => {
      const laps = withLone(x);
      laps[5] = {...laps[5], lapTime: laps[5].lapTime + 5};
      return paceEvents(laps).find(e => e.id === laps[5].id)?.limitS;
    };
    expect(limit(1.02)).toBeDefined();
    expect(limit(1.02)).toBe(limit(1));
  });

  it('a stint of 3 laps is judged against its own curve, as before', () => {
    const three = [
      ...driver([{stint: 1, laps: 12, noise: 0.05}]),
      ...[0, 1, 2].map(i => ({
        id: `t${i}`,
        stint: 2,
        stintLap: i,
        lapTime: 76 * 1.02,
        sections: BASES.map(b => b * 1.02),
      })),
    ];
    // Three laps at 2 % off are a run of 3: their own pace, not events.
    expect(slowLapIds(three).size).toBe(0);
  });
});

describe('the edges of a stint (pit-wall thread 120, ticket 31)', () => {
  // One stint of `n` laps with no sections: the lap time is the pace. A small
  // deterministic scatter keeps the limit above its guard; `extra` adds seconds
  // to the laps at those positions.
  const SCATTER = [0.04, -0.06, 0.02, 0.07, -0.03, 0.05, -0.04, 0.01];
  const stint = (n: number, extra: Record<number, number> = {}): PaceLap[] =>
    Array.from({length: n}, (_, i) => ({
      id: `l${i}`,
      stint: 1,
      stintLap: i,
      lapTime: 76 + SCATTER[i % SCATTER.length] + (extra[i] ?? 0),
      sections: null,
    }));
  const slow = (laps: readonly PaceLap[]) => [...slowLapIds(laps)].sort();
  const SLOW_S = 3;

  it('a run of 2 slow laps at the start of a stint is slow', () => {
    expect(slow(stint(12, {0: SLOW_S, 1: SLOW_S}))).toEqual(['l0', 'l1']);
  });

  it('a run of 2 one lap in from the start is slow', () => {
    expect(slow(stint(12, {1: SLOW_S, 2: SLOW_S}))).toEqual(['l1', 'l2']);
  });

  it('a run of 2 slow laps at the end of a stint is slow', () => {
    expect(slow(stint(12, {10: SLOW_S, 11: SLOW_S}))).toEqual(['l10', 'l11']);
    expect(slow(stint(12, {9: SLOW_S, 10: SLOW_S}))).toEqual(['l10', 'l9']);
  });

  it('a stint of 6 judges its edges the same way', () => {
    expect(slow(stint(6, {0: SLOW_S, 1: SLOW_S}))).toEqual(['l0', 'l1']);
    expect(slow(stint(6, {4: SLOW_S, 5: SLOW_S}))).toEqual(['l4', 'l5']);
  });

  it('a run of 3 at an edge is pace, not events', () => {
    expect(slow(stint(12, {0: SLOW_S, 1: SLOW_S, 2: SLOW_S}))).toEqual([]);
    expect(slow(stint(12, {9: SLOW_S, 10: SLOW_S, 11: SLOW_S}))).toEqual([]);
  });

  it('a warm-up of 5 laps that falls away linearly is followed at the start, and a fade at the end', () => {
    const ramp = {0: 2.5, 1: 2, 2: 1.5, 3: 1, 4: 0.5};
    expect(slow(stint(12, ramp))).toEqual([]);
    const fade = {7: 0.5, 8: 1, 9: 1.5, 10: 2, 11: 2.5};
    expect(slow(stint(12, fade))).toEqual([]);
  });

  it('one slow lap at an edge is still slow', () => {
    expect(slow(stint(12, {0: SLOW_S}))).toEqual(['l0']);
    expect(slow(stint(12, {11: SLOW_S}))).toEqual(['l11']);
  });

  it('a stint of 5 laps is judged as before: the median of 3 next to the edge', () => {
    const f = [1.1, 1.1, 1, 1, 1];
    expect(judgedPace(f)).toEqual(smoothPace(f));
  });

  it('the session limit is the one smoothPace residuals make, whatever the edges do', () => {
    // Two stints, an edge pair in one and a mistake in the other, so there are
    // events to report the limit on. The limit is made again here from
    // smoothPace alone: the edge rule must not move it.
    const a = stint(12, {0: SLOW_S, 1: SLOW_S});
    const b = stint(10, {5: 6}).map(l => ({...l, id: `b${l.id}`, stint: 2}));
    const laps = [...a, ...b];
    const residuals = [a, b].flatMap(st => {
      const times = st.map(l => l.lapTime);
      const curve = smoothPace(times);
      return times.map((t, i) => t - curve[i]);
    });
    const m = median(residuals) as number;
    const mad = median(residuals.map(r => Math.abs(r - m))) as number;
    const limitS = Math.max(
      3.5 * smallSampleFactor(residuals.length) * 1.4826 * mad,
      EVENT_GUARD_S,
    );
    const events = paceEvents(laps);
    expect(events.map(e => e.id)).toContain('l0');
    expect(events.map(e => e.id)).toContain('bl5');
    for (const e of events) expect(e.limitS).toBe(limitS);
  });

  it('judgedPace follows a straight fade exactly, ends included, and keeps a run of 2 out of the curve', () => {
    const f = Array.from({length: 9}, (_, i) => 1 - i * 0.01);
    judgedPace(f).forEach((v, i) => expect(v).toBeCloseTo(f[i], 9));
    const flat = Array(10).fill(1);
    for (const edge of [[0, 1], [8, 9]]) {
      const two = [...flat];
      for (const i of edge) two[i] = 1.1;
      judgedPace(two).forEach(v => expect(v).toBe(1));
    }
  });
});
