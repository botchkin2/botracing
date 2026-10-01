// The race's Pit stops card (round 5 item 3, pit-wall thread 43): one column per
// stop, or a "Fuel" card when there was no stop, from the fuel facts the
// uploader stores on each lap (tools/sessions/fuelFacts.mjs). Pure. Numbers,
// units and what they were measured against, never advice (CODE_STANDARDS §7).
//
// VE state or fuel-only is chosen from whether the channel is stored on the
// laps, never from the car class: with no VE the VE parts are removed, not
// shown as 0 or "—". The refuel time is litres added over the measured rate
// and is left out where that rate is not measured (src/analysis/refuel.ts).
import {refuelS, refuelScope} from '@/src/analysis/refuel';
import {WHEELS, type Wheel} from '@/src/analysis/tyres';
import {endingLap, racePitLaps} from '@/src/data/sessions';
import type {
  Lap,
  PitStop,
  SessionDetail,
  SessionType,
} from '@/src/data/sessions';

import {tyresText} from './pitReview';

/** A bold value and a muted line under it. */
export type Cell = {value: string; note: string | null};

export type PitColumn = {
  key: string;
  title: string;
  /** "after L18": the lap the pit lane was entered. */
  after: string;
  lapIndex: number;
  inTank: Cell;
  added: Cell;
  /** VE after the stop, with the bar's two parts in % of a full load; null in the fuel-only state. */
  veOut: {
    value: string;
    note: string | null;
    leftPct: number;
    addedPct: number;
  } | null;
  /**
   * The time in the pit lane. `refuelS` is the part that is refuelling, where
   * the rate is measured; the rest is not split up (nothing measures it).
   */
  lane: {
    value: string;
    note: string | null;
    laneS: number;
    refuelS: number | null;
  } | null;
  tyres: string | null;
  /** Wear per wheel round the stop; null where the laps carry no wear (older sessions). */
  wheels: WheelWear[] | null;
};

/**
 * One wheel's wear in % of a new tyre. `beforePct` is the end of the lap the
 * stop was entered on, `afterPct` the end of the lap after it (the stop ends
 * inside that lap, so it holds one out lap of wear). A null is a dead sensor
 * or no reading, shown as a gap and never as 0. Right only where the pit box
 * is past the timing line; with the box before it, `beforePct` already reads
 * the new tyre (setup, thread 44 #1543: the uploader should store wear at pit
 * entry and exit on pitStop.tyres, then this reads those).
 */
export type WheelWear = {
  wheel: Wheel;
  changed: boolean;
  beforePct: number | null;
  afterPct: number | null;
};

export type PitCardEnd = {
  /** "End of L72". */
  title: string;
  /** What was left on the last whole lap, as the frame's "Spare". */
  spare: string;
  /** "+40.1 L · used 37.0 L after · 3.1 L left": the tank's balance from the last stop. */
  last: string | null;
};

/** What the race did at one stop, in numbers, for the plan half's Actual column. */
export type ActualStop = {
  lapIndex: number;
  fuelL: number | null;
  vePct: number | null;
  /** The tighter meter's laps at the stint median, as the card shows. */
  lapsLeft: number | null;
};

export type ActualEnd = {
  fuelL: number | null;
  vePct: number | null;
  lapsLeft: number | null;
};

/** The race's side of "Plan vs what happened". */
export type PitActual = {stops: ActualStop[]; end: ActualEnd | null};

/** The card for a race with no stop. */
export type FuelCard = {
  kind: 'fuel';
  actual: PitActual;
  hasVe: boolean;
  title: string;
  start: Cell;
  used: Cell;
  end: {title: string; value: string; usedShare: number | null};
};

export type StopsCard = {
  kind: 'stops';
  actual: PitActual;
  /** One column full width, two side by side, three or more fixed width and scrolling. */
  layout: 'one' | 'two' | 'scroll';
  columns: PitColumn[];
  end: PitCardEnd | null;
  /** The line under the table saying what the bars are. */
  key: string[];
  /** Where the refuel rate comes from; null where it is not measured. */
  refuelScope: string | null;
  hasVe: boolean;
};

export type PitCard = FuelCard | StopsCard;

/** The pit card's facts about the session it belongs to. */
export type PitCardSession = Pick<SessionDetail, 'stints' | 'carClass'>;

const litres = (v: number) => `${v.toFixed(1)} L`;
const pct = (v: number) => `${Math.round(v)} %`;
const lapsOf = (v: number) => `${v.toFixed(1)} laps`;
const round1 = (v: number) => Math.round(v * 10) / 10;
const round0 = (v: number) => Math.round(v);
const join = (parts: (string | false | null | undefined)[], sep = ' · ') =>
  parts.filter(Boolean).join(sep);

/** Whether the laps carry Virtual Energy at all: the state is the session's, not the class's. */
export function sessionHasVe(laps: Lap[]): boolean {
  return laps.some(
    l => l.fuel?.veEndPct != null || l.pitStop?.atEntry.vePct != null,
  );
}

/** The tighter of the two meters' laps, as the lap table's pit line has it. */
function lapsLeft(left: {
  fuel: number | null;
  ve: number | null;
}): number | null {
  const v = [left.fuel, left.ve].filter((x): x is number => x != null);
  return v.length ? Math.min(...v) : null;
}

function inCell(stop: PitStop, hasVe: boolean): Cell {
  const {fuelL, vePct} = stop.atEntry;
  const left = lapsLeft(stop.lapsLeftAtEntry);
  const lapsNote = left != null ? lapsOf(left) : null;
  if (hasVe)
    return {
      value: fuelL != null ? litres(fuelL) : vePct != null ? pct(vePct) : '—',
      note: join([
        fuelL != null && vePct != null && `${pct(vePct)} VE`,
        lapsNote,
      ]),
    };
  return {value: fuelL != null ? litres(fuelL) : '—', note: lapsNote};
}

function addedCell(stop: PitStop, hasVe: boolean): Cell {
  const {fuelL, vePct} = stop.added;
  // Nothing added: a drive-through or a penalty, said as it is.
  if (fuelL === 0) return {value: `+${litres(0)}`, note: 'nothing added'};
  return {
    value:
      fuelL != null
        ? `+${litres(fuelL)}`
        : vePct != null
        ? `+${pct(vePct)}`
        : '—',
    note: hasVe && fuelL != null && vePct != null ? `+${pct(vePct)} VE` : null,
  };
}

/** The stint that starts after the stop: its median VE use per lap is what "laps" at VE out are at. */
function nextStintVeMedian(
  session: PitCardSession,
  laps: Lap[],
  index: number,
): number | null {
  const next = laps.slice(index + 1).find(l => !l.pitOut);
  const stint = session.stints.find(s => s.n === (next ?? laps[index]).stint);
  return stint?.medianVePct ?? null;
}

// "Not changed", "All four new", "Fronts new", "FR only": the uploader's wheels
// (thread 38), in the card's wording. Null when the session ends before the
// wear step is seen.
function tyresCell(stop: PitStop): string | null {
  if (!stop.tyres) return null;
  const text = tyresText(stop.tyres);
  const cap = text.charAt(0).toUpperCase() + text.slice(1);
  if (text === 'not changed') return cap;
  return ['all four', 'fronts', 'rears', 'lefts', 'rights'].includes(text)
    ? `${cap} new`
    : text;
}

// A wear reading of 0 is a dead sensor (the uploader nulls it; guarded here
// for docs written before that).
const liveWear = (v: number | null | undefined) =>
  v != null && v > 0 ? v : null;

// Null when neither lap has a wear reading, so older sessions keep the
// summary alone.
function wheelWear(
  stop: PitStop,
  before: Lap,
  after: Lap | undefined,
): WheelWear[] | null {
  const b = before.tyres?.wearPct;
  const a = after?.tyres?.wearPct;
  if (!b && !a) return null;
  return WHEELS.map(wheel => ({
    wheel,
    changed: stop.tyres?.wheels.includes(wheel) ?? false,
    beforePct: liveWear(b?.[wheel]),
    afterPct: liveWear(a?.[wheel]),
  }));
}

function column(
  laps: Lap[],
  lap: Lap,
  i: number,
  count: number,
  session: PitCardSession,
  hasVe: boolean,
): PitColumn {
  const stop = lap.pitStop as PitStop;
  const index = laps.findIndex(l => l.id === lap.id);
  const {vePct: left} = stop.atEntry;
  const {vePct: addedVe, fuelL: addedL} = stop.added;
  let veOut: PitColumn['veOut'] = null;
  if (hasVe && left != null && addedVe != null) {
    const out = left + addedVe;
    const median = nextStintVeMedian(session, laps, index);
    veOut = {
      value: pct(out),
      note: median != null && median > 0 ? lapsOf(out / median) : null,
      leftPct: left,
      addedPct: addedVe,
    };
  }
  let lane: PitColumn['lane'] = null;
  if (stop.inPitS != null) {
    const refuel = addedL != null ? refuelS(addedL, session.carClass) : null;
    lane = {
      value: `${stop.inPitS.toFixed(1)} s`,
      note: refuel != null ? `refuel ${refuel.toFixed(1)} s` : null,
      laneS: stop.inPitS,
      refuelS: refuel,
    };
  }
  return {
    key: lap.id,
    title: count === 1 ? 'Stop' : `Stop ${i + 1}`,
    after: `after L${lap.lapIndex}`,
    lapIndex: lap.lapIndex,
    inTank: inCell(stop, hasVe),
    added: addedCell(stop, hasVe),
    veOut,
    lane,
    tyres: tyresCell(stop),
    wheels: wheelWear(stop, lap, laps[index + 1]),
  };
}

/** "3.7 L / 4 % VE (1.1 laps)": what was left on the last whole lap. */
function leftText(f: NonNullable<Lap['fuel']>, hasVe: boolean): string {
  const l = lapsLeft({fuel: f.lapsLeftFuel, ve: f.lapsLeftVe});
  return join(
    [
      f.endL != null && litres(f.endL),
      hasVe && f.veEndPct != null && `${pct(f.veEndPct)} VE`,
    ],
    ' / ',
  ).concat(l != null ? ` (${lapsOf(l)})` : '');
}

// "+40.1 L · used 37.0 L after · 3.1 L left". What the laps after the stop
// used is the tank's balance, taken from the rounded numbers as printed so
// the line closes (camber, #147).
function lastLine(stop: PitStop, endL: number | null): string | null {
  if (endL == null) return null;
  const {fuelL: inL} = stop.atEntry;
  const {fuelL: addL} = stop.added;
  if (inL == null || addL == null) return null;
  const used = round1(round1(inL) + round1(addL) - round1(endL));
  return `+${litres(addL)} · used ${litres(used)} after · ${litres(endL)} left`;
}

function fuelCard(
  allLaps: Lap[],
  ending: Lap,
  hasVe: boolean,
): FuelCard | null {
  const first = allLaps[0]?.fuel;
  const f = ending.fuel;
  if (!first || !f || first.startL == null || f.endL == null) return null;
  const upto = allLaps.filter(l => l.lapIndex <= ending.lapIndex);
  // Everything put in during the race counts as loaded: the service before
  // the start is on the first lap.
  const addedL = upto.reduce((s, l) => s + (l.fuel?.addedL ?? 0), 0);
  const usedL = round1(round1(first.startL) + round1(addedL) - round1(f.endL));
  const n = ending.lapIndex;
  const startVe = first.veStartPct;
  const endVe = f.veEndPct;
  const addedVe = upto.reduce((s, l) => s + (l.fuel?.veAddedPct ?? 0), 0);
  const usedVe =
    hasVe && startVe != null && endVe != null
      ? round0(round0(startVe) + round0(addedVe) - round0(endVe))
      : null;
  const perLapVe = usedVe != null && n > 0 ? usedVe / n : null;
  return {
    kind: 'fuel',
    hasVe,
    actual: {
      stops: [],
      end: {
        fuelL: f.endL,
        vePct: hasVe ? f.veEndPct : null,
        lapsLeft: lapsLeft({fuel: f.lapsLeftFuel, ve: f.lapsLeftVe}),
      },
    },
    title: 'Fuel',
    start: {
      value: join(
        [
          litres(first.startL),
          hasVe && startVe != null && `${pct(startVe)} VE`,
        ],
        ' / ',
      ),
      note:
        addedL > 0.05 ? `+${litres(addedL)} added on L1` : 'loaded before L1',
    },
    used: {
      value: join(
        [litres(usedL), usedVe != null && `${pct(usedVe)} VE`],
        ' / ',
      ),
      note: join([
        n > 0 && `${(usedL / n).toFixed(2)} L/lap`,
        perLapVe != null && `${perLapVe.toFixed(2)} %/lap`,
        n > 0 && `over ${n} laps`,
      ]),
    },
    end: {
      title: `End of L${ending.lapIndex}`,
      value: leftText(f, hasVe),
      // Share of what was loaded that was used, for the bar (grey used, white left).
      usedShare:
        first.startL + addedL > 0
          ? Math.min(1, Math.max(0, usedL / (first.startL + addedL)))
          : null,
    },
  };
}

/**
 * Null for anything but a race with a lap to end on. A race with no stop is
 * the "Fuel" card; a race with stops is one column per stop. The service
 * before the start is not a stop (camber, thread 36 #1117).
 */
export function buildPitCard(
  sessionType: SessionType,
  allLaps: Lap[],
  session: PitCardSession,
): PitCard | null {
  if (sessionType !== 'R') return null;
  const ending = endingLap(allLaps);
  if (!ending) return null;
  const hasVe = sessionHasVe(allLaps);
  const pitLaps = racePitLaps(sessionType, allLaps);
  if (pitLaps.length === 0) return fuelCard(allLaps, ending, hasVe);

  const columns = pitLaps.map((lap, i) =>
    column(allLaps, lap, i, pitLaps.length, session, hasVe),
  );
  const last = pitLaps[pitLaps.length - 1].pitStop as PitStop;
  const f = ending.fuel;
  const scope = refuelScope(session.carClass);
  const anyRefuel = columns.some(c => c.lane?.refuelS != null);
  return {
    kind: 'stops',
    actual: {
      stops: pitLaps.map(l => {
        const stop = l.pitStop as PitStop;
        return {
          lapIndex: l.lapIndex,
          fuelL: stop.atEntry.fuelL,
          vePct: hasVe ? stop.atEntry.vePct : null,
          lapsLeft: lapsLeft(stop.lapsLeftAtEntry),
        };
      }),
      end: f
        ? {
            fuelL: f.endL,
            vePct: hasVe ? f.veEndPct : null,
            lapsLeft: lapsLeft({fuel: f.lapsLeftFuel, ve: f.lapsLeftVe}),
          }
        : null,
    },
    layout:
      columns.length === 1 ? 'one' : columns.length === 2 ? 'two' : 'scroll',
    columns,
    end: f
      ? {
          title: `End of L${ending.lapIndex}`,
          spare: leftText(f, hasVe),
          last: lastLine(last, f.endL),
        }
      : null,
    key: [
      hasVe &&
        'VE out: what was left (bright) and what the stop added (dim), of a full load.',
      anyRefuel
        ? 'Pit lane: the time in the lane, with the refuelling inside it (bright).'
        : 'Pit lane: the time in the lane.',
    ].filter((l): l is string => Boolean(l)),
    refuelScope: anyRefuel ? scope : null,
    hasVe,
  };
}
