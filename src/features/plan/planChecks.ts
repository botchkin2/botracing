// What the Plan's three facts rest on (pit-wall thread 104 #7391, #7393,
// #7394, ticket 47). Max fuel, litres a lap and VE a lap each read "checked"
// when two sources agree, "1 source" when only one exists, "disagrees" when
// the second contradicts the first; nothing is dropped or corrected, the plan
// uses its own number either way. The offline line says whether an offline
// practice's rules have met an online session yet. Pure.
import {usage} from '@/src/analysis/fuelPlan';
import type {PlanBlock, SessionSummary, SessionType} from '@/src/data/sessions';

import type {RuleSession, RuleSet} from './ruleSet';

export type CheckState = 'checked' | 'one-source' | 'disagrees';

/** Two docs of one run (the tray's live capture and LMU's .duckdb) start within this many seconds of each other. */
export const TWIN_WINDOW_S = 60;
/** Max fuel: str × 100 and maxValue are whole litres, so equal within half a litre. */
export const MAX_FUEL_EQUAL_L = 0.5;
/** Litres a lap vs his other runs here (any rules): within 4 % (15 pairs, thread 104 #7393). */
export const FUEL_PER_LAP_TOLERANCE = 0.04;
/** VE a lap measured against LMU's setup expectation: 3 % under to 10 % over (its estimate sits 0 to 7 % under what he drives). */
export const VE_UNDER_LMU = 0.03;
export const VE_OVER_LMU = 0.1;

/** A session of the track and car, as the checks read it. `trackCar` is equal for sessions of one combo. */
export type CheckRun = RuleSession & {
  trackCar: string;
  /** The median litres of its green laps; null when it carries no lap rows (only the newest sessions do). */
  fuelPerLapL: number | null;
};

/** A session of the combo as the rule sets and the checks read it; null with no plan block (nothing to read). */
export function checkRunOf(
  s: SessionSummary,
  plan: PlanBlock | null,
): CheckRun | null {
  const f = plan?.fuel;
  if (!f) return null;
  return {
    id: s.id,
    startedAt: s.startedAt,
    sessionType: s.sessionType,
    trackCar: `${s.trackId}|${s.car}`,
    ratio: f.litresPerVePct,
    stopRatio: f.litresPerVePctStop,
    fillLimitL: f.fillLimitL,
    tankL: f.tankL,
    startL: f.startL,
    online: s.online,
    setupVePct: f.setupVePct,
    setupVePerLapPct: f.setupVePerLapPct,
    fuelPerLapL: usage((plan.laps ?? []).map(l => l.usedL))?.median ?? null,
  };
}

/** One real run: the docs that recorded it, merged. */
export type Run = {ids: string[]; run: CheckRun};

export type FactCheck = {
  /** Null when the number is not known; then `state` is null too. */
  value: number | null;
  state: CheckState | null;
};

export type OfflineLine =
  | {kind: 'matched'; online: {startedAt: string; sessionType: SessionType}}
  | {kind: 'not-compared'};

export type PlanChecks = {
  /** Litres: the event's cap, from the setup. */
  maxFuelL: FactCheck;
  fuelPerLapL: FactCheck;
  vePerLapPct: FactCheck & {
    /** LMU's own expectation it was held against; null without one. */
    lmuPct: number | null;
  };
  /** Null unless the rule set holds an offline session. */
  offline: OfflineLine | null;
};

/**
 * Sessions of one run, collapsed. A live capture and its .duckdb twin (and
 * the third doc a re-sync can leave, 10-15's 32c9d386 / 7e812df9 / c7ae92b3)
 * are one run of the same track and car starting within a minute; counted
 * apart, a run would be its own second source. The merged run takes each
 * field from the first doc that has it, docs with the setup first: the
 * capture's `tankL` is the car's own tank, the game file's is the event's.
 */
export function collapseTwins(sessions: CheckRun[]): Run[] {
  const byStart = [...sessions].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
  const groups: CheckRun[][] = [];
  for (const s of byStart) {
    const g = groups.find(
      x =>
        x[0].trackCar === s.trackCar &&
        Math.abs(Date.parse(s.startedAt) - Date.parse(x[0].startedAt)) <=
          TWIN_WINDOW_S * 1000,
    );
    if (g) g.push(s);
    else groups.push([s]);
  }
  return groups
    .map(g => ({ids: g.map(s => s.id), run: mergeTwins(g)}))
    .sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
}

function mergeTwins(g: CheckRun[]): CheckRun {
  const ordered = [...g].sort(
    (a, b) => Number(b.fillLimitL != null) - Number(a.fillLimitL != null),
  );
  const first = <K extends keyof CheckRun>(k: K): CheckRun[K] =>
    (ordered.find(s => s[k] != null) ?? ordered[0])[k];
  return {
    ...g[0],
    fillLimitL: first('fillLimitL'),
    tankL: first('tankL'),
    startL: first('startL'),
    ratio: first('ratio'),
    stopRatio: first('stopRatio'),
    online: first('online'),
    setupVePct: first('setupVePct'),
    setupVePerLapPct: first('setupVePerLapPct'),
    fuelPerLapL: first('fuelPerLapL'),
  };
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function planChecks({
  set,
  sessions,
  measured,
  ownIds,
}: {
  /** The planned rule set. */
  set: RuleSet;
  /** Every session of his at this track and car. */
  sessions: CheckRun[];
  /** The numbers the Plan shows: the medians of the laps it planned from. */
  measured: {fuelPerLapL: number | null; vePerLapPct: number | null};
  /** The sessions those laps came from: their runs are not a second source for them. */
  ownIds: string[];
}): PlanChecks {
  const runs = collapseTwins(sessions);
  const inSet = (r: Run) => r.ids.some(id => set.sessionIds.includes(id));
  const setRuns = runs.filter(inSet);
  const source = runs.find(r => r.ids.includes(set.ratio.from.id)) ?? null;

  return {
    maxFuelL: maxFuelCheck(source, setRuns),
    fuelPerLapL: fuelPerLapCheck(
      measured.fuelPerLapL,
      runs.filter(r => !r.ids.some(id => ownIds.includes(id))),
    ),
    vePerLapPct: vePerLapCheck(measured.vePerLapPct, setRuns),
    offline: offlineLine(setRuns),
  };
}

// Max fuel is the setup's `VM_FUEL_LEVEL.maxValue`. In a week that caps the
// fill it equals the setup string's str × 100, a second reading in the same
// file; in an uncapped week it is the car's tank and str × 100 is only what he
// chose to load (Imola 07-21: 84 and 89 L in one week, maxValue 115 both), so
// that never counts or contradicts. Either way another run of the set must
// carry the same maxValue to confirm it and a different one disagrees. A run
// with no str × 100 is a live capture, whose tank is the car's own 117 L even
// in a 73 L week: it is no source (thread 104 #7399).
function maxFuelCheck(source: Run | null, setRuns: Run[]): FactCheck {
  const value = source?.run.tankL ?? null;
  if (source == null || value == null || source.run.fillLimitL == null)
    return {value: null, state: null};
  const equal = (l: number) => Math.abs(l - value) <= MAX_FUEL_EQUAL_L;
  const capped = equal(source.run.fillLimitL);
  const others = setRuns
    .filter(
      r => r !== source && r.run.fillLimitL != null && r.run.tankL != null,
    )
    .map(r => r.run.tankL as number);
  if (others.some(l => !equal(l))) return {value, state: 'disagrees'};
  return {value, state: capped || others.length > 0 ? 'checked' : 'one-source'};
}

function fuelPerLapCheck(value: number | null, others: Run[]): FactCheck {
  if (value == null) return {value: null, state: null};
  const theirs = others.flatMap(r =>
    r.run.fuelPerLapL != null ? [r.run.fuelPerLapL] : [],
  );
  if (theirs.length === 0) return {value, state: 'one-source'};
  const against = median(theirs);
  const within =
    Math.abs(value - against) / against <= FUEL_PER_LAP_TOLERANCE + 1e-9;
  return {value, state: within ? 'checked' : 'disagrees'};
}

// LMU's expectation comes from the set's file with the highest VE setting:
// '20% (5.3 laps)' carries ±1 % of rounding, '100% (28.9 laps)' ±0.2 %.
function vePerLapCheck(
  value: number | null,
  setRuns: Run[],
): FactCheck & {lmuPct: number | null} {
  const best = setRuns
    .filter(r => r.run.setupVePerLapPct != null && r.run.setupVePct != null)
    .reduce<Run | null>(
      (a, r) =>
        a == null || (r.run.setupVePct as number) > (a.run.setupVePct as number)
          ? r
          : a,
      null,
    );
  const lmuPct = best?.run.setupVePerLapPct ?? null;
  if (value == null) return {value: null, state: null, lmuPct};
  if (lmuPct == null) return {value, state: 'one-source', lmuPct: null};
  const off = (value - lmuPct) / lmuPct;
  const within = off >= -VE_UNDER_LMU - 1e-9 && off <= VE_OVER_LMU + 1e-9;
  return {value, state: within ? 'checked' : 'disagrees', lmuPct};
}

// "Matched" means an online session sits in the offline practice's rule set:
// its litres per 1 % VE within RATIO_TOLERANCE of the others' (ruleSet.ts).
function offlineLine(setRuns: Run[]): OfflineLine | null {
  if (!setRuns.some(r => r.run.online === false)) return null;
  const online = setRuns.find(r => r.run.online === true);
  return online
    ? {
        kind: 'matched',
        online: {
          startedAt: online.run.startedAt,
          sessionType: online.run.sessionType,
        },
      }
    : {kind: 'not-compared'};
}
