import {describe, expect, it} from '@jest/globals';
import {type SessionSummary} from '@/src/data/sessions';

import {
  buildSessionsModel,
  DEFAULT_SORT,
  emptyDaysText,
  nextSort,
  type SessionRow,
  sortRows,
} from './model';

const session = (over: Partial<SessionSummary>): SessionSummary => ({
  id: 's1',
  sim: 'lmu',
  trackId: 'portimao',
  track: 'Michelin Raceway Road Atlanta',
  car: 'Manthey DK Engineering 2026 #91:LM',
  carClass: 'GT3',
  sessionType: 'R',
  startedAt: '2026-09-27T21:40:00',
  lapCount: 42,
  comparableCount: 38,
  bestTimeS: 99.733,
  medianTimeS: 101.123,
  bestLapId: null,
  series: null,
  classLaps: null,
  finish: null,
  eventId: null,
  cornerMapSource: 'stored',
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
      typeLabel: 'Race',
      subline: '21:40 · 911 GT3 R',
      entry: 'Manthey #91',
      railSubline: '21:40 · 42 laps',
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

describe('desktop table', () => {
  const now = new Date('2026-09-27T23:00:00');
  const rows = (...over: Partial<SessionSummary>[]): SessionRow[] =>
    buildSessionsModel(
      over.map((o, i) => session({id: `s${i}`, ...o})),
      now,
    ).flatMap(d => d.rows);
  const ids = (r: SessionRow[]) => r.map(x => x.id);

  it('carries the cells the table shows', () => {
    const [row] = rows({startedAt: '2026-09-27T21:40:00'});
    expect(row.table).toEqual({
      startedAt: '2026-09-27T21:40:00',
      dateText: '27 Sept 21:40',
      carText: '911 GT3 R · Manthey #91',
      lapsN: 42,
      bestS: 99.733,
      medianS: 101.123,
      classText: 'GT3',
      place: null,
    });
  });

  it('shows a class for a race only', () => {
    const [race, practice] = rows(
      {sessionType: 'R'},
      {sessionType: 'P', startedAt: '2026-09-26T10:00:00'},
    );
    expect(race.table.classText).toBe('GT3');
    expect(practice.table.classText).toBeNull();
  });

  it('sorts by date newest first by default, and by laps and times', () => {
    const r = rows(
      {startedAt: '2026-09-25T10:00:00', lapCount: 10, bestTimeS: 100},
      {startedAt: '2026-09-27T10:00:00', lapCount: 30, bestTimeS: 98},
      {startedAt: '2026-09-26T10:00:00', lapCount: 20, bestTimeS: null},
    );
    expect(ids(sortRows(r, DEFAULT_SORT))).toEqual(['s1', 's2', 's0']);
    expect(ids(sortRows(r, {key: 'laps', dir: 'desc'}))).toEqual([
      's1',
      's2',
      's0',
    ]);
    expect(ids(sortRows(r, {key: 'laps', dir: 'asc'}))).toEqual([
      's0',
      's2',
      's1',
    ]);
    // Fastest first; a session with no time is last in both directions.
    expect(ids(sortRows(r, {key: 'best', dir: 'asc'}))).toEqual([
      's1',
      's0',
      's2',
    ]);
    expect(ids(sortRows(r, {key: 'best', dir: 'desc'}))).toEqual([
      's0',
      's1',
      's2',
    ]);
  });

  it('sorts text columns A to Z and ties by date', () => {
    const r = rows(
      {
        track: 'Daytona International Speedway',
        startedAt: '2026-09-25T10:00:00',
      },
      {track: 'Barcelona', startedAt: '2026-09-26T10:00:00'},
      {
        track: 'Daytona International Speedway',
        startedAt: '2026-09-27T10:00:00',
      },
    );
    expect(ids(sortRows(r, {key: 'track', dir: 'asc'}))).toEqual([
      's1',
      's2',
      's0',
    ]);
  });

  it('flips the sorted column and starts a new one in its own direction', () => {
    expect(nextSort(DEFAULT_SORT, 'date')).toEqual({key: 'date', dir: 'asc'});
    expect(nextSort(DEFAULT_SORT, 'best')).toEqual({key: 'best', dir: 'asc'});
    expect(nextSort(DEFAULT_SORT, 'laps')).toEqual({key: 'laps', dir: 'desc'});
    expect(nextSort({key: 'best', dir: 'asc'}, 'best')).toEqual({
      key: 'best',
      dir: 'desc',
    });
  });
});

describe('finishing position', () => {
  const now = new Date('2026-09-27T23:00:00');
  const finish = {
    overall: 3,
    inClass: 1,
    ofOverall: 58,
    ofClass: 14,
    lapsDone: 20,
    leaderLapsDone: 21,
    leftEarly: false,
  };
  const rows = (...over: Partial<SessionSummary>[]): SessionRow[] =>
    buildSessionsModel(
      over.map((o, i) => session({id: `s${i}`, ...o})),
      now,
    ).flatMap(d => d.rows);

  it('reads "P3 · P1 in class" for a race with one, and nothing without', () => {
    const [withIt, without] = rows(
      {finish},
      {finish: null, startedAt: '2026-09-26T21:40:00'},
    );
    expect(withIt.resultText).toBe('P3 · P1 in class');
    expect(withIt.table.place).toBe(3);
    expect(without.resultText).toBeNull();
    expect(without.table.place).toBeNull();
  });

  it('says "left early" with the lap, not a result, when the player stopped first', () => {
    const [r] = rows({
      finish: {
        ...finish,
        overall: 12,
        lapsDone: 6,
        leaderLapsDone: 7,
        leftEarly: true,
      },
    });
    expect(r.resultText).toBe('P12 at L6 of 7 (left early)');
  });

  it('sorts by the overall place, with sessions that have none last both ways', () => {
    const r = rows(
      {finish: {...finish, overall: 5}, startedAt: '2026-09-25T10:00:00'},
      {finish: null, startedAt: '2026-09-26T10:00:00'},
      {finish: {...finish, overall: 2}, startedAt: '2026-09-27T10:00:00'},
    );
    expect(sortRows(r, {key: 'result', dir: 'asc'}).map(x => x.id)).toEqual([
      's2',
      's0',
      's1',
    ]);
    expect(sortRows(r, {key: 'result', dir: 'desc'}).map(x => x.id)).toEqual([
      's0',
      's2',
      's1',
    ]);
  });
});

describe('emptyDaysText', () => {
  it('says recent only when no game or track is picked', () => {
    expect(emptyDaysText({game: null, track: null})).toBe('No recent sessions');
  });

  it('says No sessions when a game or track is picked', () => {
    expect(emptyDaysText({game: 'lmu', track: null})).toBe('No sessions');
    expect(emptyDaysText({game: null, track: 'spa'})).toBe('No sessions');
  });
});
