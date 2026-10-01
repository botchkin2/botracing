import {describe, expect, it} from '@jest/globals';

import {
  BOUNDARY_MARGIN_S,
  type Boundaries,
  brakeApplications,
  type CornerWindow,
  cornerBoundaries,
  EARLIEST_QUANTILE,
  foldBoundaries,
  fullThrottlePointM,
  type MapSection,
  onsetM,
  onsetOf,
  onsetPools,
  onsetsOfLaps,
  type PedalTrace,
  splitWindow,
} from './cornerBoundaries';
import * as daytona from './__fixtures__/daytonaBoundaries';
import * as atlanta from './__fixtures__/roadAtlantaBoundaries';

const speedAt = (profile: number[]) => (m: number) =>
  profile[Math.min(profile.length - 1, Math.max(0, Math.round(m / 5)))];

const windowsOf = (f: typeof daytona | typeof atlanta) =>
  cornerBoundaries({
    lengthM: f.lengthM,
    sections: f.sections as MapSection[],
    onsetsM: f.onsets.map(o => o.onsetsM),
    speedKmhAt: speedAt(f.speedKmh),
  });

// The onset the 5th percentile of a section's laps rests on, to a 5 m bin.
const reference = (onsets: (number | null)[]) => {
  const v = onsets.filter((m): m is number => m != null).sort((a, b) => a - b);
  return v[Math.max(1, Math.ceil(EARLIEST_QUANTILE * v.length)) - 1];
};

describe.each([
  ['Daytona', daytona],
  ['Road Atlanta', atlanta],
])('%s windows', (_name, f) => {
  const windows = windowsOf(f);
  const sections = windows.filter(w => w.kind === 'section');

  it('tile the lap from the line to the line, in order, with no gap or overlap', () => {
    expect(windows[0].fromM).toBe(0);
    expect(windows[windows.length - 1].toM).toBe(f.lengthM);
    windows.slice(1).forEach((w, i) => expect(w.fromM).toBe(windows[i].toM));
    for (const w of windows) expect(w.toM).toBeGreaterThan(w.fromM);
  });

  it('puts every section start a margin before the 5th percentile onset, so the laps are still on the straight', () => {
    sections.forEach((w, k) => {
      const ref = Math.min(
        f.sections[k].entryM,
        reference(f.onsets[k].onsetsM),
      );
      expect(w.fromM).toBeLessThan(ref);
      // 0.5 s at the speed there, give or take a 5 m bin and the 5 m profile.
      const marginM = (speedAt(f.speedKmh)(ref) / 3.6) * BOUNDARY_MARGIN_S;
      const gap = ref - w.fromM;
      // A boundary clamped to the previous exit sits closer than the margin.
      if (k > 0 && w.fromM === f.sections[k - 1].exitM) {
        expect(gap).toBeLessThanOrEqual(marginM + 10);
      } else {
        expect(Math.abs(gap - marginM)).toBeLessThan(10);
      }
    });
  });

  it('never starts a window behind the previous section exit', () => {
    sections.forEach((w, k) => {
      if (k > 0)
        expect(w.fromM).toBeGreaterThanOrEqual(f.sections[k - 1].exitM);
    });
  });
});

describe('Daytona', () => {
  const windows = windowsOf(daytona);

  it('makes the start/finish line a boundary: the last section ends at the line and the start straight is its own unit', () => {
    const start = windows[0];
    expect(start.kind).toBe('start-straight');
    expect(start.section).toBeNull();
    expect(start.fromM).toBe(0);
    const last = windows[windows.length - 1];
    expect(last.section).toBe(5);
    expect(last.toM).toBe(daytona.lengthM);
  });

  it('holds the bus stop as one section with three parts that tile its window', () => {
    const bus = windows.find(w => w.section === 5)!;
    expect(bus.parts.map(p => p.n)).toEqual([8, 9, 10]);
    expect(bus.parts[0].fromM).toBe(bus.fromM);
    expect(bus.parts[2].toM).toBe(bus.toM);
    bus.parts
      .slice(1)
      .forEach((p, i) => expect(p.fromM).toBe(bus.parts[i].toM));
  });

  it('leaves a single corner with no parts of its own', () => {
    expect(windows.find(w => w.section === 2)!.parts).toEqual([]);
  });

  it('ends T10 at the line instead of around it', () => {
    // The old window ran 4,005 m to 305 m, around the lap end; now it stops at
    // the line and the start straight begins there.
    const bus = windows.find(w => w.section === 5)!;
    expect(bus.parts[2].toM).toBe(daytona.lengthM);
    expect(windows[0].toM).toBeLessThan(daytona.sections[0].entryM);
  });

  it('measures a kink nobody brakes for by its lifts, and a braked section by its brakes', () => {
    expect(daytona.onsets.map(o => o.kind)).toEqual([
      'brake',
      'brake',
      'lift',
      'brake',
      'brake',
    ]);
  });
});

// A lap through one section at 5 m: turn-in at 340 m, exit at 420 m. Brake
// from brakeFrom, lift from liftFrom, until 380 m.
const section: MapSection = {n: 1, entryM: 300, turnInM: 340, exitM: 420};
const lap = (brakeFrom: number | null, liftFrom: number | null): PedalTrace => {
  const distM = Array.from({length: 61}, (_, i) => 200 + i * 5);
  return {
    distM,
    brakePct: distM.map(d =>
      brakeFrom != null && d >= brakeFrom && d < 380 ? 60 : 0,
    ),
    throttlePct: distM.map(d =>
      liftFrom != null && d >= liftFrom && d < 380 ? 50 : 100,
    ),
  };
};

describe('onsetM', () => {
  it('is the first sample of the brake run that reaches turn-in', () => {
    expect(onsetM(lap(285, null), section, 0)).toBe(285);
  });

  it('counts a lift only when asked for lifts, and then the earlier of the two starts it', () => {
    // A lift-and-coast before a brake zone is not where the braking starts.
    expect(onsetM(lap(295, 270), section, 0, 'brake')).toBe(295);
    expect(onsetM(lap(295, 270), section, 0, 'lift')).toBe(270);
  });

  it('is null for a corner taken flat', () => {
    expect(onsetM(lap(null, null), section, 0, 'brake')).toBeNull();
    expect(onsetM(lap(null, null), section, 0, 'lift')).toBeNull();
  });

  it('does not look behind the previous section exit', () => {
    expect(onsetM(lap(210, null), section, 250)).toBe(250);
  });

  it('holds a brake run through trail braking that hovers near the on level', () => {
    const t = lap(285, null);
    t.brakePct = t.distM.map(d =>
      d < 285 ? 0 : d < 300 ? 60 : d < 340 ? 5 : 0,
    );
    expect(onsetM(t, section, 0)).toBe(285);
  });
});

describe('look-back', () => {
  // A 330 km/h approach: turn-in at 1,000 m, the previous exit at 400 m.
  const fast: MapSection = {n: 2, entryM: 760, turnInM: 1000, exitM: 1100};
  const trace = (brakeFrom: number): PedalTrace => {
    const distM = Array.from({length: 121}, (_, i) => 400 + i * 5);
    return {
      distM,
      brakePct: distM.map(d => (d >= brakeFrom && d < 1050 ? 80 : 0)),
      throttlePct: distM.map(d => (d >= brakeFrom && d < 1050 ? 0 : 100)),
      speedKmh: distM.map(() => 330),
    };
  };

  it('looks back five seconds at the speed there, so a long brake zone is found', () => {
    // 330 km/h is 92 m/s: 5 s reaches 400 m, the cap, 600 m. A brake at 740 m
    // is 260 m before turn-in: past the old fixed 250 m.
    expect(onsetM(trace(740), fast, 0)).toBe(740);
  });

  it('returns no onset, and says why, when the run goes back past the look-back', () => {
    // Braking since 500 m: the look-back stops at 600 m, so 600 m is not the onset.
    const long = onsetOf(trace(500), fast, 0);
    expect(long).toEqual({atM: null, beyondLookBack: true});
    expect(onsetsOfLaps([trace(500), trace(740)], fast, 0)).toMatchObject({
      kind: 'brake',
      onsetsM: [null, 740],
      beyondLookBack: 1,
    });
  });

  it('is not beyond the look-back when the previous exit held the run', () => {
    expect(onsetOf(trace(500), fast, 700)).toEqual({
      atM: 700,
      beyondLookBack: false,
    });
  });
});

describe('onsetsOfLaps', () => {
  it('uses brake onsets where most laps brake, so a lift-and-coast lap cannot move the section', () => {
    const laps = [lap(285, null), lap(290, null), lap(285, 230)];
    const {kind, onsetsM} = onsetsOfLaps(laps, section, 0);
    expect(kind).toBe('brake');
    expect(onsetsM).toEqual([285, 290, 285]);
  });

  it('uses lift onsets for a section nobody brakes for, and none for a corner taken flat', () => {
    const kink = onsetsOfLaps([lap(null, 300), lap(null, 310)], section, 0);
    expect(kink).toMatchObject({kind: 'lift', onsetsM: [300, 310]});
    const flat = onsetsOfLaps([lap(null, null), lap(null, null)], section, 0);
    expect(flat).toMatchObject({kind: 'lift', onsetsM: [null, null]});
  });
});

describe('foldBoundaries', () => {
  const sections: MapSection[] = [
    {n: 1, entryM: 300, turnInM: 340, exitM: 420},
  ];
  const speed = () => 180; // 50 m/s: a 25 m margin
  // A session's pools from onsets laid on 5 m bins.
  const pools = (onsets: number[]) =>
    onsetPools(sections, [{kind: 'brake', onsetsM: onsets}]);
  const fold = (
    stored: Boundaries | null,
    sessionId: string,
    onsets: number[],
    extra: {minLaps?: number; minSessions?: number} = {},
  ) =>
    foldBoundaries({
      sections,
      stored,
      sessionId,
      pools: pools(onsets),
      speedKmhAt: speed,
      ...extra,
    });
  // 40 laps around 280 m, one early outlier at 200 m (a spin, a coast).
  const around = (n: number, at = 280) => Array.from({length: n}, () => at);

  // A layout established from its first session, to test what later ones do.
  const established = (onsets: number[]) =>
    fold(null, 's1', onsets, {minSessions: 1}).boundaries;

  it('starts a layout at rev 1 and is provisional (the map entry) until enough laps from enough sessions', () => {
    const first = fold(null, 's1', around(15));
    expect(first.boundaries.rev).toBe(1);
    expect(first.boundaries.earliestOnsetM).toEqual([null]);
    // The map's entry, 300 m, less the 25 m margin.
    expect(first.boundaries.startsM[0]).toBeCloseTo(275, 0);
    // A second session with 25 laps in all makes the pool established; its
    // 5th percentile is 280 m, 20 m from where the start stands: inside the
    // margin, so the windows stay and the rev too.
    const second = fold(first.boundaries, 's2', around(10));
    expect(second.boundaries.earliestOnsetM[0]).toBe(280);
    expect(second.moved).toBe(false);
    expect(second.boundaries.startsM[0]).toBeCloseTo(275, 0);
  });

  it('does not let one wild lap move a boundary: the 5th percentile ignores it', () => {
    const stored = established(around(40));
    const folded = fold(stored, 's2', [200, ...around(39)]);
    expect(folded.boundaries.earliestOnsetM[0]).toBe(280);
    expect(folded.moved).toBe(false);
  });

  it('leaves the boundaries and the rev alone when a later session moves them by less than the margin', () => {
    const base = established(around(20));
    // 10 m earlier on 30 laps: the 5th percentile moves 10 m, inside the 25 m margin.
    const later = fold(base, 's2', around(30, 270));
    expect(later.moved).toBe(false);
    expect(later.boundaries.rev).toBe(base.rev);
    expect(later.boundaries.startsM).toEqual(base.startsM);
    // The pool still took the laps in.
    expect(Object.keys(later.boundaries.sessions)).toContain('s2');
  });

  it('bumps the rev when a later session moves a boundary by more than the margin, earlier or later', () => {
    const base = established(around(20));
    const earlier = fold(base, 's2', around(60, 230));
    expect(earlier.moved).toBe(true);
    expect(earlier.boundaries.rev).toBe(base.rev + 1);
    expect(earlier.boundaries.startsM[0]).toBeLessThan(base.startsM[0] - 25);
    // Later: from a layout that began at 250 m, so many laps at 330 m (the
    // map's entry, 300 m, is as late as a start goes) that the early 20 fall
    // under the 5th percentile.
    const early = established(around(20, 250));
    const later = fold(early, 's2', around(400, 330));
    expect(later.moved).toBe(true);
    expect(later.boundaries.rev).toBe(early.rev + 1);
    expect(later.boundaries.startsM[0]).toBeGreaterThan(early.startsM[0] + 25);
  });

  it('replaces a session on a resync instead of counting its laps twice', () => {
    const base = fold(null, 's1', around(30)).boundaries;
    const again = fold(base, 's1', around(30));
    expect(again.changed).toBe(false);
    expect(again.boundaries).toEqual(base);
  });

  it('puts a corner taken flat at its turn-in less the margin', () => {
    const flat = foldBoundaries({
      sections: [{n: 1, entryM: 340, turnInM: 340, exitM: 420}],
      stored: null,
      sessionId: 's1',
      pools: onsetPools(
        [{n: 1, entryM: 340, turnInM: 340, exitM: 420}],
        [{kind: 'lift', onsetsM: [null, null, null]}],
      ),
      speedKmhAt: speed,
    });
    expect(flat.boundaries.startsM[0]).toBeCloseTo(315, 0);
  });

  it('replaces boundaries stored under another rule version, with a higher rev', () => {
    const base = fold(null, 's1', around(30)).boundaries;
    const old: Boundaries = {...base, v: 0, rev: 4};
    const next = fold(old, 's2', around(30));
    expect(next.boundaries.v).toBe(base.v);
    expect(next.boundaries.rev).toBe(5);
    expect(next.moved).toBe(false);
  });
});

describe('fullThrottlePointM', () => {
  const window = {fromM: 0, toM: 400};
  // 10 m a sample at 50 m/s: 0.2 s a sample.
  const trace = (throttlePct: number[]): PedalTrace => ({
    distM: throttlePct.map((_, i) => i * 10),
    brakePct: throttlePct.map(() => 0),
    throttlePct,
    timeS: throttlePct.map((_, i) => i * 0.2),
  });

  it('is the first sample at full throttle that holds', () => {
    expect(
      fullThrottlePointM(trace([0, 0, 40, 80, 96, 100, 100, 100]), window),
    ).toBe(40);
  });

  it('ignores a flick of throttle in the middle of a chicane', () => {
    // 100 % for one sample (0.2 s), then back off: not the exit.
    const flick = [0, 0, 100, 20, 20, 40, 96, 100, 100, 100];
    expect(fullThrottlePointM(trace(flick), window)).toBe(60);
  });

  it('finds a traction-limited exit that never sits at full throttle', () => {
    const limited = [0, 0, 40, 88, 92, 87, 93, 89, 91, 90, 92, 90, 91];
    expect(fullThrottlePointM(trace(limited), window)).toBe(30);
  });

  it('is null when the pedal never gets there, and without times', () => {
    expect(fullThrottlePointM(trace([0, 10, 20, 30, 40]), window)).toBeNull();
    const noTime = trace([100, 100, 100]);
    delete noTime.timeS;
    expect(fullThrottlePointM(noTime, window)).toBeNull();
  });
});

describe('splitWindow', () => {
  const timeAt = (m: number) => m / 50;
  const window = {fromM: 1000, toM: 1600};

  it('splits a window into run-in, corner and exit that add up to its time', () => {
    const s = splitWindow(timeAt, window, {
      onsetM: 1100,
      fullThrottleAtM: 1400,
    });
    expect(s).toEqual({runInS: 2, cornerS: 6, exitS: 4});
    expect(s.runInS + s.cornerS + s.exitS).toBe(timeAt(1600) - timeAt(1000));
  });

  it('starts the corner at the window with no brake and runs it to the end with no full throttle', () => {
    expect(
      splitWindow(timeAt, window, {onsetM: null, fullThrottleAtM: 1400}),
    ).toEqual({runInS: 0, cornerS: 8, exitS: 4});
    expect(
      splitWindow(timeAt, window, {onsetM: 1100, fullThrottleAtM: null}),
    ).toEqual({runInS: 2, cornerS: 10, exitS: 0});
  });

  it('splits a lift-only section at its lift onset, the same one the boundary uses', () => {
    const kink = onsetsOfLaps([lap(null, 270)], section, 0);
    expect(kink.kind).toBe('lift');
    const s = splitWindow(timeAt, window, {
      onsetM: 1000 + (kink.onsetsM[0]! - 200),
      fullThrottleAtM: 1400,
    });
    expect(s.runInS).toBeGreaterThan(0);
    expect(s.runInS + s.cornerS + s.exitS).toBeCloseTo(12, 9);
  });

  it('keeps the points in the window and in order', () => {
    const early = splitWindow(timeAt, window, {
      onsetM: 900,
      fullThrottleAtM: 950,
    });
    expect(early).toEqual({runInS: 0, cornerS: 0, exitS: 12});
    const late = splitWindow(timeAt, window, {
      onsetM: 1500,
      fullThrottleAtM: 1200,
    });
    expect(late.runInS + late.cornerS + late.exitS).toBeCloseTo(12, 9);
    expect(late.cornerS).toBe(0);
  });
});

describe('brakeApplications', () => {
  const windows = windowsOf(daytona);
  const bus = windows.find(w => w.section === 5) as CornerWindow;

  it('finds the bus stop as brake applications at section level, with onset, peak and part', () => {
    const [first, second] = daytona.busStopLaps.map(l =>
      brakeApplications(l, bus),
    );
    // Lap one: the hard stop for T8 and a touch (12 %) for T9, which starts
    // before the part window of T9 does: it still belongs to T9.
    expect(first.map(a => a.part)).toEqual([8, 9]);
    expect(first[0].peakPct).toBeGreaterThan(80);
    expect(first[1].peakPct).toBeLessThan(20);
    expect(first[1].onsetM).toBeLessThan(bus.parts[1].fromM);
    // Lap two: the same two applications, T8's firmer.
    expect(second.map(a => a.part)).toEqual([8, 9]);
    expect(second[1].peakPct).toBeGreaterThan(20);
  });

  it("labels an application by the corner it brakes for, even when it starts before that corner's window", () => {
    const early: PedalTrace = {
      distM: [3840, 3850, 3860, 3870],
      brakePct: [0, 60, 70, 0],
      throttlePct: [0, 0, 0, 0],
    };
    // 3850 is inside T8's window (ends 3860) but T8 turned in at 3770.
    expect(brakeApplications(early, bus)).toEqual([
      {onsetM: 3850, peakPct: 70, part: 9},
    ]);
  });

  it('counts none on a lap that never brakes in the window', () => {
    const none: PedalTrace = {
      distM: [4000, 4010, 4020],
      brakePct: [0, 1, 0],
      throttlePct: [100, 100, 100],
    };
    expect(brakeApplications(none, bus)).toEqual([]);
  });

  it('does not split an application on trail braking that hovers near 10 %', () => {
    const trail: PedalTrace = {
      distM: [3700, 3710, 3720, 3730, 3740, 3750],
      brakePct: [80, 40, 9, 11, 8, 0],
      throttlePct: [0, 0, 0, 0, 0, 0],
    };
    expect(brakeApplications(trail, bus)).toEqual([
      {onsetM: 3700, peakPct: 80, part: 8},
    ]);
  });
});
