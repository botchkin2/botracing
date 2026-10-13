// One rule at any size (thread 1 #4928): (f) with the 12-lap minimum lowered,
// sigma with and without the small-sample MAD factor (Croux & Rousseeuw 1992),
// against today's uploader cut (median + max(3 sigma, 1.5 s), capped at 107 %).
import {rng, makeDriver} from './paceSimGen.mjs';
import * as J from './paceJudge.mjs';

const med = xs => { const v = [...xs].sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const mad = xs => { const m = med(xs); return 1.4826 * med(xs.map(x => Math.abs(x - m))); };
// Croux & Rousseeuw (1992) small-sample correction for the MAD.
const bn = n => ({2: 1.196, 3: 1.495, 4: 1.363, 5: 1.206, 6: 1.2, 7: 1.14, 8: 1.129, 9: 1.107}[n] ?? n / (n - 0.8));

function judgeOld(laps) {
  const t = laps.map(l => l.lapTime), b = med(t), s = mad(t);
  const cut = Math.min(b * 1.07, b + Math.max(3 * s, 1.5));
  return t.map(x => x > cut);
}

function judgeF(laps, {k = 3.5, minLaps = 3, correct = false}) {
  const n = laps.length;
  if (n < minLaps) return laps.map(() => false);
  const S = laps[0].sections.length;
  const base = Array.from({length: S}, (_, s) => med(laps.map(l => l.sections[s])));
  const total = base.reduce((a, b) => a + b, 0);
  const wmed = (xs, ws) => { const v = xs.map((x, i) => [x, ws[i]]).sort((a, b) => a[0] - b[0]); const T = ws.reduce((a, b) => a + b, 0); let acc = 0; for (const [x, w] of v) { acc += w; if (acc >= T / 2) return x; } };
  const f = laps.map(l => wmed(l.sections.map((t, s) => t / base[s]), base));
  const fh = J.smoothPace(f);
  const r = laps.map((l, i) => l.lapTime - total * fh[i]);
  const sigma = mad(r) * (correct ? bn(n) : 1);
  const limit = Math.max(k * sigma, 0.3);
  return r.map(x => x > limit);
}

const N = 400, levels = [0.02, 0.05, 0.1, 0.2, 0.3];
const judges = {
  'old cut (uploader today)': l => judgeOld(l),
  '(f) 3.5σ, min 3': l => judgeF(l, {}),
  '(f) 3.5σ, min 3, small-n factor': l => judgeF(l, {correct: true}),
};
console.log('laps | judge | clean dropped (levels .02/.05/.10/.20/.30) | mistakes 1-3 s caught | 3-10 s caught | spread kept/true [keep all]');
for (const laps of [3, 5, 8, 12, 25]) for (const [name, judge] of Object.entries(judges)) {
  const cl = [], c13 = [], c310 = [], sp = [], spAll = [];
  for (const level of levels) {
    const r = rng(11 + Math.round(level * 1000) + laps);
    let a = [0, 0], b = [0, 0], c = [0, 0], spr = 0, sprAll = 0, ns = 0;
    for (let d = 0; d < N; d++) {
      const drv = makeDriver(r, {level, sections: 4 + Math.floor(9 * r()), base: [80, 105, 125][Math.floor(3 * r())], laps});
      const out = judge(drv.laps);
      drv.laps.forEach((l, i) => {
        if (l.kind === 'clean' || l.kind === 'pacechange') { a[1]++; a[0] += out[i]; }
        else if (l.kind === 'mistake' && l.size >= 1 && l.size < 3) { b[1]++; b[0] += out[i]; }
        else if (l.kind === 'mistake' && l.size >= 3) { c[1]++; c[0] += out[i]; }
      });
      // spread of lap time minus its noise-free expectation, kept vs the clean truth
      const dev = drv.laps.map(l => l.lapTime - l.expected), truth = mad(drv.laps.map(l => l.cleanTime - l.expected));
      const kept = dev.filter((_, i) => !out[i]);
      if (truth > 0 && kept.length >= 2) { spr += mad(kept) / truth; sprAll += mad(dev) / truth; ns++; }
    }
    const pct = ([x, y]) => (y ? Math.round(100 * x / y) : '-');
    cl.push((100 * a[0] / a[1]).toFixed(1)); c13.push(pct(b)); c310.push(pct(c)); sp.push((spr / ns).toFixed(2)); spAll.push((sprAll / ns).toFixed(2));
  }
  console.log(`${laps} | ${name} | ${cl.join('/')}% | ${c13.join('/')}% | ${c310.join('/')}% | ${sp.join('/')} [${spAll.join('/')}]`);
}
