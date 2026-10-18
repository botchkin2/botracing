// Spearman's rank correlation of two series, and the size it must reach to be
// told from no relation at all. Pure.

/** Ranks from 1; equal values share the mean of the ranks they span. */
export function ranksOf(values: readonly number[]): number[] {
  const order = values
    .map((v, i) => [v, i] as const)
    .sort((a, b) => a[0] - b[0]);
  const out: number[] = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = rank;
    i = j + 1;
  }
  return out;
}

/**
 * Spearman's rho over the pairs where both values are numbers: the Pearson
 * correlation of their ranks. Null under 3 pairs, or when either side never
 * varies (every value equal: no order to correlate).
 */
export function spearman(
  xs: readonly (number | null)[],
  ys: readonly (number | null)[],
): {rho: number; n: number} | null {
  const a: number[] = [];
  const b: number[] = [];
  xs.forEach((x, i) => {
    const y = ys[i];
    if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) {
      a.push(x);
      b.push(y);
    }
  });
  const n = a.length;
  if (n < 3) return null;
  const ra = ranksOf(a);
  const rb = ranksOf(b);
  const mean = (n + 1) / 2;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (ra[i] - mean) * (rb[i] - mean);
    saa += (ra[i] - mean) ** 2;
    sbb += (rb[i] - mean) ** 2;
  }
  if (saa === 0 || sbb === 0) return null;
  return {rho: sab / Math.sqrt(saa * sbb), n};
}

// The two-sided 5 % critical values of |rho| for n pairs (the exact table,
// n 10 to 30, Zar's Biostatistical Analysis).
const CRITICAL: Record<number, number> = {
  10: 0.648,
  11: 0.618,
  12: 0.587,
  13: 0.56,
  14: 0.538,
  15: 0.521,
  16: 0.503,
  17: 0.485,
  18: 0.472,
  19: 0.46,
  20: 0.447,
  21: 0.435,
  22: 0.425,
  23: 0.415,
  24: 0.406,
  25: 0.398,
  26: 0.39,
  27: 0.382,
  28: 0.375,
  29: 0.368,
  30: 0.362,
};

/**
 * The |rho| a relation must reach, with n pairs, to be told from none at the
 * two-sided 5 % level: the exact table to n 30, the t approximation past it
 * (rho = t / sqrt(n - 2 + t^2), t the 97.5 % point with n - 2 degrees of
 * freedom). Null under 10 pairs, where the table stops being useful and the
 * screens show nothing.
 */
export function spearmanCritical(n: number): number | null {
  if (n < 10) return null;
  if (n <= 30) return CRITICAL[n];
  const z = 1.959964;
  const df = n - 2;
  const t =
    z +
    (z ** 3 + z) / (4 * df) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);
  return t / Math.sqrt(df + t * t);
}
