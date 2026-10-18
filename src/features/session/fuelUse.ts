// The practice and race view (pit-wall thread 36 and 73, #1115/#1203/#1204/#1205): fuel use per
// lap against lap time, by stint. It shows numbers and how they were measured,
// never a fit, a correlation or a cost per litre: in real practices the use
// varies 3-8 % and the sign of any trend flips between sessions (thread 36
// #1203), so the only honest question is whether his stints differ by more
// than the laps inside each stint do (camber, #1205).
import {sameLimit} from '@/src/analysis/fuelHistory';
import type {Lap, SessionDetail} from '@/src/data/sessions';
import {formatGap, formatLapTime, oneDecimal} from '@/src/design';
import {iqr, median} from '@/src/analysis/setStats';
import {MIN_GREEN_LAPS} from '@/src/analysis/fuelPlan';

/** A stint gives a median from this many green laps. */
/** The fewest green laps a stint needs for a median use: the Plan's own floor, so a stint line, this card and the Plan give a number for the same laps. */
export const MIN_STINT_LAPS = MIN_GREEN_LAPS;
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
  /** Median seconds a lap spends coasting (pit-wall thread 72); null under MIN_STINT_LAPS laps with the figure. */
  medianCoastS: number | null;
  /** How many laps one full load lasts at this stint's use, at the session's fill limit. */
  loadLaps: {fuel: number | null; ve: number | null};
  /**
   * This stint's medians against the first stint's (this minus that): what a
   * fuel save cost. Null for the first stint and for a stint without a median.
   */
  vsFirst: {
    /** The stint it is against. */
    against: number;
    fuelL: number;
    vePct: number | null;
    timeS: number;
    coastS: number | null;
  } | null;
};

export type FuelUseVerdict =
  /** No stint has enough laps for a median. */
  | {kind: 'none'}
  | {kind: 'one-stint'}
  /** The stints' medians are apart by more than the laps inside them. */
  | {kind: 'differs'}
  | {kind: 'same'; lowL: number; highL: number};

export type FuelUse = {
  /** A race: the plan owns laps per load, so the card does not print it (thread 73 #5596). */
  race: boolean;
  points: FuelUsePoint[];
  stints: FuelUseStint[];
  verdict: FuelUseVerdict;
  /** The fill limit of this session, litres; null when it has none on record. */
  limitL: number | null;
  /** Median lap time over the laps in the medians. */
  medianTimeS: number | null;
};

/**
 * The laps a fuel or VE figure per lap is taken over, on every screen: the
 * green ones (timed, whole, no pit, no yellow) with a fuel use. Green, not
 * comparable: a slow or off-track lap still burns fuel, and the stored stint
 * medians and the Plan use the same set, so all of them print the same number.
 */
export function greenLaps(laps: Lap[]): Lap[] {
  return laps.filter(
    l =>
      l.fuel?.green === true &&
      l.fuel.usedL != null &&
      l.fuel.usedL > 0 &&
      l.timeS != null,
  );
}

/** Null for a qualifying and for a session with no green lap. */
export function buildFuelUse(
  session: Pick<SessionDetail, 'sessionType' | 'fuel'>,
  laps: Lap[],
): FuelUse | null {
  if (session.sessionType === 'Q') return null;
  // Only the fill limit is a limit: a practice that started part-full has a
  // start level, and the tank is not what the event allows (camber, #158).
  const limitL = session.fuel?.fillLimitL ?? null;

  const usable = greenLaps(laps);
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
    const coast = inStint
      .map(l => l.coastS)
      .filter((v): v is number => v != null);
    const medianCoastS =
      enough && coast.length >= MIN_STINT_LAPS ? median(coast) : null;
    return {
      n,
      laps: inStint.length,
      medianFuelL,
      fuelIqrL: enough ? iqr(fuel) : null,
      medianVePct,
      medianCoastS,
      medianTimeS: enough ? median(inStint.map(l => l.timeS as number)) : null,
      loadLaps: {
        fuel:
          medianFuelL != null && limitL != null ? limitL / medianFuelL : null,
        ve: medianVePct != null ? 100 / medianVePct : null,
      },
      vsFirst: null,
    };
  });
  const first = stints.find(
    s => s.medianFuelL != null && s.medianTimeS != null,
  );
  for (const s of stints) {
    if (!first || s === first || s.medianFuelL == null || s.medianTimeS == null)
      continue;
    s.vsFirst = {
      against: first.n,
      fuelL: s.medianFuelL - (first.medianFuelL as number),
      vePct:
        s.medianVePct != null && first.medianVePct != null
          ? s.medianVePct - first.medianVePct
          : null,
      timeS: s.medianTimeS - (first.medianTimeS as number),
      coastS:
        s.medianCoastS != null && first.medianCoastS != null
          ? s.medianCoastS - first.medianCoastS
          : null,
    };
  }

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
    race: session.sessionType === 'R',
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

/** "−0.18 L/lap · −0.25 % VE/lap · −0.14 s": signed, true minus, the stint against the first. */
export function vsFirstText(v: NonNullable<FuelUseStint['vsFirst']>): string {
  return [
    `${formatGap(v.fuelL, 2)} L/lap`,
    v.vePct != null && `${formatGap(v.vePct, 2)} % VE/lap`,
    // Time gaps are 3 decimals app-wide (CODE_STANDARDS §4).
    `${formatGap(v.timeS)} s`,
    v.coastS != null && `${formatGap(v.coastS, 1)} s coast/lap`,
  ]
    .filter(Boolean)
    .join(' · ');
}

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
        s.fuelIqrL != null ? ` (IQR ${s.fuelIqrL.toFixed(2)})` : ''
      }`,
      s.medianVePct != null && `${oneDecimal(s.medianVePct)} % VE/lap`,
      s.medianTimeS != null && formatLapTime(s.medianTimeS),
      s.medianCoastS != null && `${oneDecimal(s.medianCoastS)} s coast/lap`,
    ].filter(Boolean);
    // A race: the plan owns laps per load (one owner per fact).
    const load = fu.race
      ? []
      : [
          s.loadLaps.fuel != null &&
            `${s.loadLaps.fuel.toFixed(1)} laps of fuel`,
          s.loadLaps.ve != null && `${s.loadLaps.ve.toFixed(1)} laps of VE`,
        ].filter(Boolean);
    return {
      key: String(s.n),
      title,
      lines: [
        use.join(' · '),
        ...(s.vsFirst
          ? [`vs stint ${s.vsFirst.against}: ${vsFirstText(s.vsFirst)}`]
          : []),
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
        ? `Stints within lap IQR: ${low} L/lap`
        : `Stints within lap IQR: ${low}–${high} L/lap`;
    }
    case 'differs':
      return 'Medians differ';
  }
}

/** "Limit 75 L" under the load lines; null without a limit (no line, roadmap 2i). */
export function limitText(fu: FuelUse): string | null {
  return fu.limitL != null ? `Limit ${fu.limitL.toFixed(0)} L` : null;
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
    const plan = `${laps}: not in ${planLabel} (${planLimitL.toFixed(0)} L)`;
    // Without a limit there is nothing to set beside the plan's (roadmap 2i).
    return sessionLimitL != null
      ? `${plan}. This session ran at the ${sessionLimitL.toFixed(0)} L limit ›`
      : `${plan} ›`;
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
  // A race has its own plan card (planVsRace): one owner for the race length.
  if (fu.race) return null;
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
