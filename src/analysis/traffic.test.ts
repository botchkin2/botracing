import {describe, expect, it} from '@jest/globals';

import {paceOf} from './classLaps';
import {
  CLEAN_AHEAD_S,
  MIN_SET_LAPS,
  overtakesOf,
  TRAFFIC_AHEAD_S,
  TRAFFIC_VERSION,
  trafficMedians,
  type TrafficField,
  type TrafficLap,
} from './traffic';

const DT = 0.2;
const L = 4000;

type Car = {
  class: string;
  player?: boolean;
  // Lap distance in metres at an update; null = absent.
  at: (u: number) => number | null;
  pits?: (u: number) => boolean;
};

function field(cars: Car[], updates: number): TrafficField {
  const deltas = (values: (number | null)[]) => {
    let last = 0;
    return values.map(v => {
      if (v === null) return null;
      const d = v - last;
      last = v;
      return d;
    });
  };
  return {
    et0: 10,
    tDs: Array.from({length: updates}, (_, u) => Math.round(u * DT * 10)),
    cars: cars.map(c => ({class: c.class, player: c.player})),
    lapDistDm: cars.map(c =>
      deltas(
        Array.from({length: updates}, (_, u) => {
          const v = c.at(u);
          return v === null ? null : Math.round(v * 10);
        }),
      ),
    ),
    inPits: cars.map(c =>
      Array.from({length: updates}, (_, u) => (c.pits?.(u) ? 1 : 0)),
    ),
  };
}

// The player drives at 40 m/s from 1000 m. A car starting `startM` behind at
// `speed` m/s (relative to the lap) catches them when speed > 40.
const player = (): Car => ({
  class: 'GT3',
  player: true,
  at: u => (1000 + u * DT * 40) % L,
});
const chaser = (cls: string, speed: number, startM = 100): Car => ({
  class: cls,
  at: u => (1000 - startM + u * DT * speed) % L,
});
const all = [{from: 0, to: 1e9}];

describe('overtakesOf', () => {
  it('lists a faster-class car that passes the player, with class and lap distance', () => {
    // A Hypercar 100 m behind at 50 m/s: gains 10 m/s, level after 10 s.
    const f = field([player(), chaser('Hyper', 50)], 200);
    const [o] = overtakesOf(f, all, paceOf);
    expect(o).toHaveLength(1);
    expect(o[0].cls).toBe('hypercar');
    // Level at 10 s: the player has driven 400 m from 1000 m.
    expect(Math.abs(o[0].atM - 1400)).toBeLessThan(12);
  });

  it('leaves out the player own class and a slower class', () => {
    const f = field(
      [player(), chaser('GT3', 50), chaser('GT3', 50, 60), chaser('Other', 50)],
      200,
    );
    expect(overtakesOf(f, all, paceOf)[0]).toHaveLength(0);
  });

  it('counts a pass once, not each update the cars are side by side', () => {
    const f = field([player(), chaser('LMP2', 40.5)], 3000);
    // 100 m behind, gaining 0.5 m/s: level after 200 s, once.
    expect(overtakesOf(f, all, paceOf)[0].length).toBeLessThanOrEqual(1);
  });

  it('ignores a car in the pits, and a car that is absent', () => {
    const pits = field(
      [player(), {...chaser('Hyper', 50), pits: () => true}],
      200,
    );
    expect(overtakesOf(pits, all, paceOf)[0]).toHaveLength(0);
    const gone = field(
      [player(), {...chaser('Hyper', 50), at: () => null}],
      200,
    );
    expect(overtakesOf(gone, all, paceOf)[0]).toHaveLength(0);
  });

  it('puts each pass in the lap window it falls in', () => {
    const f = field([player(), chaser('Hyper', 50)], 200);
    // Level at about 10 s on a clock that starts at 10 s: 20 s.
    const w = [
      {from: 0, to: 18},
      {from: 18, to: 1e9},
    ];
    const out = overtakesOf(f, w, paceOf);
    expect(out[0]).toHaveLength(0);
    expect(out[1]).toHaveLength(1);
  });

  it('is empty per window when there is no player car', () => {
    const noPlayer = field([chaser('Hyper', 50)], 100);
    expect(overtakesOf(noPlayer, all, paceOf)).toEqual([[]]);
  });
});

const lap = (
  timeS: number | null,
  aheadS: number,
  suffered = 0,
  comparable = true,
): TrafficLap => ({
  timeS,
  comparable,
  traffic: {trafficAheadS: aheadS, passesSuffered: suffered},
});

describe('trafficMedians', () => {
  it('splits clean and traffic laps, and leaves the 2-5 s between them in neither', () => {
    const laps = [
      lap(100.0, 0),
      lap(100.2, 1.9),
      lap(100.4, 0.5),
      lap(101, 2), // 2 s is not clean
      lap(101.4, 4.9), // between 2 and 5: neither
      lap(103, 5),
      lap(103.4, 20),
      lap(103.8, 40),
      lap(105, 60),
    ];
    const t = trafficMedians(laps);
    expect(t?.v).toBe(TRAFFIC_VERSION);
    expect(t?.clean).toEqual({laps: 3, medianS: 100.2});
    expect(t?.traffic).toEqual({laps: 4, medianS: 103.6});
    expect(CLEAN_AHEAD_S).toBeLessThan(TRAFFIC_AHEAD_S);
  });

  it('a lap that was passed is not clean, whatever the seconds ahead', () => {
    const laps = [lap(100, 0, 1), lap(100, 0), lap(100, 0), lap(100, 0)];
    expect(trafficMedians(laps)?.clean.laps).toBe(3);
  });

  it('gives no median under the floor, but keeps the count', () => {
    const t = trafficMedians([lap(100, 0), lap(101, 0)]);
    expect(MIN_SET_LAPS).toBe(3);
    expect(t?.clean).toEqual({laps: 2, medianS: null});
    expect(t?.traffic).toEqual({laps: 0, medianS: null});
  });

  it('leaves out laps that are not comparable or have no time', () => {
    const t = trafficMedians([
      lap(100, 0),
      lap(100, 0),
      lap(100, 0),
      lap(50, 0, 0, false),
      lap(null, 0),
    ]);
    expect(t?.clean).toEqual({laps: 3, medianS: 100});
  });

  it('is null for a session with no traffic facts at all', () => {
    expect(
      trafficMedians([{timeS: 100, comparable: true, traffic: null}]),
    ).toBeNull();
    expect(trafficMedians([])).toBeNull();
  });
});
