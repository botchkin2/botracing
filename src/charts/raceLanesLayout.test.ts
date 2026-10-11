import {describe, expect, it} from '@jest/globals';

import {laneWindow, type RaceLanes} from '@/src/analysis/raceLanes';

import {laneScrubber, lanesLayout, timeAtX} from './raceLanesLayout';

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
  off: [{fromS: 300, toS: 300.2}],
  blueS: [50, 800],
  passes: [
    {timeS: 60, made: true},
    {timeS: 900, made: false},
  ],
};
const opts = {laneWidth: 200, laneHeight: 10, lapLabelEvery: 2};

describe('lanesLayout', () => {
  it('whole race: 200 px over 1000 s, six lanes stacked', () => {
    const l = lanesLayout({
      ...opts,
      lanes,
      window: {fromS: 0, toS: 1000},
    });
    expect(l.rows.map(r => [r.key, r.y])).toEqual([
      ['pit', 0],
      ['off', 10],
      ['tow', 20],
      ['battle', 30],
      ['blue', 40],
      ['pass', 50],
    ]);
    expect(l.height).toBe(60);
    expect(l.rows[0].spans).toEqual([{x: 18, w: 6}]);
    // An off-track mark is at least 3 px wide, to see and tap on a phone.
    expect(l.rows[1].spans).toEqual([{x: 60, w: 3}]);
    expect(l.rows[2].spans).toEqual([
      {x: 2, w: 2},
      {x: 140, w: 2},
    ]);
    // A span under a pixel wide still draws one.
    expect(l.rows[3].spans[0].w).toBe(1);
    expect(l.rows[4].ticks).toEqual([10, 160]);
    expect(l.rows[5].marks).toEqual([
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
    expect(l.rows[2].spans).toEqual([]);
    expect(l.rows[4].ticks).toEqual([]);
    expect(l.rows[5].marks).toEqual([]);
  });

  it('lap lines are inside the window; labels every N laps', () => {
    const l = lanesLayout({
      ...opts,
      lanes,
      window: {fromS: 100, toS: 400},
    });
    // Laps 2, 3, 4 and 5 start at 100, 200, 300, 400... lap 1 is at 0.
    expect(l.lapLines.map(x => [Math.round(x.x), x.label])).toEqual([
      [0, 'L2'],
      [67, null],
      [133, 'L4'],
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

describe('laneScrubber', () => {
  // The 3-lap window (300 s) follows the playhead, as on the Race screen.
  function drag() {
    let playhead = 500;
    const seen: number[] = [];
    const scrub = laneScrubber(() => ({
      window: laneWindow('l3', playhead, lanes),
      laneWidth: 200,
      labelWidth: 44,
      onScrub: t => {
        playhead = t;
        seen.push(t);
      },
    }));
    return {scrub, seen, playhead: () => playhead};
  }

  it('maps every move of a drag through the window it started in', () => {
    const {scrub, seen} = drag();
    scrub.start(44 + 100); // the middle of [350, 650]
    scrub.move(44 + 150); // 3/4 of the way
    scrub.move(44 + 150); // the finger has not moved: neither has the playhead
    scrub.move(44 + 150);
    expect(seen).toEqual([500, 575, 575, 575]);
  });

  it('without the freeze the playhead would run away (what the window does to a move)', () => {
    let playhead = 500;
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      const window = laneWindow('l3', playhead, lanes);
      playhead = timeAtX(150, window, 200);
      seen.push(playhead);
    }
    expect(seen[2]).toBeGreaterThan(seen[0]); // 575, 650, 725
  });

  it('maps through the new window once the drag has ended', () => {
    const {scrub, seen} = drag();
    scrub.start(44 + 100);
    scrub.move(44 + 150); // playhead 575, window now [425, 725]
    scrub.end();
    scrub.start(44 + 100); // the middle of the new window
    expect(seen.at(-1)).toBe(575);
  });
});
