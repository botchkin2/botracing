// The Session Tires card (round 7 item 1A/1C, pit-wall thread 44): one stint at
// a time, from the per-wheel facts on each lap (`lap.tyres`, tools/sessions/
// tyres.mjs). Pure. Numbers, units and what they were measured against, never
// advice (CODE_STANDARDS §7).
//
// Not here, because the laps do not carry it yet: tread zones, the stop
// cool-down and the compound (thread 44 #1606/#1607).
import {WHEELS, type Wheel} from '@/src/analysis/tyres';
import type {Lap, SessionDetail} from '@/src/data/sessions';

import {median} from './desktopModel';

/** A trend of wear per lap needs this many green laps (round 7 1C b). */
export const MIN_TREND_LAPS = 5;

/** The wear bars run 0 to this, % of a new tyre lost on a lap (round 7 1A key). */
export const WEAR_BAR_MAX_PCT = 1.4;

export type WheelCell = {
  wheel: Wheel;
  /** Wear left at the end of the last green lap, % of a new tyre. */
  leftPct: number | null;
  /** % lost on every lap that follows a lap with a reading, in lap order; a lap that is not green is drawn hollow. */
  bars: LossBar[];
  /** Median over the green laps' losses; null with none. */
  medianLossPct: number | null;
  /** The largest single-lap loss, when it is over BIG_LOSS_FACTOR times the median. */
  biggest: {lapLabel: string; lossPct: number; green: boolean} | null;
  /** Median stabilised hot pressure over the green laps, kPa. */
  hotKpa: number | null;
  /** The sensor reads nothing from `flat.fromLap` on (a flat tyre or a failed sensor). */
  flat: FlatWheel | null;
};

export type LossBar = {lapLabel: string; lossPct: number; green: boolean};

/** A single lap's loss is called out when it is over this many times the median. */
export const BIG_LOSS_FACTOR = 3;

export type FlatWheel = {
  /** "L37": the first lap with no pressure reading. */
  fromLap: string;
  /** "L36": the last lap with one; null when there is none before. */
  lastValidLap: string | null;
  /** Wear at the end of `lastValidLap`, kept in place of the lost readings. */
  lastValidPct: number | null;
};

export type Axle = 'front' | 'rear';

/** One value per lap for each axle (mean of its wheels with a reading). */
export type AxleSeries = {
  lapLabels: string[];
  front: (number | null)[];
  rear: (number | null)[];
  /** Median over the green laps of the axle mean; null with none. */
  medianFront: number | null;
  medianRear: number | null;
};

export type ReadingRow = {label: string; wearPct: Record<Wheel, number | null>};

export type StintTires = {
  n: number;
  /** "S2". */
  tab: string;
  /** "Stint 2 · L14–L26". */
  title: string;
  /** "12 green laps". */
  sub: string;
  /** Each wheel's set age at the stint's last lap: "all four on 13-lap sets", or per wheel when they differ. */
  setAge: string;
  greenLaps: number;
  /** Bars and trend, or the readings as a table when there are too few green laps. */
  kind: 'trend' | 'readings';
  wheels: WheelCell[];
  /** Wear left after each green lap, for the table when `kind` is 'readings'. */
  readings: ReadingRow[];
  /** Each lap's median pressure (the line); the key's median is the stabilised hot one. */
  pressure: AxleSeries;
  /** Each lap's surface-layer rubber temperature, C. */
  rubber: AxleSeries;
  /** The sentence about a wheel that read nothing, or null. */
  flatNote: string | null;
};

export type TiresCard =
  | {kind: 'absent'}
  | {kind: 'stints'; stints: StintTires[]};

const lapLabel = (l: Lap) => `L${l.lapIndex}`;

const hasTyres = (l: Lap) =>
  l.tyres != null &&
  (l.tyres.wearPct != null ||
    l.tyres.pressureKpa != null ||
    l.tyres.rubberC != null);

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * The wheels that stop reporting pressure partway through a stint, with the
 * first lap that has none. A wheel with no channel for the whole stint is not
 * in it: that wheel is simply absent.
 */
function flatWheels(laps: Lap[]): Map<Wheel, number> {
  const out = new Map<Wheel, number>();
  for (const w of WHEELS) {
    let seen = false;
    for (let i = 0; i < laps.length; i++) {
      const p = laps[i].tyres?.pressureKpa;
      if (!p) continue;
      // Another wheel read, this one did not: its sensor is gone.
      const others = WHEELS.some(o => o !== w && p[o] != null);
      if (p[w] != null) seen = true;
      else if (seen && others) {
        out.set(w, i);
        break;
      }
    }
  }
  return out;
}

function axleSeries(
  laps: Lap[],
  green: Set<string>,
  flatFrom: Map<Wheel, number>,
  pick: (l: Lap) => Record<Wheel, number | null> | null | undefined,
  pickMedian: (l: Lap) => Record<Wheel, number | null> | null | undefined,
): AxleSeries {
  const axle = (l: Lap, i: number, wheels: Wheel[], read: typeof pick) => {
    const per = read(l);
    if (!per) return null;
    const v: number[] = [];
    for (const w of wheels) {
      const from = flatFrom.get(w);
      const x = per[w];
      if (x != null && (from == null || i < from)) v.push(x);
    }
    return mean(v);
  };
  const front: Wheel[] = ['FL', 'FR'];
  const rear: Wheel[] = ['RL', 'RR'];
  const med = (wheels: Wheel[]) => {
    const v: number[] = [];
    laps.forEach((l, i) => {
      const x = green.has(l.id) ? axle(l, i, wheels, pickMedian) : null;
      if (x != null) v.push(x);
    });
    return median(v);
  };
  return {
    lapLabels: laps.map(lapLabel),
    front: laps.map((l, i) => axle(l, i, front, pick)),
    rear: laps.map((l, i) => axle(l, i, rear, pick)),
    medianFront: med(front),
    medianRear: med(rear),
  };
}

/**
 * How many laps each wheel's tyre had run by the stint's last lap. A set
 * starts on the lap after a stop that changed the wheel (`tyres.changed`) or
 * after a reset to the garage, so a kept-tyres stop does not restart it and a
 * single-wheel change restarts only that wheel. Without a change on record
 * the set is as old as the session's first lap.
 */
export function setAges(
  all: Lap[],
  lastLapIndex: number,
): Record<Wheel, number> {
  const out = {} as Record<Wheel, number>;
  for (const w of WHEELS) {
    let start = all.length ? all[0].lapIndex : lastLapIndex;
    for (const l of all) {
      if (l.lapIndex >= lastLapIndex) break;
      if (l.endedInReset || l.tyres?.changed?.includes(w)) {
        start = l.lapIndex + 1;
      }
    }
    out[w] = lastLapIndex - start + 1;
  }
  return out;
}

export function setAgeText(ages: Record<Wheel, number>, lastLap: number) {
  const v = WHEELS.map(w => ages[w]);
  const unit = (n: number) => `${n}-lap`;
  if (v.every(n => n === v[0]))
    return `All four on ${unit(v[0])} sets at L${lastLap}`;
  return `Set age at L${lastLap}: ${WHEELS.map(
    w => `${w} ${ages[w]} ${ages[w] === 1 ? 'lap' : 'laps'}`,
  ).join(' · ')}`;
}

function stintTires(n: number, laps: Lap[], all: Lap[]): StintTires | null {
  const withData = laps.filter(hasTyres);
  if (withData.length === 0) return null;
  const green = new Set(
    withData.filter(l => l.fuel?.green === true).map(l => l.id),
  );
  const flatFrom = flatWheels(withData);
  const greenLaps = withData.filter(l => green.has(l.id));
  const first = withData[0].lapIndex;
  const last = withData[withData.length - 1].lapIndex;

  const wheels: WheelCell[] = WHEELS.map(wheel => {
    const from = flatFrom.get(wheel);
    const usable = (i: number) => from == null || i < from;
    // Wear left: the last green lap with a reading before the wheel went dark.
    let leftPct: number | null = null;
    const bars: LossBar[] = [];
    const hot: number[] = [];
    withData.forEach((l, i) => {
      if (!usable(i)) return;
      const isGreen = green.has(l.id);
      const w = l.tyres?.wearPct?.[wheel];
      if (w != null && isGreen) leftPct = w;
      const prev = withData[i - 1];
      const before =
        prev && prev.lapIndex === l.lapIndex - 1
          ? prev.tyres?.wearPct?.[wheel]
          : null;
      // Every lap is a bar, so a lock-up on an untimed lap shows; only green laps feed the median.
      if (w != null && before != null && before >= w)
        bars.push({lapLabel: lapLabel(l), lossPct: before - w, green: isGreen});
      const h = isGreen ? l.tyres?.hotPressureKpa?.[wheel] : null;
      if (h != null) hot.push(h);
    });
    const medianLoss = median(bars.filter(b => b.green).map(b => b.lossPct));
    let biggest: WheelCell['biggest'] = null;
    for (const b of bars)
      if (!biggest || b.lossPct > biggest.lossPct) biggest = b;
    if (
      biggest &&
      (medianLoss == null || biggest.lossPct <= BIG_LOSS_FACTOR * medianLoss)
    )
      biggest = null;
    let flat: FlatWheel | null = null;
    if (from != null) {
      const lastValid = from > 0 ? withData[from - 1] : null;
      flat = {
        fromLap: lapLabel(withData[from]),
        lastValidLap: lastValid ? lapLabel(lastValid) : null,
        lastValidPct: lastValid?.tyres?.wearPct?.[wheel] ?? null,
      };
    }
    return {
      wheel,
      leftPct,
      bars,
      medianLossPct: medianLoss,
      biggest,
      hotKpa: median(hot),
      flat,
    };
  });

  const flatCells = wheels.filter(c => c.flat);
  const flatNote =
    flatCells.length === 0
      ? null
      : flatCells
          .map(
            c =>
              `${c.wheel} pressure reads nothing from ${
                c.flat?.fromLap
              } on. That is a flat tyre or a failed sensor; the file cannot tell which. ${
                c.wheel
              } wear, pressure and temperature after ${
                c.flat?.lastValidLap ?? 'the start of the stint'
              } are left out of every line and median.`,
          )
          .join(' ');

  const kind = greenLaps.length >= MIN_TREND_LAPS ? 'trend' : 'readings';
  return {
    n,
    tab: `S${n}`,
    title: `Stint ${n} · L${first}–L${last}`,
    sub: `${greenLaps.length} green ${greenLaps.length === 1 ? 'lap' : 'laps'}`,
    setAge: setAgeText(setAges(all, last), last),
    greenLaps: greenLaps.length,
    kind,
    wheels,
    readings: greenLaps.map(l => ({
      label: lapLabel(l),
      wearPct: l.tyres?.wearPct ?? {FL: null, FR: null, RL: null, RR: null},
    })),
    pressure: axleSeries(
      withData,
      green,
      flatFrom,
      l => l.tyres?.pressureKpa,
      l => l.tyres?.hotPressureKpa,
    ),
    rubber: axleSeries(
      withData,
      green,
      flatFrom,
      l => l.tyres?.rubberC,
      l => l.tyres?.rubberC,
    ),
    flatNote,
  };
}

/** The card, or `absent` when no lap in the session carries tyre facts. */
export function buildTiresCard(
  session: Pick<SessionDetail, 'stints'>,
  laps: Lap[],
): TiresCard {
  const nums = session.stints.length
    ? session.stints.map(s => s.n)
    : [...new Set(laps.map(l => l.stint))].sort((a, b) => a - b);
  const stints: StintTires[] = [];
  for (const n of nums) {
    const s = stintTires(
      n,
      laps.filter(l => l.stint === n),
      laps,
    );
    if (s) stints.push(s);
  }
  return stints.length ? {kind: 'stints', stints} : {kind: 'absent'};
}

export const NO_TYRE_CHANNELS =
  'This session has no tyre channels (an older file, or the recording had none). Laps, fuel and pit stops still work.';

// Behind the "?" on the Tires card, one sentence a line.
export const TIRES_HELP: readonly string[] = [
  'Cells are laid out as seen from above, front at the top. The big number is the wear left at the end of the last green lap, in % of a new tyre; the bars are the % lost on each lap, hollow when the lap is not a green one, and the dashed line is the median of the green laps. A lap that lost more than 3 times the median is named under its number.',
  'Pressure is each lap median, outside the pit lane, as an axle mean. The key gives the stabilised hot pressure (the last 5 s of the lap, from the third lap of a stint), which is the number in each cell.',
  'Rubber temperature is the surface layer (not the carcass), a median per lap. The out-lap warm-up stays in the line.',
  'A trend needs 5 green laps; with fewer the readings are listed. A wheel that reads no pressure is outlined and left out of every median.',
];
