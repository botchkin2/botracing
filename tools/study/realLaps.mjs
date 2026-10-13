// (a0) vs (f) 3.5σ on the local sync folders (study only): node tools/study/realLaps.mjs <work dir>
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {judgeA0Session} from './paceJudgeA0.mjs';
import {judgeF} from './paceJudge.mjs';
const root = process.argv[2];
const t = {
  sessions: 0,
  laps: 0,
  a0: 0,
  f: 0,
  both: 0,
  onlyA0: 0,
  onlyF: 0,
  sessionsA0: 0,
  sessionsF: 0,
};
for (const dir of [root + '/all/out', root + '/all-ir/out']) {
  if (!existsSync(dir)) continue;
  for (const id of readdirSync(dir)) {
    let L;
    try {
      L = JSON.parse(readFileSync(`${dir}/${id}/laps.json`, 'utf8'));
    } catch {
      continue;
    }
    L = Array.isArray(L) ? L : Object.values(L);
    const cand = L.filter(
      l =>
        l.timed !== false &&
        l.lapTime != null &&
        !l.incomplete &&
        !l.partial &&
        !l.pitIn &&
        !l.pitOut &&
        Number.isFinite(l.lapTime),
    );
    if (cand.length < 12) continue;
    const secs = l =>
      l.startStraight && Array.isArray(l.corners)
        ? [l.startStraight.segTime, ...l.corners.map(c => c.segTime)]
        : null;
    const n = secs(cand[0])?.length;
    const ok =
      n &&
      cand.every(l => {
        const s = secs(l);
        return s && s.length === n && s.every(Number.isFinite);
      });
    const stints = [...new Set(cand.map(l => l.stint ?? 1))].map(s => ({
      laps: cand
        .filter(l => (l.stint ?? 1) === s)
        .map(l => ({
          id: l.id,
          lapTime: l.lapTime,
          sections: ok ? secs(l) : null,
          evidence: null,
        })),
    }));
    t.sessions++;
    t.laps += cand.length;
    const a0 = new Set([...judgeA0Session({stints})].map(l => l.id));
    const fr = judgeF({stints}, {k: 3.5});
    const f = new Set([...fr].filter(([, v]) => v.out).map(([k]) => k));
    t.a0 += a0.size;
    t.f += f.size;
    t.both += [...a0].filter(x => f.has(x)).length;
    t.onlyA0 += [...a0].filter(x => !f.has(x)).length;
    t.onlyF += [...f].filter(x => !a0.has(x)).length;
    if (a0.size) t.sessionsA0++;
    if (f.size) t.sessionsF++;
  }
}
console.log(
  JSON.stringify(t),
  `a0 ${((100 * t.a0) / t.laps).toFixed(1)}% f ${((100 * t.f) / t.laps).toFixed(
    1,
  )}%`,
);
