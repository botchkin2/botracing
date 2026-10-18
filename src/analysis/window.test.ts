import {describe, expect, it} from '@jest/globals';

import {
  distanceAtTime,
  gridStepM,
  minorStepM,
  loopRange,
  loopStep,
  panCursor,
  playStep,
  rewindStep,
  type TimedGrid,
  timeAtDistance,
  timeAtIndex,
  timeGridStepM,
  windowRange,
  windowTimeS,
} from './window';

// 1000 m: the first 500 m at 50 m/s (10 s), the rest at 25 m/s (20 s).
const ref: TimedGrid = (() => {
  const distanceM = Array.from({length: 201}, (_, i) => i * 5);
  const timeS = distanceM.map(d => (d <= 500 ? d / 50 : 10 + (d - 500) / 25));
  return {stepM: 5, distanceM, timeS};
})();

describe('timeAtDistance past the lap', () => {
  it('extends at the first and last step pace', () => {
    // First 500 m at 50 m/s, the rest at 25 m/s; 1000 m lap ends at 30 s.
    expect(timeAtDistance(ref, -100)).toBeCloseTo(-2);
    expect(timeAtDistance(ref, 1100)).toBeCloseTo(34);
  });
});

describe('time <-> distance on the reference', () => {
  it('round-trips', () => {
    expect(timeAtDistance(ref, 250)).toBeCloseTo(5);
    expect(timeAtDistance(ref, 750)).toBeCloseTo(20);
    expect(distanceAtTime(ref, 20)).toBeCloseTo(750);
    expect(distanceAtTime(ref, -1)).toBe(0);
    expect(distanceAtTime(ref, 99)).toBe(1000);
  });
});

describe('windowRange', () => {
  it('time mode widens on the fast part and tightens on the slow part', () => {
    const [a, b] = windowRange(ref, 250, 'time', 2);
    expect(b - a).toBeCloseTo(100);
    const [c, d] = windowRange(ref, 750, 'time', 2);
    expect(d - c).toBeCloseTo(50);
  });
  it('distance mode is fixed; null is the whole lap', () => {
    expect(windowRange(ref, 600, 'distance', 200)).toEqual([500, 700]);
    // Centred at the line too: the part past it is blank, not shifted.
    expect(windowRange(ref, 30, 'distance', 200)).toEqual([-70, 130]);
    expect(windowRange(ref, 990, 'distance', 200)).toEqual([890, 1090]);
    expect(windowRange(ref, 600, 'time', null)).toEqual([0, 1000]);
  });
});

describe('time mode x axis', () => {
  const x = (m: number, cursorM: number) => {
    const [t0, t1] = windowTimeS(ref, cursorM, 2);
    return (timeAtDistance(ref, m) - t0) / (t1 - t0);
  };
  it('is a constant 2 s wide wherever the cursor is', () => {
    for (const c of [0, 250, 500, 750, 1000]) {
      const [t0, t1] = windowTimeS(ref, c, 2);
      expect(t1 - t0).toBeCloseTo(2);
    }
  });
  it('keeps the cursor centred at 0 m and at the lap end', () => {
    expect(windowTimeS(ref, 0, 2)).toEqual([-1, 1]);
    expect(windowTimeS(ref, 1000, 2)).toEqual([29, 31]);
    expect(x(0, 0)).toBeCloseTo(0.5);
    expect(x(1000, 1000)).toBeCloseTo(0.5);
  });
  it('clips the metres to the lap at the line', () => {
    expect(windowRange(ref, 0, 'time', 2)).toEqual([0, 50]);
  });
  it('is monotonic along the lap, and past its end for longer laps', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 210; i++) {
      const t = timeAtIndex(ref, i);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
    expect(timeAtIndex(ref, 202)).toBeCloseTo(30 + 2 * 0.2);
  });
  it('gridline step comes from the average speed, not the window', () => {
    // 1000 m in 30 s: a 2 s window is ~67 m wherever the cursor is.
    expect(timeGridStepM(ref, 2, 400)).toBe(10);
  });
});

describe('panCursor', () => {
  it('dragging left moves forward by the window fraction', () => {
    expect(panCursor(ref, 600, 'distance', 200, -100, 400)).toBeCloseTo(650);
    // 1/4 of a 2 s window at 25 m/s = 12.5 m
    expect(panCursor(ref, 750, 'time', 2, -100, 400)).toBeCloseTo(762.5);
  });
  it('clamps to the lap', () => {
    expect(panCursor(ref, 10, 'distance', 200, 400, 400)).toBe(0);
  });
});

describe('gridStepM', () => {
  it('picks a nice step with room between lines', () => {
    expect(gridStepM(100, 358)).toBe(20);
    expect(gridStepM(1000, 358)).toBe(200);
  });
});

describe('labelled and minor distance gridlines (Botkin: 100 m was too coarse)', () => {
  // Corner's chart at 1440 wide (798 pt for ~700 m) and at 375 (343 pt).
  it('Corner at 1440: labels every 50 m, a line every 25 m', () => {
    const step = gridStepM(700, 798);
    expect(step).toBe(50);
    expect(minorStepM(step, (step / 700) * 798)).toBe(25);
  });
  it('Corner at 375: labels every 100 m, a line every 50 m', () => {
    const step = gridStepM(700, 343);
    expect(step).toBe(100);
    expect(minorStepM(step, (step / 700) * 343)).toBe(50);
  });
  it('a minor step always divides the labelled one, and none when it would crowd', () => {
    expect(minorStepM(100, 30)).toBeNull();
    for (const [step, pt] of [
      [20, 400],
      [50, 130],
      [200, 105],
      [1000, 58],
    ] as const) {
      const m = minorStepM(step, pt);
      expect(m).not.toBeNull();
      expect(step % m!).toBe(0);
      expect((m! / step) * pt).toBeGreaterThanOrEqual(16);
    }
  });
});

describe('playStep', () => {
  it('advances by rate and loops at the lap end', () => {
    expect(playStep(ref, 250, 1, 1)).toBeCloseTo(300);
    expect(playStep(ref, 250, 1, 0.5)).toBeCloseTo(275);
    // 990 m is 29.6 s; +1 s wraps to 0.6 s, which is 30 m at 50 m/s.
    expect(playStep(ref, 990, 1, 1)).toBeCloseTo(30);
  });
});

describe('rewindStep', () => {
  it('goes back by rate and stops at the lap start', () => {
    expect(rewindStep(ref, 250, 1, 1)).toBeCloseTo(200);
    expect(rewindStep(ref, 250, 1, 0.5)).toBeCloseTo(225);
    expect(rewindStep(ref, 20, 1, 1)).toBe(0);
    expect(rewindStep(ref, 0, 1, 1)).toBe(0);
  });
});

describe('loopRange', () => {
  it('is the window around the cursor in seconds, clipped to the lap', () => {
    // 500 m is 10 s: a 4 s window is 8 to 12 s.
    expect(loopRange(ref, 500, 'time', 4)).toEqual([8, 12]);
    // Near the line the start is held at 0.
    expect(loopRange(ref, 0, 'time', 4)).toEqual([0, 2]);
    // Distance mode: 200 m around 500 m is 400 to 600 m, in time on the reference.
    const [a, b] = loopRange(ref, 500, 'distance', 200);
    expect(a).toBeCloseTo(8, 6);
    expect(b).toBeCloseTo(14, 6);
  });
  it('is the whole lap without a window', () => {
    expect(loopRange(ref, 300, 'time', null)).toEqual([0, 30]);
  });
});

describe('loopStep', () => {
  const range: [number, number] = [8, 12];
  const at = (t: number) => distanceAtTime(ref, t);
  it('plays on inside the range', () => {
    const next = loopStep(ref, at(9), 1, 1, false, range);
    expect(timeAtDistance(ref, next)).toBeCloseTo(10, 6);
  });
  it('comes back in at the start past the end, keeping the overshoot', () => {
    const next = loopStep(ref, at(11.5), 1, 1, false, range);
    expect(timeAtDistance(ref, next)).toBeCloseTo(8.5, 6);
  });
  it('plays backwards and comes in at the end past the start (no stop)', () => {
    const next = loopStep(ref, at(8.5), 1, 1, true, range);
    expect(timeAtDistance(ref, next)).toBeCloseTo(11.5, 6);
  });
  it('joins a cursor dragged outside the range at the end it is heading for', () => {
    const f = loopStep(ref, at(20), 0, 1, false, range);
    expect(timeAtDistance(ref, f)).toBeGreaterThanOrEqual(8);
    expect(timeAtDistance(ref, f)).toBeLessThanOrEqual(12);
  });
  it('stays put on an empty range', () => {
    expect(loopStep(ref, 100, 1, 1, false, [5, 5])).toBe(100);
  });
});
