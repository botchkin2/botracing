// Roadmap 6b, the case Botkin hits (torsion #5216 4): the app opened with no
// signal after the car. The Sessions list kept from the last run comes back
// from the stored snapshot, its refetch fails for want of a network, and the
// screen lists the drives with the time they were read, not an error.
import {describe, expect, it} from '@jest/globals';
import {QueryClient} from '@tanstack/react-query';

import {restoreSnapshot, snapshotOf} from '@/src/data/queryPersist';
import {sessionKeys, type SessionSummary} from '@/src/data/sessions';

import {NO_FILTER, listQuery} from './filter';
import {sessionsModelOf} from './model';

const row: SessionSummary = {
  id: 's1',
  sim: 'lmu',
  trackId: 'lmu-michelin_raceway_road_atlanta',
  track: 'Michelin Raceway Road Atlanta',
  car: 'Porsche 911 GT3 R',
  carClass: 'GT3',
  sessionType: 'R',
  startedAt: '2026-10-13T23:15:00Z',
  endedAt: null,
  online: null,
  lapCount: 13,
  comparableCount: 11,
  bestTimeS: 81.2,
  medianTimeS: 81.9,
  bestLapId: null,
  series: null,
  classLaps: null,
  finish: null,
  eventId: null,
  cornerMapSource: 'stored',
  updatedAt: '2026-10-13T23:50:00Z',
};

describe('a cold start with no network', () => {
  it('lists the kept drives and says since when, never an error', () => {
    const readAt = new Date(2026, 9, 14, 0, 41).getTime();
    const before = new QueryClient();
    const key = sessionKeys.list(listQuery(NO_FILTER));
    before.setQueryData(key, {items: [row]}, {updatedAt: readAt});
    const raw = snapshotOf(before, 'u1', readAt);

    // The app is closed and opened again, offline.
    const after = new QueryClient();
    expect(restoreSnapshot(after, raw, 'u1', readAt + 3_600_000)).toBe(true);
    const state = after.getQueryState(key);
    expect(state?.data).toEqual({items: [row]});

    const failedAt = readAt + 3_600_000;
    const model = sessionsModelOf({
      list: {
        isError: true,
        isPending: false,
        error: new TypeError('Network request failed'),
        data: state?.data as {items: SessionSummary[]},
        dataUpdatedAt: state?.dataUpdatedAt ?? 0,
        errorUpdatedAt: failedAt,
      },
      facets: undefined,
      filter: NO_FILTER,
      now: new Date(failedAt),
      answeredAt: readAt,
    });
    expect(model.state).toBe('ready');
    if (model.state !== 'ready') return;
    expect(model.days.flatMap(d => d.rows).map(r => r.id)).toEqual(['s1']);
    expect(model.offlineText).toBe('Offline · 00:41');
  });
});
