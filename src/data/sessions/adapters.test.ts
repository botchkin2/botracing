import {describe, expect, it} from '@jest/globals';

import {toSessionDetail, toSessionSummary, toTrackMap} from './adapters';
import {trackCorners} from './corners';

// Shape as served by GET /api/lmu/sessions on 2026-09-27.
const raw = {
  id: 'fd111c3353f7bcad',
  sim: 'lmu',
  trackId: 'lmu-daytona_international_speedway_road_course',
  track: {
    name: 'Daytona International Speedway',
    variant: 'Daytona International Speedway Road Course',
  },
  car: {name: 'Manthey DK Engineering 2026 #91:LM', class: 'GT3'},
  sessionType: 'Qualify',
  startedAt: '2026-09-26T03:20:57Z',
  lapCount: 2,
  comparableCount: 0,
  bestLapTime: null,
  medianLapTime: 101.5,
  updatedAt: '2026-09-27T20:02:17.985Z',
};

describe('toSessionSummary', () => {
  it('reads names from track and car objects', () => {
    const s = toSessionSummary(raw);
    expect(s.track).toBe('Daytona International Speedway');
    expect(s.car).toBe('Manthey DK Engineering 2026 #91:LM');
  });
  it('maps Race/Qualify/Practice to R/Q/P and keeps nulls', () => {
    const s = toSessionSummary(raw);
    expect(s.sessionType).toBe('Q');
    expect(s.bestTimeS).toBeNull();
    expect(s.medianTimeS).toBe(101.5);
  });
});

describe('toSessionDetail', () => {
  it('carries the field pointer, null when the session has none', () => {
    expect(toSessionDetail(raw).field).toBeNull();
    const d = toSessionDetail({
      ...raw,
      field: {hash: 'abc123def456', hz: 5, cars: 62, durationS: 931},
    });
    expect(d.field?.hash).toBe('abc123def456');
  });

  it('takes the stint trend from consistency.stints, null when absent', () => {
    const d = toSessionDetail({
      ...raw,
      stints: [{n: 1}, {n: 2}],
      consistency: {stints: [{n: 2, trendPerLap: 0.042}]},
    });
    expect(d.stints.map(s => s.trendSPerLap)).toEqual([null, 0.042]);
  });
});

describe('toTrackMap official turn labels', () => {
  const corners = [1, 2].map(n => ({
    n,
    entryM: n * 100,
    apexM: n * 100 + 50,
    exitM: n * 100 + 90,
    parts: [],
  }));
  const plain = (extra: Record<string, unknown>) =>
    toTrackMap({lengthM: 1000, corners, ...extra});

  it('carries the official label where tracks.json has one, and only there', () => {
    // Road Atlanta: the app's 7 and 8 are two parts of T7; 9, 10 and 11 are T10a, T10b and T12.
    const m = toTrackMap({
      trackId: 'lmu-michelin_raceway_road_atlanta',
      lengthM: 4000,
      corners: [1, 7, 8, 9, 10, 11].map(n => ({
        n,
        entryM: n * 100,
        apexM: n * 100 + 50,
        exitM: n * 100 + 90,
        parts: [],
      })),
    });
    expect(m.sections.map(s => s.official)).toEqual([
      undefined,
      'T7 entry',
      'T7',
      'T10a',
      'T10b',
      'T12',
    ]);
    expect(trackCorners(m).map(c => c.official)).toEqual([
      undefined,
      'T7 entry',
      'T7',
      'T10a',
      'T10b',
      'T12',
    ]);
  });

  it('leaves other tracks and missing ids as the app numbers them', () => {
    expect(
      plain({trackId: 'lmu-nowhere'}).sections[0].official,
    ).toBeUndefined();
    expect(plain({}).sections[1].official).toBeUndefined();
  });

  it('names a section range by its first and last official label', () => {
    const m = toTrackMap({
      trackId: 'lmu-michelin_raceway_road_atlanta',
      lengthM: 4000,
      corners: [
        {
          n: 5,
          entryM: 3300,
          apexM: 3520,
          exitM: 4000,
          parts: [9, 10, 11].map(n => ({
            n,
            entryM: 3300,
            apexM: 3520,
            exitM: 4000,
          })),
        },
      ],
    });
    expect(trackCorners(m)[0].sectionLabel).toBe('S5 (T10a–T12)');
  });
});
