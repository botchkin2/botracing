// A track's drawable surface, measured from the game's own channels.
//
// Every lap carries PathLateral (where the car is across the track, from the
// game's centre path) and TrackEdge (the asphalt edge on the car's side, in
// the same lateral coordinate). So a lap gives the centre path everywhere
// (position minus PathLateral) and an edge wherever the car was near one.
// Measured on Road Atlanta (24 laps) and Daytona (10 laps): the centre path
// agrees between laps to 0.19 m median per 10 m (raw positions differ by
// 3.2 m); an edge, where seen, varies 0.03 to 0.27 m; one lap gives the centre
// on the whole lap but only one edge on most of it (left 65-69%, right 33-38%).
// Pit-thread 40 has the numbers.
//
// The surface is a sum per bin along the lap, so sessions add up. It stores
// the game's own metres (the fake-origin frame the traces use), before any
// georef: the same in every session of a track and layout, so sessions pool
// without a fit. A map placer projects it like a lap.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface Pt {
  x: number;
  y: number;
}

/** One lap's samples that have a position (10 Hz), aligned by index. */
export interface SurfaceLap {
  /** Metres along the lap, from LapDistPct. */
  distM: number[];
  /** Game-world metres (the fake-origin frame), x east, y north. */
  x: number[];
  y: number[];
  pathLateralM: number[];
  trackEdgeM: number[];
}

/** Sums for one bin. Lap counts count a lap once per bin and kind. */
export interface SurfaceBin {
  /** Laps and samples with a centre. */
  laps: number;
  n: number;
  sx: number;
  sy: number;
  /** Left edge (TrackEdge < 0): laps, samples, sum of the lateral value. */
  lapsL: number;
  nL: number;
  sL: number;
  /** Right edge (TrackEdge > 0). */
  lapsR: number;
  nR: number;
  sR: number;
}

export interface TrackSurface {
  v: 1;
  stepM: number;
  lengthM: number;
  /** Sessions already added: adding one again changes nothing. */
  sessions: string[];
  bins: SurfaceBin[];
}

export const SURFACE_STEP_M = 10;
/**
 * PathLateral is positive to the right of the direction of travel: with this
 * sign the laps' centres collapse (3.2 m to 0.19 m rms on both tracks); the
 * other sign leaves them at 3.5-4.1 m.
 */
const RIGHT = 1;
/**
 * An edge further than this from the centre is not the road: Daytona reads up
 * to 25.8 m where the pit entry opens, against a 14.8 m p90 width.
 */
export const MAX_EDGE_M = 20;
/** Neighbours further apart than this (a gap in the 10 Hz samples) give no heading. */
const MAX_GAP_M = 30;

export function emptySurface(
  lengthM: number,
  stepM: number = SURFACE_STEP_M,
): TrackSurface {
  const bins: SurfaceBin[] = [];
  for (let i = 0; i < Math.ceil(lengthM / stepM); i++) {
    bins.push({
      laps: 0,
      n: 0,
      sx: 0,
      sy: 0,
      lapsL: 0,
      nL: 0,
      sL: 0,
      lapsR: 0,
      nR: 0,
      sR: 0,
    });
  }
  return {v: 1, stepM, lengthM, sessions: [], bins};
}

/** Unit vector to the right of travel between two points; null if they coincide or are a gap apart. */
function rightNormal(a: Pt, b: Pt): Pt | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0 || len > MAX_GAP_M) return null;
  return {x: dy / len, y: -dx / len};
}

/** Adds one lap's samples. Laps that are pit, partial or not comparable are the caller's to leave out. */
export function addLap(s: TrackSurface, lap: SurfaceLap): void {
  const seenC = new Set<number>();
  const seenL = new Set<number>();
  const seenR = new Set<number>();
  const last = lap.x.length - 1;
  for (let i = 0; i <= last; i++) {
    const at = {x: lap.x[i], y: lap.y[i]};
    const d = lap.distM[i];
    const pl = lap.pathLateralM[i];
    const te = lap.trackEdgeM[i];
    if (![at.x, at.y, d, pl, te].every(Number.isFinite)) continue;
    const n = rightNormal(
      {x: lap.x[Math.max(0, i - 1)], y: lap.y[Math.max(0, i - 1)]},
      {x: lap.x[Math.min(last, i + 1)], y: lap.y[Math.min(last, i + 1)]},
    );
    if (!n) continue;
    const b = Math.min(s.bins.length - 1, Math.max(0, Math.floor(d / s.stepM)));
    const bin = s.bins[b];
    bin.n += 1;
    bin.sx += at.x - RIGHT * pl * n.x;
    bin.sy += at.y - RIGHT * pl * n.y;
    if (!seenC.has(b)) {
      seenC.add(b);
      bin.laps += 1;
    }
    if (Math.abs(te) > MAX_EDGE_M) continue;
    if (te < 0) {
      bin.nL += 1;
      bin.sL += te;
      if (!seenL.has(b)) {
        seenL.add(b);
        bin.lapsL += 1;
      }
    } else {
      bin.nR += 1;
      bin.sR += te;
      if (!seenR.has(b)) {
        seenR.add(b);
        bin.lapsR += 1;
      }
    }
  }
}

/**
 * Adds a session's laps once. A session id already in the surface is skipped,
 * so a resync or a re-run cannot count laps twice. Returns whether it was added.
 */
export function addSession(
  s: TrackSurface,
  sessionId: string,
  laps: SurfaceLap[],
): boolean {
  if (s.sessions.includes(sessionId)) return false;
  for (const lap of laps) addLap(s, lap);
  s.sessions.push(sessionId);
  return true;
}

export interface SurfaceGeometry {
  /** Runs of consecutive bins with a centre; each run is one drawable road. */
  runs: SurfaceRun[];
  /** Half the measured width: median over bins with both edges; null when none. */
  halfWidthM: number | null;
  coverage: SurfaceCoverage;
}

export interface SurfaceRun {
  centre: Pt[];
  /** Measured edges per bin (null: not measured there). */
  left: (Pt | null)[];
  right: (Pt | null)[];
  /** The edge drawn dashed at the median half-width where it is not measured. */
  leftDashed: (Pt | null)[];
  rightDashed: (Pt | null)[];
  /** Metres along the lap where the run starts. */
  fromM: number;
}

/** Shares of the bins with a centre, by what was measured. */
export interface SurfaceCoverage {
  bins: number;
  both: number;
  oneEdge: number;
  centreOnly: number;
}

const median = (a: number[]): number => {
  const s = a.slice().sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
};

/**
 * The surface as points. A bin needs `minLaps` laps for its centre; an edge
 * needs `minLaps` laps on that side. Direction of travel comes from the
 * neighbouring centres, so edges sit across the measured road.
 */
export function surfaceGeometry(
  s: TrackSurface,
  minLaps: number = 1,
): SurfaceGeometry {
  const has = s.bins.map(b => b.laps >= minLaps && b.n > 0);
  const centre = s.bins.map(b =>
    b.n > 0 ? {x: b.sx / b.n, y: b.sy / b.n} : null,
  );
  const widths: number[] = [];
  let both = 0;
  let one = 0;
  let only = 0;
  let count = 0;
  s.bins.forEach((b, i) => {
    if (!has[i]) return;
    count += 1;
    const l = b.lapsL >= minLaps;
    const r = b.lapsR >= minLaps;
    if (l && r) {
      both += 1;
      widths.push((b.sR / b.nR - b.sL / b.nL) / 2);
    } else if (l || r) one += 1;
    else only += 1;
  });
  const half = widths.length > 0 ? median(widths) : null;
  const runs: SurfaceRun[] = [];
  let i = 0;
  while (i < s.bins.length) {
    if (!has[i]) {
      i += 1;
      continue;
    }
    const from = i;
    while (i < s.bins.length && has[i]) i += 1;
    runs.push(buildRun(s, centre as (Pt | null)[], from, i, minLaps, half));
  }
  return {
    runs,
    halfWidthM: half,
    coverage: {
      bins: count,
      both: count ? both / count : 0,
      oneEdge: count ? one / count : 0,
      centreOnly: count ? only / count : 0,
    },
  };
}

function buildRun(
  s: TrackSurface,
  centre: (Pt | null)[],
  from: number,
  to: number,
  minLaps: number,
  half: number | null,
): SurfaceRun {
  const run: SurfaceRun = {
    centre: [],
    left: [],
    right: [],
    leftDashed: [],
    rightDashed: [],
    fromM: from * s.stepM,
  };
  for (let i = from; i < to; i++) {
    const c = centre[i] as Pt;
    const prev = (i > from ? centre[i - 1] : c) as Pt;
    const next = (i < to - 1 ? centre[i + 1] : c) as Pt;
    const n =
      rightNormal(prev, next) ?? rightNormal(c, next) ?? rightNormal(prev, c);
    const b = s.bins[i];
    const at = (lateral: number): Pt | null =>
      n
        ? {x: c.x + RIGHT * lateral * n.x, y: c.y + RIGHT * lateral * n.y}
        : null;
    const l = b.lapsL >= minLaps ? b.sL / b.nL : null;
    const r = b.lapsR >= minLaps ? b.sR / b.nR : null;
    run.centre.push(c);
    run.left.push(l == null ? null : at(l));
    run.right.push(r == null ? null : at(r));
    run.leftDashed.push(l == null && half != null ? at(-half) : null);
    run.rightDashed.push(r == null && half != null ? at(half) : null);
  }
  return run;
}

export interface OsmWay {
  id: string | number;
  /** 'track' is a road of the layout; anything else (pit, service) is never dropped. */
  kind: string;
  points: Pt[];
}

export interface OsmSplit {
  id: string | number;
  kind: string;
  /** Stretches outside the measured surface, kept as before. */
  kept: Pt[][];
  /** Length inside the measured surface, replaced by it. */
  droppedM: number;
}

/** OSM points are taken every this many metres. */
const OSM_STEP_M = 4;
/** Slack beyond the measured half-width: fit noise and the road's shoulders. */
export const DROP_MARGIN_M = 3;

/**
 * Drops the parts of racing-layout OSM roads that lie inside the measured
 * surface (within its half-width plus DROP_MARGIN_M of the measured centre):
 * that road is drawn from the measurement instead. Everything else, and every
 * way that is not a plain road ('pit', service), stays exactly as it was. The
 * measured road ends hard where its bins end; the OSM beside it is not blended.
 */
export function dropOsmInsideSurface(
  ways: OsmWay[],
  g: SurfaceGeometry,
  marginM: number = DROP_MARGIN_M,
): OsmSplit[] {
  const reach = (g.halfWidthM ?? 0) + marginM;
  const segs: [Pt, Pt][] = [];
  for (const run of g.runs) {
    for (let i = 1; i < run.centre.length; i++) {
      segs.push([run.centre[i - 1], run.centre[i]]);
    }
  }
  const inside = (p: Pt): boolean => {
    for (const [a, b] of segs) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2),
      );
      if (Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= reach)
        return true;
    }
    return false;
  };
  return ways.map(w => {
    if (w.kind !== 'track' || g.halfWidthM == null || segs.length === 0) {
      return {id: w.id, kind: w.kind, kept: [w.points], droppedM: 0};
    }
    const pts = densify(w.points);
    const kept: Pt[][] = [];
    let cur: Pt[] = [];
    let dropped = 0;
    let prev: Pt | null = null;
    for (const p of pts) {
      const from: Pt | null = prev;
      prev = p;
      if (inside(p)) {
        if (from) dropped += Math.hypot(p.x - from.x, p.y - from.y);
        if (cur.length > 1) kept.push(cur);
        cur = [];
      } else cur.push(p);
    }
    if (cur.length > 1) kept.push(cur);
    return {id: w.id, kind: w.kind, kept, droppedM: dropped};
  });
}

function densify(line: Pt[]): Pt[] {
  const out: Pt[] = line.length > 0 ? [line[0]] : [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const n = Math.max(
      1,
      Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / OSM_STEP_M),
    );
    for (let k = 1; k <= n; k++) {
      out.push({
        x: a.x + ((b.x - a.x) * k) / n,
        y: a.y + ((b.y - a.y) * k) / n,
      });
    }
  }
  return out;
}
