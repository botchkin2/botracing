// Per-lap traffic facts from the encoded field (field.mjs): seconds and
// counts about the cars around the player, never a verdict.
//
// Everything reads the field by name (lapDistDm, pathLateralDm, inPits, flag,
// tDs, et0, cars[i].player), so the yaw and other columns later versions add
// change nothing here.
//
// Sampling is 5 Hz, so a pass that starts and ends inside 0.4 s is missed;
// that is fine for a count of passes but not for timing one.
import {undelta} from './field.mjs';

// Same lane: lateral centre lines within this many metres (the measured
// tow needs cars nose to tail; 2 m is a car width, pit-wall thread 30 #787).
export const SAME_LANE_M = 2;
// Blue flag on the player, `mFlag` in the capture (only 0 and 6 seen).
export const BLUE_FLAG = 6;
// "Traffic" is a car within this many seconds on the road, ahead or behind.
export const TRAFFIC_S = 1;
// A pass is the on-road gap changing sign while both cars are this close.
export const PASS_WINDOW_M = 150;
// Below this the time gap divides by a standing car: floor the speed.
const MIN_SPEED_MS = 20;

// Draft: a car ahead in the same lane within DRAFT_MAX_GAP_M while the
// player is above DRAFT_MIN_KMH. Measured on the Daytona race of 2026-09-28
// (62 cars, back straight lapDist 4200-5700 m). Speed gained from entry to
// exit against passes with the nearest car 80 m or more ahead, same entry
// speed by regression, only passes not closing on the car ahead
// (|closing| < 5 km/h), median km/h with the 95% bootstrap interval:
//
//   class  <15 m         15-30 m           30-50 m          50-80 m
//   GT3    +3.5 (n=31)   +5.3 [2.9,6.6] 28 +2.7 [2.0,3.8] 19 +1.7 (n=8)
//   LMP2   +1.2 (n=6)    +3.6 [2.3,4.8] 15 +1.4 [1.0,2.2] 16 +0.2 (n=9)
//   Hyper  +1.7 (n=24)   +4.5 [2.2,5.6] 23 +2.2 [2.0,3.0] 21 +0.8 (n=3)
//
// The tow peaks at 15-30 m and is gone by 50-80 m, so 30 m keeps the part
// that shows. It is one race: the constant is a raw fact ("seconds this
// close behind a car on a fast stretch"), not a km/h claim, until a paired
// gain is recomputed on more races. Scripts: fixtures/fieldTags/.
export const DRAFT_MAX_GAP_M = 30;
export const DRAFT_MIN_KMH = 200;

const round1 = v => Math.round(v * 10) / 10;

// The field back to numbers: {etS[], cars: [{player, lapDistM[], laneM[],
// inPits[], flag[], carClass}]} with null where a car was absent from an
// update.
export function decodeField(field) {
  const etS = field.tDs.map(d => field.et0 + d / 10);
  const unit = grid => undelta(grid).map(v => (v === null ? null : v / 10));
  const cars = field.cars.map((c, i) => ({
    player: c.player,
    carClass: c.class,
    lapDistM: unit(field.lapDistDm[i]),
    laneM: unit(field.pathLateralDm[i]),
    inPits: field.inPits[i],
    flag: field.flag[i],
  }));
  return {etS, cars};
}

// Signed on-road distance from a to b, in (-L/2, L/2]: positive when b is
// ahead of a.
function ahead(a, b, L) {
  return ((((b - a) % L) + 1.5 * L) % L) - L / 2;
}

const EMPTY = () => ({
  draftS: 0,
  trafficAheadS: 0,
  trafficBehindS: 0,
  blueFlagS: 0,
  // Places made and lost to cars of the player's class: a Hypercar lapping a
  // GT3 is not a lost place. The All counts take every car.
  passesMade: 0,
  passesSuffered: 0,
  passesMadeAll: 0,
  passesSufferedAll: 0,
  // Seconds within TRAFFIC_S of a car of the player's class, ahead or behind,
  // in any lane (side by side counts).
  battleS: 0,
});

// windows: [{from, to}] on the session clock (seconds, `from` inclusive).
// Returns one facts object per window, or all null when there is no player
// car in the field.
export function lapFieldFacts(field, windows) {
  const {etS, cars} = decodeField(field);
  const me = cars.findIndex(c => c.player);
  if (me < 0) return windows.map(() => null);
  const dt = 1 / field.hz;
  let L = 0;
  for (const c of cars)
    for (const d of c.lapDistM) if (d !== null && d > L) L = d;
  const out = windows.map(EMPTY);
  const windowAt = et => windows.findIndex(w => et >= w.from && et < w.to);

  // Speed of a car from its own distance between consecutive updates.
  const speedMs = (c, u) => {
    const a = c.lapDistM[u - 1];
    const b = c.lapDistM[u];
    if (u === 0 || a === null || b === null) return null;
    return ahead(a, b, L) / dt;
  };
  const prevGap = new Map();

  for (let u = 0; u < etS.length; u++) {
    const p = cars[me];
    const w = windowAt(etS[u]);
    const here = p.lapDistM[u];
    if (here === null || p.inPits[u]) {
      prevGap.clear();
      continue;
    }
    const vMs = speedMs(p, u);
    let gapAhead = Infinity;
    let gapBehind = Infinity;
    let battleGapM = Infinity;
    const gapNow = new Map();
    for (let j = 0; j < cars.length; j++) {
      const c = cars[j];
      if (j === me || c.lapDistM[u] === null || c.inPits[u]) continue;
      const g = ahead(here, c.lapDistM[u], L);
      const sameClass = c.carClass === p.carClass;
      if (sameClass) battleGapM = Math.min(battleGapM, Math.abs(g));
      if (Math.abs(g) < PASS_WINDOW_M) {
        gapNow.set(j, g);
        const before = prevGap.get(j);
        // Strictly across zero: a gap that rounds to exactly 0 m (decimetre
        // positions) is neither side, so it is not a second pass.
        if (before !== undefined && before * g < 0 && w >= 0) {
          const made = before > 0;
          out[w][made ? 'passesMadeAll' : 'passesSufferedAll']++;
          if (sameClass) out[w][made ? 'passesMade' : 'passesSuffered']++;
        }
        if (g === 0 && before !== undefined) gapNow.set(j, before);
      }
      const lane = Math.abs(c.laneM[u] - p.laneM[u]);
      if (!(lane < SAME_LANE_M)) continue;
      if (g > 0) gapAhead = Math.min(gapAhead, g);
      else gapBehind = Math.min(gapBehind, -g);
    }
    prevGap.clear();
    for (const [j, g] of gapNow) prevGap.set(j, g);
    if (w < 0) continue;

    const f = out[w];
    const speed = Math.max(vMs ?? 0, MIN_SPEED_MS);
    if (gapAhead / speed < TRAFFIC_S) f.trafficAheadS += dt;
    if (gapBehind / speed < TRAFFIC_S) f.trafficBehindS += dt;
    if (battleGapM / speed < TRAFFIC_S) f.battleS += dt;
    if (p.flag[u] === BLUE_FLAG) f.blueFlagS += dt;
    if (
      gapAhead <= DRAFT_MAX_GAP_M &&
      vMs !== null &&
      vMs * 3.6 > DRAFT_MIN_KMH
    ) {
      f.draftS += dt;
    }
  }
  for (const f of out) {
    for (const k of [
      'draftS',
      'trafficAheadS',
      'trafficBehindS',
      'blueFlagS',
      'battleS',
    ]) {
      f[k] = round1(f[k]);
    }
  }
  return out;
}
