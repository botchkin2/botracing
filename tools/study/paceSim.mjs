// Pace simulation v2 (pit-wall thread 1 #4889): drivers with a curved stint fade, a shared lap rhythm, section
// noise scaled by driver level, and truth-labelled events. Study only: nothing in the app imports this.
import {rng, makeDriver} from './paceSimGen.mjs';
const med = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n === 0 ? null : n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const rsig = a => { const m = med(a); return m == null ? 0 : 1.4826 * med(a.map(v => Math.abs(v - m))); };
function sen(xs, ys) { const sl = []; for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) sl.push((ys[j] - ys[i]) / (xs[j] - xs[i])); return med(sl) ?? 0; }
// judge (a): #577 as decided: robust straight trend, 3 sigma of residuals, 0.3 s guard, min 12 laps, slow only.
export function judgeA(stint, {z = 3, guard = 0.3, min = 12} = {}) {
  const ys = stint.laps.map(l => l.lapTime), xs = ys.map((_, i) => i); if (ys.length < min) return ys.map(() => ({out: false}));
  const range = xs.length - 1; let slope = xs.length >= 6 && range >= 5 ? sen(xs, ys) : 0; const fit = rsig(ys.map((y, i) => y - slope * xs[i])); if (Math.abs(slope) * range < 2 * fit) slope = 0;
  const ic = med(ys.map((y, i) => y - slope * xs[i])); const res = ys.map((y, i) => y - (ic + slope * xs[i])); const lim = Math.max(z * rsig(res), guard);
  return res.map(r => ({out: r >= lim, p: null}));
}
// the (a) with the run rule (a run of 3+ slow laps stays): #577's built variant
export function judgeARun(stint, o) { const base = judgeA(stint, o).map(x => x.out); const keep = [...base]; let i = 0; while (i < base.length) { if (!base[i]) { i++; continue; } let j = i; while (j + 1 < base.length && base[j + 1]) j++; if (j - i + 1 > 2) for (let k = i; k <= j; k++) keep[k] = false; i = j + 1; } return keep.map(out => ({out})); }
export const judges = {'(a) 3σ lap residual, straight trend': judgeA, '(a+) same, run of 3+ stays': judgeARun};
export async function run(judgeMap = judges, N = 400) {
  const levels = [0.02, 0.05, 0.1, 0.2, 0.3];
  const bands = ['0.3-1', '1-3', '3-10'];
  const bandOf = s => s < 1 ? 0 : s < 3 ? 1 : 2;
  for (const [name, judge] of Object.entries(judgeMap)) {
    console.log('\n## ' + name + `   (${N} drivers per level, 4-12 sections, 80/105/125 s, 25 laps; 4% section mistakes, 3% spread events, ~3% pace-change starts)`);
    console.log('level s | mistakes caught 0.3-1/1-3/3-10 s | spread events caught | clean dropped | pace-change laps dropped | kept-median error vs truth (s): mean abs, [all-laps median error]');
    for (const level of levels) {
      const r = rng(7 + Math.round(level * 1000)); const m = [[0, 0], [0, 0], [0, 0]], sp = [0, 0], cl = [0, 0], pc = [0, 0]; let errKept = 0, errAll = 0, ne = 0;
      for (let d = 0; d < N; d++) {
        const sections = 4 + Math.floor(9 * r()), base = [80, 105, 125][Math.floor(3 * r())];
        const drv = makeDriver(r, {level, sections, base, laps: 25}); const flags = judge(drv, ).map(x => x.out);
        const truth = med(drv.laps.map(l => l.cleanTime)); const kept = drv.laps.filter((_, i) => !flags[i]).map(l => l.lapTime);
        if (kept.length) { errKept += Math.abs(med(kept) - truth); errAll += Math.abs(med(drv.laps.map(l => l.lapTime)) - truth); ne++; }
        drv.laps.forEach((l, i) => { const c = flags[i] ? 1 : 0; if (l.kind === 'mistake') { const b = bandOf(l.size); m[b][1]++; m[b][0] += c; } else if (l.kind === 'spread') { sp[1]++; sp[0] += c; } else if (l.kind === 'pacechange') { pc[1]++; pc[0] += c; } else { cl[1]++; cl[0] += c; } });
      }
      const pct = ([a, b]) => b ? (100 * a / b).toFixed(0) + '%' : '-';
      console.log(`${level.toFixed(2)} | ${m.map(pct).join(' / ')} | ${pct(sp)} | ${(100 * cl[0] / cl[1]).toFixed(1)}% | ${pct(pc)} | ${(errKept / ne).toFixed(3)} [${(errAll / ne).toFixed(3)}]`);
    }
  }
}
// node tools/study/paceSim.mjs [--judges <module>]: the module exports `judges`, a map name -> judge(stint),
// where stint = {laps: [{lapTime, sections: [s]}]} and a judge returns [{out: boolean}] per lap. The
// simulator's own judges (a) and (a+) always run. Truth labels are on each lap (kind, size, cleanTime).
if (process.argv[1].endsWith('paceSim.mjs')) {
  const at = process.argv.indexOf('--judges');
  const extra = at > 0 ? (await import(new URL(process.argv[at + 1], 'file:///' + process.cwd().replace(/\/g, '/') + '/').href)).judges : {};
  run({...judges, ...extra});
}
