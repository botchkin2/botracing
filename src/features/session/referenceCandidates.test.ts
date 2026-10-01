import {describe, expect, it} from '@jest/globals';

import {
  toLaps,
  toSessionDetail,
  toSessionSummary,
} from '@/src/data/sessions/adapters';
import fixture from '@/src/data/sessions/__fixtures__/roadAtlantaGt3.json';

import {
  candidateLine,
  matchText,
  POOL_SESSIONS,
  poolSessions,
  referenceCandidates,
} from './referenceCandidates';

// Two real Road Atlanta GT3 races (A: 44 laps on 25 Sep, B: 22 laps on 26 Sep),
// trimmed to the fields the ranking reads: fuel and VE at the start of each
// lap, tyre readings, flags and times.
const raw = fixture as unknown as Record<
  'raceA' | 'raceB',
  {session: Record<string, unknown> & {id: string}; laps: never[]}
>;
const sessionA = toSessionDetail(raw.raceA.session);
const sessionB = toSessionDetail(raw.raceB.session);
const lapsA = toLaps(raw.raceA.laps);
const lapsB = toLaps(raw.raceB.laps);
const summaryA = toSessionSummary(raw.raceA.session);

describe('poolSessions', () => {
  const s = (id: string, over: Record<string, unknown>) =>
    toSessionSummary({
      id,
      trackId: 'trk',
      car: {name: '911GT3R Custom Team 2025 #397'},
      startedAt: '2026-09-20T12:00:00Z',
      ...over,
    });
  const current = s('now', {});

  it('keeps the same track and car model, newest first, never the session itself', () => {
    const all = [
      s('now', {}),
      s('old', {startedAt: '2026-09-01T12:00:00Z'}),
      s('new', {startedAt: '2026-09-19T12:00:00Z'}),
      s('elsewhere', {trackId: 'other'}),
      s('otherCar', {car: {name: 'Mustang Custom Team 2025 #397'}}),
      // The same model in another livery or number is the same car.
      s('livery', {
        car: {name: '911GT3R Custom Team 2025 #12'},
        startedAt: '2026-09-10T12:00:00Z',
      }),
    ];
    expect(poolSessions(current, all).map(x => x.id)).toEqual([
      'new',
      'livery',
      'old',
    ]);
  });

  it('is capped, so a long history is a bounded fetch', () => {
    const many = Array.from({length: POOL_SESSIONS + 3}, (_, i) =>
      s(`p${i}`, {
        startedAt: `2026-09-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
      }),
    );
    expect(poolSessions(current, many)).toHaveLength(POOL_SESSIONS);
  });
});

describe('referenceCandidates on two real races', () => {
  const pool = [{session: summaryA, laps: lapsA}];

  it('never offers the lap itself, and every candidate is a whole timed lap', () => {
    const target = lapsB[10];
    const out = referenceCandidates(target, sessionB, lapsB, pool);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      expect(c.lapId).not.toBe(target.id);
      expect(c.timeS).toBeGreaterThan(70);
    }
  });

  it('draws from the other session when it matches and the lap’s own session does not', () => {
    // B's lap 11 started on about 49.9 L: A's laps in that band are the
    // matches, all tyres kept and clean, fastest first.
    const out = referenceCandidates(lapsB[10], sessionB, lapsB, pool);
    expect(out.map(c => c.lapId)).toEqual([
      lapsA.find(l => l.lapIndex === 11)!.id,
      lapsA.find(l => l.lapIndex === 13)!.id,
      lapsA.find(l => l.lapIndex === 8)!.id,
    ]);
    expect(out.every(c => c.sessionId === sessionA.id)).toBe(true);
    expect(out.every(c => c.match.fuelBand && c.match.tyresKept)).toBe(true);
    expect(out[0].timeS).toBeLessThan(out[1].timeS);
  });

  it('ranks the lap’s own session in with the pool, on the same keys', () => {
    const out = referenceCandidates(lapsA[20], sessionA, lapsA, [
      {session: toSessionSummary(raw.raceB.session), laps: lapsB},
    ]);
    expect(out[0].sessionId).toBe(sessionA.id);
    expect(out[0].startedAt).toBeNull();
    expect(candidateLine(out[0])).toContain('this session');
  });

  it('still bands the load by Virtual Energy for laps recorded without a fuel level', () => {
    const noFuel = lapsA.map(l => ({
      ...l,
      fuel: l.fuel && {...l.fuel, startL: null},
    }));
    const target = {
      ...lapsB[10],
      fuel: lapsB[10].fuel && {...lapsB[10].fuel, startL: null},
    };
    const out = referenceCandidates(
      target,
      sessionB,
      [],
      [{session: summaryA, laps: noFuel}],
    );
    expect(out.length).toBe(3);
    expect(out.every(c => c.match.fuelBand)).toBe(true);
  });
});

describe('candidate text', () => {
  it('states the lap, session, time and gap, and what matched; no verdict', () => {
    const [c] = referenceCandidates(lapsB[10], sessionB, lapsB, [
      {session: {...summaryA, startedAt: '2026-09-25T12:00:00Z'}, laps: lapsA},
    ]);
    expect(candidateLine(c)).toMatch(
      /^L11 · 25 Sep · Race · 1:20\.743 · −13\.688 s$/,
    );
    expect(matchText(c.match)).toBe(
      'same car · same session type · load in band · tyres kept · on track',
    );
    expect(matchText({...c.match, fuelBand: false, onTrack: false})).toBe(
      'same car · same session type · tyres kept',
    );
  });
});
