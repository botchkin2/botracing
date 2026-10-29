import {describe, expect, it} from '@jest/globals';

import qualifying from './__fixtures__/classPaceQ.json';
import race from './__fixtures__/classPaceR.json';
import {median} from './setStats';
import {
  CLASS_PACE_VERSION,
  type ClassPaceDoc,
  classPaceCurrent,
  classPaceDoc,
  medianVsClass,
  MIN_PACE_LAPS,
  type ResultsDriver,
  type ResultsLap,
  TOP_CARS,
  hasOtherDrivers,
  sectorGapS,
  topVsYou,
} from './classPace';

// classPaceQ.json and classPaceR.json are the results input v2's `drivers`, made
// from two of his real files (Sebring 2026-10-21: qualifying 19_39_09-06Q1, race
// 20_45_08-82R1) with the names and numbers left out and the field cut to the
// player and a few cars of each class.
const driversOf = (f: {drivers: unknown}) => f.drivers as ResultsDriver[];

const lap = (
  t: number | null,
  s: [number, number, number] | null = null,
): ResultsLap => ({
  t,
  s1: s ? s[0] : null,
  s2: s ? s[1] : null,
  s3: s ? s[2] : null,
  pit: false,
});

const driver = (
  over: Partial<ResultsDriver> & {times: (number | null)[]},
): ResultsDriver => ({
  player: false,
  cls: 'GT3',
  car: 'Car',
  pos: null,
  laps: over.times.map(t =>
    lap(t, t === null ? null : [t * 0.4, t * 0.3, t * 0.3]),
  ),
  ...over,
});

describe('classPaceDoc', () => {
  it('is null without drivers (no results file, or a v1 input)', () => {
    expect(classPaceDoc(null)).toBeNull();
    expect(classPaceDoc(undefined)).toBeNull();
    expect(classPaceDoc([])).toBeNull();
  });

  it('carries a basis only when it is given, so a race result doc has no such key', () => {
    const d: ResultsDriver = {
      player: true,
      cls: 'GT3',
      car: 'Car',
      pos: 1,
      laps: [lap(100)],
    };
    expect('basis' in classPaceDoc([d])!).toBe(false);
    expect(classPaceDoc([d], 'qualifying')!.basis).toBe('qualifying');
  });

  it('counts a timed lap only: an untimed lap, with or without sectors, is out of the best, the median and the sectors', () => {
    const d: ResultsDriver = {
      player: true,
      cls: 'GT3',
      car: 'Car',
      pos: 1,
      laps: [
        lap(null),
        // the file gives S1 and S2 of a lap the game deleted: they are not a valid lap's
        {t: null, s1: 1, s2: 1, s3: null, pit: false},
        lap(100, [40, 30, 30]),
        lap(102, [41, 30, 31]),
        lap(101, [40.5, 30.5, 30]),
      ],
    };
    const [p] = classPaceDoc([d])!.drivers;
    expect(p.laps).toBe(3);
    expect(p.best).toBe(100);
    expect(p.median).toBe(101);
    expect(p.sectors[0]).toEqual({best: 40, median: 40.5});
    expect(p.sectors[2].best).toBe(30);
  });

  it(`a driver under ${MIN_PACE_LAPS} valid laps has a best and no median, in every sector too`, () => {
    const doc = classPaceDoc([driver({times: [100, 101]})])!;
    expect(doc.drivers[0].best).toBe(100);
    expect(doc.drivers[0].median).toBeNull();
    expect(doc.drivers[0].sectors[1].best).not.toBeNull();
    expect(doc.drivers[0].sectors[1].median).toBeNull();
  });

  it('a driver with no timed lap is left out', () => {
    const doc = classPaceDoc([
      driver({times: [null, null]}),
      driver({times: [100, 101, 102]}),
    ])!;
    expect(doc.drivers).toHaveLength(1);
  });

  it('lists a class at a time, in the order the file gives them, fastest first inside each', () => {
    const doc = classPaceDoc([
      driver({cls: 'GT3', times: [110, 111, 112]}),
      driver({cls: 'LMP2', times: [100, 101, 102]}),
      driver({cls: 'GT3', times: [108, 109, 110]}),
    ])!;
    expect(doc.drivers.map(d => [d.cls, d.best])).toEqual([
      ['GT3', 108],
      ['GT3', 110],
      ['LMP2', 100],
    ]);
  });

  it('carries no name and no car number: only the class, the car, the place and numbers', () => {
    const doc = classPaceDoc(driversOf(qualifying))!;
    for (const d of doc.drivers)
      expect(Object.keys(d).sort()).toEqual([
        'best',
        'car',
        'cls',
        'laps',
        'median',
        'pos',
        'sectors',
        'you',
      ]);
  });

  it('reads his real qualifying: the best the game printed, the lap the game deleted not counted', () => {
    const doc = classPaceDoc(driversOf(qualifying))!;
    const you = doc.drivers.find(d => d.you)!;
    // 6 laps in the file, the first untimed (the out lap); his best is the XML's BestLapTime 122.3207
    expect(you.laps).toBe(4);
    expect(you.best).toBeCloseTo(122.3207, 4);
    expect(you.cls).toBe('GT3');
    expect(you.car).toBe('Porsche 911 GT3 R LMGT3');
    expect(you.sectors[0].best).toBeCloseTo(45.9079, 4);
  });

  it('reads his real race: each driver has the median of the timed laps, in the file order of the class', () => {
    const doc = classPaceDoc(driversOf(race))!;
    expect(doc.v).toBe(CLASS_PACE_VERSION);
    expect([...new Set(doc.drivers.map(d => d.cls))]).toEqual([
      'GT3',
      'LMP2_ELMS',
    ]);
    for (const d of doc.drivers) {
      expect(d.median).not.toBeNull();
      expect(d.median as number).toBeGreaterThanOrEqual(d.best as number);
    }
    // a lap the game deleted is not in the count: the BMW has 29 laps and 28 timed
    expect(doc.drivers.find(d => d.car.startsWith('BMW'))!.laps).toBe(28);
  });
});

const docOf = (
  rows: (Partial<ResultsDriver> & {times?: (number | null)[]})[],
): ClassPaceDoc =>
  classPaceDoc(
    rows.map((r, i) =>
      driver({
        times: [100 + i, 101 + i, 102 + i, 103 + i],
        ...r,
      }),
    ),
  )!;

describe('topVsYou', () => {
  it('is the class top cars by best lap, him left out: his median sector minus theirs, + where he is slower', () => {
    // him: sectors 40 / 30 / 30 (times 100..103 => 0.4, 0.3, 0.3 of each); the others are faster by 1, 2, 3 s laps
    const doc = docOf([
      {player: true, times: [100, 100, 100, 100]},
      {times: [99, 99, 99, 99]},
      {times: [98, 98, 98, 98]},
      {times: [97, 97, 97, 97]},
    ]);
    const top = topVsYou(doc)!;
    expect(top.cars).toBe(3);
    expect(top.cls).toBe('GT3');
    // theirs: 98 -> 39.2 / 29.4 / 29.4, he: 100 -> 40 / 30 / 30; the median of 99, 98, 97 is 98
    expect(top.sectorsS[0]).toBeCloseTo(40 - 39.2, 6);
    expect(top.sectorsS[1]).toBeCloseTo(30 - 29.4, 6);
    expect(top.sectorsS[2]).toBeCloseTo(30 - 29.4, 6);
  });

  it(`takes ${TOP_CARS} cars at most, the fastest ones, and never a car of another class`, () => {
    const faster = Array.from({length: 7}, (_, i) => ({
      times: [90 + i, 90 + i, 90 + i, 90 + i],
    }));
    const doc = docOf([
      {player: true, times: [100, 100, 100, 100]},
      ...faster,
      {cls: 'LMP2', times: [80, 80, 80, 80]},
    ]);
    const top = topVsYou(doc)!;
    expect(top.cars).toBe(TOP_CARS);
    // the five fastest GT3 are 90..94, median 92; the LMP2 at 80 is not one of them
    expect(top.sectorsS[0]).toBeCloseTo(100 * 0.4 - 92 * 0.4, 6);
  });

  it('a sector with no median on his side or theirs is null, the others stay', () => {
    const noS3 = (t: number): ResultsLap =>
      lap(t, [t * 0.4, t * 0.6, 0] as [number, number, number]);
    const doc = classPaceDoc([
      {
        player: true,
        cls: 'GT3',
        car: 'Car',
        pos: 1,
        laps: [100, 100, 100].map(t => ({...noS3(t), s3: null})),
      },
      driver({times: [99, 99, 99]}),
    ])!;
    const top = topVsYou(doc)!;
    expect(top.sectorsS[2]).toBeNull();
    expect(top.sectorsS[0]).not.toBeNull();
  });

  it('is null without him in the doc, or with nobody else in his class', () => {
    expect(topVsYou(null)).toBeNull();
    expect(topVsYou(docOf([{times: [100, 100, 100]}]))).toBeNull();
    expect(
      topVsYou(docOf([{player: true}, {cls: 'LMP2', times: [90, 90, 90]}])),
    ).toBeNull();
  });

  it('works on his real qualifying: the top GT3 cars are faster than him in the sector the file gives', () => {
    const top = topVsYou(classPaceDoc(driversOf(qualifying)))!;
    expect(top.cls).toBe('GT3');
    expect(top.cars).toBeGreaterThan(0);
    expect(top.sectorsS.every(s => s === null || Number.isFinite(s))).toBe(
      true,
    );
  });
});

describe('medianVsClass', () => {
  it("his median against the median of the other drivers' medians in his class", () => {
    const doc = docOf([
      {player: true, times: [100, 100, 100, 100]},
      {times: [98, 98, 98, 98]},
      {times: [99, 99, 99, 99]},
      {times: [104, 104, 104, 104]},
      {cls: 'LMP2', times: [80, 80, 80, 80]},
    ]);
    expect(medianVsClass(doc)).toEqual({
      cls: 'GT3',
      youS: 100,
      classS: 99,
      deltaS: 1,
      cars: 3,
    });
  });

  it('is null when he has no median, or nobody else of his class has one', () => {
    expect(medianVsClass(null)).toBeNull();
    expect(
      medianVsClass(
        docOf([{player: true, times: [100, 101]}, {times: [99, 99, 99]}]),
      ),
    ).toBeNull();
    expect(
      medianVsClass(docOf([{player: true}, {times: [99, 100]}])),
    ).toBeNull();
  });

  it('works on his real race', () => {
    const m = medianVsClass(classPaceDoc(driversOf(race)))!;
    expect(m.cls).toBe('GT3');
    expect(m.cars).toBe(3);
    expect(Math.abs(m.youS - m.classS)).toBeLessThan(5);
  });
});

describe('classPaceCurrent', () => {
  it('is true for the version these rules write, false for another or none', () => {
    expect(classPaceCurrent({v: CLASS_PACE_VERSION})).toBe(true);
    expect(classPaceCurrent({v: CLASS_PACE_VERSION + 1})).toBe(false);
    expect(classPaceCurrent(null)).toBe(false);
  });
});

describe('sectorGapS: the one place the sign is written', () => {
  const doc = classPaceDoc([
    driver({player: true, times: [100, 100, 100]}),
    driver({times: [98, 98, 98]}),
    driver({times: [102, 102, 102]}),
    driver({times: [100, 101]}),
  ])!;
  const [you, fast, slow, few] = [
    doc.drivers.find(d => d.you)!,
    doc.drivers.find(d => d.best === 98)!,
    doc.drivers.find(d => d.best === 102)!,
    doc.drivers.find(d => d.laps === 2)!,
  ];

  it('is his median minus theirs: + where he is slower than the driver, − where faster', () => {
    expect(sectorGapS(you, fast, 0)).toBeCloseTo(100 * 0.4 - 98 * 0.4, 6);
    expect(sectorGapS(you, slow, 2)).toBeCloseTo(100 * 0.3 - 102 * 0.3, 6);
    expect(sectorGapS(you, fast, 0)!).toBeGreaterThan(0);
    expect(sectorGapS(you, slow, 0)!).toBeLessThan(0);
  });

  it('is null where either side has no median (under 3 valid laps)', () => {
    expect(sectorGapS(you, few, 1)).toBeNull();
    expect(sectorGapS(few, you, 1)).toBeNull();
  });

  it('is what the top line is made of: its sector is the median of these over the top cars', () => {
    const top = topVsYou(doc)!;
    expect(top.cars).toBe(3);
    // the cars with a median: 98 and 102 (the 2-lap car has none), so the median of +0.8 and -0.8
    expect(top.sectorsS[0]).toBeCloseTo(
      median([sectorGapS(you, fast, 0), sectorGapS(you, slow, 0)])!,
      9,
    );
  });
});

describe('hasOtherDrivers', () => {
  it('is true when the doc lists a driver other than him, false with only him or no doc', () => {
    expect(hasOtherDrivers(null)).toBe(false);
    expect(
      hasOtherDrivers(
        classPaceDoc([driver({player: true, times: [100, 101, 102]})]),
      ),
    ).toBe(false);
    expect(
      hasOtherDrivers(
        classPaceDoc([
          driver({player: true, times: [100, 101, 102]}),
          driver({times: [99, 100, 101]}),
        ]),
      ),
    ).toBe(true);
    expect(hasOtherDrivers(classPaceDoc(driversOf(race)))).toBe(true);
  });
});
