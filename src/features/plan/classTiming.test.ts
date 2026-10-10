import {describe, expect, it} from '@jest/globals';

import {type SessionClassLaps} from '@/src/data/sessions';

import {
  classSessionOf,
  classTiming,
  noPassText,
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
  player: 'gt3',
  byClass: {
    ...(hyper != null && {hypercar: lapsOf(hyper, 90)}),
    ...(lmp2 != null && {lmp2: lapsOf(lmp2, 90)}),
    ...(gt3 != null && {gt3: lapsOf(gt3, 100)}),
  },
});

const mine = {
  key: 'gt3' as const,
  medianLapS: 110,
  laps: 25,
  sessions: 3,
};

function ready(t: ReturnType<typeof classTiming>) {
  if (t.kind !== 'ready') throw new Error(`not ready: ${t.kind}`);
  return t;
}

function row(t: ReturnType<typeof ready>, key: string) {
  const r = t.rows.find(x => x.key === key);
  if (!r) throw new Error(`no row ${key}`);
  return r;
}

describe('classTiming', () => {
  it('has no field when no session carries other cars', () => {
    expect(
      classTiming({sessions: [], mine, raceLaps: 60, stopsAfter: []}),
    ).toEqual({kind: 'no-field'});
  });

  it('shows every class fastest first, his marked, lap times to a tenth', () => {
    const t = ready(
      classTiming({
        sessions: [session('race', 97.04, 110.26, 103.5)],
        mine,
        raceLaps: 60,
        stopsAfter: [],
      }),
    );
    expect(t.rows.map(r => [r.label, r.lapText, r.mine])).toEqual([
      ['Hypercar', '1:37.0', false],
      ['LMP2', '1:43.5', false],
      ['GT3', '1:50.3', true],
    ]);
  });

  it('without his laps (a car not driven here) still shows the classes, with no vs you', () => {
    const t = ready(
      classTiming({
        sessions: [session('race', 97, 110)],
        mine: {key: null, medianLapS: null, laps: 0, sessions: 0},
        raceLaps: null,
        stopsAfter: [],
      }),
    );
    expect(t.rows.map(r => r.lapText)).toEqual(['1:37.0', '1:50.0']);
    expect(
      t.rows.every(
        r => r.vsText === '—' && r.firstText === '—' && r.passes.length === 0,
      ),
    ).toBe(true);
    expect(t.you).toBeNull();
  });

  it('pools the median of per-session medians, races only when the class raced', () => {
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
    const hyper = row(t, 'hypercar');
    // The median of 96, 98 and 100 is 98: 12 s a lap faster, 98 / 12 = 8.2 of his laps.
    expect(hyper.lapText).toBe('1:38.0');
    expect(hyper.vsText).toBe('−12.0');
    expect(hyper.everyText).toBe('~8 laps');
    expect(hyper.srcText).toBe('3 races · 270 laps');
  });

  it('one race leaves practice out; practice counts only when no race saw the class', () => {
    const t = ready(
      classTiming({
        sessions: [
          session('race', 98, 110),
          session('practice', 90, 110, 101),
          session('practice', 92, 110, 103),
        ],
        mine,
        raceLaps: 60,
        stopsAfter: [],
      }),
    );
    expect(row(t, 'hypercar').lapText).toBe('1:38.0');
    expect(row(t, 'hypercar').srcText).toBe('1 race · 90 laps');
    expect(row(t, 'lmp2').lapText).toBe('1:42.0');
    expect(row(t, 'lmp2').srcText).toBe('2 practices · 180 laps');
  });

  it('the first catch is a range from the p10 to the p90 lap on a level start', () => {
    const t = ready(
      classTiming({
        sessions: [session('race', 98, 110)],
        mine,
        raceLaps: 60,
        stopsAfter: [],
      }),
    );
    // p10 96 s: 96 / 14 = 6.9 laps; p90 100 s: 100 / 10 = 10 laps.
    expect(row(t, 'hypercar').firstText).toBe('L8–L11');
    expect(row(t, 'hypercar').passes.length).toBeGreaterThan(0);
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
    // Leader 20 s, p10 96 s: 96 * 90 / (110 * 14) = 5.6 laps; tail 10 s, p90 100 s: 100 * 100 / (110 * 10) = 9.1.
    expect(row(t, 'hypercar').firstText).toBe('L7–L10');
    expect(row(t, 'hypercar').srcText).toBe(
      '4 races · 360 laps · grid gap 10–20 s',
    );
  });

  it('a slower class reads plus, a faster one minus; no catch for the slower; his own class gets neither', () => {
    const t = ready(
      classTiming({
        sessions: [session('race', 96, 110)],
        mine: {...mine, key: 'hypercar', medianLapS: 97},
        raceLaps: 60,
        stopsAfter: [],
      }),
    );
    expect(row(t, 'hypercar')).toMatchObject({
      mine: true,
      vsText: '—',
      firstText: '—',
    });
    expect(row(t, 'gt3')).toMatchObject({
      mine: false,
      vsText: '+13.0',
      firstText: '—',
      everyText: '—',
      passes: [],
    });
  });

  it('takes grid gaps only from races he drove in his own class', () => {
    const race = (
      player: 'gt3' | 'hypercar',
      gap: {firstS: number; lastS: number},
    ) => {
      const s = session('race', 98, 110, 101);
      s.player = player;
      s.byClass.lmp2!.gap = gap;
      return s;
    };
    const t = ready(
      classTiming({
        sessions: [
          race('gt3', {firstS: 20, lastS: 10}),
          // Measured from a Hypercar start, where LMP2 started behind him.
          race('hypercar', {firstS: -30, lastS: -40}),
        ],
        mine,
        raceLaps: 60,
        stopsAfter: [],
      }),
    );
    expect(row(t, 'lmp2').srcText).toBe(
      '2 races · 180 laps · grid gap 10–20 s',
    );
  });

  it('signs a grid gap whose tail started behind him with a minus', () => {
    const s = session('race', 98, 110);
    s.byClass.hypercar!.gap = {firstS: 22, lastS: -16.4};
    const t = ready(
      classTiming({sessions: [s], mine, raceLaps: 60, stopsAfter: []}),
    );
    expect(row(t, 'hypercar').srcText).toBe(
      '1 race · 90 laps · grid gap −16–22 s',
    );
  });

  it('a first catch band inside one lap names that lap once', () => {
    const s = session('race', null, 110);
    // p10 98 s: 98 / 12 = 8.2 laps; p90 98.5 s: 98.5 / 11.5 = 8.6 laps.
    s.byClass.hypercar = {medianS: 98.2, p10S: 98, p90S: 98.5, laps: 50};
    const t = ready(
      classTiming({sessions: [s], mine, raceLaps: 60, stopsAfter: []}),
    );
    expect(row(t, 'hypercar').firstText).not.toContain('–');
  });

  it('gives his own median with the laps it rests on', () => {
    const t = ready(
      classTiming({
        sessions: [session('race', 96, 111)],
        mine: {...mine, medianLapS: 109.5},
        raceLaps: 60,
        stopsAfter: [3],
      }),
    );
    expect(t.you).toEqual({
      lapText: '1:49.500',
      srcText: '25 laps · 3 sessions',
    });
    expect(t.stopsAfter).toEqual([3]);
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
  const doc = (over: Partial<SessionClassLaps>): SessionClassLaps => ({
    version: 6,
    kind: 'race',
    classes: {gt3: stats},
    startGapsS: null,
    player: 'gt3',
    ...over,
  });

  it('turns a stored race or practice field into the model input', () => {
    expect(
      classSessionOf({sim: 'lmu', carClass: 'GT3', classLaps: doc({})}),
    ).toEqual({
      kind: 'race',
      player: 'gt3',
      byClass: {gt3: {medianS: 215.4, p10S: 213, p90S: 219, laps: 120}},
    });
    expect(
      classSessionOf({
        sim: 'lmu',
        carClass: 'GT3',
        classLaps: doc({kind: 'practice'}),
      })?.kind,
    ).toBe('practice');
  });

  it('carries the grid gap of a class', () => {
    const s = classSessionOf({
      sim: 'lmu',
      carClass: 'GT3',
      classLaps: doc({startGapsS: {gt3: {firstS: 14, lastS: 12.5}}}),
    });
    expect(s?.byClass.gt3?.gap).toEqual({firstS: 14, lastS: 12.5});
  });

  it('leaves out qualifying, no field and a field with no class pace', () => {
    expect(
      classSessionOf({
        sim: 'lmu',
        carClass: 'GT3',
        classLaps: doc({kind: 'qualify'}),
      }),
    ).toBeNull();
    expect(
      classSessionOf({sim: 'lmu', carClass: 'GT3', classLaps: null}),
    ).toBeNull();
    expect(
      classSessionOf({
        sim: 'lmu',
        carClass: 'GT3',
        classLaps: doc({classes: null}),
      }),
    ).toBeNull();
  });

  it('keeps an LMU doc from before version 6, not an iRacing one (its classes were wrong)', () => {
    const v5 = doc({version: 5, player: null});
    expect(
      classSessionOf({sim: 'lmu', carClass: 'GT3', classLaps: v5}),
    ).not.toBeNull();
    expect(
      classSessionOf({sim: 'iracing', carClass: 'IMSA23', classLaps: v5}),
    ).toBeNull();
    expect(
      classSessionOf({sim: 'iracing', carClass: 'IMSA23', classLaps: doc({})}),
    ).not.toBeNull();
  });
});

describe('noPassText', () => {
  it('says how long the race is and where the first pass would fall', () => {
    expect(noPassText(5, 'L13–L16')).toBe(
      'No pass in 5 laps (first at L13–L16)',
    );
  });
});
