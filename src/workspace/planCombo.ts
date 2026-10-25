import {MIN_GREEN_LAPS} from '@/src/analysis/fuelPlan';
import {type SessionSummary} from '@/src/data/sessions';
import {trackInfo} from '@/src/data/tracks';
import {carLabel, shortTrackName} from '@/src/design';
import {planComboKey} from '@/src/nav/routes';

// Which track and car the Plan is about: the combos he has driven, the one the
// Plan opens on, and the label that names each. The Plan screen, the Track
// page and the desktop bar all read it here, so they cannot name different
// pairs (ticket 34). Which combo is identity, label and default; what the Plan
// says about it (fuel, laps, rules) stays in `features/plan`.

/** How far back the Plan, the Track page's plan block and the bar read his sessions: all of them. */
export const PLAN_HISTORY_DAYS = 3650;

export type Combo = {
  key: string;
  sim: string;
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
    if (s.lapCount === 0) continue;
    const car = carLabel(s.car).model;
    const key = planComboKey(s.trackId, car, s.sim);
    const combo = byKey.get(key) ?? {
      key,
      sim: s.sim,
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
 * The track+car the plan opens on: the newest one with enough comparable laps
 * for a median, so it does not open on a car driven for one lap when others
 * have hundreds. The chips still list them all. Falls back to the newest.
 */
export function defaultCombo(combos: Combo[]): Combo | null {
  const enough = (c: Combo) =>
    c.sessions.reduce((n, s) => n + s.comparableCount, 0) >= MIN_GREEN_LAPS;
  return combos.find(enough) ?? combos[0] ?? null;
}

/**
 * A combo for a track and car he has no session of, from a Plan key
 * (`planComboKey`: `[sim:]trackId|carModel`). Null for a key that is not one.
 */
export function undrivenCombo(key: string): Combo | null {
  const bar = key.indexOf('|');
  if (bar <= 0 || bar === key.length - 1) return null;
  const head = key.slice(0, bar);
  const colon = head.indexOf(':');
  const sim = colon > 0 ? head.slice(0, colon) : 'lmu';
  const trackId = colon > 0 ? head.slice(colon + 1) : head;
  const car = key.slice(bar + 1);
  if (!trackId) return null;
  const track = trackInfo(trackId)?.layout ?? trackId;
  return {
    key,
    sim,
    trackId,
    track,
    label: `${shortTrackName(track)} · ${car}`,
    car,
    sessions: [],
  };
}

/**
 * The combo the Plan opens on: the one a link names, else (a link to a track
 * and car he has not driven) an empty combo for it, else the default. A link
 * never silently opens on some other track.
 */
export function resolveCombo(
  combos: Combo[],
  key: string | null,
  fallback: Combo | null,
): Combo | null {
  if (key == null) return fallback;
  return combos.find(c => c.key === key) ?? undrivenCombo(key) ?? fallback;
}

/** A combo's label is "short track · short car"; each half, for the two chips. */
export const comboTrack = (c: Combo) =>
  c.label.slice(0, c.label.lastIndexOf(' · '));
export const comboCar = (c: Combo) =>
  c.label.slice(c.label.lastIndexOf(' · ') + 3);
