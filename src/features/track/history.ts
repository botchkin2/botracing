import {type SessionSummary} from '@/src/data/sessions';
import {carLabel, formatDate, formatLapTime} from '@/src/design';

// "Your history here" on the Track page (handoff T1, third column). Bests
// are the sessions' own bests, which the uploader takes from comparable laps
// only, so a track-limits or pit lap never becomes the headline. They are
// grouped by car, not class: the class is recorded but BoP and car differ
// within one (pit-wall thread 20 #522). The trend shows one car only and
// draws no fitted line.

export type HistoryBest = {
  key: string;
  sessionId: string;
  car: string;
  carClass: string;
  date: string;
  time: string;
};

export type TrendBar = {
  /** 0 = the slowest bar's floor, 1 = the fastest. */
  height01: number;
  best: boolean;
};

export type HistoryModel = {
  stats: {label: string; value: string}[];
  bests: HistoryBest[];
  cars: {name: string; laps: string}[];
  trend: {
    title: string;
    bars: TrendBar[];
    from: string;
    to: string;
    /** The scale's ends, with units: the fastest best (top) and the floor (bottom). */
    fastest: string;
    floor: string;
  } | null;
};

// Bars need a floor below the slowest so it still shows: 0.4 s, from the
// handoff mock.
const TREND_FLOOR_S = 0.4;
const TREND_MIN_SESSIONS = 3;

export function buildHistory(sessions: SessionSummary[]): HistoryModel | null {
  if (sessions.length === 0) return null;
  const newestFirst = [...sessions].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  const laps = sessions.reduce((sum, s) => sum + s.lapCount, 0);

  const byCar = new Map<string, SessionSummary[]>();
  for (const s of newestFirst) {
    const list = byCar.get(s.car) ?? [];
    list.push(s);
    byCar.set(s.car, list);
  }

  const bests: (HistoryBest & {timeS: number})[] = [];
  for (const [car, list] of byCar) {
    let best: SessionSummary | null = null;
    for (const s of list) {
      if (s.bestTimeS == null) continue;
      if (!best || s.bestTimeS < (best.bestTimeS as number)) best = s;
    }
    if (!best || best.bestTimeS == null) continue;
    const label = carLabel(car);
    bests.push({
      key: car,
      sessionId: best.id,
      car: label.entry ? `${label.model} · ${label.entry}` : label.model,
      carClass: best.carClass,
      date: formatDate(best.startedAt),
      time: formatLapTime(best.bestTimeS),
      timeS: best.bestTimeS,
    });
  }
  bests.sort((a, b) => a.timeS - b.timeS);

  const cars = [...byCar.entries()]
    .map(([car, list]) => ({
      car,
      laps: list.reduce((sum, s) => sum + s.lapCount, 0),
    }))
    .sort((a, b) => b.laps - a.laps);

  return {
    stats: [
      {label: 'Sessions', value: String(sessions.length)},
      {label: 'Laps', value: String(laps)},
      {label: 'Last driven', value: formatDate(newestFirst[0].startedAt)},
    ],
    bests: bests.map(({timeS: _, ...b}) => b),
    cars: cars.map(c => {
      const label = carLabel(c.car);
      return {
        name: label.entry ? `${label.model} · ${label.entry}` : label.model,
        laps: `${c.laps} laps`,
      };
    }),
    trend: buildTrend(cars.length ? byCar.get(cars[0].car) ?? [] : []),
  };
}

function buildTrend(newestFirst: SessionSummary[]): HistoryModel['trend'] {
  const timed = newestFirst.filter(s => s.bestTimeS != null).reverse();
  if (timed.length < TREND_MIN_SESSIONS) return null;
  const times = timed.map(s => s.bestTimeS as number);
  const fastest = Math.min(...times);
  const floor = Math.max(...times) + TREND_FLOOR_S;
  const span = floor - fastest || 1;
  const label = carLabel(timed[0].car);
  return {
    title: `Best lap per session · ${label.model}`,
    bars: times.map(t => ({height01: (floor - t) / span, best: t === fastest})),
    from: formatDate(timed[0].startedAt),
    to: formatDate(timed[timed.length - 1].startedAt),
    fastest: formatLapTime(fastest),
    floor: formatLapTime(floor),
  };
}
