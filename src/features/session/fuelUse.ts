// The practice view (pit-wall thread 36, #1115/#1203/#1204/#1205): fuel use per
// lap against lap time, by stint. It shows numbers and how they were measured,
// never a fit, a correlation or a cost per litre: in real practices the use
// varies 3-8 % and the sign of any trend flips between sessions (thread 36
// #1203), so the only honest question is whether his stints differ by more
// than the laps inside each stint do (camber, #1205).
import {sameLimit} from '@/src/analysis/fuelHistory';
import type {Lap, SessionDetail} from '@/src/data/sessions';
import {formatLapTime} from '@/src/design';

/** A stint gives a median from this many green laps. */
export const MIN_STINT_LAPS = 4;
/** Stints differ when their medians are further apart than this share of the use, and than the laps inside them. */
export const MIN_DIFF_FRACTION = 0.03;

export type FuelUsePoint = {
  lapId: string;
  /** "L7". */
  label: string;
  stint: number;
  fuelL: number;
  timeS: number;
};

export type FuelUseStint = {
  n: number;
  /** Laps in the medians (green, comparable); a tow or traffic does not leave one out. */
  laps: number;
  /** Null under MIN_STINT_LAPS. */
  medianFuelL: number | null;
  /** Spread inside the stint: q3 - q1 of the fuel use per lap. */
  fuelIqrL: number | null;
  medianVePct: number | null;
  medianTimeS: number | null;
  /** How many laps one full load lasts at this stint's use, at the session's fill limit. */
  loadLaps: {fuel: number | null; ve: number | null};
};

export type FuelUseVerdict =
  /** No stint has enough laps for a median. */
  | {kind: 'none'}
  | {kind: 'one-stint'}
  /** The stints' medians are apart by more than the laps inside them. */
  | {kind: 'differs'}
  | {kind: 'same'; lowL: number; highL: number};

export type FuelUse = {
  points: FuelUsePoint[];
  stints: FuelUseStint[];
  verdict: FuelUseVerdict;
  /** The fill limit of this session, litres; null when it has none on record. */
  limitL: number | null;
  /** Median lap time over the laps in the medians. */
  medianTimeS: number | null;
};

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  return quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  );
}

function iqr(values: number[]): number | null {
  if (values.length < 2) return null;
  const v = [...values].sort((a, b) => a - b);
  return quantile(v, 0.75) - quantile(v, 0.25);
}

/** Null for anything but a practice with green laps. */
export function buildFuelUse(
  session: Pick<SessionDetail, 'sessionType' | 'fuel'>,
  laps: Lap[],
): FuelUse | null {
  if (session.sessionType !== 'P') return null;
  // Only the fill limit is a limit: a practice that started part-full has a
  // start level, and the tank is not what the event allows (camber, #158).
  const limitL = session.fuel?.fillLimitL ?? null;

  const usable = laps.filter(
    l =>
      l.comparable &&
      l.fuel?.green === true &&
      l.fuel.usedL != null &&
      l.fuel.usedL > 0 &&
      l.timeS != null,
  );
  if (usable.length === 0) return null;
  const points: FuelUsePoint[] = usable.map(l => ({
    lapId: l.id,
    label: `L${l.lapIndex}`,
    stint: l.stint,
    fuelL: l.fuel!.usedL as number,
    timeS: l.timeS as number,
  }));

  const stintNumbers = [...new Set(usable.map(l => l.stint))].sort(
    (a, b) => a - b,
  );
  const stints = stintNumbers.map((n): FuelUseStint => {
    const inStint = usable.filter(l => l.stint === n);
    const enough = inStint.length >= MIN_STINT_LAPS;
    const fuel = inStint.map(l => l.fuel!.usedL as number);
    const ve = inStint
      .map(l => l.fuel!.veUsedPct)
      .filter((v): v is number => v != null && v > 0);
    const medianFuelL = enough ? median(fuel) : null;
    const medianVePct =
      enough && ve.length >= MIN_STINT_LAPS ? median(ve) : null;
    return {
      n,
      laps: inStint.length,
      medianFuelL,
      fuelIqrL: enough ? iqr(fuel) : null,
      medianVePct,
      medianTimeS: enough ? median(inStint.map(l => l.timeS as number)) : null,
      loadLaps: {
        fuel:
          medianFuelL != null && limitL != null ? limitL / medianFuelL : null,
        ve: medianVePct != null ? 100 / medianVePct : null,
      },
    };
  });

  const eligible = stints.filter(s => s.medianFuelL != null);
  let verdict: FuelUseVerdict;
  if (eligible.length === 0) verdict = {kind: 'none'};
  else if (eligible.length === 1) verdict = {kind: 'one-stint'};
  else {
    const medians = eligible.map(s => s.medianFuelL as number);
    const lowL = Math.min(...medians);
    const highL = Math.max(...medians);
    const within = Math.max(...eligible.map(s => s.fuelIqrL ?? 0));
    const mean = medians.reduce((a, b) => a + b, 0) / medians.length;
    verdict =
      highL - lowL > Math.max(within, MIN_DIFF_FRACTION * mean)
        ? {kind: 'differs'}
        : {kind: 'same', lowL, highL};
  }
  return {
    points,
    stints,
    verdict,
    limitL,
    medianTimeS: median(points.map(p => p.timeS)),
  };
}

/** The plan's race length in laps at a lap time; minutes turn into laps through it. */
export function raceLaps(
  length: {kind: 'laps' | 'min'; value: number},
  lapTimeS: number | null,
): number | null {
  if (length.kind === 'laps') return length.value;
  return lapTimeS != null && lapTimeS > 0
    ? (length.value * 60) / lapTimeS
    : null;
}

/**
 * Whether the plan's rules run at this session's fill limit, so the two can
 * be set side by side (the Barcelona case: another limit is another car,
 * thread 36 #1205). Unknown on either side never matches.
 */
export function planMatchesLimit(
  sessionLimitL: number | null,
  planLimitL: number | null,
): boolean {
  return planLimitL != null && sameLimit(sessionLimitL, planLimitL);
}

const litres = (v: number, digits = 2) => `${v.toFixed(digits)} L`;

export type FuelUseRow = {
  key: string;
  title: string;
  lines: string[];
  /** The stint has green laps, which are in the plan's history when its rules run at this fill limit. */
  counts: boolean;
};

/** One row per stint, as text. */
export function fuelUseRows(fu: FuelUse): FuelUseRow[] {
  return fu.stints.map(s => {
    const title = `Stint ${s.n} · ${s.laps} lap${s.laps === 1 ? '' : 's'}`;
    if (s.medianFuelL == null)
      return {
        key: String(s.n),
        title,
        lines: [`Under ${MIN_STINT_LAPS} laps: no median`],
        counts: s.laps > 0,
      };
    const use = [
      `${litres(s.medianFuelL)}/lap${
        s.fuelIqrL != null ? ` (spread ${s.fuelIqrL.toFixed(2)})` : ''
      }`,
      s.medianVePct != null && `${s.medianVePct.toFixed(1)} % VE/lap`,
      s.medianTimeS != null && formatLapTime(s.medianTimeS),
    ].filter(Boolean);
    const load = [
      s.loadLaps.fuel != null && `${s.loadLaps.fuel.toFixed(1)} laps of fuel`,
      s.loadLaps.ve != null && `${s.loadLaps.ve.toFixed(1)} laps of VE`,
    ].filter(Boolean);
    return {
      key: String(s.n),
      title,
      lines: [
        use.join(' · '),
        ...(load.length ? [`One load: ${load.join(' · ')}`] : []),
      ],
      counts: s.laps > 0,
    };
  });
}

/** What the stints show, or why nothing is shown. */
export function verdictText(fu: FuelUse): string {
  const v = fu.verdict;
  switch (v.kind) {
    case 'none':
      return `Under ${MIN_STINT_LAPS} green laps in each stint: no median`;
    case 'one-stint':
      return 'One stint: nothing to compare';
    case 'same': {
      const low = v.lowL.toFixed(2);
      const high = v.highL.toFixed(2);
      return low === high
        ? `Stints within lap spread: ${low} L/lap`
        : `Stints within lap spread: ${low}–${high} L/lap`;
    }
    case 'differs':
      return 'Medians differ';
  }
}

/** "at the 75 L limit of this session" for the load lines; empty without a limit. */
export function limitText(fu: FuelUse): string {
  return fu.limitL != null
    ? `Limit ${fu.limitL.toFixed(0)} L`
    : 'No fill limit on record';
}

/**
 * The card's last line: which plan these laps belong to, and whether its rules
 * run at this session's fill limit. Laps at another limit are another car and
 * are not in that plan's history (thread 36 #1205).
 */
export function planLinkText(
  greenLaps: number,
  planLabel: string,
  sessionLimitL: number | null,
  planLimitL: number | null,
): string {
  const laps = `${greenLaps} green lap${greenLaps === 1 ? '' : 's'}`;
  if (planLimitL != null && !planMatchesLimit(sessionLimitL, planLimitL)) {
    const ran =
      sessionLimitL != null
        ? `This session ran at the ${sessionLimitL.toFixed(0)} L limit`
        : 'This session has no fill limit on record';
    return `${laps}: not in ${planLabel} (${planLimitL.toFixed(0)} L). ${ran} ›`;
  }
  return `${laps} in ${planLabel} ›`;
}

/** The plan's race beside one load, when the plan's rules run at this session's fill limit. */
export function planRaceText(
  fu: FuelUse,
  length: {kind: 'laps' | 'min'; value: number},
  lengthText: string,
  planLimitL: number | null,
): string | null {
  // Without a preset the plan runs at the last session's limit; only a
  // preset's own limit can differ, and then it has to match.
  if (planLimitL != null && !planMatchesLimit(fu.limitL, planLimitL))
    return null;
  const laps = raceLaps(length, fu.medianTimeS);
  if (laps == null) return null;
  return `Race ${lengthText}: about ${laps.toFixed(0)} laps${
    length.kind === 'min' && fu.medianTimeS != null ? ' at median lap' : ''
  }`;
}
