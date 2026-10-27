import {describe, expect, it} from '@jest/globals';

import {toLaps} from '@/src/data/sessions/adapters';
import type {Lap, SessionDetail} from '@/src/data/sessions';

import fixture from './__fixtures__/roadAtlantaRace.json';
import {buildFuelUse} from './fuelUse';
import {stintFuelTable} from './stintFuelTable';

const base = toLaps([fixture.laps[0]])[0];

const session = (
  sessionType: 'P' | 'R',
): Pick<SessionDetail, 'sessionType' | 'fuel' | 'plan'> => ({
  sessionType,
  plan: null,
  fuel: {
    startL: 75,
    fillLimitL: 75,
    tankL: 75,
    litresPerVePct: 0.68,
    litresPerVePctStop: null,
    setupVePct: null,
    setupVePerLapPct: null,
  },
});

let n = 0;
/** A green lap of `stint` using `ve` % (and `ve * 0.68` L), starting at level `veStart`. */
const lap = (
  stint: number,
  ve: number,
  timeS: number,
  veStart: number,
  over: Partial<Lap> = {},
): Lap => {
  n++;
  return {
    ...base,
    id: `l${n}`,
    lapIndex: n,
    lapNo: n,
    stint,
    timeS,
    pitIn: false,
    pitOut: false,
    pitStop: null,
    reasons: [],
    coastS: null,
    traffic: null,
    fuel: {
      startL: veStart * 0.68,
      endL: (veStart - ve) * 0.68,
      usedL: ve * 0.68,
      addedL: 0,
      veStartPct: veStart,
      veEndPct: veStart - ve,
      veUsedPct: ve,
      veAddedPct: 0,
      lapsLeftFuel: null,
      lapsLeftVe: null,
      green: true,
    },
    ...over,
  };
};

/** Stint 1: 5 laps at 5.0 % and 120 s, ends in a stop with 20 % left. Stint 2: 5 laps at 4.5 % and 120.4 s, to the flag. */
const race = (): Lap[] => {
  const one = [100, 95, 90, 85, 80].map((s, i) =>
    lap(1, 5, 120, s, {
      coastS: 10,
      ...(i === 4
        ? {
            pitIn: true,
            pitStop: {
              atEntry: {fuelL: 13.6, vePct: 20},
              added: {fuelL: null, vePct: null},
              inPitS: 30,
              lapsLeftAtEntry: {fuel: null, ve: null},
              tyres: null,
              visit: null,
            },
          }
        : {}),
    }),
  );
  const two = [50, 45.5, 41, 36.5, 32].map(s =>
    lap(2, 4.5, 120.4, s, {coastS: 16.5}),
  );
  return [...one, ...two];
};

describe('stintFuelTable', () => {
  it('a race: a row per stint with the use a lap, coast and lap time against stint 1, and how each stint ended', () => {
    const fu = buildFuelUse(session('R'), race())!;
    const t = stintFuelTable(fu);
    expect(t.useHead).toBe('VE %/lap');
    expect(t.endHead).toBe('Stint end');
    expect(t.against).toBe('vs stint 1');
    expect(t.rows.map(r => r.stint)).toEqual([
      {value: 'Stint 1', note: '5 laps'},
      {value: 'Stint 2', note: '5 laps'},
    ]);
    expect(t.rows[0].use).toEqual({value: '5.00', note: null});
    expect(t.rows[1].use).toEqual({value: '4.50', note: '−0.50'});
    expect(t.rows[1].coast).toEqual({value: '16.5', note: '+6.5'});
    expect(t.rows[1].time).toEqual({value: '2:00.400', note: '+0.400'});
    expect(t.rows[0].end).toEqual({value: 'left 20.0 %', note: null});
    // The stint started on 50 % and ran 5 laps; the flag came at 27.5 %.
    expect(t.rows[1].end).toEqual({
      value: 'need 10.00',
      note: 'flag 27.5 %',
    });
  });

  it('a practice has stint rows only: no end column, no target', () => {
    const t = stintFuelTable(buildFuelUse(session('P'), race())!);
    expect(t.endHead).toBeNull();
    expect(t.rows.every(r => r.end === null)).toBe(true);
  });

  it('counts litres for laps without VE', () => {
    const laps = race().map(l => ({
      ...l,
      fuel: {...l.fuel!, veUsedPct: null, veStartPct: null, veEndPct: null},
    }));
    const t = stintFuelTable(buildFuelUse(session('P'), laps)!);
    expect(t.useHead).toBe('L/lap');
    expect(t.rows[0].use.value).toBe('3.40');
  });

  it('a stint under the floor shows dashes, and says how many laps it has', () => {
    const laps = [...race(), lap(3, 4.4, 119, 20)];
    const t = stintFuelTable(buildFuelUse(session('P'), laps)!);
    expect(t.rows[2].stint.note).toBe('1 lap · under 3');
    expect(t.rows[2].use.value).toBe('—');
    expect(t.rows[2].time.value).toBe('—');
  });

  it('writes no sentence anywhere in the table', () => {
    const t = stintFuelTable(buildFuelUse(session('R'), race())!);
    const cells = t.rows.flatMap(r => [r.stint, r.end, r.use, r.coast, r.time]);
    for (const c of cells)
      for (const text of [c?.value, c?.note])
        if (text) expect(text.split(' ').length).toBeLessThanOrEqual(4);
  });
});
