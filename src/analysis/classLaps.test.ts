import {describe, expect, it} from '@jest/globals';

import {
  carLaps,
  CLASS_LAPS_VERSION,
  classLaps,
  classLapsCurrent,
  classLapsDoc,
  type EncodedField,
  paceClass,
  sessionKind,
} from './classLaps';

const DT = 0.2;
const L = 4000;

type Spec = {
  class: string;
  lapS: number;
  offsetM: number;
  pitsAt?: (u: number) => boolean;
  flagAt?: (u: number) => boolean;
  // Replaces the distance at an update (a reset, a jump).
  distAt?: (u: number, along: number) => number | null;
};

// A field file: each car drives at a steady speed, lap distance wrapping at L,
// decimetre deltas as the uploader writes them.
function build(specs: Spec[], updates: number): EncodedField {
  const deltas = (values: (number | null)[]) => {
    let last = 0;
    return values.map(v => {
      if (v === null) return null;
      const d = v - last;
      last = v;
      return d;
    });
  };
  const dist = specs.map(s =>
    deltas(
      Array.from({length: updates}, (_, u) => {
        const along = s.offsetM + ((u * DT) / s.lapS) * L;
        const v = s.distAt ? s.distAt(u, along) : along % L;
        return v === null ? null : Math.round(v * 10);
      }),
    ),
  );
  return {
    hz: 5,
    tDs: Array.from({length: updates}, (_, u) => Math.round(u * DT * 10)),
    cars: specs.map(s => ({class: s.class})),
    lapDistDm: dist,
    inPits: specs.map(s =>
      Array.from({length: updates}, (_, u) => (s.pitsAt?.(u) ? 1 : 0)),
    ),
    flag: specs.map(s =>
      Array.from({length: updates}, (_, u) => (s.flagAt?.(u) ? 1 : 0)),
    ),
  };
}

const raceLaps = (f: EncodedField) => classLaps(f, 'race');

describe('carLaps', () => {
  it('times a lap crossing to crossing, not update to update', () => {
    // 100.1 s laps: crossings fall between 5 Hz updates, so sample-time
    // differences would read 100.0 or 100.2.
    const laps = carLaps(
      build([{class: 'GT3', lapS: 100.1, offsetM: 10}], 3200),
    )[0];
    expect(laps.length).toBeGreaterThanOrEqual(4);
    for (const t of laps) expect(Math.abs(t - 100.1)).toBeLessThan(0.02);
  });

  it('starts the clock at the first crossing', () => {
    // Crossings at updates 125, 625 and 1125: two laps.
    const f = build([{class: 'GT3', lapS: 100, offsetM: 3000}], 1500);
    expect(carLaps(f)[0]).toHaveLength(2);
  });

  it('leaves out a lap with a pit visit, a flag, or a gap in the field', () => {
    const f = build(
      [
        {
          class: 'GT3',
          lapS: 100,
          offsetM: 0,
          pitsAt: u => u > 1020 && u < 1040, // the lap ending at 1500
          flagAt: u => u > 1520 && u < 1540, // the lap ending at 2000
          distAt: (u, along) => (u > 2020 && u < 2040 ? null : along % L), // ending at 2500
        },
      ],
      3200,
    );
    // Crossings 500 (clock), 1000 counts, 1500 pit, 2000 flag, 2500 gap, 3000 counts.
    expect(carLaps(f)[0]).toHaveLength(2);
  });

  it('does not take a counter reset for the line', () => {
    // The lap distance jumps from 3700 to -300 (the race-start reset on the
    // Daytona files): 300 m in one update is not a crossing, and the lap
    // running through it is not a lap.
    const f = build(
      [
        {
          class: 'GT3',
          lapS: 100,
          offsetM: 0,
          distAt: (u, along) =>
            u > 700 && u < 1000
              ? along % L
              : u >= 1000
              ? (along % L) - 300
              : along % L,
        },
      ],
      3200,
    );
    const laps = carLaps(f)[0];
    // No lap is shorter than the real 100 s by the reset's 300 m (2.3 s).
    for (const t of laps) expect(t).toBeGreaterThan(97);
  });
});

describe('classLaps', () => {
  it('pools per pace class, and one odd name does not split a class', () => {
    const c = raceLaps(
      build(
        [
          {class: 'GT3', lapS: 110, offsetM: 0},
          {class: 'LMGT3', lapS: 111, offsetM: 500},
          {class: 'Hyper', lapS: 97, offsetM: 0},
          {class: 'Hypercar', lapS: 97.4, offsetM: 900},
        ],
        3200,
      ),
    );
    expect(c?.gt3?.cars).toBe(2);
    expect(c?.hypercar?.cars).toBe(2);
    expect(Math.abs((c?.gt3?.medianS ?? 0) - 110.5)).toBeLessThan(0.75);
    expect(Math.abs((c?.hypercar?.medianS ?? 0) - 97.2)).toBeLessThan(0.5);
    expect(c?.hypercar?.p10S).toBeLessThanOrEqual(c?.hypercar?.medianS ?? 0);
    expect(c?.hypercar?.p90S).toBeGreaterThanOrEqual(c?.hypercar?.medianS ?? 0);
  });

  it('keeps GTE apart from GT3', () => {
    const c = raceLaps(
      build(
        [
          {class: 'GT3', lapS: 110, offsetM: 0},
          {class: 'GTE', lapS: 104, offsetM: 0},
        ],
        3200,
      ),
    );
    expect(c?.gt3?.medianS).toBeCloseTo(110, 0);
    expect(c?.gte?.medianS).toBeCloseTo(104, 0);
  });

  it('cuts a slow car at 1.15x the class median', () => {
    const c = raceLaps(
      build(
        [
          {class: 'GT3', lapS: 100, offsetM: 0},
          {class: 'GT3', lapS: 100, offsetM: 100},
          {class: 'GT3', lapS: 140, offsetM: 200},
        ],
        3000,
      ),
    );
    expect(c?.gt3?.cars).toBe(2);
    expect(c?.gt3?.medianS).toBeLessThan(101);
  });

  it('cuts a fast false lap at 0.95x the class median', () => {
    // One car's lap distance jumps 1000 m forward at update 1200, so its wrap
    // comes early and that lap is 25 % short; the cut drops it.
    const jump = (u: number, along: number) =>
      u < 1200 ? along % L : (along + 1000) % L;
    const field = build(
      [
        {class: 'GT3', lapS: 100, offsetM: 0},
        {class: 'GT3', lapS: 100, offsetM: 300},
        {class: 'GT3', lapS: 100, offsetM: 600},
        {class: 'GT3', lapS: 100, offsetM: 900, distAt: jump},
      ],
      3000,
    );
    const lapsDriven = carLaps(field).flat();
    expect(Math.min(...lapsDriven)).toBeLessThan(80);
    expect(classLaps(field, 'race')?.gt3?.laps).toBe(lapsDriven.length - 1);
  });

  it('is null under three laps or with no laps at all', () => {
    expect(
      raceLaps(build([{class: 'GT3', lapS: 100, offsetM: 0}], 1300)),
    ).toBeNull();
  });
});

describe('practice', () => {
  // A car whose first three laps are 110 s (an out lap, a setup run) and the
  // rest 100 s: a race keeps them (inside 1.15x), practice drops them
  // (outside 1.07x of the car's own best).
  const slowStart = (u: number) => {
    const slowUpdates = 1650; // three 110 s laps at 0.2 s per update
    const a =
      u < slowUpdates
        ? ((u * DT) / 110) * L
        : ((slowUpdates * DT) / 110) * L + (((u - slowUpdates) * DT) / 100) * L;
    return a % L;
  };

  it('keeps a car laps within 1.07x of its own best, and drops the rest', () => {
    const field = build(
      [
        {class: 'GT3', lapS: 100, offsetM: 0},
        {class: 'GT3', lapS: 100, offsetM: 400},
        {class: 'GT3', lapS: 100, offsetM: 800, distAt: u => slowStart(u)},
      ],
      4000,
    );
    const race = classLaps(field, 'race');
    const practice = classLaps(field, 'practice');
    expect(practice?.gt3?.laps).toBeLessThan(race?.gt3?.laps ?? 0);
    expect(practice?.gt3?.p90S).toBeLessThan(101);
    expect(race?.gt3?.p90S).toBeGreaterThan(105);
  });

  it('applies the fast cut before taking a car best', () => {
    // A car whose lap distance jumps early has one 75 s false lap. If that
    // became its best, 1.07 x 75 s would throw away all its real 100 s laps.
    const jump = (u: number, along: number) =>
      u < 1200 ? along % L : (along + 1000) % L;
    const field = build(
      [
        {class: 'GT3', lapS: 100, offsetM: 0},
        {class: 'GT3', lapS: 100, offsetM: 300},
        {class: 'GT3', lapS: 100, offsetM: 600},
        {class: 'GT3', lapS: 100, offsetM: 900, distAt: jump},
      ],
      3000,
    );
    const lapsDriven = carLaps(field).flat();
    expect(classLaps(field, 'practice')?.gt3?.laps).toBe(lapsDriven.length - 1);
  });
});

describe('classLapsDoc', () => {
  const field = build(
    [
      {class: 'GT3', lapS: 100, offsetM: 0},
      {class: 'GT3', lapS: 100, offsetM: 300},
    ],
    3000,
  );
  it('records the kind and the version with the numbers', () => {
    const doc = classLapsDoc(field, 'Race');
    expect(doc.kind).toBe('race');
    expect(doc.version).toBe(CLASS_LAPS_VERSION);
    expect(doc.classes?.gt3?.cars).toBe(2);
    expect(classLapsDoc(field, 'Practice 1').kind).toBe('practice');
  });
  it('qualifying is written with no classes', () => {
    expect(classLapsDoc(field, 'Qualify')).toEqual({
      version: CLASS_LAPS_VERSION,
      kind: 'qualify',
      classes: null,
    });
  });
  it('a field nothing reaches three laps in still gets a doc', () => {
    const short = build([{class: 'GT3', lapS: 100, offsetM: 0}], 1300);
    expect(classLapsDoc(short, 'Race').classes).toBeNull();
    expect(classLapsDoc(short, 'Race').version).toBe(CLASS_LAPS_VERSION);
  });
});

describe('sessionKind', () => {
  it('reads the raw session type', () => {
    expect(
      ['Race', 'Practice', 'Practice 2', 'Qualify', '', 'Warmup'].map(
        sessionKind,
      ),
    ).toEqual([
      'race',
      'practice',
      'practice',
      'qualify',
      'practice',
      'practice',
    ]);
  });
});

describe('paceClass', () => {
  it('maps the sim strings, else other', () => {
    expect(
      ['Hyper', 'LMP2', 'GT3', 'LMGT3', 'GTE', 'Hypercar', '', 'Odd'].map(
        paceClass,
        sessionKind,
      ),
    ).toEqual([
      'hypercar',
      'lmp2',
      'gt3',
      'gt3',
      'gte',
      'hypercar',
      'other',
      'other',
    ]);
  });
});

describe('classLapsCurrent', () => {
  const doc = {version: CLASS_LAPS_VERSION, kind: 'race'};
  it('keeps the same version and kind', () => {
    expect(classLapsCurrent(doc, 'Race')).toBe(true);
  });
  it('recomputes an older version, a missing doc, or a re-typed session', () => {
    expect(
      classLapsCurrent({...doc, version: CLASS_LAPS_VERSION - 1}, 'Race'),
    ).toBe(false);
    expect(classLapsCurrent(null, 'Race')).toBe(false);
    expect(classLapsCurrent(undefined, 'Race')).toBe(false);
    expect(classLapsCurrent(doc, 'Practice')).toBe(false);
  });
  it('a legitimately empty doc is current, so it is not downloaded again', () => {
    expect(
      classLapsCurrent(
        {version: CLASS_LAPS_VERSION, kind: 'qualify', classes: null},
        'Qualify',
      ),
    ).toBe(true);
  });
});
