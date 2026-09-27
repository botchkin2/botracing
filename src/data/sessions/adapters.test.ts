import {describe, expect, it} from '@jest/globals';

import {toSessionSummary} from './adapters';

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
