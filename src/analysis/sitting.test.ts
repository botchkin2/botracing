import {describe, expect, it} from '@jest/globals';

import {SITTING_GAP_MS, sittingOf, sittings, type SittingItem} from './sitting';

const H = 3_600_000;
const T0 = Date.parse('2026-10-15T00:00:00Z');
const at = (h: number) => new Date(T0 + h * H).toISOString();
const s = (
  id: string,
  startH: number,
  endH: number | null,
  over: Partial<SittingItem> = {},
): SittingItem => ({
  id,
  trackId: 'silverstone',
  carModel: '911 GT3 R',
  sessionType: 'P',
  startedAt: at(startH),
  endedAt: endH == null ? null : at(endH),
  ...over,
});

describe('sittings', () => {
  it('joins sessions that start within 3 h of the previous end, in start order', () => {
    expect(SITTING_GAP_MS).toBe(3 * H);
    const out = sittings([s('c', 3.3, 3.8), s('a', 0, 0.5), s('b', 0.6, 1)]);
    expect(out.map(set => set.map(x => x.id))).toEqual([['a', 'b', 'c']]);
  });

  it('an overnight gap splits them, and a lone session is no sitting', () => {
    const out = sittings([
      s('a', 0, 0.5),
      s('b', 0.7, 1.2),
      s('c', 20, 21), // the next evening, 18.8 h after b
    ]);
    expect(out.map(set => set.map(x => x.id))).toEqual([['a', 'b']]);
  });

  it('measures the gap from the latest end so far, not the last start', () => {
    // b is long (to 5 h); c starts 3.5 h after a's end but only 0.5 h after b's.
    const out = sittings([s('a', 0, 1), s('b', 1.2, 5), s('c', 5.5, 6)]);
    expect(out[0].map(x => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps track, car and type apart, and never joins a race', () => {
    const out = sittings([
      s('p1', 0, 0.5),
      s('p2', 0.6, 1),
      s('q1', 1.1, 1.5, {sessionType: 'Q'}),
      s('other-car', 1.2, 1.6, {carModel: 'Hypercar'}),
      s('other-track', 1.2, 1.6, {trackId: 'daytona'}),
      s('r1', 0, 1, {sessionType: 'R'}),
      s('r2', 1.1, 2, {sessionType: 'R'}),
    ]);
    expect(out.map(set => set.map(x => x.id))).toEqual([['p1', 'p2']]);
  });

  it('a session with no end ends where it started; one with no readable start is left out', () => {
    expect(sittings([s('a', 0, null), s('b', 2.9, null)])).toHaveLength(1);
    expect(sittings([s('a', 0, null), s('b', 3.1, null)])).toHaveLength(0);
    expect(
      sittings([s('a', 0, 1), {...s('b', 1, 2), startedAt: 'not a date'}]),
    ).toHaveLength(0);
  });

  it('sittingOf finds the one a session is in', () => {
    const items = [s('a', 0, 0.5), s('b', 0.6, 1), s('z', 30, 31)];
    expect(sittingOf(items, 'b')?.map(x => x.id)).toEqual(['a', 'b']);
    expect(sittingOf(items, 'z')).toBeNull();
    expect(sittingOf(items, 'missing')).toBeNull();
  });
});
