import {describe, expect, it} from '@jest/globals';

import type {PerWheel, TreadC} from '@/src/analysis/tyres';
import type {Lap, PitStop} from '@/src/data/sessions';
import {toLaps} from '@/src/data/sessions/adapters';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {
  buildTiresCard,
  MIN_TREND_LAPS,
  setAges,
  setAgeText,
  type StintTires,
  treadScale,
} from './tireCard';

const all = (v: number | null): PerWheel => ({FL: v, FR: v, RL: v, RR: v});

const lap = (
  lapIndex: number,
  wear: number | null,
  over: Partial<Lap> = {},
  tyres: Partial<NonNullable<Lap['tyres']>> = {},
): Lap => ({
  ...toLaps([{...fixture.laps[0], newTyres: false}])[0],
  id: `l${lapIndex}`,
  lapIndex,
  stint: 1,
  fuel: {green: true} as Lap['fuel'],
  tyres: {
    v: 2,
    wearPct: wear == null ? null : all(wear),
    pressureKpa: all(160),
    hotPressureKpa: all(165),
    rubberC: all(90),
    carcassC: null,
    treadC: null,
    changed: null,
    ...tyres,
  },
  ...over,
});

const stints = (laps: Lap[]) => {
  const card = buildTiresCard({stints: []}, laps);
  if (card.kind !== 'stints') throw new Error('no stints');
  return card.stints;
};
const one = (laps: Lap[]): StintTires => stints(laps)[0];

describe('buildTiresCard', () => {
  it('is absent when no lap carries tyre facts', () => {
    const laps = [lap(1, 99, {tyres: null}), lap(2, 98, {tyres: null})];
    expect(buildTiresCard({stints: []}, laps)).toEqual({kind: 'absent'});
  });

  it('a trend needs five green laps; fewer lists the readings', () => {
    const laps = (n: number) =>
      Array.from({length: n}, (_, i) => lap(i + 2, 99 - i));
    expect(one(laps(MIN_TREND_LAPS - 1)).kind).toBe('readings');
    expect(one(laps(MIN_TREND_LAPS)).kind).toBe('trend');
    const s = one(laps(2));
    expect(s.readings.map(r => r.label)).toEqual(['L2', 'L3']);
    expect(s.readings[1].wearPct.FL).toBe(98);
  });

  it('wear left is the last green lap; loss is the step from the lap before', () => {
    const s = one([
      lap(2, 99),
      lap(3, 98.4),
      lap(4, 97.6),
      lap(5, 97.0),
      lap(6, 96.2),
      lap(7, 95.6),
    ]);
    const fl = s.wheels[0];
    expect(fl.wheel).toBe('FL');
    expect(fl.leftPct).toBeCloseTo(95.6);
    expect(fl.bars.map(b => +b.lossPct.toFixed(2))).toEqual([
      0.6, 0.8, 0.6, 0.8, 0.6,
    ]);
    expect(fl.medianLossPct).toBeCloseTo(0.6);
    expect(s.sub).toBe('6 green laps');
    expect(s.setAge).toBe('All four on 6-lap sets at L7');
    expect(s.title).toBe('Stint 1 · L2–L7');
  });

  it('every lap is a bar, hollow when not green; the median is green laps only', () => {
    const s = one([
      lap(2, 99),
      lap(3, 98, {fuel: {green: false} as Lap['fuel']}),
      lap(4, 97),
    ]);
    const fl = s.wheels[0];
    expect(fl.bars).toEqual([
      {lapLabel: 'L3', lossPct: 1, green: false},
      {lapLabel: 'L4', lossPct: 1, green: true},
    ]);
    expect(fl.medianLossPct).toBe(1);
    expect(fl.leftPct).toBe(97);
    // A gap in the laps leaves no bar: nothing to subtract from.
    expect(one([lap(2, 99), lap(5, 95)]).wheels[0].bars).toEqual([]);
  });

  it('a single-lap loss over 3 times the median is called out with its lap', () => {
    const wear = [99, 98.4, 97.8, 91.1, 90.5, 89.9];
    const laps = wear.map((w, i) =>
      lap(i + 2, w, i === 3 ? {fuel: {green: false} as Lap['fuel']} : {}),
    );
    const fl = one(laps).wheels[0];
    expect(fl.medianLossPct).toBeCloseTo(0.6);
    expect(fl.biggest?.lapLabel).toBe('L5');
    expect(fl.biggest?.lossPct).toBeCloseTo(6.7);
    expect(fl.biggest?.green).toBe(false);
    const even = one(wear.map((_, i) => lap(i + 2, 99 - i * 0.6))).wheels[0];
    expect(even.biggest).toBeNull();
  });

  it('a wear step upward (a new tyre) is not a loss', () => {
    const s = one([lap(2, 60), lap(3, 100)]);
    expect(s.wheels[0].bars).toEqual([]);
  });

  it('axle means and the key median come from the stabilised hot pressure', () => {
    const s = one([
      lap(
        2,
        99,
        {},
        {
          pressureKpa: {FL: 150, FR: 152, RL: 140, RR: 144},
          hotPressureKpa: null,
        },
      ),
      lap(
        3,
        98,
        {},
        {
          pressureKpa: {FL: 160, FR: 162, RL: 150, RR: 154},
          hotPressureKpa: {FL: 164, FR: 166, RL: 154, RR: 158},
        },
      ),
    ]);
    expect(s.pressure.front).toEqual([151, 161]);
    expect(s.pressure.rear).toEqual([142, 152]);
    expect(s.pressure.medianFront).toBe(165);
    expect(s.pressure.medianRear).toBe(156);
    expect(s.wheels.map(w => w.hotKpa)).toEqual([164, 166, 154, 158]);
  });

  it('a wheel that stops reading pressure is outlined and left out', () => {
    const dead = (p: number | null): PerWheel => ({
      FL: 160,
      FR: p,
      RL: 150,
      RR: 150,
    });
    const s = one([
      lap(2, 99, {}, {pressureKpa: dead(160)}),
      lap(3, 98, {}, {pressureKpa: dead(160)}),
      lap(4, 97, {}, {pressureKpa: dead(null), hotPressureKpa: dead(null)}),
      lap(5, 96, {}, {pressureKpa: dead(null), hotPressureKpa: dead(null)}),
    ]);
    const fr = s.wheels[1];
    expect(fr.flat).toEqual({
      fromLap: 'L4',
      lastValidLap: 'L3',
      lastValidPct: 98,
    });
    // Wear after L3 is out of the wheel's own numbers; the other wheels go on.
    expect(fr.leftPct).toBe(98);
    expect(fr.bars.map(b => b.lossPct)).toEqual([1]);
    expect(s.wheels[0].flat).toBeNull();
    expect(s.wheels[0].leftPct).toBe(96);
    expect(s.pressure.front).toEqual([160, 160, 160, 160]);
    expect(s.flatNote).toMatch(/FR pressure reads nothing from L4/);
    expect(s.flatNote).toMatch(/cannot tell which/);
  });

  it('a wheel with no pressure channel at all is not flat', () => {
    const s = one([
      lap(2, 99, {}, {pressureKpa: {FL: 1, FR: null, RL: 1, RR: 1}}),
      lap(3, 98, {}, {pressureKpa: {FL: 1, FR: null, RL: 1, RR: 1}}),
    ]);
    expect(s.wheels[1].flat).toBeNull();
    expect(s.flatNote).toBeNull();
  });

  it('keeps stints apart and skips a stint with no tyre facts', () => {
    const laps = [
      lap(2, 99, {stint: 1}),
      lap(3, 98, {stint: 1}),
      lap(4, 99, {stint: 2, tyres: null}),
      lap(5, 99, {stint: 3}),
    ];
    expect(stints(laps).map(s => s.tab)).toEqual(['S1', 'S3']);
  });
});

describe('setAges', () => {
  const laps = (n: number) => Array.from({length: n}, (_, i) => lap(i + 1, 99));

  it('a stop that changes no wheel does not restart the set', () => {
    const l = laps(10);
    l[4] = lap(5, 99, {}, {changed: []});
    expect(setAges(l, 10)).toEqual({FL: 10, FR: 10, RL: 10, RR: 10});
  });

  it('a full set restarts every wheel on the next lap; one wheel only that wheel', () => {
    const l = laps(10);
    l[3] = lap(4, 99, {}, {changed: ['FL', 'FR', 'RL', 'RR']});
    l[6] = lap(7, 99, {}, {changed: ['FR']});
    expect(setAges(l, 10)).toEqual({FL: 6, FR: 3, RL: 6, RR: 6});
  });

  it('a reset to the garage restarts the set; the text names wheels that differ', () => {
    const l = laps(8);
    l[2] = lap(3, 99, {endedInReset: true});
    const ages = setAges(l, 8);
    expect(ages.FL).toBe(5);
    expect(setAgeText({...ages, FR: 2}, 8)).toBe(
      'Set age at L8: FL 5 laps · FR 2 laps · RL 5 laps · RR 5 laps',
    );
  });
});

describe('tread zones', () => {
  const tread = (inner: number, centre: number, outer: number): TreadC => ({
    inner,
    centre,
    outer,
  });
  const treads = (t: TreadC) => ({FL: t, FR: t, RL: t, RR: t});
  const run = (n: number, t: (i: number) => TreadC) =>
    Array.from({length: n}, (_, i) =>
      lap(i + 2, 99 - i, {}, {treadC: treads(t(i))}),
    );

  it('is null for a stint from before the tread was recorded', () => {
    const laps = Array.from({length: 6}, (_, i) => lap(i + 2, 99 - i));
    expect(one(laps).tread).toBeNull();
  });

  it('is the median over the green laps, inner minus outer', () => {
    const z = one(run(5, i => tread(50 + i, 52 + i, 48 + i))).tread!;
    expect(z.map(w => w.wheel)).toEqual(['FL', 'FR', 'RL', 'RR']);
    expect(z[0]).toEqual({
      wheel: 'FL',
      inner: 52,
      centre: 54,
      outer: 50,
      innerMinusOuter: 2,
    });
  });

  it('leaves a lap that is not green out of the median', () => {
    const laps = run(5, i => tread(50 + i, 50 + i, 50 + i));
    laps[4] = {...laps[4], fuel: {green: false} as Lap['fuel']};
    expect(one(laps).tread![0].inner).toBe(51.5);
  });

  it('has no I - O where a third has no reading', () => {
    const laps = run(5, () => ({inner: 50, centre: 52, outer: null}));
    const z = one(laps).tread![0];
    expect(z.outer).toBeNull();
    expect(z.innerMinusOuter).toBeNull();
  });

  it('drops a wheel from the lap its pressure sensor went dark', () => {
    const laps = run(6, i => tread(50 + i * 10, 50, 50));
    for (const i of [4, 5])
      laps[i] = {
        ...laps[i],
        tyres: {
          ...laps[i].tyres!,
          pressureKpa: {...all(160), FR: null},
        },
      };
    const z = one(laps).tread!;
    // FR is read for the first four laps only: 50, 60, 70, 80.
    expect(z[1].inner).toBe(65);
    expect(z[0].inner).toBe(75);
  });
});

describe('stop cool-down', () => {
  const wheelsOf = (v: number | null) => ({FL: v, FR: v, RL: v, RR: v});
  const stop = (
    over: Partial<NonNullable<PitStop['tyres']>> = {},
  ): PitStop => ({
    atEntry: {fuelL: 10, vePct: 10},
    added: {fuelL: 50, vePct: 50},
    inPitS: 40,
    lapsLeftAtEntry: {fuel: null, ve: null},
    visit: null,
    tyres: {
      changed: false,
      wheels: [],
      entryPct: null,
      exitPct: null,
      coolDown: {
        afterS: 45,
        rubberC: {FL: -5.7, FR: -4.1, RL: null, RR: -5.2},
        carcassC: wheelsOf(-6),
        pressureKpa: wheelsOf(-3.5),
      },
      compound: null,
      ...over,
    },
  });
  // Stint 1 is L2-L6 with the stop in L6; stint 2 is L7-L12.
  const race = (pitStop: PitStop | null) => [
    ...Array.from({length: 4}, (_, i) => lap(i + 2, 99 - i)),
    lap(6, 95, {pitStop, pitIn: true}),
    ...Array.from({length: 6}, (_, i) => lap(i + 7, 99 - i, {stint: 2})),
  ];
  const second = (laps: Lap[]) => stints(laps)[1].coolDown;

  it('reads the stop before the stint, for the wheels that kept their tyre', () => {
    const c = second(race(stop()));
    expect(c).toMatchObject({kind: 'readings', after: 'After L6', afterS: 45});
    // RL's rubber is null but its carcass and pressure read, so it stays.
    if (c.kind !== 'readings') throw new Error('absent');
    expect(c.wheels.map(w => w.wheel)).toEqual(['FL', 'FR', 'RL', 'RR']);
    expect(c.wheels[0].rubberC).toBe(-5.7);
    expect(c.wheels[2].rubberC).toBeNull();
  });

  it('says there is no stop before the first stint', () => {
    expect(stints(race(stop()))[0].coolDown).toEqual({
      kind: 'absent',
      why: 'No stop before this stint',
    });
  });

  it('says so when all four tyres were changed', () => {
    const c = second(
      race(
        stop({changed: true, wheels: ['FL', 'FR', 'RL', 'RR'], coolDown: null}),
      ),
    );
    expect(c).toMatchObject({kind: 'absent'});
    expect(c.kind === 'absent' && c.why).toMatch(/All four tyres changed/);
  });

  it('says so when the stop has no reading, or no wheel has one', () => {
    const none = second(race(stop({coolDown: null})));
    expect(none.kind === 'absent' && none.why).toMatch(
      /No cool-down reading after/,
    );
    const dead = second(
      race(
        stop({
          coolDown: {
            afterS: 45,
            rubberC: wheelsOf(null),
            carcassC: wheelsOf(null),
            pressureKpa: wheelsOf(null),
          },
        }),
      ),
    );
    expect(dead.kind === 'absent' && dead.why).toMatch(/kept tyres/);
  });
});

describe('treadScale', () => {
  const zone = (
    inner: number | null,
    centre: number | null,
    outer: number | null,
  ) => ({wheel: 'FL', inner, centre, outer, innerMinusOuter: null} as const);

  it('is 70 to 100 when every reading is on it', () => {
    expect(treadScale([zone(72, 80, 91), zone(70, 99, 85)])).toEqual({
      minC: 70,
      maxC: 100,
    });
  });

  it('takes its floor down for a cold stint, so no bar is blank', () => {
    // Daytona practice: 59 to 69 C. 59 -> 55, and 5 lower so 59 still draws.
    expect(treadScale([zone(59, 65, 64), zone(68, 68, 61)])).toEqual({
      minC: 50,
      maxC: 100,
    });
    expect(treadScale([zone(69, 80, 75)]).minC).toBe(60);
  });

  it('keeps the standard scale with no readings', () => {
    expect(treadScale([zone(null, null, null)]).minC).toBe(70);
    expect(treadScale([]).minC).toBe(70);
  });
});
