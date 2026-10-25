// The per-car laps panel's rows (roadmap D55): strings only, lap 1 first (ticket 52).
// Times are approximate (the field is 5 Hz, analysis/carLaps.ts), shown to a
// tenth; a lap that cannot be timed is "—", never a guess.
import {type CarLap} from '@/src/analysis/carLaps';
import {lapTimeTenths} from '@/src/charts/tickFormat';

export type CarLapRow = {
  key: string;
  lap: string;
  time: string;
  /** "IN", "OUT" or "PIT" for a lap that touched the pit lane; "" otherwise. */
  tag: string;
  /** The lap the car is on at the playhead (analysis/carLaps `currentLapIndex`). */
  current: boolean;
};

export type CarLapsView = {
  /** "GT3 ≈": the car's class, then the mark that every time here is approximate. */
  title: string;
  rows: CarLapRow[];
};

/** Null when there are no laps: the leaderboard then shows no panel at all. `currentIndex` is -1 before the car's first lap. */
export function carLapsView(
  laps: readonly CarLap[],
  classTitle: string,
  currentIndex: number,
): CarLapsView | null {
  if (laps.length === 0) return null;
  const rows: CarLapRow[] = [];
  for (let i = 0; i < laps.length; i++) {
    const l = laps[i];
    rows.push({
      key: `${i}`,
      lap: l.lapNumber === null ? '—' : `${l.lapNumber}`,
      time: l.timeS === null ? '—' : `≈${lapTimeTenths(l.timeS)}`,
      tag: l.pit === null ? '' : l.pit.toUpperCase(),
      current: i === currentIndex,
    });
  }
  return {title: `${classTitle} ≈`, rows};
}
