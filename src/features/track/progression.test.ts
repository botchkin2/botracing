import {describe, expect, it} from '@jest/globals';

import type {PlanSession} from '@/src/data/sessions/planBlock';

import {MIN_BAR_LAPS, progressionLanes} from './progression';

const session = (
  id: string,
  sessionType: PlanSession['sessionType'],
  startedAt: string,
  endedAt: string | null,
  paceSetS: number[] | null,
): PlanSession => ({id, sessionType, startedAt, endedAt, paceSetS, plan: null});

const laps = (n: number, base = 121) =>
  Array.from({length: n}, (_, i) => base + i * 0.1);

describe('progressionLanes', () => {
  it('keeps practice and race in their own lanes, P before R, and never pools a race', () => {
    const lanes = progressionLanes([
      session('r2', 'R', '2026-10-15T19:00:00Z', '2026-10-15T20:00:00Z', laps(30)),
      session('r1', 'R', '2026-10-15T18:00:00Z', '2026-10-15T18:50:00Z', laps(30)),
      session('p1', 'P', '2026-10-15T16:00:00Z', '2026-10-15T17:00:00Z', laps(10)),
    ]);
    expect(lanes.map(l => l.type)).toEqual(['P', 'R']);
    expect(lanes[1].dots.map(d => d.ids)).toEqual([['r1'], ['r2']]);
  });

  it("a single session's dot is its stored opening set: the Session screen's median", () => {
    const set = [121.9, 121.2, 121.49, 121.6, 121.3];
    const [lane] = progressionLanes([
      session('r', 'R', '2026-10-15T18:00:00Z', null, set),
    ]);
    expect(lane.dots[0]).toEqual({
      ids: ['r'],
      startedAt: '2026-10-15T18:00:00Z',
      laps: 5,
      medianS: 121.49,
      p10S: expect.closeTo(121.24, 6),
      p90S: expect.closeTo(121.78, 6),
    });
  });

  it("a sitting is one dot over its members' laps", () => {
    const [lane] = progressionLanes([
      session('a', 'P', '2026-10-14T17:00:00Z', '2026-10-14T17:40:00Z', laps(10, 122)),
      session('b', 'P', '2026-10-14T18:00:00Z', '2026-10-14T18:30:00Z', laps(10, 121)),
      session('c', 'P', '2026-10-14T19:00:00Z', '2026-10-14T19:30:00Z', laps(11, 120)),
    ]);
    expect(lane.dots).toHaveLength(1);
    expect(lane.dots[0].ids).toEqual(['a', 'b', 'c']);
    expect(lane.dots[0].laps).toBe(31);
  });

  it('a sitting across midnight UTC stays one dot; a gap over 3 h starts the next', () => {
    const [lane] = progressionLanes([
      session('late', 'P', '2026-10-14T23:10:00Z', '2026-10-14T23:55:00Z', laps(8)),
      session('past', 'P', '2026-10-15T00:20:00Z', '2026-10-15T01:00:00Z', laps(8)),
      session('next', 'P', '2026-10-15T18:00:00Z', '2026-10-15T19:00:00Z', laps(8)),
    ]);
    expect(lane.dots.map(d => d.ids)).toEqual([['late', 'past'], ['next']]);
  });

  it(`under ${MIN_BAR_LAPS} laps the dot is hollow: a median, no bar`, () => {
    const [lane] = progressionLanes([
      session('q', 'Q', '2026-10-15T15:00:00Z', null, [100, 101]),
    ]);
    expect(lane.dots[0]).toMatchObject({laps: 2, medianS: 100.5, p10S: null, p90S: null});
  });

  it('a session with no stored set is left out and does not bridge a sitting', () => {
    const lanes = progressionLanes([
      session('a', 'P', '2026-10-14T10:00:00Z', '2026-10-14T11:00:00Z', laps(5)),
      session('old', 'P', '2026-10-14T13:00:00Z', '2026-10-14T15:00:00Z', null),
      session('b', 'P', '2026-10-14T17:00:00Z', '2026-10-14T18:00:00Z', laps(5)),
      session('none', 'R', '2026-10-14T20:00:00Z', null, []),
    ]);
    expect(lanes.map(l => l.type)).toEqual(['P']);
    expect(lanes[0].dots.map(d => d.ids)).toEqual([['a'], ['b']]);
  });
});
