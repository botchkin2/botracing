// Pace simulation v2 (pit-wall thread 1 #4889): drivers with a curved stint fade, a shared lap rhythm, section
// noise scaled by driver level, and truth-labelled events. Study only: nothing in the app imports this.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

import {judgeA, judgeARun} from './paceJudgeA.mjs';
import {rng, makeDriver} from './paceSimGen.mjs';
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
export const judges = {
  '(a) 3σ lap residual, straight trend': judgeA,
  '(a+) same, run of 3+ stays': judgeARun,
};
export async function run(judgeMap = judges, N = 400) {
  const levels = [0.02, 0.05, 0.1, 0.2, 0.3];
  const bands = ['0.3-1', '1-3', '3-10'];
  const bandOf = s => (s < 1 ? 0 : s < 3 ? 1 : 2);
  for (const [name, judge] of Object.entries(judgeMap)) {
    console.log(
      '\n## ' +
        name +
        `   (${N} drivers per level, 4-12 sections, 80/105/125 s, 25 laps; 4% section mistakes, 3% spread events, ~3% pace-change starts)`,
    );
    console.log(
      'level s | mistakes caught 0.3-1/1-3/3-10 s | spread events caught | clean dropped | pace-change laps dropped | kept-median error (s) [keep all] | spread kept/true [keep all] | slope error (s/lap) [keep all]',
    );
    for (const level of levels) {
      const r = rng(7 + Math.round(level * 1000));
      const m = [
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        sp = [0, 0],
        cl = [0, 0],
        pc = [0, 0];
      let errKept = 0,
        errAll = 0,
        ne = 0,
        spK = 0,
        spA = 0,
        slK = 0,
        slA = 0;
      for (let d = 0; d < N; d++) {
        const sections = 4 + Math.floor(9 * r()),
          base = [80, 105, 125][Math.floor(3 * r())];
        const drv = makeDriver(r, {level, sections, base, laps: 25});
        const flags = judge(drv).map(x => x.out);
        const truth = med(drv.laps.map(l => l.cleanTime));
        // spread: robust sigma of (lap time - the noise-free expectation) over the kept laps vs over the clean times
        const rs = ls => rsig(ls.map(l => l.lapTime - l.expected));
        const keptLaps = drv.laps.filter((_, i) => !flags[i]);
        const trueSpread = rsig(drv.laps.map(l => l.cleanTime - l.expected));
        if (keptLaps.length >= 5 && trueSpread > 0) {
          spK += rs(keptLaps) / trueSpread;
          spA += rs(drv.laps) / trueSpread;
        }
        // stint slope: Theil-Sen of time against lap index, kept vs all, against the slope of the clean times
        const slopeOf = pts => {
          const sl = [];
          for (let i = 0; i < pts.length; i++)
            for (let j = i + 1; j < pts.length; j++)
              sl.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
          return med(sl);
        };
        const idx = drv.laps.map((l, i) => [i, l]);
        const trueSlope = slopeOf(idx.map(([i, l]) => [i, l.cleanTime]));
        const keptSlope = slopeOf(
          idx.filter(([i]) => !flags[i]).map(([i, l]) => [i, l.lapTime]),
        );
        const allSlope = slopeOf(idx.map(([i, l]) => [i, l.lapTime]));
        if (keptSlope != null) {
          slK += Math.abs(keptSlope - trueSlope);
          slA += Math.abs(allSlope - trueSlope);
        }
        const kept = drv.laps.filter((_, i) => !flags[i]).map(l => l.lapTime);
        if (kept.length) {
          errKept += Math.abs(med(kept) - truth);
          errAll += Math.abs(med(drv.laps.map(l => l.lapTime)) - truth);
          ne++;
        }
        drv.laps.forEach((l, i) => {
          const c = flags[i] ? 1 : 0;
          if (l.kind === 'mistake') {
            const b = bandOf(l.size);
            m[b][1]++;
            m[b][0] += c;
          } else if (l.kind === 'spread') {
            sp[1]++;
            sp[0] += c;
          } else if (l.kind === 'pacechange') {
            pc[1]++;
            pc[0] += c;
          } else {
            cl[1]++;
            cl[0] += c;
          }
        });
      }
      const pct = ([a, b]) => (b ? ((100 * a) / b).toFixed(0) + '%' : '-');
      console.log(
        `${level.toFixed(2)} | ${m.map(pct).join(' / ')} | ${pct(sp)} | ${(
          (100 * cl[0]) /
          cl[1]
        ).toFixed(1)}% | ${pct(pc)} | ${(errKept / ne).toFixed(3)} [${(
          errAll / ne
        ).toFixed(3)}] | ${(spK / ne).toFixed(2)} [${(spA / ne).toFixed(
          2,
        )}] | ${(slK / ne).toFixed(3)} [${(slA / ne).toFixed(3)}]`,
      );
    }
  }
}
// node tools/study/paceSim.mjs [--judges <module>]: the module exports `judges`, a map name -> judge(stint),
// where stint = {laps: [{lapTime, sections: [s]}]} and a judge returns [{out: boolean}] per lap. The
// simulator's own judges (a) and (a+) always run. Truth labels are on each lap (kind, size, cleanTime).
if (process.argv[1].endsWith('paceSim.mjs')) {
  const at = process.argv.indexOf('--judges');
  const extra =
    at > 0
      ? (await import(pathToFileURL(resolve(process.argv[at + 1])).href)).judges
      : {};
  run({...judges, ...extra});
}
