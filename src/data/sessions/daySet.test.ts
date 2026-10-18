import {describe, expect, it} from '@jest/globals';

import {toLaps} from './adapters';
import {
  dayLapId,
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
  current = true,
) => ({
  sessionId: sid,
  current,
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
    expect([
      ...(daySlowIds([session('a', steady), lone]) as Set<string>),
    ]).toEqual(['b~b2']);
  });

  it('waits (null) when a member was analysed under other rules', () => {
    expect(
      daySlowIds([
        session('a', steady),
        session('b', [100, 101, 102], {}, false),
      ]),
    ).toBeNull();
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
      current: true,
      laps: toLaps([
        ...steady.map((t, i) => raw(`a${i}`, 1, i, t)),
        raw('x', 1, 8, 130, {reasons: ['pit-out'], comparable: false}),
      ]),
    };
    expect(daySlowIds([reasoned])).toEqual(new Set());
    const plain = session('a', [...steady, 130]);
    expect([...(daySlowIds([plain]) as Set<string>)]).toEqual(['a~a8']);
  });

  it('sections count only when every lap was cut at the same boundaries, else the day is lap time only', () => {
    const rev = (sid: string, r: number) => ({
      sessionId: sid,
      current: true,
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
      current: true,
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

describe('dayLapIds', () => {
  it('opens on every candidate lap that is not slow in the day, across stints', () => {
    const ids = dayLapIds([
      session('a', steady),
      session('b', [100, 100.1, 107]),
    ]) as string[];
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain('b~b2');
    expect(ids).toContain('b~b0');
  });

  it('is null while a member awaits re-analysis and empty under two laps', () => {
    expect(dayLapIds([session('a', [100, 101], {}, false)])).toBeNull();
    expect(dayLapIds([session('a', [100])])).toEqual([]);
  });
});
