import {describe, expect, it} from '@jest/globals';

import {
  FUEL_BAND_L,
  type RefLap,
  rankReferenceLaps,
  VE_BAND_PCT,
} from './referenceLap';

const lap = (id: string, over: Partial<RefLap> = {}): RefLap => ({
  id,
  sessionId: 's1',
  car: '911 GT3 R',
  sessionType: 'R',
  timeS: 100,
  comparable: true,
  partial: false,
  pitIn: false,
  pitOut: false,
  endedInReset: false,
  hadImpact: false,
  offTrackS: 0,
  newTyres: false,
  startL: 60,
  veStartPct: null,
  ...over,
});

const target = lap('t', {timeS: 101, startL: 60});
const ids = (candidates: RefLap[]) =>
  rankReferenceLaps(target, candidates).map(r => r.lapId);

describe('rankReferenceLaps', () => {
  it('leaves out the lap itself and laps that cannot be a ruler', () => {
    const out = ids([
      lap('t'),
      lap('untimed', {timeS: null}),
      lap('slow', {comparable: false}),
      lap('part', {partial: true}),
      lap('in', {pitIn: true}),
      lap('out', {pitOut: true}),
      lap('reset', {endedInReset: true}),
      lap('hit', {hadImpact: true}),
      lap('ok'),
    ]);
    expect(out).toEqual(['ok']);
  });

  it('with nothing else to tell them apart, the fastest first', () => {
    expect(ids([lap('a', {timeS: 100.4}), lap('b', {timeS: 99.8})])).toEqual([
      'b',
      'a',
    ]);
  });

  it('a low-fuel best lap loses to a lap at the same load', () => {
    const light = lap('light', {timeS: 98.9, startL: 20});
    const same = lap('same', {timeS: 100.2, startL: 62});
    expect(ids([light, same])).toEqual(['same', 'light']);
  });

  it('the fuel band is inclusive and needs both loads', () => {
    const edge = lap('edge', {startL: 60 + FUEL_BAND_L});
    const over = lap('over', {startL: 60 + FUEL_BAND_L + 0.1});
    const unknown = lap('unknown', {startL: null});
    const ranked = rankReferenceLaps(target, [over, unknown, edge]);
    expect(ranked.map(r => r.lapId)[0]).toBe('edge');
    expect(ranked.find(r => r.lapId === 'edge')?.match.fuelBand).toBe(true);
    expect(ranked.find(r => r.lapId === 'over')?.match.fuelBand).toBe(false);
    expect(ranked.find(r => r.lapId === 'unknown')?.match.fuelBand).toBe(false);
  });

  it('the same car and the same kind of session come before a quicker lap', () => {
    const quali = lap('quali', {sessionType: 'Q', timeS: 97});
    const otherCar = lap('other', {car: 'Vette', timeS: 96});
    const race = lap('race', {timeS: 100.5});
    expect(ids([quali, otherCar, race])).toEqual(['race', 'quali', 'other']);
  });

  it('a lap on fresh tyres ranks below one on the same set', () => {
    const fresh = lap('fresh', {newTyres: true, timeS: 99.5});
    const worn = lap('worn', {timeS: 100.3});
    expect(ids([fresh, worn])).toEqual(['worn', 'fresh']);
  });

  it('time off track ranks a lap below one on the line', () => {
    const off = lap('off', {offTrackS: 0.4});
    const on = lap('on', {timeS: 101.5});
    const ranked = rankReferenceLaps(target, [off, on]);
    expect(ranked[0].lapId).toBe('on');
    expect(ranked[1].match.onTrack).toBe(false);
  });

  it('a tow or traffic is not a ranking key: the faster lap still wins', () => {
    // The ranking has no field to read: a lap with a tow, traffic or a
    // blue flag ranks as any other (flags are shown beside a lap, never a filter).
    const fast = lap('fast', {timeS: 99.9});
    const slow = lap('slow', {timeS: 101.5});
    expect(ids([slow, fast])).toEqual(['fast', 'slow']);
  });

  it('inside the band the fastest wins, not the closest fuel', () => {
    // A slow lap next to the target in fuel, a quicker one at the band's far side.
    const beside = lap('beside', {startL: 62.4, timeS: 111.5});
    const quick = lap('quick', {startL: 58, timeS: 109.9});
    expect(ids([beside, quick])).toEqual(['quick', 'beside']);
  });

  it('is empty with no candidates, or none that qualify', () => {
    expect(ids([])).toEqual([]);
    expect(ids([lap('a', {partial: true})])).toEqual([]);
  });

  it('reports what each candidate matches, so the screen can say why', () => {
    const [first] = rankReferenceLaps(target, [lap('a', {startL: 61})]);
    expect(first.match).toEqual({
      sameCar: true,
      sameSession: true,
      fuelBand: true,
      tyresKept: true,
      onTrack: true,
    });
    expect(first.timeS).toBe(100);
  });
});

describe('the load band', () => {
  const ve = (id: string, veStartPct: number | null, startL: number | null) =>
    lap(id, {veStartPct, startL});
  const vt = ve('t', 80, null);
  const rank = (cands: RefLap[]) =>
    rankReferenceLaps(vt, cands).map(r => [r.lapId, r.match.fuelBand]);

  it('falls back to Virtual Energy where a lap has no fuel level', () => {
    expect(
      rank([
        ve('far', 80 + VE_BAND_PCT + 1, null),
        ve('near', 80 + VE_BAND_PCT, null),
      ]),
    ).toEqual([
      ['near', true],
      ['far', false],
    ]);
  });

  it('lets fuel decide when both laps have it, whatever the energy says', () => {
    const t = ve('t', 80, 60);
    const out = rankReferenceLaps(t, [
      ve('fuelNear', 20, 60 + FUEL_BAND_L),
      ve('fuelFar', 80, 60 + FUEL_BAND_L + 1),
    ]).map(r => [r.lapId, r.match.fuelBand]);
    expect(out).toEqual([
      ['fuelNear', true],
      ['fuelFar', false],
    ]);
  });

  it('is no band when neither is known on both laps', () => {
    expect(rank([ve('unknown', null, null), ve('oneSide', null, 60)])).toEqual([
      ['oneSide', false],
      ['unknown', false],
    ]);
  });

  it('carries the session each ranked lap is from', () => {
    const out = rankReferenceLaps(vt, [
      {...lap('x'), sessionId: 'other', veStartPct: 80},
    ]);
    expect(out[0].sessionId).toBe('other');
  });
});
