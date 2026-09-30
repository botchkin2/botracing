// Backtest (pit-wall thread 36): for every LMU race with a stop, what the planner
// (src/analysis/fuelPlan.ts) would have said from earlier laps, against what happened.
//
//   node tools/sessions/backtest/backtest.mjs [hist.json] [rows.json]
//   LASTN=8 SAMELIMIT=1 node ...   history limited to the last N sessions / the same fill limit
//
// Rules given to the planner: the fill limit, VE 100 %, a formation lap, and the
// laps he actually drove: so this tests the load maths, not minutes to laps.
// Model B feeds VE per lap as litres / the newest session's litres per 1 % VE.
import {readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planRace} from '../../../src/analysis/fuelPlan.ts';

const histPath = process.argv[2] || join(tmpdir(), 'fuel-backtest-hist.json');
const hist = Object.values(JSON.parse(readFileSync(histPath, 'utf8'))).filter(
  h => !h.err,
);
const key = h => [h.track, h.layout, h.model].join('|');
const median = a => {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  return v.length
    ? v.length % 2
      ? v[v.length >> 1]
      : (v[(v.length >> 1) - 1] + v[v.length >> 1]) / 2
    : null;
};
// A green lap, approximately: not in the pit lane, not the first lap, quick enough
// (a yellow or an off makes a lap long), with fuel and VE used.
function greenLaps(h) {
  const inner = h.laps.slice(1);
  const med = median(inner.filter(l => !l.inPit).map(l => l.dur));
  return inner
    .filter(l => !l.inPit && l.dur <= 1.1 * med && l.fuelL > 0)
    .map(l => ({
      fuelL: l.fuelL,
      vePct: l.vePct > 0 ? l.vePct : null,
      lapTimeS: l.dur,
      sessionId: h.name,
    }));
}
const races = hist
  .filter(h => h.session === 'Race' && h.stops.length > 0)
  .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
const rows = [];
for (const r of races) {
  const green = greenLaps(r);
  const mine = {
    fuel: median(green.map(l => l.fuelL)),
    ve: median(green.filter(l => l.vePct).map(l => l.vePct)),
  };
  const LASTN = Number(process.env.LASTN || 0); // only the last N earlier sessions
  let prior = hist
    .filter(
      h =>
        key(h) === key(r) && h.recordedAt < r.recordedAt && h.name !== r.name,
    )
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  if (process.env.SAMELIMIT)
    // only sessions with the same fill limit (a BoP change shows there)
    prior = prior.filter(
      h => (h.fillLimitL ?? h.tankL) === (r.fillLimitL ?? r.tankL),
    );
  if (LASTN) prior = prior.filter(h => greenLaps(h).length > 0).slice(-LASTN);
  const earlier = prior.flatMap(greenLaps);
  const totalLaps = r.laps.length - 1; // lap 0 is the formation/out lap
  const rules = {
    name: r.name,
    lengthLaps: totalLaps,
    lengthMin: null,
    fuelL: r.fillLimitL ?? r.tankL ?? r.startL,
    vePct: 100,
    formationLap: true,
    mandatoryStops: 0,
  };
  const plan = planRace(rules, earlier);
  // Model B (clutch's #136): VE per lap from litres and the newest session's litres-per-1%-VE ratio.
  const sameCar = hist.filter(
    h =>
      key(h) === key(r) &&
      h.recordedAt < r.recordedAt &&
      h.name !== r.name &&
      h.laps.length > 3,
  );
  const ratioOf = h => {
    const g = greenLaps(h).filter(l => l.vePct);
    const v = g.map(l => l.fuelL / l.vePct);
    return v.length >= 3 ? median(v) : null;
  };
  const newest = [...sameCar].reverse().find(h => ratioOf(h) != null);
  const ratio = newest ? ratioOf(newest) : null;
  const earlierB = ratio
    ? earlier.map(l => ({...l, vePct: l.fuelL / ratio}))
    : earlier;
  const planB = planRace(rules, earlierB);
  const stopLaps = r.stops.map(s => s.lap);
  const stint = o => o.stopLaps;
  // What was left, in laps at this race's own median.
  const flagL = r.endL,
    flagVe = r.endVe;
  const overfill = mine.fuel ? flagL / mine.fuel : null;
  rows.push({
    file: r.name.replace('.duckdb', ''),
    date: r.recordedAt.slice(0, 10),
    track: r.track.replace(
      / (International|Speedway|Circuit|Raceway|Michelin).*/,
      '',
    ),
    model: r.model,
    limitL: r.fillLimitL ?? r.startL,
    totalLaps,
    stops: r.stops.length,
    stopLaps,
    med: mine,
    historyLaps: earlier.length,
    historySessions: new Set(earlier.map(l => l.sessionId)).size,
    predMedian:
      plan.atMedian.stops == null
        ? null
        : {
            stops: plan.atMedian.stops,
            stopLaps: stint(plan.atMedian),
            firstLaps: plan.atMedian.firstStint.laps,
            limit: plan.atMedian.firstStint.limitedBy,
          },
    predP90:
      plan.atP90.stops == null
        ? null
        : {
            stops: plan.atP90.stops,
            stopLaps: stint(plan.atP90),
            firstLaps: plan.atP90.firstStint.laps,
            limit: plan.atP90.firstStint.limitedBy,
          },
    predBMedian:
      planB.atMedian.stops == null
        ? null
        : {
            stops: planB.atMedian.stops,
            stopLaps: planB.atMedian.stopLaps,
            firstLaps: planB.atMedian.firstStint.laps,
            limit: planB.atMedian.firstStint.limitedBy,
          },
    predBP90:
      planB.atP90.stops == null
        ? null
        : {stops: planB.atP90.stops, stopLaps: planB.atP90.stopLaps},
    ratioB: ratio ? +ratio.toFixed(3) : null,
    perStop: r.stops.map(s => ({
      lap: s.lap,
      atEntryL: s.fuelAtEntry,
      atEntryVe: s.veAtEntry,
      addedL: s.addedL,
      addedVe: s.addedVe,
      inPitS: s.inPitS,
      entryLaps: mine.fuel ? +(s.fuelAtEntry / mine.fuel).toFixed(1) : null,
    })),
    flagL,
    flagVe,
    spareLaps: overfill == null ? null : +overfill.toFixed(1),
    startL: r.startL,
  });
}
writeFileSync(
  process.argv[3] || join(tmpdir(), 'fuel-backtest-rows.json'),
  JSON.stringify(rows, null, 1),
);
console.log(rows.length, 'races');
