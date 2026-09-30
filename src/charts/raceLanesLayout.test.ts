import {describe, expect, it} from '@jest/globals';

import type {RaceLanes} from '@/src/analysis/raceLanes';

import {lanesLayout, timeAtX} from './raceLanesLayout';

const lanes: RaceLanes = {
  durationS: 1000,
  lapStarts: [0, 100, 200, 300, 400, 500].map((timeS, i) => ({
    lap: i + 1,
    timeS,
  })),
  typicalLapS: 100,
  pit: [{fromS: 90, toS: 120}],
  tow: [
    {fromS: 10, toS: 20},
    {fromS: 700, toS: 710},
  ],
  battle: [{fromS: 0.1, toS: 0.15}],
  blueS: [50, 800],
  passes: [
    {timeS: 60, made: true},
    {timeS: 900, made: false},
  ],
};
const opts = {laneWidth: 200, laneHeight: 10, lapLabelEvery: 2};

describe('lanesLayout', () => {
  it('whole race: 200 px over 1000 s, five lanes stacked', () => {
    const l = lanesLayout({
      ...opts,
      lanes,
      window: {fromS: 0, toS: 1000},
    });
    expect(l.rows.map(r => [r.key, r.y])).toEqual([
      ['pit', 0],
      ['tow', 10],
      ['battle', 20],
      ['blue', 30],
      ['pass', 40],
    ]);
    expect(l.height).toBe(50);
    expect(l.rows[0].spans).toEqual([{x: 18, w: 6}]);
    expect(l.rows[1].spans).toEqual([
      {x: 2, w: 2},
      {x: 140, w: 2},
    ]);
    // A span under a pixel wide still draws one.
    expect(l.rows[2].spans[0].w).toBe(1);
    expect(l.rows[3].ticks).toEqual([10, 160]);
    expect(l.rows[4].marks).toEqual([
      {x: 12, made: true},
      {x: 180, made: false},
    ]);
  });

  it('a window clips spans and drops what is outside it', () => {
    const l = lanesLayout({
      ...opts,
      lanes,
      window: {fromS: 100, toS: 200},
    });
    // The pit span 90..120 runs in from the left edge: 20 s of 100 s.
    expect(l.rows[0].spans).toEqual([{x: 0, w: 40}]);
    expect(l.rows[1].spans).toEqual([]);
    expect(l.rows[3].ticks).toEqual([]);
    expect(l.rows[4].marks).toEqual([]);
  });

  it('lap lines are inside the window; labels every N laps', () => {
    const l = lanesLayout({
      ...opts,
      lanes,
      window: {fromS: 100, toS: 400},
    });
    // Laps 2, 3, 4 and 5 start at 100, 200, 300, 400... lap 1 is at 0.
    expect(l.lapLines.map(x => [Math.round(x.x), x.label])).toEqual([
      [0, '2'],
      [67, null],
      [133, '4'],
      [200, null],
    ]);
  });
});

describe('timeAtX', () => {
  it('maps pixels back to race time, clamped to the window', () => {
    const w = {fromS: 100, toS: 300};
    expect(timeAtX(100, w, 200)).toBe(200);
    expect(timeAtX(-5, w, 200)).toBe(100);
    expect(timeAtX(999, w, 200)).toBe(300);
  });
});
