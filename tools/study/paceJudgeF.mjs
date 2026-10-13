// (f) from kingpin's description (paceJudge.mjs comment), written independently (gasket): the lap's pace factor is the
// median over sections of section time / that section's session median; a running median of 5 along the stint gives the
// curve; the lap's residual is its time minus (sum of section bases x curve); 3.5 sigma of the session's residuals,
// at least 0.3 s, slow only; fewer than 12 laps drops nothing; no sections: straight-trend rule (a).
import {judgeA} from './paceJudgeA.mjs';

const med = a => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  const n = s.length;
  return n === 0 ? NaN : n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const rsig = a => 1.4826 * med(a.map(v => Math.abs(v - med(a))));
// running median of 5; the two laps at each end use the largest odd window that fits
function running5(f) {
  const n = f.length;
  if (n < 5) return f.map(() => med(f));
  return f.map((_, i) => {
    const h = Math.min(2, i, n - 1 - i);
    return med(f.slice(i - h, i + h + 1));
  });
}
export function judgeFIndependent(
  stint,
  {z = 3.5, guard = 0.3, min = 12} = {},
) {
  const laps = stint.laps;
  if (laps.length < min) return laps.map(() => ({out: false}));
  if (!laps.every(l => Array.isArray(l.sections))) return judgeA(stint);
  const n = laps[0].sections.length;
  const base = Array.from({length: n}, (_, s) =>
    med(laps.map(l => l.sections[s])),
  );
  const total = base.reduce((a, b) => a + b, 0);
  const factor = laps.map(l => med(l.sections.map((t, s) => t / base[s])));
  const curve = running5(factor);
  const res = laps.map((l, i) => l.lapTime - total * curve[i]);
  const lim = Math.max(z * rsig(res), guard);
  return res.map(r => ({out: r >= lim}));
}
export const judges = {
  '(f) independent, 3.5σ': judgeFIndependent,
  '(f) independent, 3σ': s => judgeFIndependent(s, {z: 3}),
};
