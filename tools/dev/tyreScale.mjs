// Where the tyre heat strips' scale ends come from (pit-wall thread 73, row 1f):
// the p2 and p98 of every wheel's rubber C and hot kPa over the laps from the
// third lap of a stint on, across the sessions a local analysis wrote.
//
//   node tools/sessions/sync.mjs --local --sim lmu --work <dir> --since 2026-09-25   (LAP_OWNER, DUCKDB, LAP_CAPTURE=<empty folder>)
//   node tools/dev/tyreScale.mjs <dir>/out
//
// Prints the percentiles, then each session's min and max. The outliers (one
// sensor read 133 C) are why the ends are percentiles, not the extremes.
import {readdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const out = resolve(process.argv[2]);
const WHEELS = ['FL', 'FR', 'RL', 'RR'];
const rub = [];
const kpa = [];
const perSession = [];
let sessions = 0;
let laps = 0;
for (const id of readdirSync(out)) {
  let ls;
  let s;
  try {
    ls = JSON.parse(readFileSync(resolve(out, id, 'laps.json'), 'utf8'));
    s = JSON.parse(readFileSync(resolve(out, id, 'session.json'), 'utf8'));
  } catch {
    continue;
  }
  const list = Array.isArray(ls) ? ls : ls.laps ?? ls.items ?? [];
  // Stint lap number: 1-based position of a lap within its stint.
  const seen = new Map();
  const r = [];
  const k = [];
  for (const l of [...list].sort(
    (a, b) => (a.lapIndex ?? a.lapNumber) - (b.lapIndex ?? b.lapNumber),
  )) {
    const st = l.stint ?? 1;
    const n = (seen.get(st) ?? 0) + 1;
    seen.set(st, n);
    const t = l.tyres;
    if (!t || n < 3) continue;
    for (const w of WHEELS) {
      if (t.rubberC?.[w] != null) r.push(t.rubberC[w]);
      if (t.pressureKpa?.[w] != null) k.push(t.pressureKpa[w]);
    }
  }
  if (r.length || k.length) {
    sessions++;
    laps += list.length;
    rub.push(...r);
    kpa.push(...k);
    perSession.push([
      id,
      s.sessionType ?? '',
      r.length ? Math.min(...r).toFixed(1) : '-',
      r.length ? Math.max(...r).toFixed(1) : '-',
      k.length ? Math.min(...k).toFixed(1) : '-',
      k.length ? Math.max(...k).toFixed(1) : '-',
    ]);
  }
}
const pct = (a, p) => {
  const b = [...a].sort((x, y) => x - y);
  return b[
    Math.min(b.length - 1, Math.max(0, Math.round((p / 100) * (b.length - 1))))
  ];
};
console.log(`sessions with tyre readings: ${sessions}, laps ${laps}`);
console.log(
  `rubber C  n=${rub.length}  p2=${pct(rub, 2).toFixed(1)}  p50=${pct(
    rub,
    50,
  ).toFixed(1)}  p98=${pct(rub, 98).toFixed(1)}  min=${Math.min(...rub).toFixed(
    1,
  )} max=${Math.max(...rub).toFixed(1)}`,
);
console.log(
  `pressure kPa n=${kpa.length}  p2=${pct(kpa, 2).toFixed(1)}  p50=${pct(
    kpa,
    50,
  ).toFixed(1)}  p98=${pct(kpa, 98).toFixed(1)}  min=${Math.min(...kpa).toFixed(
    1,
  )} max=${Math.max(...kpa).toFixed(1)}`,
);
for (const row of perSession) console.log(row.join('\t'));
