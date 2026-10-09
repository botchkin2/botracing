import {type GreenLap} from '@/src/analysis/fuelPlan';
import {formatDate} from '@/src/design';

import {type Combo} from '../plan/model';

// The Plan block on the Track page (round 5, item 4): one card per car driven
// at this track, above the session list. It says what the plan for that car
// starts from, so the driver can see it before opening the plan: his last race
// there, and the fuel and VE one green lap uses, with how many laps that is.
// Numbers only, no advice. Pure; the block gathers the laps through the same
// hooks the Plan screen reads.

export type PlanCardModel = {
  /** The Plan combo key: the link opens the plan on this track and car. */
  key: string;
  car: string;
  /** "Last race 29 Sep 2026 · 72 laps", or that there is none yet. */
  last: string;
  /** "Fuel 2.34 L/lap · VE 3.44 %/lap"; null without green laps. */
  use: string | null;
};

const NO_RACE = 'No race here yet';

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = (v.length - 1) / 2;
  return (v[Math.floor(mid)] + v[Math.ceil(mid)]) / 2;
}

/**
 * The newest race in the combo (sessions come newest first), by date only. A
 * lap count would be a third number beside the pit card's and the plan's
 * (`lapCount` includes the formation and cool-down laps), so none is printed.
 */
export function lastRaceLine(combo: Combo): string {
  const race = combo.sessions.find(s => s.sessionType === 'R');
  if (!race) return NO_RACE;
  return `Last race ${formatDate(race.startedAt)}`;
}

/** VE needs this many of the counted laps carrying it (the plan's threshold). */
export const MIN_VE_LAPS = 3;

/**
 * The per-lap use the plan starts from: the median over the laps the plan
 * counts, with how many that is. VE is left out unless at least MIN_VE_LAPS of
 * them carry it (a session without the channel), never printed as 0 or a dash;
 * when fewer laps carry VE than fuel it gets its own n.
 */
export function perLapUseLine(laps: GreenLap[]): string | null {
  if (laps.length === 0) return null;
  const fuel = `Fuel ${median(laps.map(l => l.fuelL)).toFixed(2)} L/lap`;
  const ve = laps.flatMap(l => (l.vePct == null ? [] : [l.vePct]));
  if (ve.length < MIN_VE_LAPS) return fuel;
  const veText = `VE ${median(ve).toFixed(2)} %/lap`;
  return `${fuel} · ${veText}`;
}

export function planCardModel(combo: Combo, laps: GreenLap[]): PlanCardModel {
  return {
    key: combo.key,
    car: combo.car,
    last: lastRaceLine(combo),
    use: perLapUseLine(laps),
  };
}
