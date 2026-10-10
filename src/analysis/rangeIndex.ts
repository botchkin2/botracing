// The lowest and highest value of a stretch of a long array, without reading
// the stretch: each array gets a per-block min and max once, and a range is
// read from the blocks it covers plus the two part-blocks at its ends.
// Compare fits every chart's y range to its laps on each cursor step; with 60
// laps a full scan per step was 38 of 46 ms (pit-wall thread 1 #3243). Pure;
// the index is kept per array object, so arrays must not be changed in place.

/** Values per block: the scan of a range touches at most two part-blocks. */
const BLOCK = 32;

interface Index {
  lo: Float64Array;
  hi: Float64Array;
}

const indexes = new WeakMap<ArrayLike<number>, Index>();

function indexOf(a: ArrayLike<number>): Index {
  const known = indexes.get(a);
  if (known) return known;
  const blocks = Math.ceil(a.length / BLOCK);
  const lo = new Float64Array(blocks).fill(Infinity);
  const hi = new Float64Array(blocks).fill(-Infinity);
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    const b = (i / BLOCK) | 0;
    // NaN fails both comparisons, as it does in a plain scan.
    if (v < lo[b]) lo[b] = v;
    if (v > hi[b]) hi[b] = v;
  }
  const index = {lo, hi};
  indexes.set(a as object as ArrayLike<number>, index);
  return index;
}

/**
 * [lowest, highest] of `a[from..to]` (inclusive, clamped to the array);
 * [Infinity, -Infinity] for an empty range or one with no comparable value.
 */
export function rangeOf(
  a: ArrayLike<number>,
  from: number,
  to: number,
): [number, number] {
  const i0 = Math.max(0, from);
  const i1 = Math.min(a.length - 1, to);
  let lo = Infinity;
  let hi = -Infinity;
  if (i1 < i0) return [lo, hi];
  const scan = (s: number, e: number) => {
    for (let i = s; i <= e; i++) {
      const v = a[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  };
  const b0 = Math.ceil(i0 / BLOCK);
  const b1 = Math.floor((i1 + 1) / BLOCK) - 1;
  if (b1 < b0) {
    scan(i0, i1);
    return [lo, hi];
  }
  scan(i0, b0 * BLOCK - 1);
  const idx = indexOf(a);
  for (let b = b0; b <= b1; b++) {
    if (idx.lo[b] < lo) lo = idx.lo[b];
    if (idx.hi[b] > hi) hi = idx.hi[b];
  }
  scan((b1 + 1) * BLOCK, i1);
  return [lo, hi];
}
