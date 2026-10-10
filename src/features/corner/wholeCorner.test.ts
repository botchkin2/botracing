import {describe, expect, it} from '@jest/globals';

// Adapters are internal to data/; tests reach them to build real shapes.
import {
  toLaps,
  toSessionDetail,
  toTrackMap,
} from '@/src/data/sessions/adapters';
import {trackCorners} from '@/src/data/sessions';

import {buildCornerModel, sectionChips} from './model';
import {sliceCornerOf, wholeTitle} from './wholeCorner';

const session = toSessionDetail({
  id: 's1',
  sim: 'lmu',
  track: {name: 'Test Ring'},
  car: {name: 'Manthey DK Engineering 2026 #91:LM'},
  sessionType: 'Race',
  startedAt: '2026-09-26T00:00:00Z',
  stints: [],
});

// S1 = T1; S2 = a bus stop: T2 and T3 in one window (500 to 1000 m).
const map = toTrackMap({
  lengthM: 1000,
  boundaries: {
    v: 1,
    rev: 3,
    startsM: [150, 500],
    marginM: [20, 20],
    windows: [
      {kind: 'start-straight', section: null, fromM: 0, toM: 150, parts: []},
      {kind: 'section', section: 1, fromM: 150, toM: 500, parts: []},
      {
        kind: 'section',
        section: 2,
        fromM: 500,
        toM: 1000,
        parts: [
          {n: 2, turnInM: 540, fromM: 500, toM: 700},
          {n: 3, turnInM: 680, fromM: 700, toM: 1000},
        ],
      },
    ],
  },
  corners: [
    {n: 1, entryM: 200, apexM: 250, exitM: 300, parts: []},
    {
      n: 2,
      entryM: 520,
      apexM: 600,
      exitM: 800,
      parts: [
        {n: 2, entryM: 520, apexM: 580, exitM: 700},
        {n: 3, entryM: 700, apexM: 780, exitM: 800},
      ],
    },
  ],
  outline: {features: []},
});

// Handwritten, as no stored lap of a compound corner is under 50 KB. Times
// are rounded to 3 decimals like the uploader writes them. Each part and the
// section carry different pedal facts so the test can tell which one is read.
type Opts = {
  /** The part the first brake application brakes for (section brakeApps). */
  brakePart?: number | null;
  firstEdge?: boolean;
  lastEdge?: boolean;
  lastFlat?: boolean;
  sectionEdge?: boolean;
};
const lap = (id: string, shift: number, o: Opts = {}) => ({
  id,
  lapTime: 100,
  comparable: true,
  reasons: [],
  cornerBoundaries: {v: 1, rev: 3},
  corners: [
    {segTime: 5, parts: []},
    {
      segTime: 12.001 + shift,
      fromM: 500,
      toM: 1000,
      runInS: 2,
      cornerS: 6.001 + shift,
      exitS: 4,
      minSpeedKmh: 70,
      brakeAtM: 400,
      fullThrottleAtM: 700,
      throttlePickupAtM: 650,
      minSpeedAtEdge: o.sectionEdge === true,
      fullThrottleAtEdge: false,
      brakeApps:
        o.brakePart == null
          ? []
          : [{onsetM: 640, peakPct: 60, part: o.brakePart}],
      parts: [
        {
          segTime: 5.0004,
          fromM: 500,
          toM: 700,
          runInS: 1,
          cornerS: 3,
          exitS: 1,
          minSpeedKmh: 90,
          brakeAtM: 470 - shift,
          peakBrakePct: 90,
          turnInAtM: 530,
          throttlePickupAtM: 600,
          fullThrottleAtM: 690,
          minSpeedAtEdge: o.firstEdge === true,
        },
        {
          segTime: 7.0006 + shift,
          fromM: 700,
          toM: 1000,
          runInS: 1,
          cornerS: 3 + shift,
          exitS: 3,
          minSpeedKmh: 100,
          brakeAtM: 690,
          peakBrakePct: 60,
          turnInAtM: 720,
          throttlePickupAtM: 790,
          fullThrottleAtM: 850 + shift,
          minSpeedAtEdge: o.lastEdge === true,
          fullThrottleAtEdge: o.lastFlat === true,
        },
      ],
    },
  ],
});

const laps = toLaps([lap('a', 0), lap('b', 2)]);
const build = (
  corner: number,
  whole: boolean,
  lapIds = ['a', 'b'],
  l = laps,
  refId: string | null = 'a',
) =>
  buildCornerModel({
    session,
    laps: l,
    map,
    band: null,
    traces: new Map(),
    lapIds,
    refId,
    keyLapIds: lapIds,
    hl: null,
    corner,
    whole,
  })!;

describe('All on a compound corner', () => {
  const all = trackCorners(map);
  const whole = build(2, true);

  it('spans the section: first entry to last exit', () => {
    expect(whole.whole).toBe(true);
    expect(whole.title).toBe('Turns 2–3');
    expect(whole.window?.fromM).toBe(500);
    expect(whole.window?.toM).toBe(1000);
    // The shaded stretch is the section's window, not one part's.
    expect(whole.zoom.stretch.fromM).toBeLessThanOrEqual(500);
    expect(whole.zoom.stretch.toM).toBeGreaterThanOrEqual(1000);
    expect(whole.zoom.deltaFromM).toBeLessThanOrEqual(500);
    const part = build(2, false);
    expect(part.zoom.stretch.toM).toBeLessThan(whole.zoom.stretch.toM);
  });

  it('time over the window equals the sum of its parts, within rounding', () => {
    for (const shift of [0, 2]) {
      const l = laps.find(x => x.id === (shift ? 'b' : 'a'))!;
      const parts = l.sections[1].parts.reduce(
        (sum, p) => sum + (p.segTimeS ?? 0),
        0,
      );
      expect(l.sections[1].segTimeS! - parts).toBeCloseTo(0, 2);
    }
    expect(whole.rows[0].values.time).toBe(12.001);
  });

  it('takes the entry from the first part, the exit from the last, the rest from the section', () => {
    expect(whole.rows[0].values).toEqual({
      time: 12.001,
      // First part: brake and turn-in, from its apex (580).
      brake: 580 - 470,
      peakBrake: 90,
      turnIn: 580 - 530,
      // The section's own slowest speed.
      minSpeed: 70,
      // Last part: pickup and full throttle, from its apex (780).
      pickup: 790 - 780,
      throttle: 850 - 780,
      minThrottle: null,
    });
  });

  it('measures the brake to the part the first application brakes for', () => {
    // Road Atlanta T2-5: the only application brakes for T3, not for T2.
    const l = toLaps([lap('a', 0, {brakePart: 3})]);
    const m = build(2, true, ['a'], l);
    // T3's brake (690) and turn-in (720) from T3's apex (780).
    expect(m.rows[0].values.brake).toBe(780 - 690);
    expect(m.rows[0].values.turnIn).toBe(780 - 720);
    expect(m.rows[0].values.peakBrake).toBe(60);
    // The braking map places it from the same apex.
    expect(m.rows[0].brakeApexM).toBe(780);
  });

  it('falls back to the part holding the slowest point, then the first', () => {
    const l = toLaps([lap('a', 0)]);
    expect(build(2, true, ['a'], l).rows[0].brakeApexM).toBe(580);
  });

  it('turn-in is not lost to the first part’s edge flag when another part is braked for', () => {
    const l = toLaps([lap('a', 0, {brakePart: 3, firstEdge: true})]);
    expect(build(2, true, ['a'], l).rows[0].values.turnIn).toBe(60);
    // Braked for the first part, which sat on the edge: no turn-in.
    const edge = toLaps([lap('a', 0, {firstEdge: true})]);
    expect(build(2, true, ['a'], edge).rows[0].values.turnIn).toBeNull();
  });

  it('gates the exit facts on the window’s edge flag, not the last part’s', () => {
    const l = toLaps([lap('a', 0, {brakePart: 3, lastEdge: true})]);
    const v = build(2, true, ['a'], l).rows[0].values;
    expect(v.pickup).toBe(10);
    expect(v.throttle).toBe(70);
    expect(v.minSpeed).toBe(70);
    const edge = toLaps([lap('a', 0, {brakePart: 3, sectionEdge: true})]);
    const w = build(2, true, ['a'], edge).rows[0].values;
    expect([w.pickup, w.throttle, w.minSpeed]).toEqual([null, null, null]);
  });

  it('takes full throttle from the section when the last part was already there', () => {
    const l = toLaps([lap('a', 0, {lastFlat: true})]);
    const m = build(2, true, ['a'], l);
    // The section's held point (700) from the section's apex (600).
    expect(m.rows[0].values.throttle).toBe(100);
  });

  it('frames and shades the whole window under the median basis', () => {
    const m = build(2, true, ['a', 'b'], laps, null);
    expect(m.zoom.stretch.fromM).toBe(500);
    expect(m.zoom.stretch.toM).toBe(1000);
    expect(m.zoom.windowM[0]).toBeLessThanOrEqual(500);
    expect(m.subtitle).toContain('vs median of 2');
    // Names the compound, and not its own parts as "also in view".
    expect(m.zoom.caption).not.toContain('also in view: T2');
    expect(m.zoom.caption).not.toContain('T3');
  });

  it('compares against the median of the set like any corner', () => {
    expect(whole.subtitle).toContain('vs L');
    expect(whole.rows[1].cells.time.gap).toBe('+2.000');
    // b braked 2 m earlier than a, measured to the first part's apex.
    expect(whole.rows[1].cells.brake.gap).toBe('+2');
  });

  it('keeps one part as it was', () => {
    const t3 = build(3, false);
    expect(t3.whole).toBe(false);
    expect(t3.title).toBe('Turn 3');
    expect(t3.rows[0].values.time).toBe(7.0006);
    expect(t3.rows[0].values.pickup).toBe(790 - 780);
  });

  it('puts All first in the Parts row; no part is selected while it is', () => {
    const chips = sectionChips(all, all[1], true);
    expect(chips.all).toEqual({selected: true});
    expect(chips.parts.map(p => p.selected)).toEqual([false, false]);
    expect(sectionChips(all, all[1]).all).toEqual({selected: false});
    expect(sectionChips(all, all[0]).all).toBeNull();
    expect(whole.all).toEqual({selected: true});
  });

  it('steps from All to the corners around the section', () => {
    expect(whole.prev).toBe(1);
    expect(whole.next).toBe(1);
    const mid = build(2, false);
    expect(mid.next).toBe(3);
  });

  it('is ignored on a single corner', () => {
    const t1 = build(1, true);
    expect(t1.whole).toBe(false);
    expect(t1.all).toBeNull();
    expect(t1.title).toBe('Turn 1');
  });

  it('reads the window from the last part’s slice file', () => {
    expect(sliceCornerOf(all, 2, true)).toBe(3);
    expect(sliceCornerOf(all, 2, false)).toBe(2);
    expect(sliceCornerOf(all, 1, true)).toBe(1);
  });

  it('names a section by its turns', () => {
    expect(wholeTitle('S2 (T2–T5)')).toBe('Turns 2–5');
    expect(wholeTitle('S7 (T7)')).toBe('Turn 7');
  });
});
