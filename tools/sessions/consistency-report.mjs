// Check the consistency analysis on sessions written by `sync.mjs --local`.
//
//   node tools/sessions/consistency-report.mjs --work <dir> [--session <id>]
//
// Rebuilds each lap's facts from laps.json, the way the app will from lap
// docs, reruns src/analysis/consistency.ts, and checks the result matches
// what the uploader stored. With --session it prints the lap table. Without,
// it prints one line per session and how many lap results change when each
// threshold moves by ±20%.
import {readdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  analyzeConsistency,
  defaultThresholds,
  normalRacing,
} from '../../src/analysis/consistency.ts';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const work = resolve(arg('--work', '.'));
const only = arg('--session', '');

const read = (dir, name) =>
  JSON.parse(readFileSync(resolve(dir, name), 'utf8'));

// A lap doc back into the facts the module takes.
function facts(lap) {
  return {
    id: lap.id,
    lapNumber: lap.lapNumber,
    stint: lap.stint,
    stintLap: lap.stintLap,
    lapTime: lap.lapTime,
    timed: lap.timed,
    partial: lap.partial,
    pitIn: lap.pitIn,
    pitOut: lap.pitOut,
    start: lap.start,
    newTyres: lap.newTyres,
    offtrack: lap.offtrack,
    offTrackSec: lap.offTrackSec,
    impactMax: lap.impactMax,
    tyreCarcassC: lap.tyreCarcassC,
    courseYellowSec: lap.courseYellowSec,
    corners: lap.corners?.length ? lap.corners : null,
  };
}

function run(all, thresholds) {
  const excluded = normalRacing(all, thresholds);
  const selected = all.filter(f => excluded.get(f.id).length === 0);
  return {excluded, result: analyzeConsistency(selected, thresholds)};
}

// What a lap result says, for comparing two runs.
const label = r =>
  r.offPace
    ? `off:${r.losses.map(x => x.corner + (x.mistake ? '!' : '')).join(',')}`
    : r.losses.some(x => x.mistake)
      ? `mistake:${r.losses.map(x => x.corner).join(',')}`
      : 'normal';

const keys = ['offPaceZ', 'lossZ', 'lossCover', 'mistakeZ', 'mistakeSec'];
const changed = Object.fromEntries(keys.map(k => [k, 0]));
let total = 0;
let mismatches = 0;

const outDir = resolve(work, 'out');
for (const id of only ? [only] : readdirSync(outDir)) {
  const dir = resolve(outDir, id);
  let session;
  let laps;
  try {
    session = read(dir, 'session.json');
    laps = read(dir, 'laps.json');
  } catch {
    continue;
  }
  if (!session.consistency) continue;
  const all = laps.map(facts);
  const {excluded, result} = run(all, defaultThresholds);

  // The phone's rerun must match what was stored at upload.
  const stored = new Map(laps.map(l => [l.id, l]));
  for (const r of result.laps) {
    const lap = stored.get(r.id);
    if (JSON.stringify(lap.consistency) !== JSON.stringify({residual: r.residual, offPace: r.offPace, losses: r.losses})) {
      mismatches++;
      console.log(`MISMATCH ${id} lap ${r.lapNumber}`);
    }
  }
  if (result.overview !== session.consistency.overview) {
    mismatches++;
    console.log(`MISMATCH ${id} overview`);
  }

  const base = new Map(result.laps.map(r => [r.id, label(r)]));
  for (const key of keys) {
    for (const k of [0.8, 1.2]) {
      const other = run(all, {...defaultThresholds, [key]: defaultThresholds[key] * k});
      for (const r of other.result.laps) {
        if (base.get(r.id) !== label(r)) changed[key]++;
      }
    }
  }
  total += result.laps.length * 2;

  if (only) {
    for (const lap of laps) {
      const r = result.laps.find(x => x.id === lap.id);
      const why = excluded.get(lap.id).join('+');
      console.log(
        [
          String(lap.lapNumber).padStart(3),
          lap.stint,
          lap.lapTime.toFixed(3).padStart(8),
          r ? `${r.residual >= 0 ? '+' : ''}${r.residual.toFixed(2)}`.padStart(6) : '      ',
          r ? (r.offPace ? 'OFF PACE' : '').padEnd(8) : `out: ${why}`.padEnd(8),
          r?.losses
            .map(x => `C${x.corner} ${x.seconds > 0 ? '+' : ''}${x.seconds.toFixed(2)}${x.mistake ? '!' : ''}${x.tags.length ? ` [${x.tags.join(',')}]` : ''}`)
            .join('  ') ?? '',
        ].join(' '),
      );
    }
    for (const c of result.corners) {
      const sp = c.split;
      console.log(
        `  corner ${String(c.n).padStart(2)} median ${c.medianSec.toFixed(2)} s, spread ${c.spreadSec.toFixed(3)}, lost ${c.lostSec.toFixed(2)} s, named ${c.named}, mistakes ${c.mistakes}` +
          (sp ? ` | slow third vs fast: ${sp.seconds.toFixed(2)} s, brake ${sp.brakeAtM ?? '-'} m, min speed ${sp.minSpeedKmh ?? '-'} km/h, full throttle ${sp.fullThrottleAtM ?? '-'} m` : ''),
      );
    }
    console.log(result.overview);
  } else {
    const s = result.summary;
    console.log(
      `${id} ${session.startedAt.slice(0, 10)} ${session.sessionType.padEnd(8)} ${(session.track?.name ?? '').slice(0, 18).padEnd(18)} laps=${s.laps} scatter=${s.scatter} offPace=${s.offPaceLaps}/${s.offPaceSec}s mistakes=${s.mistakes}`,
    );
  }
}
console.log(`rerun from lap docs: ${mismatches} mismatches`);
if (!only) {
  for (const key of keys) {
    console.log(
      `${key} ±20%: ${changed[key]} of ${total} lap results change (${((100 * changed[key]) / Math.max(1, total)).toFixed(1)}%)`,
    );
  }
}
if (mismatches) process.exitCode = 1;
