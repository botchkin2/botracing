// Which parts of the OSM outline this layout drives on.
//
// The outline is every road the mapper drew around the track: Daytona has an
// oval and infield loops next to the road course, and Le Mans shares ways
// between layouts. Our driven line is already on the outline's map (the
// georef), so a stretch of outline is "used" when the driven line passes
// within `maxDistM` of it, and the rest can be drawn at low contrast.
//
// The distance is taken per sample along each way (every SAMPLE_STEP_M), not
// per way, because one OSM way can run from the used road course onto an
// unused loop. Short runs are absorbed so a patch of fit noise does not cut a
// way into dashes: see MIN_RUN_M.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface Pt {
  x: number;
  y: number;
}

export interface OutlineUse {
  /** Stretches the driven line runs along; drawn as today. */
  used: Pt[][];
  /** Everything else; drawn at low contrast. */
  unused: Pt[][];
}

/** Driven line within this many metres of the outline counts as on it. */
export const OUTLINE_MAX_DIST_M = 8;
/** A run shorter than this between two runs of the other kind flips. */
export const MIN_RUN_M = 40;
const SAMPLE_STEP_M = 4;
// The driven line is densified to this spacing, so the nearest driven point is
// within half of it of the nearest point on the line.
const DRIVEN_STEP_M = 3;

/** Points every `step` metres along a polyline, first and last included. */
function resample(line: Pt[], step: number): Pt[] {
  if (line.length < 2) return line.slice();
  const out: Pt[] = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    let at = step - carry;
    while (at < len) {
      const t = at / len;
      out.push({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t});
      at += step;
    }
    carry = len - (at - step);
  }
  const last = line[line.length - 1];
  const tail = out[out.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) out.push(last);
  return out;
}

/** Nearest-point lookup over a fixed set of points, by hashed grid cells. */
function nearIndex(points: Pt[], cellM: number) {
  const cells = new Map<string, Pt[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  for (const p of points) {
    const k = key(Math.floor(p.x / cellM), Math.floor(p.y / cellM));
    const bucket = cells.get(k);
    if (bucket) bucket.push(p);
    else cells.set(k, [p]);
  }
  return (p: Pt, maxDistM: number): boolean => {
    const cx = Math.floor(p.x / cellM);
    const cy = Math.floor(p.y / cellM);
    const reach = Math.ceil(maxDistM / cellM);
    const max2 = maxDistM * maxDistM;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        const bucket = cells.get(key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const q of bucket) {
          const ex = q.x - p.x;
          const ey = q.y - p.y;
          if (ex * ex + ey * ey <= max2) return true;
        }
      }
    }
    return false;
  };
}

/** Flips runs shorter than minRunM that sit between two runs of the other kind. */
function absorbShortRuns(
  flags: boolean[],
  stepM: number,
  minRunM: number,
): boolean[] {
  const out = flags.slice();
  const minSamples = Math.ceil(minRunM / stepM);
  let changed = true;
  while (changed) {
    changed = false;
    let i = 0;
    while (i < out.length) {
      let j = i;
      while (j < out.length && out[j] === out[i]) j++;
      const interior = i > 0 && j < out.length;
      if (interior && j - i < minSamples) {
        const flipTo = !out[i];
        for (let k = i; k < j; k++) out[k] = flipTo;
        changed = true;
        break;
      }
      i = j;
    }
  }
  return out;
}

export function splitOutline(
  lines: Pt[][],
  driven: Pt[],
  options: {maxDistM?: number; minRunM?: number} = {},
): OutlineUse {
  const maxDistM = options.maxDistM ?? OUTLINE_MAX_DIST_M;
  const minRunM = options.minRunM ?? MIN_RUN_M;
  // No driven line to compare with: nothing can be called unused.
  if (driven.length < 2) return {used: lines.slice(), unused: []};
  const near = nearIndex(resample(driven, DRIVEN_STEP_M), maxDistM);
  const used: Pt[][] = [];
  const unused: Pt[][] = [];
  for (const line of lines) {
    const pts = resample(line, SAMPLE_STEP_M);
    if (pts.length < 2) continue;
    const flags = absorbShortRuns(
      pts.map(p => near(p, maxDistM)),
      SAMPLE_STEP_M,
      minRunM,
    );
    let from = 0;
    for (let i = 1; i <= pts.length; i++) {
      if (i < pts.length && flags[i] === flags[from]) continue;
      // Runs share their boundary point, so the pieces join without a gap.
      const piece = pts.slice(from, Math.min(i + 1, pts.length));
      if (piece.length >= 2) (flags[from] ? used : unused).push(piece);
      from = i;
    }
  }
  return {used, unused};
}
