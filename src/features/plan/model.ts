import {type HistoryDrift, sameLimit} from '@/src/analysis/fuelHistory';
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
  type SessionFuel,
  type SessionSummary,
} from '@/src/data/sessions';
import {trackInfo} from '@/src/data/tracks';
import {
  carLabel,
  formatDate,
  formatLapTime,
  shortTrackName,
} from '@/src/design';
import {type FuelPreset, type RaceLength} from '@/src/state/fuelPresets';

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
    const key = `${s.trackId}|${car}`;
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
 * The sessions whose laps feed the plan: the newest few at the fill limit of
 * the rules. A balance-of-performance change moves fuel per lap (Barcelona
 * 2026-08: 2.31 L a lap at a 79 L limit, 2.88 L at 75 L), and history from the
 * other limit plans the old car (pit wall thread 36 #1095, #1102).
 * `limitsL` lines up with `combo.sessions`; undefined is a session doc still
 * loading, and null one with no limit on record: neither is used.
 */
export function historySessions(
  combo: Combo,
  limitsL: (number | null | undefined)[],
  wantedL: number,
): SessionSummary[] {
  return combo.sessions
    .filter((_, i) => {
      const limit = limitsL[i];
      return limit != null && sameLimit(limit, wantedL);
    })
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
  /** Where it came from: the preset, or the last session there on this date. */
  source: {kind: 'preset'} | {kind: 'session'; startedAt: string};
};

/**
 * The ratio to plan with: the preset's if it sets one, else the newest history
 * session that has one. `sessions` is newest first, as `historySessions` gives.
 *
 * The ratio follows the fill limit (0.68 L per % at 75 L, 0.81 at 84), so when
 * a preset sets its own max fuel the session must have run that load (within
 * 0.5 L), or VE per lap would come out ~16 % off for a 75 L event judged on an
 * 84 L one (camber, thread 35 #1046). With no preset max fuel the rules start
 * from the last session's own limit, so its ratio is the right one.
 */
export function veRatioFor(
  preset: FuelPreset | null,
  sessions: {
    startedAt: string;
    ratio: number | null;
    fillLimitL: number | null;
  }[],
): VeRatio | null {
  if (preset?.veRatio != null)
    return {perPctL: preset.veRatio, source: {kind: 'preset'}};
  const wanted = preset?.fuelL ?? null;
  const last = sessions.find(
    s =>
      s.ratio != null &&
      (wanted == null ||
        (s.fillLimitL != null && Math.abs(s.fillLimitL - wanted) <= 0.5)),
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
    });
  }
  return out;
}

/**
 * Whether the plan has no VE to show: fewer than the planner's minimum of the
 * green laps it was built from recorded VE themselves. Chosen from the data,
 * never from the car class, so a mixed history (Barcelona: March laps without
 * VE, August with) reads right (camber, thread 43 #1243).
 */
export function fuelOnly(laps: GreenLap[]): boolean {
  return laps.filter(l => l.veMeasured).length < MIN_GREEN_LAPS;
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
): string {
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
    /** Set when the newest session's use has moved away from the older ones. */
    drift: HistoryDrift | null;
  },
): PlanView {
  const r = rules.rules;
  const rulesLine = preset
    ? `Rules: ${preset.name}  ·  set ${formatDate(preset.savedAt)}`
    : `Rules: last race here (${r.fuelL} L ${
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
  const since = history.since ? `, since ${formatDate(history.since)}` : '';
  const driftRow = history.drift ? driftRowOf(history.drift) : null;
  cards.push({
    key: 'perLap',
    title: 'Per green lap',
    explainer:
      'Your clean laps at this track and car, at the fill limit of these rules: not the first lap, in or out laps, full-course yellows or laps cut short by a reset. Median, and p10 to p90 in brackets.',
    rows: [
      ...(driftRow ? [driftRow] : []),
      {
        label: 'Fuel',
        value: fuel ? usageText(fuel, l2) : 'no data',
        note: fuel ? undefined : 'Needs 3 green laps',
      },
      {
        label: 'Virtual Energy',
        value: ve ? usageText(ve, pct2) : 'no data',
        note: ratioNote(history.ratio, r.fuelL, history.ratioLoadsL),
      },
      {
        label: 'Lap time',
        value: lapTimeS
          ? `${lapTime(lapTimeS.median)}  (${lapTime(
              lapTimeS.p10,
            )} to ${lapTime(lapTimeS.p90)})`
          : 'no data',
      },
      {
        label: 'From',
        value: `${plan.history.laps} laps in ${plan.history.sessions} ${
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
          meterLine('Fuel', d.fuelPerLapL, d.saveFuelL, d.saveFuelPct, l2),
          meterLine(
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
      c.atMost.fuelL != null ? `<= ${l2(c.atMost.fuelL)}` : null,
      c.atMost.vePct != null ? `<= ${pct2(c.atMost.vePct)} VE` : null,
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
                    c.lowestFuelL != null ? l2(c.lowestFuelL) : null,
                    c.lowestVePct != null ? pct2(c.lowestVePct) : null,
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
      'Not modelled: tyres and double-stinting, full-course yellows, weather, and how long a stop takes (refuelling time grows with the amount added).',
  };
}
