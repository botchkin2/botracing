import {describe, expect, it} from '@jest/globals';

import {
  BOUNDARY_MARGIN_S,
  brakeApplications,
  type CornerWindow,
  cornerBoundaries,
  type MapSection,
  onsetM,
  type PedalTrace,
  splitWindow,
} from './cornerBoundaries';
import * as daytona from './__fixtures__/daytonaBoundaries';
import * as atlanta from './__fixtures__/roadAtlantaBoundaries';

const speedAt = (profile: number[]) => (m: number) =>
  profile[Math.min(profile.length - 1, Math.max(0, Math.round(m / 5)))];

const windowsOf = (f: typeof daytona | typeof atlanta) =>
  cornerBoundaries({
    lengthM: f.lengthM,
    sections: f.sections as MapSection[],
    onsetsM: f.onsetsM,
    speedKmhAt: speedAt(f.speedKmh),
  });

const earliest = (onsets: (number | null)[]) =>
  Math.min(...onsets.filter((m): m is number => m != null));

describe.each([
  ['Daytona', daytona],
  ['Road Atlanta', atlanta],
])('%s windows', (_name, f) => {
  const windows = windowsOf(f);
  const sections = windows.filter(w => w.kind === 'section');

  it('tile the lap from the line to the line, in order, with no gap or overlap', () => {
    expect(windows[0].fromM).toBe(0);
    expect(windows[windows.length - 1].toM).toBe(f.lengthM);
    windows.slice(1).forEach((w, i) => expect(w.fromM).toBe(windows[i].toM));
    for (const w of windows) expect(w.toM).toBeGreaterThan(w.fromM);
  });

  it('puts every section start a margin before its earliest onset, so every lap is still on the straight', () => {
    sections.forEach((w, k) => {
      const first = earliest(f.onsetsM[k]);
      expect(w.fromM).toBeLessThan(first);
      // 0.5 s at the speed there, give or take the 5 m the profile is read at.
      const marginM = (speedAt(f.speedKmh)(first) / 3.6) * BOUNDARY_MARGIN_S;
      const gap = first - w.fromM;
      // A boundary clamped to the previous exit sits closer than the margin.
      if (k > 0 && w.fromM === f.sections[k - 1].exitM) {
        expect(gap).toBeLessThanOrEqual(marginM + 8);
      } else {
        expect(Math.abs(gap - marginM)).toBeLessThan(8);
      }
    });
  });

  it('never starts a window behind the previous section exit', () => {
    sections.forEach((w, k) => {
      if (k > 0)
        expect(w.fromM).toBeGreaterThanOrEqual(f.sections[k - 1].exitM);
    });
  });

  it('has every lap brake or lift inside its window, none before it', () => {
    sections.forEach((w, k) => {
      for (const m of f.onsetsM[k]) {
        if (m != null) expect(m).toBeGreaterThanOrEqual(w.fromM);
      }
    });
  });
});

describe('Daytona', () => {
  const windows = windowsOf(daytona);

  it('makes the start/finish line a boundary: the last section ends at the line and the start straight is its own unit', () => {
    const start = windows[0];
    expect(start.kind).toBe('start-straight');
    expect(start.section).toBeNull();
    expect(start.fromM).toBe(0);
    const last = windows[windows.length - 1];
    expect(last.section).toBe(5);
    expect(last.toM).toBe(daytona.lengthM);
  });

  it('holds the bus stop as one section with three parts that tile its window', () => {
    const bus = windows.find(w => w.section === 5)!;
    expect(bus.parts.map(p => p.n)).toEqual([8, 9, 10]);
    expect(bus.parts[0].fromM).toBe(bus.fromM);
    expect(bus.parts[2].toM).toBe(bus.toM);
    bus.parts
      .slice(1)
      .forEach((p, i) => expect(p.fromM).toBe(bus.parts[i].toM));
  });

  it('leaves a single corner with no parts of its own', () => {
    expect(windows.find(w => w.section === 2)!.parts).toEqual([]);
  });

  it('ends T10 at the line instead of around it', () => {
    // The old window ran 4,005 m to 305 m, around the lap end; now it stops at
    // the line and the start straight begins there.
    const bus = windows.find(w => w.section === 5)!;
    expect(bus.parts[2].toM).toBe(daytona.lengthM);
    expect(windows[0].toM).toBeLessThan(daytona.sections[0].entryM);
  });
});

describe('onsetM', () => {
  const section: MapSection = {n: 1, entryM: 300, turnInM: 340, exitM: 420};
  const lap = (
    brakeFrom: number | null,
    liftFrom: number | null,
  ): PedalTrace => {
    const distM = Array.from({length: 61}, (_, i) => 200 + i * 5);
    return {
      distM,
      brakePct: distM.map(d =>
        brakeFrom != null && d >= brakeFrom && d < 380 ? 60 : 0,
      ),
      throttlePct: distM.map(d =>
        liftFrom != null && d >= liftFrom && d < 380 ? 50 : 100,
      ),
    };
  };

  it('is the first sample of the working run that reaches turn-in', () => {
    expect(onsetM(lap(285, null), section, 0)).toBe(285);
    // A lift counts as well as a brake, and the earlier of the two starts it.
    expect(onsetM(lap(295, 270), section, 0)).toBe(270);
  });

  it('is null for a corner taken flat', () => {
    expect(onsetM(lap(null, null), section, 0)).toBeNull();
  });

  it('does not look behind the previous section exit', () => {
    expect(onsetM(lap(210, null), section, 250)).toBe(250);
  });
});

describe('splitWindow', () => {
  const timeAt = (m: number) => m / 50;
  const window = {fromM: 1000, toM: 1600};

  it('splits a window into run-in, corner and exit that add up to its time', () => {
    const s = splitWindow(timeAt, window, {
      brakeAtM: 1100,
      fullThrottleAtM: 1400,
    });
    expect(s).toEqual({runInS: 2, cornerS: 6, exitS: 4});
    expect(s.runInS + s.cornerS + s.exitS).toBe(timeAt(1600) - timeAt(1000));
  });

  it('starts the corner at the window with no brake and runs it to the end with no full throttle', () => {
    expect(
      splitWindow(timeAt, window, {brakeAtM: null, fullThrottleAtM: 1400}),
    ).toEqual({runInS: 0, cornerS: 8, exitS: 4});
    expect(
      splitWindow(timeAt, window, {brakeAtM: 1100, fullThrottleAtM: null}),
    ).toEqual({runInS: 2, cornerS: 10, exitS: 0});
  });

  it('keeps the points in the window and in order', () => {
    const early = splitWindow(timeAt, window, {
      brakeAtM: 900,
      fullThrottleAtM: 950,
    });
    expect(early).toEqual({runInS: 0, cornerS: 0, exitS: 12});
    const late = splitWindow(timeAt, window, {
      brakeAtM: 1500,
      fullThrottleAtM: 1200,
    });
    expect(late.runInS + late.cornerS + late.exitS).toBeCloseTo(12, 9);
    expect(late.cornerS).toBe(0);
  });
});

describe('brakeApplications', () => {
  const windows = windowsOf(daytona);
  const bus = windows.find(w => w.section === 5) as CornerWindow;

  it('finds the bus stop as brake applications at section level, with onset, peak and part', () => {
    const [first, second] = daytona.busStopLaps.map(l =>
      brakeApplications(l, bus),
    );
    // Lap one: the hard stop for T8 and a touch (12 %) before T9 begins.
    expect(first.map(a => a.part)).toEqual([8, 8]);
    expect(first[0].peakPct).toBeGreaterThan(80);
    expect(first[1].peakPct).toBeLessThan(20);
    // Lap two brakes for T9 inside T9's own window.
    expect(second.map(a => a.part)).toEqual([8, 9]);
    expect(second[1].onsetM).toBeGreaterThan(bus.parts[1].fromM);
  });

  it('counts none on a lap that never brakes in the window', () => {
    const lap: PedalTrace = {
      distM: [4000, 4010, 4020],
      brakePct: [0, 1, 0],
      throttlePct: [100, 100, 100],
    };
    expect(brakeApplications(lap, bus)).toEqual([]);
  });

  it('does not split an application on trail braking that hovers near 10 %', () => {
    const lap: PedalTrace = {
      distM: [3700, 3710, 3720, 3730, 3740, 3750],
      brakePct: [80, 40, 9, 11, 8, 0],
      throttlePct: [0, 0, 0, 0, 0, 0],
    };
    expect(brakeApplications(lap, bus)).toEqual([
      {onsetM: 3700, peakPct: 80, part: 8},
    ]);
  });
});
