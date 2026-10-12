import {type NativeSamples, thinSamples} from '@/src/analysis/nativeSamples';

// Chart lines built once, in lap-wide build pixels, and cut into chunks one
// window wide; the chart scrolls them with a transform. While playing, a
// frame then costs a translate, not a rebuild of every line (pit-wall
// thread 26 #528/#529: rebuilding every path was two thirds of a frame).
//
// x: lap position in build pixels, u × sx, where u is metres or, in time
// mode, the reference lap's elapsed time. y: pixels in the target y range.
// A segment belongs to the chunk that holds its left point, so chunks meet
// exactly and no segment is drawn twice (it would show on faint lines).
// Tangents come from a margin of neighbours either side, so a chunk's
// curve is identical to the same stretch of a whole-lap curve.

export type ChunkSource = {
  /** One value per grid point (index × stepM metres). */
  values: number[];
  /** Recorded samples: drawn instead of `values` when given. */
  samples?: NativeSamples;
  /** Discrete channel: steps, never smoothed. */
  stepped?: boolean;
};

export type ChunkFrame = {
  /** Identity of everything below; chunks are cached under it. */
  key: string;
  /** Lap distance → x units (metres, or reference seconds). */
  uOfM: (m: number) => number;
  /** Grid index → x units. */
  uOfIndex: (i: number) => number;
  stepM: number;
  /** Build pixels per x unit. */
  sx: number;
  /** Value → build pixels. */
  y: (v: number) => number;
  /** Chunk width, build pixels. */
  chunkPx: number;
  /** Lap distance per build pixel, averaged over the lap (thinning, stride). */
  mPerPx: number;
};

type Pt = [number, number];

// Neighbours either side that feed a chunk's tangents. A tangent depends on
// its two neighbours; the overshoot fix can chain further in rare runs of
// steep segments, so keep a wide margin.
const MARGIN = 8;

const f = (v: number) => v.toFixed(1);

// Fritsch–Carlson tangents: a curve through every point that never
// overshoots them (thread 26 #397/#402).
function monotoneTangents(pts: Pt[]): number[] {
  const n = pts.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0] || 1e-6);
    slope.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  if (n < 2) return [0];
  const t: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++)
    t.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  t.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / slope[i];
    const b = t[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * slope[i];
      t[i + 1] = k * b * slope[i];
    }
  }
  return t;
}

/** Segments [a, b) of pts as path commands, starting with a move to pts[a]. */
function emit(
  pts: Pt[],
  a: number,
  b: number,
  kind: 'monotone' | 'catmull' | 'line' | 'step',
): string {
  if (b <= a) return '';
  let d = `M${f(pts[a][0])},${f(pts[a][1])}`;
  const t = kind === 'monotone' ? monotoneTangents(pts) : null;
  for (let i = a; i < b; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (kind === 'step') d += `H${f(x1)}V${f(y1)}`;
    else if (kind === 'line') d += `L${f(x1)},${f(y1)}`;
    else if (t) {
      const h = (x1 - x0) / 3;
      d += `C${f(x0 + h)},${f(y0 + t[i] * h)} ${f(x1 - h)},${f(
        y1 - t[i + 1] * h,
      )} ${f(x1)},${f(y1)}`;
    } else {
      const p0 = pts[i - 1] ?? pts[i];
      const p3 = pts[i + 2] ?? pts[i + 1];
      d += `C${f(x0 + (x1 - p0[0]) / 6)},${f(y0 + (y1 - p0[1]) / 6)} ${f(
        x1 - (p3[0] - x0) / 6,
      )},${f(y1 - (p3[1] - y0) / 6)} ${f(x1)},${f(y1)}`;
    }
  }
  return d;
}

/** First index whose x is >= px, over ascending xs (binary search). */
function lowerBound(xs: (i: number) => number, n: number, px: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs(mid) < px) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Chunk k's path: the segments whose left point has x in [k, k+1) × chunkPx. */
export function buildChunk(
  src: ChunkSource,
  frame: ChunkFrame,
  k: number,
): string {
  const lo = k * frame.chunkPx;
  const hi = lo + frame.chunkPx;
  if (src.samples) {
    let s = src.samples;
    // More samples than pixels (whole-lap zoom): the extremes per pixel.
    const perPx =
      (s.distanceM.length / (s.distanceM.at(-1) || 1)) * frame.mPerPx;
    if (perPx > 2) s = thinSamples(s, frame.mPerPx);
    const n = s.distanceM.length;
    const xAt = (i: number) => frame.uOfM(s.distanceM[i]) * frame.sx;
    const a = lowerBound(xAt, n, lo);
    const b = lowerBound(xAt, n, hi);
    // Owned segments: left points a..b-1 (the last one reaches point b).
    const first = Math.max(0, a - MARGIN);
    const last = Math.min(n - 1, b + MARGIN);
    const pts: Pt[] = [];
    for (let i = first; i <= last; i++)
      pts.push([xAt(i), frame.y(s.values[i])]);
    return emit(
      pts,
      a - first,
      Math.min(b, n - 1) - first,
      src.stepped ? 'step' : 'monotone',
    );
  }
  // Grid values: every stride-th point, aligned to the lap so chunks agree.
  const v = src.values;
  const stride = Math.max(1, Math.floor(frame.mPerPx / frame.stepM));
  const count = Math.floor((v.length - 1) / stride) + 1;
  const xAt = (j: number) => frame.uOfIndex(j * stride) * frame.sx;
  const a = lowerBound(xAt, count, lo);
  const b = lowerBound(xAt, count, hi);
  const first = Math.max(0, a - MARGIN);
  const last = Math.min(count - 1, b + MARGIN);
  const pts: Pt[] = [];
  for (let j = first; j <= last; j++)
    pts.push([xAt(j), frame.y(v[j * stride])]);
  const kind = src.stepped
    ? 'step'
    : frame.mPerPx / frame.stepM < 0.5
    ? 'catmull'
    : 'line';
  return emit(pts, a - first, Math.min(b, count - 1) - first, kind);
}

/**
 * A chunk's line closed down to a baseline (y in build pixels), for a filled
 * area under it. Empty for an empty path. The line's first and last points
 * are its first "M" and its last coordinate pair.
 */
export function areaPath(d: string, baseY: number): string {
  if (d === '') return '';
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 4) return '';
  const x0 = nums[0];
  const x1 = nums[nums.length - 2];
  return `${d}L${x1},${f(baseY)}L${x0},${f(baseY)}Z`;
}

// Built chunks, per source (its samples or values array) and frame key. A
// source keeps the chunks of its last few frames: y ranges change at section
// boundaries and may change back. Within a frame it keeps the chunks it drew
// last, not the whole lap: a lap of path strings for every line is megabytes
// on a phone (scrutineer, #80).
const KEEP_FRAMES = 4;
const KEEP_CHUNKS = 6;
const ids = new WeakMap<object, number>();
let nextId = 1;
/** A stable number for an object, for frame keys (e.g. the reference lap). */
export function objectId(o: object): number {
  let id = ids.get(o);
  if (id == null) ids.set(o, (id = nextId++));
  return id;
}

const cache = new WeakMap<object, Map<string, Map<number, string>>>();

/** buildChunk, memoized on the source's identity and the frame key. */
export function chunkPath(
  src: ChunkSource,
  frame: ChunkFrame,
  k: number,
): string {
  const id: object = src.samples ?? src.values;
  let frames = cache.get(id);
  if (!frames) cache.set(id, (frames = new Map()));
  let chunks = frames.get(frame.key);
  if (!chunks) {
    if (frames.size >= KEEP_FRAMES)
      frames.delete(frames.keys().next().value as string);
    frames.set(frame.key, (chunks = new Map()));
  }
  let d = chunks.get(k);
  if (d == null) {
    // Oldest first (insertion order); playback moves one way, so the oldest
    // chunk is the one furthest behind.
    if (chunks.size >= KEEP_CHUNKS)
      chunks.delete(chunks.keys().next().value as number);
    chunks.set(k, (d = buildChunk(src, frame, k)));
  }
  return d;
}

/**
 * Chunk indices to draw for a window [x0, x1] (build pixels): those it
 * touches, plus the one to its left, whose last segment reaches into it.
 */
export function chunksIn(x0: number, x1: number, chunkPx: number): number[] {
  const out: number[] = [];
  for (let k = Math.floor(x0 / chunkPx) - 1; k <= Math.floor(x1 / chunkPx); k++)
    out.push(k);
  return out;
}
