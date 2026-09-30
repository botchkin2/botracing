import {
  type FuelPlan,
  type GreenLap,
  type Option,
  type PlanRules,
  presetMismatch,
} from '@/src/analysis/fuelPlan';
import {
  type Lap,
  type SessionFuel,
  type SessionSummary,
} from '@/src/data/sessions';
import {trackInfo} from '@/src/data/tracks';
import {carLabel, formatDate, formatLapTime} from '@/src/design';
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
      car,
      sessions: [],
    };
    combo.sessions.push(s);
    byKey.set(key, combo);
  }
  const combos = [...byKey.values()];
  for (const c of combos)
    c.sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return combos.sort((a, b) =>
    b.sessions[0].startedAt.localeCompare(a.sessions[0].startedAt),
  );
}

/** The sessions whose laps feed the plan. */
export function historySessions(combo: Combo): SessionSummary[] {
  return combo.sessions.slice(0, HISTORY_SESSIONS);
}

/** Clean laps of one session, as the planner reads them. */
export function greenLapsOf(sessionId: string, laps: Lap[]): GreenLap[] {
  const out: GreenLap[] = [];
  for (const l of laps) {
    const f = l.fuel;
    if (!f || !f.green || f.usedL == null || f.usedL <= 0 || l.timeS == null)
      continue;
    out.push({
      fuelL: f.usedL,
      vePct: f.veUsedPct != null && f.veUsedPct > 0 ? f.veUsedPct : null,
      lapTimeS: l.timeS,
      sessionId,
    });
  }
  return out;
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
};

/**
 * The rules to plan with. Max fuel is the preset's, else the fill limit of
 * his last session at this track and car, else the tank, else what he started
 * with; null when none is known and he has to type it.
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
  } else if (last?.tankL != null) {
    fuelL = last.tankL;
    fuelSource = 'tank';
  } else if (last?.startL != null) {
    fuelL = last.startL;
    fuelSource = 'start fuel';
  }
  if (fuelL == null) return null;
  return {
    fuelSource,
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

const l2 = (v: number) => `${v.toFixed(2)} L`;
const pct2 = (v: number) => `${v.toFixed(2)} %`;
const pct0 = (v: number) => `${Math.round(v)} %`;

function usageText(
  u: {median: number; p10: number; p90: number},
  fmt: (v: number) => string,
): string {
  return `${fmt(u.median)}  (${fmt(u.p10)} to ${fmt(u.p90)})`;
}

function stintText(o: Option): string {
  const s = o.stint;
  if (s.laps == null) return 'no data';
  const parts = [
    s.fuelLaps != null ? `fuel ${s.fuelLaps}` : null,
    s.veLaps != null ? `VE ${s.veLaps}` : null,
  ].filter(Boolean);
  const limit =
    s.limitedBy === 'fuel' ? 'fuel' : s.limitedBy === 've' ? 'VE' : null;
  return `${s.laps} laps${
    limit ? ` (${limit} runs out first)` : ''
  }  ·  ${parts.join(', ')}`;
}

function stopsText(o: Option): string {
  if (o.stops == null) return 'no data';
  if (o.stops === 0) return 'no stop';
  const fuelStops = o.stopLaps.length;
  const after = fuelStops > 0 ? `  ·  after lap ${o.stopLaps.join(', ')}` : '';
  const anyLap =
    o.anyLapStops > 0 ? `  ·  ${o.anyLapStops} more mandatory, any lap` : '';
  return `${o.stops} ${o.stops === 1 ? 'stop' : 'stops'}${after}${anyLap}`;
}

function evenText(o: Option): string | null {
  const e = o.even;
  // With no stop there is nothing to split.
  if (!e || !o.stops) return null;
  const load = [
    e.fuelL != null ? l2(e.fuelL) : null,
    e.vePct != null ? pct2(e.vePct) : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `${e.laps} laps each${load ? `  ·  ${load}` : ''}`;
}

function lapTime(s: number): string {
  return formatLapTime(s);
}

export function planView(
  preset: FuelPreset | null,
  rules: Rules,
  plan: FuelPlan,
  history: {since: string | null; lastFillLimitL: number | null},
): PlanView {
  const r = rules.rules;
  const rulesLine = preset
    ? `Rules: ${preset.name}  ·  set ${formatDate(preset.savedAt)}`
    : `Rules: No limits (${
        rules.fuelSource === 'fill limit'
          ? 'fill limit'
          : rules.fuelSource === 'tank'
          ? 'tank'
          : 'start fuel'
      } ${r.fuelL} L, 100 % VE)`;
  const mismatch = preset
    ? presetMismatch(r.fuelL, history.lastFillLimitL)
    : null;
  const stale = mismatch
    ? `preset ${mismatch.presetL} L  ·  last session there ${mismatch.lastL} L`
    : null;

  const cards: Card[] = [];
  const {fuel, ve, lapTimeS} = plan.perLap;
  const since = history.since ? `, since ${formatDate(history.since)}` : '';
  cards.push({
    key: 'perLap',
    title: 'Per green lap',
    explainer:
      'Your clean laps at this track and car: not the first lap, in or out laps, full-course yellows or laps cut short by a reset. Median, and p10 to p90 in brackets.',
    rows: [
      {
        label: 'Fuel',
        value: fuel ? usageText(fuel, l2) : 'no data',
        note: fuel ? undefined : 'Needs 3 green laps',
      },
      {label: 'Virtual Energy', value: ve ? usageText(ve, pct2) : 'no data'},
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

  const load = `${r.fuelL} L, ${pct0(r.vePct)} VE${
    r.formationLap ? ', formation lap burnt from the first stint' : ''
  }`;
  cards.push({
    key: 'tank',
    title: 'Per tank',
    explainer:
      'Laps one load lasts at your median use, and at your heavy laps (p90), from fuel and from Virtual Energy separately. The smaller one is the stint.',
    rows: [
      {label: 'Start load', value: load},
      {label: 'At median use', value: stintText(plan.atMedian)},
      {label: 'At p90 use', value: stintText(plan.atP90)},
    ],
  });

  const race = plan.raceLaps;
  cards.push({
    key: 'race',
    title: 'Race',
    explainer:
      'A timed race runs to the first line crossing after the time is up, and the flag falls on the overall leader, so a slower class can get one lap fewer.',
    rows: [
      {
        label: r.lengthLaps != null ? 'Length' : `${r.lengthMin} min`,
        value: race
          ? `${race.estimate} laps${
              race.oneFewer != null
                ? `  (${race.oneFewer} if the leader finishes first)`
                : ''
            }`
          : 'no data',
        note:
          race && r.lengthMin != null ? 'at your median lap time' : undefined,
      },
    ],
  });

  const stopRows: Row[] = [
    {label: 'At median use', value: stopsText(plan.atMedian)},
    {label: 'At p90 use', value: stopsText(plan.atP90)},
  ];
  const evenM = evenText(plan.atMedian);
  if (evenM)
    stopRows.push({label: 'Equal stints', value: evenM, note: 'at median use'});
  cards.push({
    key: 'stops',
    title: 'Stops',
    explainer:
      'Full-tank strategy: run each stint until the meter that runs out first is empty, then stop. Equal stints spreads the same number of stops evenly.',
    rows: stopRows,
  });

  const d = plan.dropStop;
  if (d) {
    const rows: Row[] = [
      {
        label: `${d.targetStops} ${d.targetStops === 1 ? 'stop' : 'stops'}`,
        value: [
          d.fuelPerLapL != null && d.saveFuelL != null && d.saveFuelPct != null
            ? `at most ${l2(d.fuelPerLapL)} a lap  (${l2(
                d.saveFuelL,
              )}, ${d.saveFuelPct.toFixed(1)} % less than your median)`
            : null,
          d.vePerLapPct != null &&
          d.saveVePct != null &&
          d.saveVePctOfMedian != null
            ? `at most ${pct2(d.vePerLapPct)} a lap  (${pct2(
                d.saveVePct,
              )}, ${d.saveVePctOfMedian.toFixed(1)} % less than your median)`
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ];
    const c = d.compare;
    rows.push(
      'medianLapTimeS' in c
        ? {
            label: 'Your laps that used that little',
            value: `median ${lapTime(c.medianLapTimeS)}  (n = ${c.n})`,
            note: `all green laps: ${lapTime(c.allMedianLapTimeS)}`,
          }
        : {
            label: 'Your laps that used that little',
            value: 'no data',
            note: `${
              c.n
            } of your laps used that little; your lowest tenth used ${
              c.lowestFuelL != null ? l2(c.lowestFuelL) : ''
            }${c.lowestFuelL != null && c.lowestVePct != null ? ' and ' : ''}${
              c.lowestVePct != null ? pct2(c.lowestVePct) : ''
            }`,
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
