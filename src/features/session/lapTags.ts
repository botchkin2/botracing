// Lap tags from the field (handoff round 3 §R3), and the order they show in.
// The facts are seconds and counts the uploader stored (LapTraffic); this file
// is the one place that turns them into tags, so every threshold is here.
import {type Lap, type LapTraffic} from '@/src/data/sessions';

// A tag shows from this many seconds. TOW 1.0 and BLUE 1.0 are R3's "shown
// from"; TRAF 4 s is R3's "held up for 4 s or more".
export const TOW_MIN_S = 1;
export const TRAF_MIN_S = 4;
export const BLUE_MIN_S = 1;
// BTL shows from 5 s (R3).
export const BTL_MIN_S = 5;
// A lap towed this long is drawn hollow on the lap chart (R3c).
export const TOW_HOLLOW_S = 5;

/**
 * The traffic tags of one lap, in the order R3 gives them. Null traffic (a
 * session without a field) gives none. TRAF reads trafficAheadS (a car within
 * 1 s ahead) without R3's slower-pace and 160 km/h conditions. BLUE is the
 * seconds with the blue flag, where R3 counts faster cars that passed. PASS
 * and BTL are the player's class only, on the road: a lapped car of that
 * class counts, so PASS is not a place change.
 */
export function trafficTags(traffic: LapTraffic | null): {code: string}[] {
  if (!traffic) return [];
  const tags: {code: string}[] = [];
  if (traffic.draftS >= TOW_MIN_S)
    tags.push({code: `TOW ${traffic.draftS.toFixed(1)}`});
  if (traffic.trafficAheadS >= TRAF_MIN_S) tags.push({code: 'TRAF'});
  if (traffic.blueFlagS >= BLUE_MIN_S)
    tags.push({code: `BLUE ${traffic.blueFlagS.toFixed(1)}`});
  const {passesMade: made, passesSuffered: lost} = traffic;
  if (made > 0 || lost > 0) {
    const parts = [made > 0 && `+${made}`, lost > 0 && `−${lost}`];
    tags.push({code: `PASS ${parts.filter(Boolean).join(' ')}`});
  }
  if (traffic.battleS >= BTL_MIN_S)
    tags.push({code: `BTL ${Math.round(traffic.battleS)}`});
  return tags;
}

// R3: PART · OUT · IN · RESET · SLOW · TOW · BEST · OFF · HIT · TRAF · BLUE ·
// PASS · BTL. At 375 pt one tag shows, so this decides which one; TOW is above BEST
// so a towed best lap shows TOW.
const PRIORITY = [
  'PART',
  'OUT',
  'IN',
  'RESET',
  'SLOW',
  'TOW',
  'BEST',
  'OFF',
  'HIT',
  'TRAF',
  'BLUE',
  'PASS',
  'BTL',
];

/** Tags in priority order; a code's first word is its rank ("TOW 6.1"). */
export function orderTags<T extends {code: string}>(tags: T[]): T[] {
  const rank = (t: T) => PRIORITY.indexOf(t.code.split(' ')[0]);
  return [...tags].sort((a, b) => rank(a) - rank(b));
}

/** What a lap shows on the chart rails and bars (R3c); all false without traffic. */
export function lapTraffic(traffic: LapTraffic | null) {
  const towed = !!traffic && traffic.draftS >= TOW_MIN_S;
  const heldUp = !!traffic && traffic.trafficAheadS >= TRAF_MIN_S;
  return {
    towed,
    hollow: !!traffic && traffic.draftS >= TOW_HOLLOW_S,
    heldUp,
    // The grey tick: held up or blue-flagged.
    tick: heldUp || (!!traffic && traffic.blueFlagS >= BLUE_MIN_S),
  };
}

/**
 * The fastest comparable lap that is neither towed nor held up, and how far
 * it is behind the best lap ("Best without TOW or TRAF", R3). Null when the
 * session has no field, or the best lap is itself clean (nothing to say).
 */
export function bestWithoutTow(
  laps: Lap[],
  bestLapId: string | null,
): {lap: Lap; behindS: number} | null {
  const best = laps.find(l => l.id === bestLapId);
  if (!best || best.timeS == null || !laps.some(l => l.traffic)) return null;
  const affected = (l: Lap) => {
    const f = lapTraffic(l.traffic);
    return f.towed || f.heldUp;
  };
  if (!affected(best)) return null;
  let clean: {lap: Lap; timeS: number} | null = null;
  for (const l of laps) {
    if (!l.comparable || l.timeS == null || l.traffic == null) continue;
    if (affected(l)) continue;
    if (clean == null || l.timeS < clean.timeS)
      clean = {lap: l, timeS: l.timeS};
  }
  return clean && {lap: clean.lap, behindS: clean.timeS - best.timeS};
}
