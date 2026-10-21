import {describe, expect, it} from '@jest/globals';

import {toLaps} from './adapters';
import {
  dayLapId,
  dayBestLapId,
  dayLapIds,
  daySlowIds,
  dayUsesSections,
  mergeDayLaps,
} from './daySet';

const stamp = {v: 1, rev: 3};
const raw = (
  id: string,
  stint: number,
  stintLap: number,
  timeS: number,
  over: Record<string, unknown> = {},
) => ({
  id,
  lapTime: timeS,
  stint,
  stintLap,
  comparable: true,
  reasons: [],
  cornerBoundaries: stamp,
  startStraight: {segTime: 5, fromM: 0, toM: 100, pit: false},
  corners: [
    {segTime: timeS * 0.5 - 5, fromM: 100, toM: 600, pit: false},
    {segTime: timeS * 0.5, fromM: 600, toM: 1000, pit: false},
  ],
  ...over,
});

// A session of one stint, one lap per time.
const session = (
  sid: string,
  times: number[],
  over: Record<string, unknown> = {},
) => ({
  sessionId: sid,
  race: false,
  laps: toLaps(times.map((t, i) => raw(`${sid}${i}`, 1, i, t, over))),
});

const steady = [100, 100.1, 99.9, 100.05, 100.1, 99.95, 100, 100.1];

describe('mergeDayLaps', () => {
  it('ids as Compare writes them, a stint per session, lap numbers running on', () => {
    const out = mergeDayLaps([session('a', [100, 101]), session('b', [100])]);
    expect(out.map(l => l.id)).toEqual(['a~a0', 'a~a1', 'b~b0']);
    expect(out.map(l => l.stint)).toEqual([1, 1, 2]);
    expect(out.map(l => l.lapIndex)).toEqual([1, 2, 3]);
    expect(dayLapId('a', 'a0')).toBe('a~a0');
  });
});

describe('daySlowIds', () => {
  it('a 3-lap session judges nothing alone, and is judged inside its day', () => {
    const lone = session('b', [100, 100.1, 107]);
    // Alone: under MIN_EVENT_LAPS laps, nothing is slow (the uploader's rule).
    expect(daySlowIds([lone])).toEqual(new Set());
    expect([...daySlowIds([session('a', steady), lone])]).toEqual(['b~b2']);
  });

  it('a member with five or more judged laps keeps its own verdict: the day never calls clean what its session calls slow', () => {
    // Session a zigzags by several seconds, so the day's limit is wide. Session
    // b is tight with one lap 0.9 s off: slow alone.
    const loose = session(
      'a',
      [100, 101, 99, 102, 98, 103, 97, 104, 96, 105, 95, 106],
    );
    const six = session('b', [100, 100.05, 99.95, 100.02, 99.98, 100.9]);
    expect(daySlowIds([six]).has('b~b5')).toBe(true);
    // Five or more laps: its own verdict stands inside the day.
    expect(daySlowIds([loose, six]).has('b~b5')).toBe(true);
    // Under five laps it judges nothing alone and is judged by the day's wide
    // limit: the same 0.9 s lap reads clean there.
    const four = session('b', [100, 100.05, 99.95, 100.9]);
    expect(daySlowIds([four]).size).toBe(0);
    expect(daySlowIds([loose, four]).has('b~b3')).toBe(false);
  });

  it('a stint is a session: a lap is judged against its own session curve, not another session’s', () => {
    // Session b is 3 s slower all through; its curve is its own, so its laps
    // are not slow, and the day limit is still the day's.
    const slowerDay = session(
      'b',
      steady.map(t => t + 3),
    );
    expect(daySlowIds([session('a', steady), slowerDay])).toEqual(new Set());
  });

  it('leaves out laps with a stored reason other than slow', () => {
    const reasoned = {
      sessionId: 'a',
      race: false,
      laps: toLaps([
        ...steady.map((t, i) => raw(`a${i}`, 1, i, t)),
        raw('x', 1, 8, 130, {reasons: ['pit-out'], comparable: false}),
      ]),
    };
    expect(daySlowIds([reasoned])).toEqual(new Set());
    const plain = session('a', [...steady, 130]);
    expect([...daySlowIds([plain])]).toEqual(['a~a8']);
  });

  it('sections count only when every lap was cut at the same boundaries, else the day is lap time only', () => {
    const rev = (sid: string, r: number) => ({
      sessionId: sid,
      race: false,
      laps: toLaps(
        steady.map((t, i) =>
          raw(`${sid}${i}`, 1, i, t, {cornerBoundaries: {v: 1, rev: r}}),
        ),
      ),
    });
    expect(dayUsesSections([rev('a', 3), rev('b', 3)])).toBe(true);
    expect(dayUsesSections([rev('a', 3), rev('b', 4)])).toBe(false);
    // A member with no windows at all (cut before them) is the same: no sections.
    const bare = {
      sessionId: 'c',
      race: false,
      laps: toLaps(
        steady.map((t, i) => raw(`c${i}`, 1, i, t, {cornerBoundaries: null})),
      ),
    };
    expect(dayUsesSections([rev('a', 3), bare])).toBe(false);
    // The pit and the slow laps do not decide: only the judged laps are compared.
    const pit = session('p', [100], {
      pitIn: true,
      cornerBoundaries: {v: 9, rev: 9},
    });
    expect(dayUsesSections([rev('a', 3), pit])).toBe(true);
  });
});

describe('dayBestLapId', () => {
  it('is the fastest comparable lap of the merged day, null with none', () => {
    const laps = mergeDayLaps([
      session('a', [101, 100.5, 102]),
      session('b', [100.2, 103]),
    ]);
    expect(dayBestLapId(laps)).toBe('b~b0');
    expect(dayBestLapId([])).toBeNull();
  });
});

describe('dayLapIds', () => {
  it('opens on every candidate lap that is not slow in the day, across stints', () => {
    const ids = dayLapIds([
      session('a', steady),
      session('b', [100, 100.1, 107]),
    ]);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain('b~b2');
    expect(ids).toContain('b~b0');
  });

  it('is empty under two laps', () => {
    expect(dayLapIds([session('a', [100])])).toEqual([]);
  });
});
