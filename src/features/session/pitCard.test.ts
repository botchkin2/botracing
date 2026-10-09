import {describe, expect, it} from '@jest/globals';

import type {Lap, PitStop} from '@/src/data/sessions';
import {toLaps} from '@/src/data/sessions/adapters';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {buildPitCard, type PitCardSession, sessionHasVe} from './pitCard';

const lap = (lapIndex: number, over: Partial<Lap> = {}): Lap => ({
  ...toLaps([{...fixture.laps[0], newTyres: false}])[0],
  id: `l${lapIndex}`,
  lapIndex,
  stint: 1,
  timeS: 90,
  partial: false,
  reasons: [],
  fuel: null,
  pitStop: null,
  pitOut: false,
  tyres: null,
  newTyres: false,
  ...over,
});

const fuel = (over: Partial<NonNullable<Lap['fuel']>> = {}) => ({
  startL: 45,
  endL: 40,
  usedL: 5,
  addedL: 0,
  veStartPct: 68,
  veEndPct: 60,
  veUsedPct: 8,
  veAddedPct: 0,
  lapsLeftFuel: 8,
  lapsLeftVe: 7.5,
  green: true,
  ...over,
});

const stop = (over: Partial<PitStop> = {}): PitStop => ({
  atEntry: {fuelL: 9.4, vePct: 4},
  added: {fuelL: 40.1, vePct: 62},
  inPitS: 51.2,
  lapsLeftAtEntry: {fuel: 2.6, ve: 1.1},
  visit: null,
  tyres: {
    changed: true,
    wheels: ['FL', 'FR', 'RL', 'RR'],
    entryPct: null,
    exitPct: null,
    coolDown: null,
    compound: null,
  },
  ...over,
});

const session = (over: Partial<PitCardSession> = {}): PitCardSession => ({
  carClass: 'GT3',
  stints: [
    {n: 1, medianVePct: 3.5},
    {n: 2, medianVePct: 3.5},
    {n: 3, medianVePct: 3.5},
  ] as PitCardSession['stints'],
  ...over,
});

// L1 from the grid (the service before the start), L2 to L5 flying, a stop
// entered on L6, L7 out lap, L8 flying with new tyres showing, L9 the last
// whole lap.
const oneStop = [
  lap(1, {
    fuel: fuel({startL: 30, addedL: 15, veStartPct: 45, veAddedPct: 23}),
    pitStop: stop({
      atEntry: {fuelL: 30, vePct: 45},
      added: {fuelL: 15, vePct: 23},
    }),
  }),
  lap(2, {fuel: fuel()}),
  lap(3, {fuel: fuel()}),
  lap(4, {fuel: fuel()}),
  lap(5, {fuel: fuel()}),
  lap(6, {fuel: fuel(), pitStop: stop(), pitIn: true}),
  lap(7, {pitOut: true, stint: 2, fuel: fuel()}),
  lap(8, {stint: 2, newTyres: true, fuel: fuel()}),
  lap(9, {
    stint: 2,
    fuel: fuel({endL: 3.7, veEndPct: 4, lapsLeftFuel: 1.5, lapsLeftVe: 1.1}),
  }),
];

describe('buildPitCard', () => {
  it('has no card outside a race, or without a whole lap to end on', () => {
    expect(buildPitCard('P', oneStop, session())).toBeNull();
    expect(buildPitCard('Q', oneStop, session())).toBeNull();
    expect(buildPitCard('R', [lap(1), lap(2)], session())).toBeNull();
  });

  describe('a stop', () => {
    const card = buildPitCard('R', oneStop, session());

    it('is one full-width column, and the service before the start is not a stop', () => {
      expect(card?.kind).toBe('stops');
      if (card?.kind !== 'stops') return;
      expect(card.layout).toBe('one');
      expect(card.columns).toHaveLength(1);
      expect(card.columns[0].title).toBe('Stop');
      expect(card.columns[0].after).toBe('after L6');
    });

    it('reads what was left, what was added, VE out, the lane and the tyres', () => {
      if (card?.kind !== 'stops') throw new Error('not a stops card');
      const c = card.columns[0];
      expect(c.inTank).toEqual({value: '9.4 L', note: '4 % VE · 1.1 laps'});
      expect(c.added).toEqual({value: '+40.1 L', note: '+62 % VE'});
      // 4 + 62 = 66 % out, at the next stint's 3.5 %/lap.
      expect(c.veOut).toEqual({
        value: '66 %',
        note: '18.9 laps',
        leftPct: 4,
        addedPct: 62,
      });
      expect(c.lane).toEqual({
        value: '51.2 s',
        note: 'refuel 11.8 s',
        laneS: 51.2,
        refuelS: 40.1 / 3.4,
      });
      expect(c.tyres).toBe('All four new');
    });

    it('says the same lap in the column and in what the plan half compares with', () => {
      if (card?.kind !== 'stops') throw new Error('not a stops card');
      expect(card.columns[0].after).toBe('after L6');
      expect(card.actual.stops.map(s => s.lapIndex)).toEqual([6]);
      expect(card.actual.end).toEqual({fuelL: 3.7, vePct: 4, lapsLeft: 1.1});
    });

    it('ends on the last whole lap, and the balance closes on the printed numbers', () => {
      if (card?.kind !== 'stops') throw new Error('not a stops card');
      expect(card.end).toEqual({
        title: 'End of L9',
        spare: '3.7 L / 4 % VE (1.1 laps)',
        // 9.4 + 40.1 - 3.7 = 45.8 L used after.
        last: '+40.1 L · used 45.8 L after · 3.7 L left',
      });
      expect(card.refuelScope).toBe(
        'refuel at 3.4 L/s · GT3, measured on 5 stops',
      );
      expect(card.hasVe).toBe(true);
      expect(card.key).toEqual([
        'VE out: what was left (bright) and what the stop added (dim), of a full load.',
        'Pit lane: the time in the lane, with the refuelling inside it (bright).',
      ]);
    });
  });

  it('a stop on the first lap is a stop when the lap ends in the lane, and the garage service is not', () => {
    const lap1Stop = [
      lap(1, {
        pitStop: stop({
          tyres: {
            changed: true,
            wheels: ['FL'],
            entryPct: null,
            exitPct: null,
            coolDown: null,
            compound: null,
          },
        }),
        pitIn: true,
        fuel: fuel(),
      }),
      lap(2, {pitOut: true, stint: 2, fuel: fuel()}),
      lap(3, {
        stint: 2,
        fuel: fuel({
          endL: 3.7,
          veEndPct: 4,
          lapsLeftFuel: 1.5,
          lapsLeftVe: 1.1,
        }),
      }),
    ];
    const card = buildPitCard('R', lap1Stop, session());
    if (card?.kind !== 'stops') throw new Error('not a stops card');
    expect(card.columns.map(c => [c.after, c.tyres])).toEqual([
      ['after L1', 'FL only'],
    ]);
    // The same stop on an out lap that does not end in the lane is the service before the start.
    const service = [
      {...lap1Stop[0], pitIn: false, pitOut: true},
      ...lap1Stop.slice(1),
    ];
    expect(buildPitCard('R', service, session())?.kind).toBe('fuel');
  });

  it('two stops are two columns, three or more scroll with fixed width columns', () => {
    const twoStops = [
      ...oneStop.slice(0, 8),
      lap(8, {stint: 2, fuel: fuel(), pitStop: stop(), pitIn: true}),
      lap(9, {stint: 3, pitOut: true, fuel: fuel()}),
      lap(10, {
        stint: 3,
        fuel: fuel({
          endL: 3.7,
          veEndPct: 4,
          lapsLeftFuel: 1.5,
          lapsLeftVe: 1.1,
        }),
      }),
    ];
    const two = buildPitCard('R', twoStops, session());
    if (two?.kind !== 'stops') throw new Error('not a stops card');
    expect(two.layout).toBe('two');
    expect(two.columns.map(c => c.title)).toEqual(['Stop 1', 'Stop 2']);
    expect(two.columns.map(c => c.after)).toEqual(['after L6', 'after L8']);
    const three = buildPitCard(
      'R',
      [
        ...twoStops.slice(0, 9),
        lap(10, {stint: 3, fuel: fuel(), pitStop: stop(), pitIn: true}),
        lap(11, {
          stint: 4,
          fuel: fuel({
            endL: 3.7,
            veEndPct: 4,
            lapsLeftFuel: 1.5,
            lapsLeftVe: 1.1,
          }),
        }),
      ],
      session(),
    );
    if (three?.kind !== 'stops') throw new Error('not a stops card');
    expect(three.layout).toBe('scroll');
    expect(three.columns).toHaveLength(3);
  });

  it('a drive-through says nothing was added and has no refuel time', () => {
    const laps = oneStop.map(l =>
      l.id === 'l6'
        ? {
            ...l,
            pitStop: stop({
              added: {fuelL: 0, vePct: 0},
              lapsLeftAtEntry: {fuel: 2.6, ve: 1.1},
              visit: null,
            }),
          }
        : l,
    );
    const card = buildPitCard('R', laps, session());
    if (card?.kind !== 'stops') throw new Error('not a stops card');
    expect(card.columns[0].added).toEqual({
      value: '+0.0 L',
      note: 'nothing added',
    });
    expect(card.columns[0].lane?.refuelS).toBeNull();
    expect(card.columns[0].lane?.note).toBeNull();
    expect(card.key[1]).toBe('Pit lane: the time in the lane.');
    expect(card.refuelScope).toBeNull();
  });

  it('a class the rate is not measured on has the lane time alone, never a guess', () => {
    const card = buildPitCard('R', oneStop, session({carClass: 'LMP2'}));
    if (card?.kind !== 'stops') throw new Error('not a stops card');
    expect(card.columns[0].lane).toEqual({
      value: '51.2 s',
      note: null,
      laneS: 51.2,
      refuelS: null,
    });
    expect(card.refuelScope).toBeNull();
  });

  it('names the compound of a full set against the start of the run, and only then', () => {
    const compound = (c: 'start' | 'other' | null) => {
      const t = {
        changed: true,
        wheels: ['FL', 'FR', 'RL', 'RR'] as ('FL' | 'FR' | 'RL' | 'RR')[],
        entryPct: null,
        exitPct: null,
        coolDown: null,
        compound: c,
      };
      const laps = oneStop.map(l =>
        l.id === 'l6' ? {...l, pitStop: stop({tyres: t})} : l,
      );
      const card = buildPitCard('R', laps, session());
      if (card?.kind !== 'stops') throw new Error('not a stops card');
      return card.columns[0].compound;
    };
    expect(compound('start')).toBe('Compound as at the start of the run');
    expect(compound('other')).toBe(
      'Compound different from the start of the run',
    );
    expect(compound(null)).toBeNull();
  });

  it('says which tyres changed in the card wording, and nothing before the wear step is seen', () => {
    const tyres = (t: NonNullable<PitStop['tyres']> | null) => {
      const laps = oneStop.map(l =>
        l.id === 'l6' ? {...l, pitStop: stop({tyres: t})} : l,
      );
      const card = buildPitCard('R', laps, session());
      if (card?.kind !== 'stops') throw new Error('not a stops card');
      return card.columns[0].tyres;
    };
    expect(
      tyres({
        changed: false,
        wheels: [],
        entryPct: null,
        exitPct: null,
        coolDown: null,
        compound: null,
      }),
    ).toBe('Not changed');
    expect(
      tyres({
        changed: true,
        wheels: ['FL', 'FR'],
        entryPct: null,
        exitPct: null,
        coolDown: null,
        compound: null,
      }),
    ).toBe('Fronts new');
    expect(
      tyres({
        changed: true,
        wheels: ['FR'],
        entryPct: null,
        exitPct: null,
        coolDown: null,
        compound: null,
      }),
    ).toBe('FR only');
    expect(tyres(null)).toBeNull();
  });

  describe('wear per wheel round the stop', () => {
    const wear = (
      FL: number | null,
      FR: number | null,
      RL: number | null,
      RR: number | null,
    ) => ({
      v: 1,
      wearPct: {FL, FR, RL, RR},
      pressureKpa: null,
      hotPressureKpa: null,
      rubberC: null,
      carcassC: null,
      treadC: null,
      changed: null,
    });
    const wheels = (
      before: Lap['tyres'],
      after: Lap['tyres'],
      tyres: PitStop['tyres'] = {
        changed: true,
        wheels: ['FR'],
        entryPct: null,
        exitPct: null,
        coolDown: null,
        compound: null,
      },
    ) => {
      const laps = oneStop.map(l =>
        l.id === 'l6'
          ? {...l, tyres: before, pitStop: stop({tyres})}
          : l.id === 'l7'
          ? {...l, tyres: after}
          : l,
      );
      const card = buildPitCard('R', laps, session());
      if (card?.kind !== 'stops') throw new Error('not a stops card');
      return card.columns[0].wheels;
    };

    it('without entry/exit readings (resynced before them): reads the pit-in lap as before and the lap after as after, and marks the changed wheel', () => {
      expect(
        wheels(wear(61.2, 55.4, 63, 58), wear(60.1, 98.9, 62.4, 57.2)),
      ).toEqual([
        {
          wheel: 'FL',
          changed: false,
          beforePct: 61.2,
          afterPct: 60.1,
          beforeLapIndex: null,
        },
        {
          wheel: 'FR',
          changed: true,
          beforePct: 55.4,
          afterPct: 98.9,
          beforeLapIndex: null,
        },
        {
          wheel: 'RL',
          changed: false,
          beforePct: 63,
          afterPct: 62.4,
          beforeLapIndex: null,
        },
        {
          wheel: 'RR',
          changed: false,
          beforePct: 58,
          afterPct: 57.2,
          beforeLapIndex: null,
        },
      ]);
    });

    it('leaves a dead sensor as a gap, never a zero', () => {
      const w = wheels(wear(61, 0, 63, 58), wear(60, null, 62, 57));
      expect(w?.[1]).toEqual({
        wheel: 'FR',
        changed: true,
        beforePct: null,
        afterPct: null,
        beforeLapIndex: null,
      });
    });

    describe('from the stop entry and exit readings', () => {
      const pw = (
        FL: number | null,
        FR: number | null,
        RL: number | null,
        RR: number | null,
      ) => ({FL, FR, RL, RR});
      const stopWith = (
        entryPct: ReturnType<typeof pw> | null,
        exitPct: ReturnType<typeof pw> | null,
      ) => ({
        changed: true,
        wheels: ['FR' as const],
        entryPct,
        exitPct,
        coolDown: null,
        compound: null,
      });

      it('reads them, whatever the pit-in lap shows (box before the line)', () => {
        // The pit-in lap already reads the new tyre (FR 99); the entry does not.
        const w = wheels(
          wear(61, 99, 63, 58),
          wear(60, 98, 62, 57),
          stopWith(pw(61, 55, 63, 58), pw(61, 100, 63, 58)),
        );
        expect(
          w?.map(x => [x.wheel, x.changed, x.beforePct, x.afterPct]),
        ).toEqual([
          ['FL', false, 61, 61],
          ['FR', true, 55, 100],
          ['RL', false, 63, 63],
          ['RR', false, 58, 58],
        ]);
      });

      it('uses the last valid reading from an earlier lap for a sensor dead at entry, and says which lap', () => {
        const laps = oneStop.map(l =>
          l.id === 'l5'
            ? {...l, tyres: wear(62, 56, 64, 59)}
            : l.id === 'l6'
            ? {
                ...l,
                tyres: wear(61, 0, 63, 58),
                pitStop: stop({
                  tyres: stopWith(pw(61, 0, 63, 58), pw(61, 100, 63, 58)),
                }),
              }
            : l,
        );
        const card = buildPitCard('R', laps, session());
        if (card?.kind !== 'stops') throw new Error('not a stops card');
        const fr = card.columns[0].wheels?.[1];
        expect(fr).toEqual({
          wheel: 'FR',
          changed: true,
          beforePct: 56,
          afterPct: 100,
          beforeLapIndex: 5,
        });
        expect(card.columns[0].wheels?.[0].beforeLapIndex).toBeNull();
      });

      it('leaves the after side a gap when the session ends in the pits', () => {
        const w = wheels(null, null, stopWith(pw(61, 55, 63, 58), null));
        expect(w?.map(x => x.afterPct)).toEqual([null, null, null, null]);
        expect(w?.map(x => x.beforePct)).toEqual([61, 55, 63, 58]);
      });
    });

    it('has no wheels for older sessions whose laps carry no tyres', () => {
      expect(wheels(null, null)).toBeNull();
    });

    it('keeps the side that has a reading when the other lap has none', () => {
      const w = wheels(wear(61, 55, 63, 58), null);
      expect(w?.map(x => [x.beforePct, x.afterPct])).toEqual([
        [61, null],
        [55, null],
        [63, null],
        [58, null],
      ]);
    });
  });

  it('a session ending in the pits has no lane time and no tyres yet', () => {
    const laps = [
      ...oneStop.slice(0, 5),
      lap(6, {
        fuel: fuel({endL: 3.7, veEndPct: 4}),
        pitStop: stop({inPitS: null, tyres: null}),
        pitIn: true,
      }),
    ];
    // No lap follows the stop, so the last whole lap is the pit-in lap itself.
    const card = buildPitCard('R', laps, session());
    if (card?.kind !== 'stops') throw new Error('not a stops card');
    expect(card.columns[0].lane).toBeNull();
    expect(card.columns[0].tyres).toBeNull();
  });

  describe('fuel only: a session with no Virtual Energy stored', () => {
    const noVe = (l: Lap): Lap => ({
      ...l,
      fuel: l.fuel
        ? {
            ...l.fuel,
            veStartPct: null,
            veEndPct: null,
            veUsedPct: null,
            veAddedPct: null,
            lapsLeftVe: null,
          }
        : null,
      pitStop: l.pitStop
        ? {
            ...l.pitStop,
            atEntry: {...l.pitStop.atEntry, vePct: null},
            added: {...l.pitStop.added, vePct: null},
            lapsLeftAtEntry: {...l.pitStop.lapsLeftAtEntry, ve: null},
            visit: null,
          }
        : null,
    });
    const laps = oneStop.map(noVe);

    it('is chosen from the stored channel, whatever the class', () => {
      expect(sessionHasVe(oneStop)).toBe(true);
      expect(sessionHasVe(laps)).toBe(false);
    });

    it('removes VE: no bar, no VE line, litres only, and the lane time still stands', () => {
      const card = buildPitCard('R', laps, session({carClass: 'LMP2'}));
      if (card?.kind !== 'stops') throw new Error('not a stops card');
      expect(card.hasVe).toBe(false);
      const c = card.columns[0];
      expect(c.veOut).toBeNull();
      expect(c.inTank).toEqual({value: '9.4 L', note: '2.6 laps'});
      expect(c.added).toEqual({value: '+40.1 L', note: null});
      expect(c.lane?.value).toBe('51.2 s');
      expect(card.key).toEqual(['Pit lane: the time in the lane.']);
      expect(card.end?.spare).toBe('3.7 L (1.5 laps)');
    });
  });

  describe('no stop: the Fuel card', () => {
    const noStop = [
      lap(1, {
        fuel: fuel({startL: 45, veStartPct: 68, usedL: 2.3, veUsedPct: 3.6}),
      }),
      lap(2, {fuel: fuel()}),
      lap(3, {
        fuel: fuel({
          endL: 3.7,
          veEndPct: 4,
          lapsLeftFuel: 1.5,
          lapsLeftVe: 1.1,
        }),
      }),
    ];

    it('says what was in the car, what was used and what was left on the last whole lap', () => {
      const card = buildPitCard('R', noStop, session());
      if (card?.kind !== 'fuel') throw new Error('not the fuel card');
      expect(card.start).toEqual({
        value: '45.0 L / 68 % VE',
        note: 'loaded before L1',
      });
      // 45.0 - 3.7 = 41.3 L; 68 - 4 = 64 % VE; over the 3 laps.
      expect(card.used).toEqual({
        value: '41.3 L / 64 % VE',
        note: 'over 3 laps',
      });
      expect(card.end.title).toBe('End of L3');
      expect(card.end.value).toBe('3.7 L / 4 % VE (1.1 laps)');
      expect(card.end.usedShare).toBeCloseTo(41.3 / 45, 5);
    });

    it('counts fuel put in before the start as loaded, and says so', () => {
      const laps = [
        lap(1, {
          fuel: fuel({startL: 30, addedL: 15, veStartPct: 45, veAddedPct: 23}),
        }),
        ...noStop.slice(1),
      ];
      const card = buildPitCard('R', laps, session());
      if (card?.kind !== 'fuel') throw new Error('not the fuel card');
      expect(card.start.note).toBe('+15.0 L added on L1');
      // 30 + 15 - 3.7 = 41.3 L.
      expect(card.used.value).toBe('41.3 L / 64 % VE');
    });
  });
});
