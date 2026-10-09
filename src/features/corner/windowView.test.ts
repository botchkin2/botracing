import {describe, expect, it} from '@jest/globals';

// Adapters are internal to data/; tests reach them to build real shapes.
import {
  toLaps,
  toSessionDetail,
  toTrackMap,
} from '@/src/data/sessions/adapters';
import {trackCorners} from '@/src/data/sessions';

import {buildCornerModel, sectionChips} from './model';
import {windowCaption} from './stretch';

const session = toSessionDetail({
  id: 's1',
  sim: 'lmu',
  track: {name: 'Test Ring'},
  car: {name: 'Manthey DK Engineering 2026 #91:LM'},
  sessionType: 'Race',
  startedAt: '2026-09-26T00:00:00Z',
  stints: [],
});

// S1 = T1; S2 = a bus stop: T2 and T3 in one window. Boundaries tile 0 to
// 1000, the start straight first.
const boundaries = {
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
};

const mapWith = (b: unknown) =>
  toTrackMap({
    lengthM: 1000,
    boundaries: b,
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

const rawLap = (id: string, stamp: unknown) => ({
  id,
  lapTime: 100,
  comparable: true,
  reasons: [],
  cornerBoundaries: stamp,
  corners: [
    {segTime: 5, parts: []},
    {
      segTime: 12,
      fromM: 500,
      toM: 1000,
      runInS: 2,
      cornerS: 6,
      exitS: 4,
      brakeApps: [],
      parts: [
        {segTime: 5, fromM: 500, toM: 700, runInS: 1, cornerS: 3, exitS: 1},
        {segTime: 7, fromM: 700, toM: 1000, runInS: 1, cornerS: 3, exitS: 3},
      ],
    },
  ],
});

const build = (
  m: ReturnType<typeof mapWith>,
  stamp: unknown,
  corner: number,
) => {
  const laps = toLaps([rawLap('a', stamp), rawLap('b', stamp)]);
  return buildCornerModel({
    session,
    laps,
    map: m,
    band: null,
    traces: new Map(),
    lapIds: ['a', 'b'],
    keyLapIds: ['a', 'b'],
    hl: null,
    corner,
  });
};

describe('sectionChips', () => {
  const all = trackCorners(mapWith(boundaries));

  it('is one chip per section, a compound one named by its corners', () => {
    const {sections} = sectionChips(all, all[0]);
    expect(sections.map(s => [s.label, s.firstCorner, s.selected])).toEqual([
      ['T1', 1, true],
      ['S2 (T2–T3)', 2, false],
    ]);
  });

  it('offers the parts of the current compound section to drill into', () => {
    const {sections, parts} = sectionChips(all, all[2]);
    expect(sections.map(s => s.selected)).toEqual([false, true]);
    expect(parts).toEqual([
      {n: 2, label: 'T2', selected: false},
      {n: 3, label: 'T3', selected: true},
    ]);
  });

  it('has no parts row for a single corner', () => {
    expect(sectionChips(all, all[0]).parts).toEqual([]);
  });
});

describe('windowCaption', () => {
  const zoom: [number, number] = [350, 750];

  it('names the shaded window and what is in view', () => {
    expect(
      windowCaption(
        'T3',
        {fromM: 700, toM: 740},
        {fromM: 700, toM: 740},
        [{label: 'T2', lapM: 580}],
        zoom,
      ),
    ).toBe('Shaded: T3 · also in view: T2');
  });

  it('says where a window runs past the drawn stretch, so the edge is not its end', () => {
    expect(
      windowCaption(
        'T10',
        {fromM: 3900, toM: 4300},
        {fromM: 700, toM: 1100},
        [],
        zoom,
      ),
    ).toBe('Shaded: T10 · window continues later, not drawn');
    expect(
      windowCaption(
        'T1',
        {fromM: 100, toM: 500},
        {fromM: 100, toM: 500},
        [],
        zoom,
      ),
    ).toContain('window starts earlier, not drawn');
  });
});

describe('the Corner model with windows', () => {
  const m = mapWith(boundaries);

  it('shades the part’s own window and anchors the delta at its start', () => {
    const model = build(m, {v: 1, rev: 3}, 3)!;
    expect(model.zoom.stretch).toEqual({fromM: 700, toM: 1000});
    expect(model.zoom.caption).toMatch(/^Shaded: T3/);
    expect(model.sections.map(s => s.label)).toEqual(['T1', 'S2 (T2–T3)']);
    expect(model.parts.map(p => p.label)).toEqual(['T2', 'T3']);
  });

  it('draws a part’s delta from its section’s start, and says so', () => {
    const t3 = build(m, {v: 1, rev: 3}, 3)!;
    // T3 starts at 700 inside S2 (500 → 1000): laps share speed at 500, and
    // the charts run back to it (the slice is cut from the section's start).
    expect(t3.zoom.stretch.fromM).toBe(700);
    expect(t3.zoom.deltaFromM).toBe(500);
    expect(t3.zoom.windowM[0]).toBeLessThanOrEqual(500);
    expect(t3.zoom.caption).toContain('delta from the start of S2');
    expect(t3.zoom.caption).not.toContain('not drawn');
    // The first part starts where its section does: nothing to add.
    const t2 = build(m, {v: 1, rev: 3}, 2)!;
    expect(t2.zoom.deltaFromM).toBe(t2.zoom.stretch.fromM);
    expect(t2.zoom.caption).not.toContain('delta from');
    // A single corner is unchanged.
    const t1 = build(m, {v: 1, rev: 3}, 1)!;
    expect(t1.zoom.deltaFromM).toBe(t1.zoom.stretch.fromM);
  });

  it('reads a one-corner section as a corner, though the stored map gives it a parts array', () => {
    const one = toTrackMap({
      lengthM: 1000,
      boundaries,
      corners: [
        {
          n: 1,
          entryM: 200,
          apexM: 250,
          exitM: 300,
          parts: [{n: 1, entryM: 200, apexM: 250, exitM: 300}],
        },
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
    const t1 = build(one, {v: 1, rev: 3}, 1)!;
    expect(t1.parts).toEqual([]);
    expect(build(one, {v: 1, rev: 3}, 2)!.parts.map(p => p.label)).toHaveLength(
      2,
    );
  });

  it('keeps the old stretch for laps cut at other boundaries', () => {
    const model = build(m, {v: 1, rev: 2}, 3)!;
    expect(model.zoom.caption).toMatch(/^Shaded: T3 · also in view/);
    expect(model.zoom.stretch.fromM).toBe(700);
  });

  it('keeps the old stretch for a track with no boundaries', () => {
    const model = build(mapWith(null), null, 3)!;
  });
});
