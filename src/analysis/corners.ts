// A track's corners, found once from a median lap and kept per track and
// layout, so "corner 6" is the same place every session.
//
// Corners come from the shape of the track (GPS curvature), not from speed
// minima: an ess with no braking is still two corners, and a flat-out final
// corner is still a corner. Each corner's segment runs from its entry (where
// the driver brakes, lifts, or turns in) to the next corner's entry, so a
// slow exit is charged to the corner that caused it, straight included.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface Profile {
  stepM: number;
  // One value per grid point, median over clean laps.
  speedKmh: number[];
  brake: number[];
  throttle: number[];
  // Metres east and north of any fixed point.
  x: number[];
  y: number[];
}

export interface TrackCorner {
  n: number;
  direction: 'left' | 'right';
  // Where this corner's segment starts: brake, lift, or turn-in.
  entryM: number;
  turnInM: number;
  apexM: number;
  exitM: number;
  // Taken without braking or lifting.
  flat: boolean;
  minSpeedKmh: number;
}

export interface CornerOptions {
  // Curvature (1/m) that counts as turning: 1/400 m.
  turnCurv: number;
  // A region must peak at least here to be a corner and not a kink: 1/220 m.
  peakCurv: number;
  minLengthM: number;
  // How far before turn-in to look for the brake or lift.
  lookBackM: number;
}

export const defaultCornerOptions: CornerOptions = {
  turnCurv: 1 / 400,
  peakCurv: 1 / 220,
  minLengthM: 30,
  lookBackM: 250,
};

export function curvature(p: Profile): number[] {
  const n = p.x.length;
  const w = Math.max(1, Math.round(15 / p.stepM));
  const raw = new Array<number>(n).fill(0);
  for (let g = w; g < n - w; g++) {
    const h1 = Math.atan2(p.y[g] - p.y[g - w], p.x[g] - p.x[g - w]);
    const h2 = Math.atan2(p.y[g + w] - p.y[g], p.x[g + w] - p.x[g]);
    let dh = h2 - h1;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    // Left is positive: x east, y north, angles counter-clockwise.
    raw[g] = dh / (w * p.stepM);
  }
  return smooth(raw, 2);
}

export function findTrackCorners(
  p: Profile,
  o: CornerOptions = defaultCornerOptions,
): TrackCorner[] {
  const c = curvature(p);
  const n = c.length;
  const minPts = Math.round(o.minLengthM / p.stepM);

  // Runs of steady turning in one direction.
  const regions: {s: number; e: number; sign: number}[] = [];
  let g = 0;
  while (g < n) {
    const sign = Math.sign(c[g]);
    if (Math.abs(c[g]) < o.turnCurv) {
      g++;
      continue;
    }
    let e = g;
    while (
      e + 1 < n &&
      Math.sign(c[e + 1]) === sign &&
      Math.abs(c[e + 1]) >= o.turnCurv
    )
      e++;
    regions.push({s: g, e, sign});
    g = e + 1;
  }
  // Rejoin a corner split by a short dip in curvature, same direction,
  // unless the driver brakes again for the second part.
  const brakeOnset = (a: number, b: number) => {
    for (let k = Math.max(1, a); k <= b; k++) {
      if (p.brake[k] >= 0.1 && p.brake[k - 1] < 0.1) return true;
    }
    return false;
  };
  const merged: typeof regions = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.sign === r.sign &&
      r.s - last.e <= Math.round(20 / p.stepM) &&
      !brakeOnset(last.s + 1, r.e)
    ) {
      last.e = r.e;
    } else {
      merged.push({...r});
    }
  }
  // Split a long run of one direction where the curvature falls well below
  // both of the peaks around it: two corners that happen to turn the same way.
  const split: typeof regions = [];
  for (const r of merged) {
    let start = r.s;
    let peakBefore = 0;
    let valley = -1;
    let valleyCurv = Infinity;
    for (let k = r.s; k <= r.e; k++) {
      const a = Math.abs(c[k]);
      if (valley < 0) {
        if (a >= peakBefore) peakBefore = a;
        else if (peakBefore >= o.peakCurv) {
          valley = k;
          valleyCurv = a;
        }
        continue;
      }
      if (a < valleyCurv) {
        valley = k;
        valleyCurv = a;
      } else if (
        a >= o.peakCurv &&
        valleyCurv < 0.5 * Math.min(peakBefore, a)
      ) {
        split.push({s: start, e: valley, sign: r.sign});
        start = valley + 1;
        peakBefore = a;
        valley = -1;
        valleyCurv = Infinity;
      } else if (a > peakBefore) {
        // Still climbing to the first peak: no valley yet.
        peakBefore = a;
        valley = -1;
        valleyCurv = Infinity;
      }
    }
    split.push({s: start, e: r.e, sign: r.sign});
  }

  const corners: TrackCorner[] = [];
  let prevEnd = 0;
  for (const r of split) {
    let peak = 0;
    let apex = r.s;
    for (let k = r.s; k <= r.e; k++) {
      if (Math.abs(c[k]) > peak) peak = Math.abs(c[k]);
    }
    let minSpeed = Infinity;
    for (let k = r.s; k <= r.e; k++) {
      if (p.speedKmh[k] < minSpeed) {
        minSpeed = p.speedKmh[k];
        apex = k;
      }
    }
    // Entry: the last brake or lift before turn-in, if there is one close by.
    // Never look back into the previous corner.
    const from = Math.max(prevEnd, r.s - Math.round(o.lookBackM / p.stepM));
    prevEnd = r.e + 1;
    let entry = -1;
    for (let k = r.e; k >= from; k--) {
      const working = p.brake[k] >= 0.1 || p.throttle[k] < 0.9;
      if (working) entry = k;
      else if (entry >= 0 && k < r.s) break;
    }
    const flat = entry < 0;
    // A kink that never turns hard is part of the straight, even when the
    // braking for the next corner starts in it.
    if (r.e - r.s + 1 < minPts || peak < o.peakCurv) continue;
    corners.push({
      n: 0,
      direction: r.sign > 0 ? 'left' : 'right',
      entryM: (flat ? r.s : Math.min(entry, r.s)) * p.stepM,
      turnInM: r.s * p.stepM,
      apexM: apex * p.stepM,
      exitM: r.e * p.stepM,
      flat,
      minSpeedKmh: Math.round(minSpeed),
    });
  }
  // Two corners in a row with no brake between them (an ess) share a
  // boundary where the steering changes direction.
  for (let k = 1; k < corners.length; k++) {
    const prev = corners[k - 1];
    const cur = corners[k];
    if (cur.entryM < prev.exitM)
      cur.entryM = Math.max(prev.apexM + p.stepM, cur.turnInM);
  }
  corners.forEach((corner, k) => (corner.n = k + 1));
  return corners;
}

// Time spent in each corner's segment, entry to next entry. The last
// segment wraps over the line to the first corner's entry.
export function segmentTimes(
  corners: TrackCorner[],
  lengthM: number,
  timeAt: (m: number) => number,
): number[] {
  const lapTime = timeAt(lengthM) - timeAt(0);
  return corners.map((corner, k) => {
    const a = timeAt(corner.entryM);
    if (k + 1 < corners.length) return timeAt(corners[k + 1].entryM) - a;
    return lapTime - a + timeAt(corners[0].entryM) - timeAt(0);
  });
}

function smooth(values: number[], radius: number): number[] {
  return values.map((_, i) => {
    let total = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k++) {
      const v = values[i + k];
      if (v !== undefined && Number.isFinite(v)) {
        total += v;
        count++;
      }
    }
    return count ? total / count : 0;
  });
}
