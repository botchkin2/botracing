import {describe, expect, it} from '@jest/globals';

import {
  classSessionOf,
  classTiming,
  type ClassSession,
  passesOf,
} from './classTiming';

// A class's laps as the uploader keeps them: the median, and a p10 and p90 two seconds apart.
const lapsOf = (medianS: number, laps: number) => ({
  medianS,
  p10S: medianS - 2,
  p90S: medianS + 2,
  laps,
});

const session = (
  kind: ClassSession['kind'],
  hyper: number | null,
  gt3: number | null,
  lmp2: number | null = null,
): ClassSession => ({
  kind,
  byClass: {
    ...(hyper != null && {hypercar: lapsOf(hyper, 90)}),
    ...(lmp2 != null && {lmp2: lapsOf(lmp2, 90)}),
    ...(gt3 != null && {gt3: lapsOf(gt3, 100)}),
  },
});

const mine = {
  key: 'gt3' as const,
  name: 'GT3',
  medianLapS: 110,
  greenLaps: 25,
  sessions: 3,
};

function ready(t: ReturnType<typeof classTiming>) {
  if (t.kind !== 'ready') throw new Error(`not ready: ${t.kind}`);
  return t;
}

describe('classTiming', () => {
  it('has no field when no session carries other cars', () => {
    expect(
      classTiming({sessions: [], mine, raceLaps: 60, stopsAfter: []}),
    ).toEqual({kind: 'no-field'});
  });

  it('has no laps when he has no green lap to set the gain against', () => {
    const t = classTiming({
      sessions: [session('race', 97, 110)],
      mine: {...mine, medianLapS: null},
      raceLaps: 60,
      stopsAfter: [],
    });
    expect(t).toEqual({kind: 'no-laps'});
  });

  it('pools the median of per-session medians and counts races and practices', () => {
    const t = ready(
      classTiming({
        sessions: [
          session('race', 96, 110),
          session('race', 98, 110),
          session('practice', 100, 110),
        ],
        mine,
        raceLaps: 60,
        stopsAfter: [],
      }),
    );
    const hyper = t.faster.find(c => c.key === 'hypercar')!;
    // The median of 96, 98 and 100 is 98: a gain of 12 s, 98 / 12 = 8.2 of his laps.
    expect(hyper.estimate?.lapText).toBe('1:38.000');
    expect(hyper.estimate?.gainText).toBe('12.0 s');
    expect(hyper.estimate?.everyText).toBe('~8 laps');
    expect(hyper.text).toBe(
      'From 2 races, 1 practice · n = 270 laps · under 3 races, so practice counts',
    );
  });

  it('pools races alone from 3 races, and the text names only what it pooled', () => {
    const t = ready(
      classTiming({
        sessions: [
          session('race', 96, 110),
          session('race', 98, 110),
          session('race', 100, 110),
          session('practice', 90, 110),
        ],
        mine,
        raceLaps: 60,
        stopsAfter: [],
      }),
    );
    const hyper = t.faster.find(c => c.key === 'hypercar')!;
    expect(hyper.estimate?.lapText).toBe('1:38.000');
    expect(hyper.text).toBe('From 3 races · n = 270 laps');
  });

  it('the first catch is a range from the p10 to the p90 lap, and assumes a level start', () => {
    const t = ready(
      classTiming({
        sessions: [
          session('race', 98, 110),
          session('race', 98, 110),
          session('race', 98, 110),
        ],
        mine,
        raceLaps: 60,
        stopsAfter: [],
      }),
    );
    const est = t.faster[0].estimate!;
    // p10 96 s: 96 / 14 = 6.9 laps; p90 100 s: 100 / 10 = 10 laps.
    expect(est.firstText).toBe('L8–L11');
    expect(est.firstNote).toBe('Assumes a level start.');
  });

  it('takes the first catch band from the median leader and tail gaps of the races that recorded them', () => {
    const withGap = (gap: {firstS: number; lastS: number} | null) => {
      const s = session('race', 98, 110);
      if (gap) s.byClass.hypercar!.gap = gap;
      return s;
    };
    const t = ready(
      classTiming({
        sessions: [
          withGap({firstS: 20, lastS: 10}),
          withGap({firstS: 24, lastS: 14}),
          withGap({firstS: 16, lastS: 6}),
          withGap(null),
        ],
        mine,
        raceLaps: 60,
        stopsAfter: [],
      }),
    );
    const est = t.faster[0].estimate!;
    // Leader 20 s, p10 96 s: 96 * 90 / (110 * 14) = 5.6 laps; tail 10 s, p90 100 s: 100 * 100 / (110 * 10) = 9.1.
    expect(est.firstText).toBe('L7–L10');
    expect(est.firstNote).toBe("Grid gap 10–20 s, from the races' starts.");
  });

  it('keeps a class seen in fewer than 3 sessions as an empty row with no lane', () => {
    const t = ready(
      classTiming({
        sessions: [session('race', 96, 110), session('race', 98, 110, 101)],
        mine,
        raceLaps: 60,
        stopsAfter: [],
      }),
    );
    const lmp2 = t.faster.find(c => c.key === 'lmp2')!;
    expect(lmp2.estimate).toBeNull();
    expect(lmp2.text).toBe(
      'No estimate. 1 session here had LMP2 cars; an estimate needs 3.',
    );
  });

  it('draws no class that is slower than he is, nor his own', () => {
    const t = ready(
      classTiming({
        sessions: [
          session('race', 96, 110),
          session('race', 96, 110),
          session('race', 96, 110),
        ],
        mine: {...mine, key: 'hypercar', medianLapS: 97},
        raceLaps: 60,
        stopsAfter: [],
      }),
    );
    expect(t.faster).toEqual([]);
    expect(t.noFaster).toBe(true);
  });

  it('puts his class last, with its median and his own, and computes no gain', () => {
    const t = ready(
      classTiming({
        sessions: [
          session('race', 96, 110),
          session('race', 98, 112),
          session('race', 97, 111),
        ],
        mine: {...mine, medianLapS: 109.5},
        raceLaps: 60,
        stopsAfter: [],
      }),
    );
    expect(t.yours).toEqual({
      name: 'GT3',
      classText: '1:51.000',
      classSrc: '3 sessions · n = 300 laps',
      youText: '1:49.500',
      youSrc: 'n = 25 green laps · 3 sessions',
    });
  });
});

describe('passesOf', () => {
  const lap = {medianS: 98, p10S: 96, p90S: 100};

  it('puts pass k at k times the catch, the band from the p10 and p90 laps, widening with k', () => {
    const p = passesOf(lap, 110, 60);
    expect(p[0].centre).toBeCloseTo(98 / 12, 5);
    expect(p[0].lo).toBeCloseTo(96 / 14, 5);
    expect(p[0].hi).toBeCloseTo(10, 5);
    expect(p[2].centre).toBeCloseTo(3 * (98 / 12), 5);
    expect(p[2].hi - p[2].lo).toBeCloseTo(3 * (p[0].hi - p[0].lo), 5);
  });

  it('starts at the catch with the grid gap, then goes on at one catch per pass', () => {
    const p = passesOf(lap, 110, 60, {firstS: 15, lastS: 15});
    // 98 * 95 / (110 * 12) = 7.05 laps, against 8.17 on a level start.
    expect(p[0].centre).toBeCloseTo(7.053, 3);
    expect(p[1].centre - p[0].centre).toBeCloseTo(98 / 12, 5);
    expect(passesOf(lap, 110, 60)[0].centre).toBeCloseTo(98 / 12, 5);
  });

  it('a gap longer than his lap puts the first catch at lap 0', () => {
    expect(passesOf(lap, 110, 60, {firstS: 200, lastS: 200})[0].centre).toBe(0);
  });

  it('runs the band from the leader (p10 lap) to the tail (p90 lap) and puts the centre between', () => {
    const [first] = passesOf(lap, 110, 60, {firstS: 20, lastS: 10});
    expect(first.lo).toBeCloseTo((96 * 90) / (110 * 14), 5);
    expect(first.hi).toBeCloseTo((100 * 100) / (110 * 10), 5);
    expect(first.centre).toBeCloseTo((98 * 95) / (110 * 12), 5);
  });

  it('stops when a band starts past the flag', () => {
    // The p10 catch is 6.86 laps: passes start at 6.9, 13.7, 20.6 and 27.4 laps, the fifth at 34.3.
    expect(passesOf(lap, 110, 30)).toHaveLength(4);
  });

  it('leaves the band open-ended when the p90 lap is not faster than his', () => {
    const p = passesOf({medianS: 108, p10S: 105, p90S: 111}, 110, 60);
    expect(p[0].hi).toBe(Infinity);
  });
});

describe('classSessionOf', () => {
  const stats = {cars: 8, laps: 120, medianS: 215.4, p10S: 213, p90S: 219};

  it('turns a stored race or practice field into the model input', () => {
    expect(
      classSessionOf({
        classLaps: {kind: 'race', classes: {gt3: stats}, startGapsS: null},
      }),
    ).toEqual({
      kind: 'race',
      byClass: {gt3: {medianS: 215.4, p10S: 213, p90S: 219, laps: 120}},
    });
    expect(
      classSessionOf({
        classLaps: {kind: 'practice', classes: {gt3: stats}, startGapsS: null},
      })?.kind,
    ).toBe('practice');
  });

  it('carries the grid gap of a class', () => {
    const s = classSessionOf({
      classLaps: {
        kind: 'race',
        classes: {gt3: stats},
        startGapsS: {gt3: {firstS: 14, lastS: 12.5}},
      },
    });
    expect(s?.byClass.gt3?.gap).toEqual({firstS: 14, lastS: 12.5});
  });

  it('leaves out qualifying, no field and a field with no class pace', () => {
    expect(
      classSessionOf({
        classLaps: {kind: 'qualify', classes: null, startGapsS: null},
      }),
    ).toBeNull();
    expect(classSessionOf({classLaps: null})).toBeNull();
    expect(
      classSessionOf({
        classLaps: {kind: 'race', classes: null, startGapsS: null},
      }),
    ).toBeNull();
  });
});
