import {describe, expect, it, jest} from '@jest/globals';

// Adapters are internal to data/; tests reach them to build real shapes.
import {toLaps, toTrackMap} from '@/src/data/sessions/adapters';

import {buildSectionWindow, isCurrent} from './sectionWindow';

// S1 = T1 alone; S2 = a bus stop: T2, T3, T4 in one window. Boundaries tile
// 0 to 1000 with a start straight before T1.
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
        {n: 2, turnInM: 560, fromM: 500, toM: 620},
        {n: 3, turnInM: 640, fromM: 620, toM: 760},
        {n: 4, turnInM: 780, fromM: 760, toM: 1000},
      ],
    },
  ],
};

const map = (b: unknown = boundaries) =>
  toTrackMap({
    lengthM: 1000,
    boundaries: b,
    corners: [
      {n: 1, entryM: 200, apexM: 250, exitM: 300, parts: []},
      {
        n: 2,
        entryM: 520,
        apexM: 600,
        exitM: 760,
        parts: [
          {n: 2, entryM: 520, apexM: 580, exitM: 620},
          {n: 3, entryM: 620, apexM: 660, exitM: 760},
          {n: 4, entryM: 760, apexM: 820, exitM: 900},
        ],
      },
    ],
    outline: {features: []},
  });

const windowFacts = (over: Record<string, unknown> = {}) => ({
  fromM: 500,
  toM: 1000,
  runInS: 2,
  cornerS: 6,
  exitS: 4,
  onsetM: 530,
  onsetSpeedKmh: 280,
  fullThrottleSpeedKmh: 120,
  endSpeedKmh: 250,
  minSpeedAtM: 660,
  minSpeedPart: 3,
  pit: false,
  ...over,
});

const section2 = (over: Record<string, unknown> = {}, time = 12) => ({
  segTime: time,
  minSpeedKmh: 70,
  ...windowFacts(over),
  brakeApps: [
    {onsetM: 530, peakPct: 92.4, part: 2},
    {onsetM: 640, peakPct: 61, part: 3},
  ],
  parts: [],
});

const rawLap = (
  id: string,
  facts: Record<string, unknown> | null,
  stamp: unknown = {v: 1, rev: 3},
) => ({
  id,
  lapTime: 100,
  comparable: true,
  reasons: [],
  cornerBoundaries: stamp,
  corners: [{segTime: 5, parts: []}, ...(facts ? [facts] : [])],
});

const lapsOf = (...raw: ReturnType<typeof rawLap>[]) => toLaps(raw);

describe('toTrackMap boundaries', () => {
  it('reads the windows, with the start straight and parts', () => {
    const b = map().boundaries;
    expect(b?.rev).toBe(3);
    expect(b?.windows.map(w => [w.kind, w.section, w.fromM, w.toM])).toEqual([
      ['start-straight', null, 0, 150],
      ['section', 1, 150, 500],
      ['section', 2, 500, 1000],
    ]);
    expect(b?.windows[2].parts.map(p => p.n)).toEqual([2, 3, 4]);
  });

  it('is null without a block or with a window missing its edges', () => {
    expect(map(null).boundaries).toBeNull();
    expect(
      map({v: 1, rev: 1, windows: [{kind: 'section', fromM: 1}]}).boundaries,
    ).toBeNull();
  });
});

describe('buildSectionWindow', () => {
  const m = map();

  it('is null without boundaries or for a section the track does not have', () => {
    const laps = lapsOf(rawLap('a', section2()));
    expect(buildSectionWindow({map: map(null), sectionN: 2, laps})).toBeNull();
    expect(buildSectionWindow({map: m, sectionN: 9, laps})).toBeNull();
  });

  it('labels the compound section by its corners and offers the parts', () => {
    const w = buildSectionWindow({
      map: m,
      sectionN: 2,
      laps: lapsOf(rawLap('a', section2())),
    });
    expect(w?.label).toBe('S2 (T2–4)');
    expect(w?.parts.map(p => [p.label, p.fromM, p.toM])).toEqual([
      ['T2', 500, 620],
      ['T3', 620, 760],
      ['T4', 760, 1000],
    ]);
  });

  it('reads the split and gaps against the picked Ref, and the four speeds', () => {
    const w = buildSectionWindow({
      map: m,
      sectionN: 2,
      refId: 'a',
      laps: lapsOf(
        rawLap('a', section2()),
        rawLap('b', section2({runInS: 2.1, cornerS: 5.8, exitS: 4.2}, 12.1)),
      ),
    });
    const [a, b] = w?.rows ?? [];
    expect(a.time).toEqual({value: '12.000', gap: null, better: false});
    expect(b.time).toEqual({value: '12.100', gap: '+0.100', better: false});
    expect(b.runIn.gap).toBe('+0.100');
    expect(b.corner).toEqual({value: '5.800', gap: '−0.200', better: true});
    expect(b.exit.gap).toBe('+0.200');
    expect(a.speeds).toEqual({
      onset: '280 km/h',
      min: '70 km/h in T3',
      fullThrottle: '120 km/h',
      end: '250 km/h',
    });
  });

  it('lists the brake applications by the corner each is for, to that corner apex', () => {
    const w = buildSectionWindow({
      map: m,
      sectionN: 2,
      laps: lapsOf(rawLap('a', section2())),
    });
    expect(w?.rows[0].brakes).toEqual([
      {label: 'Brake 1', onset: '50 m before T2', peak: '92 %', part: 'T2'},
      {label: 'Brake 2', onset: '20 m before T3', peak: '61 %', part: 'T3'},
    ]);
  });

  it('never compares a lap cut at other boundaries: re-analysis pending', () => {
    const w = buildSectionWindow({
      map: m,
      sectionN: 2,
      laps: lapsOf(
        rawLap('a', section2()),
        rawLap('old', section2(), {v: 1, rev: 2}),
        rawLap('none', null, null),
      ),
    });
    expect(w?.rows.map(r => r.state)).toEqual(['ok', 'stale', 'stale']);
    expect(w?.rows[1].time.value).toBe('—');
    expect(w?.rows[1].time.gap).toBeNull();
    expect(w?.pendingCount).toBe(2);
  });

  it('a Ref that is stale is no basis: the comparable laps are measured against their median', () => {
    const w = buildSectionWindow({
      map: m,
      sectionN: 2,
      refId: 'old',
      laps: lapsOf(
        rawLap('old', section2(), {v: 1, rev: 2}),
        rawLap('b', section2()),
      ),
    });
    expect(w?.rows[0].state).toBe('stale');
    expect(w?.rows[1].state).toBe('ok');
    // The one comparable lap is its own median: a zero gap (±0.000), not a gap to the stale lap.
    expect(w?.rows[1].time.gap).toBe('±0.000');
  });

  it('greys only the window the pit lane crosses, showing what it measured without a gap', () => {
    const w = buildSectionWindow({
      map: m,
      sectionN: 2,
      laps: lapsOf(
        rawLap('a', section2()),
        rawLap(
          'p',
          section2({pit: true, runInS: 10, cornerS: 12, exitS: 8}, 30),
        ),
      ),
    });
    expect(w?.rows[1].state).toBe('pit');
    expect(w?.rows[1].time).toEqual({
      value: '30.000',
      gap: null,
      better: false,
    });
    expect(w?.pendingCount).toBe(0);
  });

  it('says on the card when the reference cannot be compared, and who it is', () => {
    const stale = buildSectionWindow({
      map: m,
      sectionN: 2,
      laps: lapsOf(
        rawLap('old', section2(), {v: 1, rev: 2}),
        rawLap('b', section2()),
      ),
    });
    expect(stale?.referenceNote).toBe(
      'Reference L1 is pending re-analysis; no gaps.',
    );
    const pit = buildSectionWindow({
      map: m,
      sectionN: 2,
      laps: lapsOf(rawLap('p', section2({pit: true})), rawLap('b', section2())),
    });
    expect(pit?.referenceNote).toBe(
      'Reference L1 crosses the pit lane here; no gaps.',
    );
    const ok = buildSectionWindow({
      map: m,
      sectionN: 2,
      laps: lapsOf(rawLap('a', section2()), rawLap('b', section2())),
    });
    expect(ok?.referenceNote).toBeNull();
  });

  it('a split that does not add up to the window time is a stored-data fault: pending, and named', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const w = buildSectionWindow({
      map: m,
      sectionN: 2,
      laps: lapsOf(rawLap('bad', section2({cornerS: 6.5}))),
    });
    expect(w?.rows[0].state).toBe('stale');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('does not add up to segTime');
    warn.mockRestore();
  });

  it('a brake application with no part reads against the section apex', () => {
    const w = buildSectionWindow({
      map: m,
      sectionN: 2,
      laps: lapsOf(
        rawLap('a', {
          ...section2(),
          brakeApps: [{onsetM: 500, peakPct: 80, part: null}],
        }),
      ),
    });
    expect(w?.rows[0].brakes[0].onset).toBe('100 m before the apex');
  });
});

describe('isCurrent', () => {
  it('needs the same version and revision as the map', () => {
    const b = map().boundaries;
    if (!b) throw new Error('no boundaries');
    const laps = lapsOf(
      rawLap('a', null),
      rawLap('b', null, {v: 1, rev: 1}),
      rawLap('c', null, null),
    );
    expect(laps.map(l => isCurrent(l, b))).toEqual([true, false, false]);
  });
});

describe('buildSectionWindow optimum', () => {
  const m = map();
  // Six laps in stint 1: window times 12.0 to 12.5 (S2 is the section in `section2`).
  const sixLaps = () =>
    lapsOf(
      ...[0, 1, 2, 3, 4, 5].map(i =>
        rawLap(`l${i}`, section2({exitS: 4 + i * 0.1}, 12 + i * 0.1)),
      ),
    );

  it('shows the window best, median and gap over the session laps, with n', () => {
    const laps = sixLaps();
    const w = buildSectionWindow({
      map: m,
      sectionN: 2,
      laps: laps.slice(0, 1),
      sessionLaps: laps,
    });
    expect(w?.optimum).toEqual([
      {
        label: 'Stint 1',
        n: '6 laps',
        best: '12.000',
        bestLap: 'L1',
        median: '12.250',
        gap: '+0.250',
      },
    ]);
  });

  it('is empty under 5 laps', () => {
    const laps = sixLaps().slice(0, 4);
    expect(buildSectionWindow({map: m, sectionN: 2, laps})?.optimum).toEqual(
      [],
    );
  });
});
