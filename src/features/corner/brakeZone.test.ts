import {describe, expect, it} from '@jest/globals';

import {brakeZone} from './brakeZone';

// A 1 m grid unless a test says otherwise: pedal at `pct` from `from` to `to`.
const press = (from: number, to: number, pct = 80, n = 60) =>
  Array.from({length: n}, (_, i) => (i >= from && i < to ? pct : 0));

describe('brakeZone', () => {
  it('is the median brake point to the median release', () => {
    const lines = [
      {brakeAtM: 10, brakePct: press(10, 20), stepM: 1},
      {brakeAtM: 12, brakePct: press(12, 22), stepM: 1},
      {brakeAtM: 14, brakePct: press(14, 30), stepM: 1},
    ];
    expect(brakeZone(lines, 59)).toEqual([12, 22]);
  });

  it('skips laps that did not brake here', () => {
    const lines = [
      {brakeAtM: null, brakePct: press(0, 0), stepM: 1},
      {brakeAtM: 10, brakePct: press(10, 20), stepM: 1},
    ];
    expect(brakeZone(lines, 59)).toEqual([10, 20]);
  });

  it('is null when no lap in the set braked', () => {
    expect(
      brakeZone([{brakeAtM: null, brakePct: press(0, 0), stepM: 1}], 59),
    ).toBeNull();
    expect(brakeZone([], 59)).toBeNull();
  });

  it('a one-sample dip mid-zone does not end it', () => {
    const pct = press(10, 40);
    pct[25] = 0;
    expect(brakeZone([{brakeAtM: 10, brakePct: pct, stepM: 1}], 59)).toEqual([
      10, 40,
    ]);
  });

  it('a dab then the main stop runs from the dab onset to the stop release', () => {
    // 30 % dab at 10–20 m, lift for 15 m, then 90 % stop at 35–50 m.
    const pct = Array.from({length: 60}, (_, i) =>
      i >= 10 && i < 20 ? 30 : i >= 35 && i < 50 ? 90 : 0,
    );
    expect(brakeZone([{brakeAtM: 10, brakePct: pct, stepM: 1}], 59)).toEqual([
      10, 50,
    ]);
  });

  it('a lap still braking at the window end gives no zone', () => {
    // Pedal held to 59 m, the window ends at 40 m: no release inside it.
    expect(
      brakeZone([{brakeAtM: 10, brakePct: press(10, 60), stepM: 1}], 40),
    ).toBeNull();
  });

  it('braking across the start/finish line gives no zone for that lap', () => {
    // The trace ends while the application is still open.
    expect(
      brakeZone([{brakeAtM: 50, brakePct: press(50, 60), stepM: 1}], 59),
    ).toBeNull();
  });

  it('reads each lap on its own grid step', () => {
    // 5 m grid: onset at 50 m is index 10; pedal held to index 14 (70 m).
    const fiveM = Array.from({length: 30}, (_, i) =>
      i >= 10 && i < 14 ? 60 : 0,
    );
    // 1 m grid, same corner: onset 50 m, release 60 m.
    const oneM = press(50, 60, 80, 150);
    expect(
      brakeZone(
        [
          {brakeAtM: 50, brakePct: fiveM, stepM: 5},
          {brakeAtM: 50, brakePct: oneM, stepM: 1},
        ],
        149,
      ),
    ).toEqual([50, 65]);
  });
});
