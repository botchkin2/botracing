// (a) and (a+) as #577 decided: robust straight trend per driver, 3 sigma of the residuals, 0.3 s guard, min 12 laps,
// slow only; (a+) leaves a run of 3+ slow laps in. Judges take a stint {laps:[{lapTime}]} and return [{out}].
const med = a => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n === 0 ? null : n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const rsig = a => {
  const m = med(a);
  return m == null ? 0 : 1.4826 * med(a.map(v => Math.abs(v - m)));
};
function sen(xs, ys) {
  const sl = [];
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++)
      sl.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  return med(sl) ?? 0;
}
// (a): #577 as decided: robust straight trend, 3 sigma of residuals, 0.3 s guard, min 12 laps, slow only.
export function judgeA(stint, {z = 3, guard = 0.3, min = 12} = {}) {
  const ys = stint.laps.map(l => l.lapTime),
    xs = ys.map((_, i) => i);
  if (ys.length < min) return ys.map(() => ({out: false}));
  const range = xs.length - 1;
  let slope = xs.length >= 6 && range >= 5 ? sen(xs, ys) : 0;
  const fit = rsig(ys.map((y, i) => y - slope * xs[i]));
  if (Math.abs(slope) * range < 2 * fit) slope = 0;
  const ic = med(ys.map((y, i) => y - slope * xs[i]));
  const res = ys.map((y, i) => y - (ic + slope * xs[i]));
  const lim = Math.max(z * rsig(res), guard);
  return res.map(r => ({out: r >= lim, p: null}));
}
// the (a) with the run rule (a run of 3+ slow laps stays): #577's built variant
export function judgeARun(stint, o) {
  const base = judgeA(stint, o).map(x => x.out);
  const keep = [...base];
  let i = 0;
  while (i < base.length) {
    if (!base[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < base.length && base[j + 1]) j++;
    if (j - i + 1 > 2) for (let k = i; k <= j; k++) keep[k] = false;
    i = j + 1;
  }
  return keep.map(out => ({out}));
}
