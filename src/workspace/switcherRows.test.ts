import {describe, expect, it} from '@jest/globals';

import {type SessionSummary} from '@/src/data/sessions';

import {switcherRows} from './switcherRows';

const session = (over: Partial<SessionSummary>): SessionSummary =>
  ({
    id: 's',
    sim: 'lmu',
    trackId: 'le-mans',
    track: 'Circuit de la Sarthe',
    car: 'Porsche 911 GT3 R - Manthey #91',
    carClass: 'GT3',
    sessionType: 'R',
    startedAt: '2026-09-14T12:00:00Z',
    lapCount: 20,
    comparableCount: 18,
    bestTimeS: 239.4,
    medianTimeS: 241,
    bestLapId: null,
    series: null,
    ...over,
  } as SessionSummary);

describe('switcherRows', () => {
  it('lists the sessions at this track, newest first, the open one marked', () => {
    const rows = switcherRows(
      [
        session({
          id: 'old',
          startedAt: '2026-09-12T10:00:00Z',
          sessionType: 'P',
        }),
        session({id: 'new', startedAt: '2026-09-14T12:00:00Z'}),
        session({id: 'elsewhere', trackId: 'daytona'}),
      ],
      'le-mans',
      'new',
    );
    expect(rows.map(r => r.id)).toEqual(['new', 'old']);
    expect(rows.map(r => r.open)).toEqual([true, false]);
    expect(rows[1].badge).toBe('P');
  });

  it('leaves out a session with no laps, unless it is the open one', () => {
    const items = [session({id: 'a', lapCount: 0}), session({id: 'b'})];
    expect(switcherRows(items, 'le-mans', 'b').map(r => r.id)).toEqual(['b']);
    expect(switcherRows(items, 'le-mans', 'a').map(r => r.id)).toContain('a');
  });

  it('has no best time when the session has none', () => {
    const [row] = switcherRows(
      [session({id: 'a', bestTimeS: null})],
      'le-mans',
      'a',
    );
    expect(row.best).toBeNull();
  });

  it('formats the day and the best lap', () => {
    const [row] = switcherRows([session({id: 'a'})], 'le-mans', 'a');
    expect(row.date).toBe('14 Sep');
    expect(row.best).toBe('3:59.400');
  });
});
