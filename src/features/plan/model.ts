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
  type Lap,
  type SessionDetail,
  type SessionFuel,
  type SessionSummary,
} from '@/src/data/sessions';
import {
  CLEAN_AHEAD_S,
  CLEAN_BATTLE_S,
  type SessionTraffic,
  TRAFFIC_AHEAD_S,
} from '@/src/analysis/traffic';
import {trackInfo} from '@/src/data/tracks';
import {
  carLabel,
  formatDate,
  formatLapTime,
  shortTrackName,
} from '@/src/design';
import {planComboKey} from '@/src/nav/routes';
import {type FuelPreset, type RaceLength} from '@/src/state/fuelPresets';

import {effectiveUnit, type Unit} from './unit';

// The pre-race planner screen's model (pit wall thread 35): which track+car
// combinations he has history for, the laps that count, the rules in force,
// and the finished lines each card prints. Pure; the screen only lays it out.

/** Sessions of one track and car model that the history is drawn from. */
export const HISTORY_SESSIONS = 8;

export type Combo = {
  key: string;
  trackId: string;
  track: string;
  /** For the chip: short track name, the layout if two share it, and the car. */
  label: string;
  /** Car model, not livery: fuel use follows the car. */
  car: string;
  /** Newest first. */
  sessions: SessionSummary[];
};

/** Every track+car he has driven, the one he drove last first. */
export function planCombos(sessions: SessionSummary[]): Combo[] {
  const byKey = new Map<string, Combo>();
  for (const s of sessions) {
    if (s.sim !== 'lmu' || s.lapCount === 0) continue;
    const car = carLabel(s.car).model;
    const key = planComboKey(s.trackId, car);
    const combo = byKey.get(key) ?? {
      key,
      trackId: s.trackId,
      // The layout, so two Silverstones are told apart.
      track: trackInfo(s.trackId)?.layout ?? s.track,
      label: '',
      car,
      sessions: [],
    };
    combo.sessions.push(s);
    byKey.set(key, combo);
  }
  const combos = [...byKey.values()];
  // Two layouts of one circuit (Silverstone ELMS and WEC) share a short name.
  const shortOf = (c: Combo) => shortTrackName(c.sessions[0].track);
  for (const c of combos) {
    const twins = combos.filter(
      o => o !== c && shortOf(o) === shortOf(c) && o.car === c.car,
    );
    const layout = c.track.includes(' - ')
      ? c.track.slice(c.track.lastIndexOf(' - ') + 3)
      : c.track;
    c.label = `${shortOf(c)}${twins.length > 0 ? ` ${layout}` : ''} · ${
      carLabel(c.sessions[0].car).shortModel
    }`;
  }
  for (const c of combos)
    c.sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return combos.sort((a, b) =>
    b.sessions[0].startedAt.localeCompare(a.sessions[0].startedAt),
  );
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
 * The fill limit of each session doc at a track and car, and whether any doc
 * is still loading. A doc that failed to load is not loading: it has no limit
 * to read, so it is left out of the history rather than waited for forever.
 * `details` lines up with `combo.sessions`; `pending` is the query's loading
 * flag, not "this entry is undefined" (a failed one is undefined too).
 */
export function limitsOfDetails(
  details: (SessionDetail | undefined)[],
  pending: boolean,
): {pending: boolean; limitsL: (number | null | undefined)[]} {
  return {
    pending,
    limitsL: details.map(d =>
      d === undefined ? undefined : sessionLimitL(d.fuel),
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
): SessionSummary[] {
  return combo.sessions
    .filter((_, i) => limitsL[i] !== undefined)
    .slice(0, HISTORY_SESSIONS);
}

/**
 * Litres of fuel one % of Virtual Energy is worth in this session: the median
 * of usedL / veUsedPct over its green laps. VE % per lap depends on the load
 * (thread 35 #1004: 0.68 L per % at 75 L, 0.81 at 84, 0.98 at 100), so the
 * history is kept in litres and turned into VE with the ratio of the event
 * being planned. Null without a green lap that has both.
 */
export function veRatioOf(laps: Lap[]): number | null {
  const ratios: number[] = [];
  for (const l of laps) {
    const f = l.fuel;
    if (f?.green && f.usedL != null && f.usedL > 0 && f.veUsedPct)
      ratios.push(f.usedL / f.veUsedPct);
  }
  // Fewer than three green laps is not a median worth dividing by.
  if (ratios.length < MIN_GREEN_LAPS) return null;
  ratios.sort((a, b) => a - b);
  const mid = ratios.length >> 1;
  return ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
}

export type VeRatio = {
  /** Litres of fuel per 1 % VE. */
  perPctL: number;
  /** Where it came from: the preset, or a session that ran that load. */
  source: {kind: 'preset'} | {kind: 'session'; startedAt: string};
};

/**
 * The ratio to plan with: the preset's if it sets one; with a preset max fuel,
 * the newest session that ran that load; else the newest session of the
 * planned event, else none. `sessions` is newest first, as `historySessions`
 * gives, and `inEvent` marks the planned event's sessions (unset counts as in).
 *
 * The ratio belongs to the event: 0.67 to 0.99 L per % across events of one
 * car, and the load does not predict it (parc's 9-month audit, thread 44
 * #1980), so nothing is estimated from the load and another event's ratio is
 * never taken. Within one event practice, qualifying and race agree to 0.005,
 * so one lap of that event gives it.
 */
export function veRatioFor(
  preset: FuelPreset | null,
  sessions: {
    startedAt: string;
    ratio: number | null;
    fillLimitL: number | null;
    inEvent?: boolean;
  }[],
): VeRatio | null {
  if (preset?.veRatio != null)
    return {perPctL: preset.veRatio, source: {kind: 'preset'}};
  const wanted = preset?.fuelL ?? null;
  const last = sessions.find(
    s =>
      s.ratio != null &&
      (wanted != null
        ? s.fillLimitL != null && Math.abs(s.fillLimitL - wanted) <= 0.5
        : s.inEvent !== false),
  );
  return last
    ? {
        perPctL: last.ratio as number,
        source: {kind: 'session', startedAt: last.startedAt},
      }
    : null;
}

/**
 * Clean laps of one session, as the planner reads them: fuel in litres, and
 * VE % as those litres over the ratio (null without one).
 */
export function greenLapsOf(
  sessionId: string,
  laps: Lap[],
  ratio: number | null,
): GreenLap[] {
  const out: GreenLap[] = [];
  for (const l of laps) {
    const f = l.fuel;
    if (!f || !f.green || f.usedL == null || f.usedL <= 0 || l.timeS == null)
      continue;
    out.push({
      fuelL: f.usedL,
      vePct: ratio != null && ratio > 0 ? f.usedL / ratio : null,
      lapTimeS: l.timeS,
      sessionId,
      veMeasured: f.veUsedPct != null && f.veUsedPct > 0,
      traffic: l.traffic
        ? {
            trafficAheadS: l.traffic.trafficAheadS,
            passesSufferedAll: l.traffic.passesSufferedAll,
            blueFlagS: l.traffic.blueFlagS,
            battleS: l.traffic.battleS,
            overtakes: l.traffic.overtakes,
          }
        : null,
    });
  }
  return out;
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

/**
 * The track+car the plan opens on: the newest one with enough comparable laps
 * for a median, so it does not open on a car driven for one lap when others
 * have hundreds. The chips still list them all. Falls back to the newest.
 */
export function defaultCombo(combos: Combo[]): Combo | null {
  const enough = (c: Combo) =>
    c.sessions.reduce((n, s) => n + s.comparableCount, 0) >= MIN_GREEN_LAPS;
  return combos.find(enough) ?? combos[0] ?? null;
}

/** A combo's label is "short track · short car"; each half, for the two chips. */
export const comboTrack = (c: Combo) =>
  c.label.slice(0, c.label.lastIndexOf(' · '));
export const comboCar = (c: Combo) =>
  c.label.slice(c.label.lastIndexOf(' · ') + 3);

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
  caps: {fuelL: number; vePct: number},
  hasVe: boolean,
): {ve: StartChip | null; fuel: StartChip | null} {
  const under = (v: number | null, cap: number) =>
    v != null && v > 0 && v < cap - 0.5 ? v : null;
  const ve = hasVe ? under(last?.vePct ?? null, caps.vePct) : null;
  const fuel = under(last?.fuelL ?? null, caps.fuelL);
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
  /** Litres one % of VE is worth; null without VE. */
  ratioPerPctL: number | null,
): RulesCell[] {
  if (!rules) return [];
  return [
    {label: 'Max fuel', value: `${rules.fuelL} L`},
    ...(hasVe ? [{label: 'Max VE', value: `${rules.vePct} %`}] : []),
    ...(hasVe && ratioPerPctL != null
      ? [{label: '1 % VE', value: `${ratioPerPctL.toFixed(2)} L`}]
      : []),
    {
      label: 'Mandatory',
      value: `${rules.mandatoryStops} ${
        rules.mandatoryStops === 1 ? 'stop' : 'stops'
      }`,
    },
    {label: 'Formation', value: rules.formationLap ? '1 lap' : 'none'},
  ];
}

/** A typed number: positive and finite, else null (empty, "7.", "abc", 0). */
export function parseNumber(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Where the fuel to plan with came from. */
export type FuelSource = 'preset' | 'fill limit' | 'tank' | 'start fuel';

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
  if (fuelL == null) return null;
  return {
    fuelSource,
    last,
    rules: {
      name: preset ? preset.name : 'No limits',
      lengthLaps: length.kind === 'laps' ? length.value : null,
      lengthMin: length.kind === 'min' ? length.value : null,
      fuelL,
      vePct: preset ? preset.vePct : 100,
      formationLap: preset ? preset.formationLap : true,
      mandatoryStops: preset ? preset.mandatoryStops : 0,
      startFuelL: start.fuelL ?? null,
      startVePct: start.vePct ?? null,
    },
  };
}

// --- what the screen prints -------------------------------------------------

export type Row = {label: string; value: string; note?: string};

export type Card = {
  key: string;
  title: string;
  explainer: string;
  rows: Row[];
};

export type PlanView = {
  /** "Rules: Endurance 75 % fuel · set 26 Sep 2026". */
  rulesLine: string;
  /** "preset 75 L · last race 84 L" when the preset may be stale. */
  stale: string | null;
  cards: Card[];
  /** What is not modelled. */
  footnote: string;
};

const NL = String.fromCharCode(10);
const l2 = (v: number) => `${v.toFixed(2)} L`;
const pct2 = (v: number) => `${v.toFixed(2)} %`;

function usageText(
  u: {median: number; p10: number; p90: number},
  fmt: (v: number) => string,
): string {
  return `${fmt(u.median)}  (${fmt(u.p10)} to ${fmt(u.p90)})`;
}

function ratioNote(
  ratio: VeRatio | null,
  fuelL: number,
  loadsL: number[],
  eventText: string | null = null,
): string {
  if (!ratio && eventText != null)
    return `no VE a lap yet: no green lap with fuel and VE in this event (${eventText}); drive one lap here, or type the ratio into a rule set`;
  if (!ratio)
    return loadsL.length > 0
      ? `no VE: none of your sessions ran ${fuelL} L (they ran ${loadsL.join(
          ', ',
        )} L) and the ratio follows the load; type it into the preset`
      : 'no VE ratio yet: no green lap with both fuel and VE';
  const src =
    ratio.source.kind === 'preset'
      ? 'from the preset'
      : `measured in the session of ${formatDate(ratio.source.startedAt)}`;
  return `at ${ratio.perPctL.toFixed(3)} L per 1 % VE, ${src}`;
}

function loadText(l: Load): string {
  const parts = [
    l.fuelL != null ? l2(l.fuelL) : null,
    l.vePct != null ? pct2(l.vePct) : null,
  ].filter(Boolean);
  const limit =
    l.limitedBy === 'fuel' ? 'fuel' : l.limitedBy === 've' ? 'VE' : null;
  return `${parts.join('  ·  ')}${
    limit ? `  (${limit} closer to its cap)` : ''
  }${l.fits ? '' : '  (over the rules)'}`;
}

/** A race that fits one load, read the other way round (thread 35 #1015). */
function loadCard(rows: LoadToFinish[], r: PlanRules): Card {
  const out: Row[] = [];
  for (const row of rows) {
    const lapsText = `${row.laps} laps${
      r.formationLap ? ' + formation lap' : ''
    }`;
    out.push({label: `${lapsText}, median use`, value: loadText(row.atMedian)});
    const left = row.leftAtMedian;
    const leftParts = [
      left.fuelL != null && left.fuelLaps != null
        ? `${l2(left.fuelL)} = ${left.fuelLaps.toFixed(1)} laps of fuel`
        : null,
      left.vePct != null && left.veLaps != null
        ? `${pct2(left.vePct)} = ${left.veLaps.toFixed(1)} laps of VE`
        : null,
    ].filter(Boolean);
    out.push({
      label: `${lapsText}, p90 use`,
      value: loadText(row.atP90),
      note: leftParts.length
        ? `at the median you would finish with ${leftParts.join(' and ')} left`
        : undefined,
    });
  }
  return {
    key: 'load',
    title: 'Load to finish',
    explainer:
      'The race fits one load, so this is the Stops table read the other way: what the laps need at your median and at your heavy laps (p90), with the formation lap. The note says what is left if you carried the p90 load and ran the median. A number, not advice about what to load.',
    rows: out,
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
    ? `not in line with your ${of}: the plan uses the ${
        d.keptLaps
      } laps of the ${d.keptSessions} ${
        d.keptSessions === 1 ? 'session' : 'sessions'
      } since the change`
    : `lower than your ${of}, and not used for the plan: it switches once a second session in a row agrees`;
  return {label: 'Newest session', value: meters.join(NL), note};
}

function lapTime(s: number): string {
  return formatLapTime(s);
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
    /** The event the plan is for ("One Stint Sprint · week of 09-29 · 100 L"); null for a rule set or no event. */
    eventText?: string | null;
    /** Set when the newest session's use has moved away from the older ones. */
    drift: HistoryDrift | null;
    /** Median lap time of the clean and of the traffic laps among the green laps; null without a field. */
    traffic?: SessionTraffic | null;
  },
  /** The one unit the rows speak in: VE where the plan has it, unless fuel is asked for (thread 44 #1826). */
  unit: Unit = 've',
): PlanView {
  const r = rules.rules;
  const eventText = preset ? null : history.eventText ?? null;
  const rulesLine = preset
    ? `Rules: ${preset.name}  ·  set ${formatDate(preset.savedAt)}`
    : `Rules: ${eventText ?? 'last race here'} (${r.fuelL} L ${
        rules.fuelSource === 'fill limit'
          ? 'fill limit'
          : rules.fuelSource === 'tank'
          ? 'tank'
          : 'start fuel'
      }${
        rules.fuelSource !== 'tank' && rules.last?.tankL != null
          ? `, ${rules.last.tankL} L tank`
          : ''
      })`;
  const mismatch = preset
    ? presetMismatch(r.fuelL, history.lastFillLimitL)
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

  const cards: Card[] = [];
  const {fuel, ve, lapTimeS} = plan.perLap;
  const shown = effectiveUnit(unit, ve != null);
  const since = history.since ? `, since ${formatDate(history.since)}` : '';
  const driftRow = history.drift ? driftRowOf(history.drift) : null;
  const fuelRow: Row = {
    label: 'Fuel',
    value: fuel ? usageText(fuel, l2) : 'no data',
    note: fuel ? undefined : 'Needs 3 green laps',
  };
  const veRow: Row = {
    label: 'Virtual Energy',
    value: ve ? usageText(ve, pct2) : 'no data',
    note: ratioNote(
      history.ratio,
      r.fuelL,
      history.ratioLoadsL,
      preset ? null : history.eventText ?? null,
    ),
  };
  cards.push({
    key: 'perLap',
    title: 'Per green lap',
    explainer: `Green laps at this track and car, at the fill limit of these rules: not the first lap, in or out laps, full-course yellows or laps cut short by a reset. Median, and p10 to p90 in brackets. The all-green median sets the race laps, because a race includes traffic. Clean laps: no car within ${CLEAN_AHEAD_S} s ahead, no car passing, no blue flag, under ${CLEAN_BATTLE_S} s of battle. Traffic laps: ${TRAFFIC_AHEAD_S} s or more behind a car. Shown from 3 laps.`,
    rows: [
      ...(driftRow ? [driftRow] : []),
      ...(shown === 'fuel' ? [fuelRow] : []),
      // Without VE laps the row stays when it has a reason to give (the load
      // no session ran), so the missing VE is explained, not silent.
      ...(shown === 've' || (ve == null && veRow.note) ? [veRow] : []),
      {
        label: 'Lap time',
        value: lapTimeS
          ? `${lapTime(lapTimeS.median)}  (${lapTime(
              lapTimeS.p10,
            )} to ${lapTime(lapTimeS.p90)})`
          : 'no data',
        note: lapTimeS
          ? `all green laps · n ${lapTimeS.n} · sets race laps`
          : undefined,
      },
      ...(history.traffic?.clean.medianS != null
        ? [
            {
              label: 'Clean laps',
              value: lapTime(history.traffic.clean.medianS),
              note: `n ${history.traffic.clean.laps}`,
            },
          ]
        : []),
      ...(history.traffic?.traffic.medianS != null
        ? [
            {
              label: 'Traffic laps',
              value: lapTime(history.traffic.traffic.medianS),
              note: `n ${history.traffic.traffic.laps}`,
            },
          ]
        : []),
      {
        label: 'From',
        value: `${plan.history.laps} ${
          plan.history.laps === 1 ? 'lap' : 'laps'
        } in ${plan.history.sessions} ${
          plan.history.sessions === 1 ? 'session' : 'sessions'
        }${since}`,
      },
    ],
  });

  // A race that fits one load reads the Stops card the other way round; every
  // other race's Race, Per tank and Stops cards are typed (`planCards.ts`).
  if (plan.loadToFinish) cards.push(loadCard(plan.loadToFinish, r));

  const d = plan.dropStop;
  if (d) {
    const stopWord = d.targetStops === 1 ? 'stop' : 'stops';
    // Only the meter that has to use less gets the saving; one that would
    // still reach is said to be no limit (apex, thread 35 #1003).
    const meterLine = (
      name: string,
      perLap: number | null,
      save: number | null,
      savePctOfMedian: number | null,
      fmt: (v: number) => string,
    ): string | null => {
      if (perLap == null || save == null) return null;
      if (save <= 0)
        return `${name}: not the limit (${fmt(
          perLap,
        )} a lap would still reach)`;
      return `${name}: at most ${fmt(perLap)} a lap  (${fmt(save)}, ${(
        savePctOfMedian ?? 0
      ).toFixed(1)} % less than your median)`;
    };
    const rows: Row[] = [
      {
        label: `${d.targetStops} ${stopWord}`,
        value: [
          shown === 'fuel'
            ? meterLine('Fuel', d.fuelPerLapL, d.saveFuelL, d.saveFuelPct, l2)
            : meterLine(
                'VE',
                d.vePerLapPct,
                d.saveVePct,
                d.saveVePctOfMedian,
                pct2,
              ),
        ]
          .filter(Boolean)
          .join(NL),
      },
    ];
    const c = d.compare;
    const limits = [
      shown === 'fuel' && c.atMost.fuelL != null
        ? `<= ${l2(c.atMost.fuelL)}`
        : null,
      shown === 've' && c.atMost.vePct != null
        ? `<= ${pct2(c.atMost.vePct)} VE`
        : null,
    ]
      .filter(Boolean)
      .join(' and ');
    const label = limits ? `Your laps at ${limits}` : 'Your laps';
    rows.push(
      'medianLapTimeS' in c
        ? {
            label,
            value: `median ${lapTime(c.medianLapTimeS)}  (n = ${c.n})`,
            note: `all green laps: ${lapTime(c.allMedianLapTimeS)}`,
          }
        : {
            label,
            value: `no data  (n = ${c.n})`,
            note:
              c.lowestFuelL != null || c.lowestVePct != null
                ? `your lowest tenth used ${[
                    shown === 'fuel' && c.lowestFuelL != null
                      ? l2(c.lowestFuelL)
                      : null,
                    shown === 've' && c.lowestVePct != null
                      ? pct2(c.lowestVePct)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' and ')}`
                : undefined,
          },
    );
    cards.push({
      key: 'dropStop',
      title: 'To drop a stop',
      explainer:
        'The most one lap may use for the stints to reach with one fewer stop, and how your own laps at that use compare. A correlation from your laps, not a cost: traffic and pace are mixed in. Nothing here says how long a stop takes.',
      rows,
    });
  }

  return {
    rulesLine,
    stale,
    cards,
    footnote:
      'Not modelled: tyres and double-stinting, full-course yellows, weather, and how long a stop takes, except in a timed race, where the time of a stop is the pit loss measured from your own stops here plus refuelling (not counted without two such stops).',
  };
}
