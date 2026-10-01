import {describe, expect, it} from '@jest/globals';

import {
  classSessionOf,
  classTiming,
  type ClassSession,
  passesOf,
} from './classTiming';

const session = (
  kind: ClassSession['kind'],
  hyper: number | null,
  gt3: number | null,
  lmp2: number | null = null,
): ClassSession => ({
  kind,
  byClass: {
    ...(hyper != null && {hypercar: {medianS: hyper, laps: 90}}),
    ...(lmp2 != null && {lmp2: {medianS: lmp2, laps: 90}}),
    ...(gt3 != null && {gt3: {medianS: gt3, laps: 100}}),
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
    // The median of 96, 98 and 100 is 98: a gain of 12 s. They gain a lap on him
    // after 98 / 12 = 8.2 of his laps (not 110 / 12 = 9.2, which is their count).
    expect(hyper.estimate?.lapText).toBe('1:38.000');
    expect(hyper.estimate?.gainText).toBe('12.0 s');
    expect(hyper.estimate?.everyText).toBe('~8 laps');
    expect(hyper.text).toBe('From 2 races, 1 practice · n = 270 laps');
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
  it('widens each band by half a lap and stops past the flag', () => {
    const p = passesOf(9.2, 30);
    expect(p[0].centre).toBeCloseTo(9.2, 5);
    expect(p[0].hi - p[0].lo).toBeCloseTo(3, 5);
    expect(p[1].hi - p[1].lo).toBeCloseTo(4, 5);
    // The fourth pass, at 36.8 with a half band of 3, starts at 33.8: past a 30 lap race.
    expect(p).toHaveLength(3);
  });
});

describe('classSessionOf', () => {
  const stats = {cars: 8, laps: 120, medianS: 215.4, p10S: 213, p90S: 219};

  it('turns a stored race or practice field into the model input', () => {
    expect(
      classSessionOf({classLaps: {kind: 'race', classes: {gt3: stats}}}),
    ).toEqual({kind: 'race', byClass: {gt3: {medianS: 215.4, laps: 120}}});
    expect(
      classSessionOf({classLaps: {kind: 'practice', classes: {gt3: stats}}})
        ?.kind,
    ).toBe('practice');
  });

  it('leaves out qualifying, no field and a field with no class pace', () => {
    expect(
      classSessionOf({classLaps: {kind: 'qualify', classes: null}}),
    ).toBeNull();
    expect(classSessionOf({classLaps: null})).toBeNull();
    expect(
      classSessionOf({classLaps: {kind: 'race', classes: null}}),
    ).toBeNull();
  });
});
