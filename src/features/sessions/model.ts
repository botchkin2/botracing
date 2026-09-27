import {useMemo} from 'react';

import {
  type SessionFilter,
  type SessionSummary,
  useSessions,
} from '@/src/data/sessions';
import {carLabel, formatLapTime, shortTrackName} from '@/src/design';

// Sessions screen view model: sessions grouped by local day, newest first.
// buildSessionsModel is pure and unit-tested; useSessionsModel wires it to data.

export type SessionRow = {
  id: string;
  badge: SessionType;
  track: string;
  subline: string;
  laps: string;
  best: string;
  median: string;
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
  | {state: 'ready'; days: DayGroup[]};

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

const timeOrDash = (timeS: number | null) =>
  timeS == null ? '—' : formatLapTime(timeS);

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
      subline: [hhmm(started), car.shortModel, car.entry]
        .filter(Boolean)
        .join(' · '),
      laps: String(s.lapCount),
      best: timeOrDash(s.bestTimeS),
      median: timeOrDash(s.medianTimeS),
    });
  }
  return [...groups.values()];
}

export function useSessionsModel(filter: SessionFilter = {}): SessionsModel {
  const query = useSessions(filter);
  return useMemo(() => {
    if (query.isPending) return {state: 'loading'};
    if (query.isError)
      return {
        state: 'error',
        message:
          query.error instanceof Error
            ? query.error.message
            : String(query.error),
      };
    if (query.data.items.length === 0) return {state: 'empty'};
    return {
      state: 'ready',
      days: buildSessionsModel(query.data.items, new Date()),
    };
  }, [query.isPending, query.isError, query.error, query.data]);
}
