import {type HistoryDrift} from '@/src/analysis/fuelHistory';
import {
  type FuelPlan,
  type Load,
  type LoadToFinish,
  MIN_GREEN_LAPS,
  type GreenLap,
  type PlanRules,
  presetMismatch,
} from '@/src/analysis/fuelPlan';
import {
  type PlanLap,
  type PlanSession,
  type SessionFuel,
  type SessionSummary,
} from '@/src/data/sessions';
import {carLabel, formatDate} from '@/src/design';
import {planComboKey} from '@/src/nav/routes';
import {type FuelPreset, type RaceLength} from '@/src/state/fuelPresets';
import {type Combo, comboCar, comboTrack} from '@/src/workspace/planCombo';

import {type FormationBurn, formationText} from './formation';
import {type RuleSet} from './ruleSet';
import {effectiveUnit, type Unit} from './unit';

// The pre-race planner screen's model (pit wall thread 35): which track+car
// combinations he has history for, the laps that count, the rules in force,
// and the finished lines each card prints. Pure; the screen only lays it out.

/**
 * The Plan column's own width: its content plus the padding on both sides. A
 * box's `width` includes its padding, so a column given only the content
 * width left the cards two gutters narrower than the charts drawn for them,
 * and the race timeline ran out of its card at 375 pt (thread 104).
 */
export function columnWidth(contentW: number, gutter: number): number {
  return contentW + 2 * gutter;
}

/** Sessions of one track and car model that the history is drawn from. */
export const HISTORY_SESSIONS = 8;

/**
 * The Plan a track he has never driven opens on (M11: Tracks → Plan): the
 * track with the car of his newest LMU session, his current car; the Plan's
 * car picker changes it. Null with no LMU session to take a car from.
 */
export function undrivenPlanKey(
  trackId: string,
  sessions: SessionSummary[],
): string | null {
  const newest = sessions
    .filter(s => s.sim === 'lmu' && s.lapCount > 0)
    .reduce<SessionSummary | null>(
      (a, s) => (a == null || s.startedAt > a.startedAt ? s : a),
      null,
    );
  return newest
    ? planComboKey(trackId, carLabel(newest.car).model, 'lmu')
    : null;
}

/**
 * The fill limit a session ran at, in the order `rulesFor` reads it: the
 * setup's limit, else what he started with, else the tank. Null when the
 * session doc has no fuel facts.
 */
export function sessionLimitL(fuel: SessionFuel | null): number | null {
  return fuel?.fillLimitL ?? fuel?.startL ?? fuel?.tankL ?? null;
}

/**
 * The fill limit of each session at a track and car, from the plan blocks
 * GET /plan returned, and whether the request is still loading. `rows` lines
 * up with `combo.sessions`. While the request is in flight a session has no
 * limit yet (undefined: left out of the history, not waited for forever). Once
 * it has answered, a session the answer does not list (past the route's cap, or
 * a doc whose stored carModel was never resynced) is no data (null), the same
 * as a session with no block (uploaded before it existed): never zero.
 */
export function limitsOfPlan(
  rows: (PlanSession | undefined)[],
  pending: boolean,
  /** The request has answered. A session the answer does not list is then no data (null), not still loading. */
  answered = false,
): {pending: boolean; limitsL: (number | null | undefined)[]} {
  return {
    pending,
    limitsL: rows.map(r =>
      r === undefined
        ? answered
          ? null
          : undefined
        : sessionLimitL(r.plan?.fuel ?? null),
    ),
  };
}

/**
 * The sessions whose laps feed the plan: the newest few at the track and car,
 * whatever fill limit they ran. Fuel per lap is the car on the track, so the
 * history is pooled in litres across events; only VE % depends on the load,
 * and that is worked out through the ratio of the event being planned
 * (`veRatioFor`). A real jump in use (balance of performance) is cut out later
 * by `sinceChange` (pit wall thread 36 #1102, thread 44 #1968).
 * `limitsL` lines up with `combo.sessions`; undefined is a session doc still
 * loading, which is not used yet.
 */
export function historySessions(
  combo: Combo,
  limitsL: (number | null | undefined)[],
  /** The planned event's sessions: always in the history, however old, so an older event still finds its own ratio. */
  eventIds: string[] = [],
): SessionSummary[] {
  const loaded = combo.sessions.filter((_, i) => limitsL[i] !== undefined);
  const newest = new Set(loaded.slice(0, HISTORY_SESSIONS).map(s => s.id));
  return loaded.filter(s => newest.has(s.id) || eventIds.includes(s.id));
}

/**
 * The full load of an event: the largest fill limit over its sessions, else
 * the largest start, else the tank. A Q or R start under the full load is his
 * choice, never the event's cap ("fuel is time", thread 44 #1985). Null when
 * none of its docs has a fuel fact.
 */
export function eventLoad(
  fuels: (SessionFuel | null | undefined)[],
): {kind: 'fill limit' | 'start fuel' | 'tank'; litres: number} | null {
  const max = (pick: (f: SessionFuel) => number | null | undefined) => {
    const v = fuels.flatMap(f => {
      const x = f ? pick(f) : null;
      return x == null ? [] : [x];
    });
    return v.length > 0 ? Math.max(...v) : null;
  };
  const fill = max(f => f.fillLimitL);
  if (fill != null) return {kind: 'fill limit', litres: fill};
  const start = max(f => f.startL);
  if (start != null) return {kind: 'start fuel', litres: start};
  const tank = max(f => f.tankL);
  return tank != null ? {kind: 'tank', litres: tank} : null;
}

/**
 * The newest session's fuel with the planned event's load put in its place:
 * what `rulesFor` reads as the last session. Under a rule set the load is its
 * own (`load`: its most-run litres, or none) and the start and the tank are
 * never the load: a practice's start is not the event's, and a live capture
 * reports the car's own 117 L tank, not the event's cap (pit-wall thread 104).
 */
export function lastFuelOf(
  newestFuel: SessionFuel | null,
  load: {kind: 'fill limit' | 'start fuel' | 'tank'; litres: number} | null,
  underRuleSet: boolean,
): SessionFuel | null {
  if (!newestFuel || (!load && !underRuleSet)) return newestFuel;
  return {
    ...newestFuel,
    fillLimitL: load?.kind === 'fill limit' ? load.litres : null,
    startL: underRuleSet
      ? null
      : load?.kind === 'start fuel'
      ? load.litres
      : newestFuel.startL,
    tankL: underRuleSet
      ? null
      : load?.kind === 'tank'
      ? load.litres
      : newestFuel.tankL,
  };
}

export type VeRatio = {
  /** Litres of fuel per 1 % VE. */
  perPctL: number;
  /** Where it came from: the preset, or the session of the rule set it was measured in. */
  source: {kind: 'preset'} | {kind: 'session'; startedAt: string};
};

/**
 * The ratio to plan with: the preset's if it sets one, else the planned rule
 * set's (the newest race or qualifying in it, ruleSet.ts), else none. A
 * preset's fuel no longer picks the ratio: a load that matched none of his
 * sessions used to drop VE and plan on litres (thread 104, 75 L at Sebring).
 *
 * The ratio belongs to the rules, not the load (0.67 to 0.99 L per % across
 * rules of one car, parc's 9-month audit, thread 44 #1980); nothing is
 * estimated from the load and another rule set's ratio is never taken.
 */
export function veRatioFor(
  preset: FuelPreset | null,
  rules: RuleSet | null,
): VeRatio | null {
  if (preset?.veRatio != null)
    return {perPctL: preset.veRatio, source: {kind: 'preset'}};
  return rules
    ? {
        perPctL: rules.ratio.perPctL,
        source: {kind: 'session', startedAt: rules.ratio.from.startedAt},
      }
    : null;
}

/**
 * Clean laps of one session, as the planner reads them: fuel in litres, and
 * VE % as those litres over the ratio (null without one). The block holds
 * only the laps the planner keeps (green, fuel used, timed), so there is
 * nothing to filter here; it is null for a session past the newest few.
 */
export function greenLapsOf(
  sessionId: string,
  laps: PlanLap[],
  ratio: number | null,
): GreenLap[] {
  return laps.map(l => ({
    fuelL: l.usedL,
    vePct: ratio != null && ratio > 0 ? l.usedL / ratio : null,
    lapTimeS: l.timeS,
    sessionId,
    lapIndex: l.n,
    comparable: l.comparable,
    veMeasured: l.veUsedPct != null && l.veUsedPct > 0,
  }));
}

/**
 * Whether the plan has no VE to show: enough green laps for a median, and
 * fewer than the planner's minimum of them recorded VE themselves. Chosen from
 * the data, never from the car class, so a mixed history (Barcelona: March laps
 * without VE, August with) reads right (camber, thread 43 #1243). With too few
 * laps for a median at all, nothing is known about VE either way, so it is not
 * fuel-only: both meters read "no data" (apex, #1309).
 */
export function fuelOnly(laps: GreenLap[]): boolean {
  return (
    laps.length >= MIN_GREEN_LAPS &&
    laps.filter(l => l.veMeasured).length < MIN_GREEN_LAPS
  );
}

/** One row of a picker list: the combo it selects, its text, and whether it is the one in force. */
export type Choice = {key: string; label: string; selected: boolean};

/**
 * The tracks to pick from, one per circuit, newest first. A track keeps the
 * current car where it has been driven there, and else takes its newest car.
 */
export function trackChoices(combos: Combo[], current: Combo): Choice[] {
  return combos
    .filter((c, i) => combos.findIndex(o => o.trackId === c.trackId) === i)
    .map(t => ({
      key: (
        combos.find(c => c.trackId === t.trackId && c.car === current.car) ?? t
      ).key,
      label: comboTrack(t),
      selected: t.trackId === current.trackId,
    }));
}

/** The cars driven at the current track. */
export function carChoices(combos: Combo[], current: Combo): Choice[] {
  return combos
    .filter(c => c.trackId === current.trackId)
    .map(c => ({
      key: c.key,
      label: comboCar(c),
      selected: c.key === current.key,
    }));
}

/** A one-tap offer of the last race's start (parc #1902): its text, and the value it sets. */
export type StartChip = {label: string; text: string};

/**
 * The last race's start, offered beside the Start inputs instead of being
 * prefilled: a start under the full load is usually that race's own choice, so
 * the plan never starts from a value nobody set this time. A start at the full
 * load (or none recorded) offers nothing.
 */
export function startChips(
  last: {fuelL: number | null; vePct: number | null} | null,
  caps: {fuelL: number | null; vePct: number},
  hasVe: boolean,
): {ve: StartChip | null; fuel: StartChip | null} {
  const under = (v: number | null, cap: number) =>
    v != null && v > 0 && v < cap - 0.5 ? v : null;
  const ve = hasVe ? under(last?.vePct ?? null, caps.vePct) : null;
  const fuel = caps.fuelL == null ? null : under(last?.fuelL ?? null, caps.fuelL);
  return {
    ve:
      ve == null
        ? null
        : {
            label: `Last race here: ${Math.round(ve)} %`,
            text: String(Math.round(ve)),
          },
    fuel:
      fuel == null
        ? null
        : {
            label: `Last race here: ${fuel.toFixed(1)} L`,
            text: fuel.toFixed(1),
          },
  };
}

/** One number of the rules in force, finished for the Rules block. */
export type RulesCell = {label: string; value: string};

/** The numbers the plan is worked with; the VE ones only for a car with VE. */
export function rulesCells(
  rules: PlanRules | null,
  hasVe: boolean,
  /** What the formation lap burns, measured or estimated (`formation.ts`); unset reads "1 lap". */
  formation: FormationBurn | null = null,
): RulesCell[] {
  if (!rules) return [];
  return [
    // Max fuel is the facts line's (planChecks.ts): this block never repeats it
    // under the same name with the load the plan uses (thread 104 #7403)
    ...(hasVe ? [{label: 'Max VE', value: `${rules.vePct} %`}] : []),
    {
      label: 'Mandatory',
      value: `${rules.mandatoryStops} ${
        rules.mandatoryStops === 1 ? 'stop' : 'stops'
      }`,
    },
    {
      label: 'Formation',
      value: !rules.formationLap
        ? 'none'
        : formation
        ? formationText(formation)
        : '1 lap',
    },
  ];
}

/** A typed number: positive and finite, else null (empty, "7.", "abc", 0). */
export function parseNumber(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Where the fuel to plan with came from. */
export type FuelSource = 'preset' | 'fill limit' | 'tank' | 'start fuel' | 'unknown';

export type Rules = {
  rules: PlanRules;
  fuelSource: FuelSource;
  /** The last session there, for the rules line. */
  last: SessionFuel | null;
};

/**
 * The rules to plan with. Max fuel is the preset's, else the fill limit of
 * his last session at this track and car, else what he started with there
 * (the fill limit when the setup was not recorded), else the tank, which is
 * only the ceiling; null when none is known and he has to type it.
 */
export function rulesFor(
  preset: FuelPreset | null,
  length: RaceLength,
  last: SessionFuel | null,
  /** What the car starts with, when it is less than the full load (typed for this race); null or unset is full. */
  start: {fuelL?: number | null; vePct?: number | null} = {},
  /**
   * A VE car in a rule set whose load is not known (a practice only, thread
   * 104) plans on VE alone: no load, no fuel meter, nothing in litres.
   */
  planOnVeAlone = false,
): Rules | null {
  let fuelL: number | null = null;
  let fuelSource: FuelSource = 'preset';
  if (preset?.fuelL != null) {
    fuelL = preset.fuelL;
  } else if (last?.fillLimitL != null) {
    fuelL = last.fillLimitL;
    fuelSource = 'fill limit';
  } else if (last?.startL != null) {
    fuelL = last.startL;
    fuelSource = 'start fuel';
  } else if (last?.tankL != null) {
    fuelL = last.tankL;
    fuelSource = 'tank';
  }
  if (fuelL == null && planOnVeAlone) fuelSource = 'unknown';
  else if (fuelL == null) return null;
  return {
    fuelSource,
    last,
    rules: {
      name: preset ? preset.name : 'No limits',
      lengthLaps: length.kind === 'laps' ? length.value : null,
      lengthMin: length.kind === 'min' ? length.value : null,
      fuelL,
      // a stored preset vePct is kept in its doc but not read: no series VE % is applied (thread 104)
      vePct: 100,
      formationLap: preset ? preset.formationLap : true,
      mandatoryStops: preset ? preset.mandatoryStops : 0,
      startFuelL: start.fuelL ?? null,
      startVePct: start.vePct ?? null,
    },
  };
}

// --- what the screen prints -------------------------------------------------

export type Row = {label: string; value: string; note?: string};

/** The Load to finish card: one row per race length, the median and p90 loads side by side. */
export type LoadTable = {
  title: string;
  head: string[];
  rows: {label: string; median: string; p90: string}[];
};

export type PlanView = {
  /** "Rules: Endurance 75 % fuel · set 26 Sep 2026". */
  rulesLine: string;
  /** "preset 75 L · last race 84 L" when the preset may be stale. */
  stale: string | null;
  /** What the per-lap numbers stand on: the newest session's drift, the VE ratio's source, and the laps and sessions (thread 99, #6684). */
  basis: {drift: Row | null; ratio: string | null; from: string};
  /** Set when the race fits one load. */
  loadTable: LoadTable | null;
};

const NL = String.fromCharCode(10);
const l2 = (v: number) => `${v.toFixed(2)} L`;
/** The Plan's words when no session here measured VE (pit-wall thread 104 #7391). */
export const NO_VE_MEASURED =
  "No VE measured here yet. Run an offline practice with this week's settings.";

const pct2 = (v: number) => `${v.toFixed(2)} %`;

/** Why there is no VE a lap, else null: where the ratio came from is the rules line's (session and date), and the ratio itself is no number he reads. */
function ratioNote(
  ratio: VeRatio | null,
  fuelL: number | null,
  loadsL: number[],
  eventText: string | null = null,
): string | null {
  if (!ratio && eventText != null)
    return NO_VE_MEASURED;
  if (!ratio)
    return loadsL.length > 0
      ? `no VE: none of your sessions ran ${fuelL} L (they ran ${loadsL.join(
          ', ',
        )} L) and the ratio follows the load; type it into the preset`
      : 'no VE ratio yet: no green lap with both fuel and VE';
  return null;
}

function loadCell(l: Load): string {
  const parts = [
    l.vePct != null ? pct2(l.vePct) : null,
    l.fuelL != null ? l2(l.fuelL) : null,
  ].filter(Boolean);
  return `${parts.join(' · ')}${l.fits ? '' : ' · over'}`;
}

/** A race that fits one load, read the other way round (thread 35 #1015): one row per race length. */
function loadTable(rows: LoadToFinish[], r: PlanRules): LoadTable {
  const limits = new Set(rows.map(row => row.atP90.limitedBy));
  const only = limits.size === 1 ? [...limits][0] : null;
  return {
    title: 'Load to finish',
    head: [
      '',
      'Median',
      only === 'fuel'
        ? 'p90 · fuel limits'
        : only === 've'
        ? 'p90 · VE limits'
        : 'p90',
    ],
    rows: rows.map(row => ({
      label: `${row.laps} laps${r.formationLap ? ' + form.' : ''}`,
      median: loadCell(row.atMedian),
      p90: loadCell(row.atP90),
    })),
  };
}

/**
 * The newest session against the older ones, when its use per lap has moved
 * more than the drift threshold: the plan then uses the laps since the change.
 */
export function driftRowOf(d: HistoryDrift): Row {
  const meters = [
    d.fuelL
      ? `${d.fuelL.newest.toFixed(2)} L a lap against ${d.fuelL.history.toFixed(
          2,
        )} L`
      : null,
    d.vePct
      ? `${d.vePct.newest.toFixed(2)} %/lap against ${d.vePct.history.toFixed(
          2,
        )} %`
      : null,
  ].filter(Boolean);
  const others = d.droppedSessions + d.keptSessions - 1;
  const of = `${others} other ${others === 1 ? 'session' : 'sessions'}`;
  const note = d.applied
    ? `differs from ${of} · plan uses the last ${d.keptLaps} laps (${
        d.keptSessions
      } ${d.keptSessions === 1 ? 'session' : 'sessions'})`
    : `lower than ${of} · not used until a second session agrees`;
  return {label: 'Newest session', value: meters.join(NL), note};
}

export function planView(
  preset: FuelPreset | null,
  rules: Rules,
  plan: FuelPlan,
  history: {
    since: string | null;
    lastFillLimitL: number | null;
    /** The VE ratio in use, and the last session's for comparison. */
    ratio: VeRatio | null;
    lastRatio: number | null;
    /** The fill limits of the history sessions that have a ratio, for the note. */
    ratioLoadsL: number[];
    /** The event the plan is for ("Rules from your race, Oct 21 · One Stint Sprint"); null for a preset or no event. */
    eventText?: string | null;
    /** The event is a rule set: its load is its own, so the car's tank (117 L from a live capture) is not printed beside it. */
    ruleSet?: boolean;
    /** Set when the newest session's use has moved away from the older ones. */
    drift: HistoryDrift | null;
  },
  /** The one unit the rows speak in: VE where the plan has it, unless fuel is asked for (thread 44 #1826). */
  unit: Unit = 've',
): PlanView {
  const r = rules.rules;
  const eventText = preset ? null : history.eventText ?? null;
  const rulesLine = preset
    ? `Rules: ${preset.name}  ·  set ${formatDate(preset.savedAt)}`
    : history.ruleSet || rules.fuelSource === 'unknown'
    ? // a rule set names its session and date; its max fuel is the checks' own line
      eventText ?? 'Rules: last race here'
    : `Rules: ${eventText ?? 'last race here'} (${r.fuelL} L ${
        rules.fuelSource === 'fill limit'
          ? 'fill limit'
          : rules.fuelSource === 'tank'
          ? 'tank'
          : 'start fuel'
      }${
        rules.fuelSource !== 'tank' &&
        rules.last?.tankL != null
          ? `, ${rules.last.tankL} L tank`
          : ''
      })`;
  const mismatch = preset
    ? r.fuelL == null
      ? null
      : presetMismatch(r.fuelL, history.lastFillLimitL)
    : null;
  const fuelStale = mismatch
    ? `max fuel: preset ${mismatch.presetL} L  ·  last session there ${mismatch.lastL} L`
    : null;
  // A preset ratio that differs from what the last session measured.
  const ratioStale =
    preset?.veRatio != null &&
    history.lastRatio != null &&
    Math.abs(preset.veRatio - history.lastRatio) / history.lastRatio > 0.03
      ? `L per 1 % VE: preset ${preset.veRatio.toFixed(
          3,
        )}  ·  last session there ${history.lastRatio.toFixed(3)}`
      : null;
  const stale = [fuelStale, ratioStale].filter(Boolean).join(' · ') || null;

  const {ve} = plan.perLap;
  const since = history.since ? `, since ${formatDate(history.since)}` : '';
  const shown = effectiveUnit(unit, ve != null);
  const basis = {
    drift: history.drift ? driftRowOf(history.drift) : null,
    ratio:
      shown === 've' || ve == null
        ? ratioNote(
            history.ratio,
            r.fuelL,
            history.ratioLoadsL,
            preset ? null : history.eventText ?? null,
          ) ?? null
        : null,
    from: `${plan.history.laps} ${
      plan.history.laps === 1 ? 'lap' : 'laps'
    } in ${plan.history.sessions} ${
      plan.history.sessions === 1 ? 'session' : 'sessions'
    }${since}`,
  };

  return {
    rulesLine,
    stale,
    basis,
    loadTable: plan.loadToFinish ? loadTable(plan.loadToFinish, r) : null,
  };
}
