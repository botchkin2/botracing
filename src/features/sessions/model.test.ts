import {describe, expect, it} from '@jest/globals';
import {type SessionSummary} from '@/src/data/sessions';

import {buildSessionsModel} from './model';

const session = (over: Partial<SessionSummary>): SessionSummary => ({
  id: 's1',
  sim: 'lmu',
  trackId: 'portimao',
  track: 'Michelin Raceway Road Atlanta',
  car: 'Manthey DK Engineering 2026 #91:LM',
  sessionType: 'R',
  startedAt: '2026-09-27T21:40:00',
  lapCount: 42,
  comparableCount: 38,
  bestTimeS: 99.733,
  medianTimeS: 101.123,
  bestLapId: null,
  series: null,
  eventId: null,
  updatedAt: '2026-09-27T23:00:00Z',
  ...over,
});

describe('buildSessionsModel', () => {
  const now = new Date('2026-09-27T23:00:00');

  it('groups by local day, newest first, with Today and Yesterday titles', () => {
    const days = buildSessionsModel(
      [
        session({id: 'old', startedAt: '2026-09-26T10:00:00'}),
        session({id: 'new', startedAt: '2026-09-27T21:40:00'}),
      ],
      now,
    );
    expect(days.map(d => d.title)).toEqual(['Today', 'Yesterday']);
    expect(days[0].rows[0].id).toBe('new');
  });

  it('formats the row per the handoff', () => {
    const [row] = buildSessionsModel([session({})], now)[0].rows;
    expect(row).toMatchObject({
      badge: 'R',
      track: 'Road Atlanta',
      subline: '21:40 · 911 GT3 R · Manthey #91',
      laps: '42',
      best: '1:39.733',
      median: '1:41.123',
    });
  });

  it('shows a dash when a session has no timed lap', () => {
    const [row] = buildSessionsModel(
      [session({bestTimeS: null, medianTimeS: null})],
      now,
    )[0].rows;
    expect(row.best).toBe('—');
    expect(row.median).toBe('—');
  });
});
