import {useMemo} from 'react';

import {
  type SessionSummary,
  useSessionFacets,
  useSessions,
} from '@/src/data/sessions';
import type {FinishPosition} from '@/src/analysis/raceResult';
import {carLabel, formatLapTime, shortTrackName} from '@/src/design';

import {
  applyGame,
  effectiveFilter,
  type FilterOptions,
  filterOptions,
  emptyDaysText,
  listQuery,
  NO_FILTER,
  type SessionsFilter,
} from './filter';

// Sessions screen view model: sessions grouped by local day, newest first.
// buildSessionsModel is pure and unit-tested; useSessionsModel wires it to data.

export type SessionRow = {
  id: string;
  badge: SessionType;
  track: string;
  /** "Race", for the desktop rail. */
  typeLabel: string;
  /** "21:40 · 911 GT3 R": the time and the car, which never truncate. */
  subline: string;
  /** "Manthey #91": the entry, which wraps to its own line before the car is cut. */
  entry: string | null;
  /** "21:40 · 44 laps", for the desktop rail. */
  railSubline: string;
  laps: string;
  best: string;
  median: string;
  /** "P3 · P1 in class": a race's finishing position, overall then in class; null outside a race or when unknown. */
  resultText: string | null;
  /** For the desktop table: the sortable values and the cells' text. */
  table: TableCells;
};

/** What the desktop table shows and sorts on; the same facts as the row, unformatted where they sort as numbers. */
export type TableCells = {
  startedAt: string;
  /** "30 Sep 20:27". */
  dateText: string;
  /** "911 GT3 R · Manthey #91". */
  carText: string;
  lapsN: number;
  bestS: number | null;
  medianS: number | null;
  /** The car's class, for a race only ("GT3"); null otherwise. */
  classText: string | null;
  /** The overall finishing place, for sorting; null when there is none. */
  place: number | null;
};
type SessionType = SessionSummary['sessionType'];

export type DayGroup = {
  key: string;
  title: string;
  date: string;
  rows: SessionRow[];
};

export type SessionsModel =
  | {state: 'loading'}
  | {state: 'error'; message: string}
  | {state: 'empty'}
  | {
      state: 'ready';
      days: DayGroup[];
      /** The filter in force (a stale one from the URL already dropped) and what it can be changed to. */
      filter: SessionsFilter;
      options: FilterOptions;
      /** Shown when no day has a row. */
      emptyText: string;
    };

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
    2,
    '0',
  )}`;

function dayTitle(day: Date, now: Date): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(day) === dayKey(now)) return 'Today';
  if (dayKey(day) === dayKey(yesterday)) return 'Yesterday';
  return day.toLocaleDateString('en-GB', {weekday: 'long'});
}

const TYPE_LABEL: Record<SessionType, string> = {
  R: 'Race',
  Q: 'Qualifying',
  P: 'Practice',
};

const timeOrDash = (timeS: number | null) =>
  timeS == null ? '—' : formatLapTime(timeS);

/**
 * The result on a race row. A race the player left early gives the class place
 * with the class leader's laps ('P20 GT3 · L20 of 21'), so the laps compare
 * within the class; the class is left out when it has no name, and 'of N' when
 * the class leader's laps are not known.
 */
export function raceResultText(
  finish: FinishPosition | null,
  carClass: string | null,
): string | null {
  if (!finish) return null;
  if (!finish.leftEarly)
    return `P${finish.overall} · P${finish.inClass} in class`;
  const place = [`P${finish.inClass}`, carClass].filter(Boolean).join(' ');
  const laps =
    finish.classLeaderLapsDone != null
      ? `L${finish.lapsDone} of ${finish.classLeaderLapsDone}`
      : `L${finish.lapsDone}`;
  return `${place} · ${laps} (left early)`;
}

export function buildSessionsModel(
  sessions: SessionSummary[],
  now: Date,
): DayGroup[] {
  const sorted = [...sessions].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  const groups = new Map<string, DayGroup>();
  for (const s of sorted) {
    const started = new Date(s.startedAt);
    const key = dayKey(started);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: dayTitle(started, now),
        date: started.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
        }),
        rows: [],
      };
      groups.set(key, group);
    }
    const car = carLabel(s.car);
    group.rows.push({
      id: s.id,
      badge: s.sessionType,
      track: shortTrackName(s.track),
      typeLabel: TYPE_LABEL[s.sessionType],
      railSubline: `${hhmm(started)} · ${s.lapCount} laps`,
      subline: [hhmm(started), car.shortModel].filter(Boolean).join(' · '),
      entry: car.entry,
      laps: String(s.lapCount),
      best: timeOrDash(s.bestTimeS),
      median: timeOrDash(s.medianTimeS),
      resultText: raceResultText(
        s.finish,
        s.sessionType === 'R' && s.carClass ? s.carClass : null,
      ),
      table: {
        startedAt: s.startedAt,
        dateText: `${started.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
        })} ${hhmm(started)}`,
        carText: [car.shortModel, car.entry].filter(Boolean).join(' · '),
        lapsN: s.lapCount,
        bestS: s.bestTimeS,
        medianS: s.medianTimeS,
        classText: s.sessionType === 'R' && s.carClass ? s.carClass : null,
        place: s.finish?.overall ?? null,
      },
    });
  }
  return [...groups.values()];
}

export type SortKey =
  | 'date'
  | 'track'
  | 'car'
  | 'type'
  | 'laps'
  | 'best'
  | 'median'
  | 'class'
  | 'result';
export type Sort = {key: SortKey; dir: 'asc' | 'desc'};

/** The desktop table opens newest first. */
export const DEFAULT_SORT: Sort = {key: 'date', dir: 'desc'};

/** The direction a column starts in when it is first picked: text A to Z, numbers and dates with the largest or newest first except times, fastest first. */
export function firstDirection(key: SortKey): Sort['dir'] {
  return key === 'laps' || key === 'date' ? 'desc' : 'asc';
}

/** Picking the sorted column flips it; picking another starts it in its own first direction. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key)
    return {key, dir: current.dir === 'asc' ? 'desc' : 'asc'};
  return {key, dir: firstDirection(key)};
}

function compare(a: SessionRow, b: SessionRow, key: SortKey): number {
  const text = (x: string | null, y: string | null) =>
    (x ?? '').localeCompare(y ?? '', 'en', {sensitivity: 'base'});
  switch (key) {
    case 'date':
      return a.table.startedAt.localeCompare(b.table.startedAt);
    case 'track':
      return text(a.track, b.track);
    case 'car':
      return text(a.table.carText, b.table.carText);
    case 'type':
      return text(a.typeLabel, b.typeLabel);
    case 'class':
      return text(a.table.classText, b.table.classText);
    case 'result':
      return (a.table.place ?? 0) - (b.table.place ?? 0);
    case 'laps':
      return a.table.lapsN - b.table.lapsN;
    case 'best':
    case 'median': {
      const [x, y] =
        key === 'best'
          ? [a.table.bestS, b.table.bestS]
          : [a.table.medianS, b.table.medianS];
      // A session with no time sorts last whichever way it goes.
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return x - y;
    }
  }
}

/**
 * The rows in the order a column asks for, ties by date newest first. A
 * missing time or class stays at the bottom in both directions.
 */
export function sortRows(rows: SessionRow[], sort: Sort): SessionRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const empty = (r: SessionRow) =>
    (sort.key === 'best' && r.table.bestS == null) ||
    (sort.key === 'median' && r.table.medianS == null) ||
    (sort.key === 'class' && r.table.classText == null) ||
    (sort.key === 'result' && r.table.place == null);
  return [...rows].sort((a, b) => {
    const ea = empty(a);
    const eb = empty(b);
    if (ea !== eb) return ea ? 1 : -1;
    return (
      sign * compare(a, b, sort.key) ||
      b.table.startedAt.localeCompare(a.table.startedAt)
    );
  });
}

export function useSessionsModel(
  wanted: SessionsFilter = NO_FILTER,
): SessionsModel {
  const facets = useSessionFacets();
  // Both reads start at once. The list comes from the URL; the facets only
  // correct it when the URL names a game or track nothing was driven in.
  const filter = useMemo(
    () => (facets.data ? effectiveFilter(facets.data, wanted) : wanted),
    [facets.data, wanted.game, wanted.track],
  );
  const list = useSessions(listQuery(filter));
  return useMemo(() => {
    if (list.isPending) return {state: 'loading'};
    if (list.isError)
      return {
        state: 'error',
        message:
          list.error instanceof Error ? list.error.message : String(list.error),
      };
    if (facets.data && facets.data.games.length === 0) return {state: 'empty'};
    return {
      state: 'ready',
      days: buildSessionsModel(applyGame(list.data.items, filter), new Date()),
      filter,
      emptyText: emptyDaysText(filter),
      options: facets.data
        ? filterOptions(facets.data, filter)
        : {games: [], tracks: []},
    };
  }, [list.status, list.data, list.error, facets.data, filter]);
}
