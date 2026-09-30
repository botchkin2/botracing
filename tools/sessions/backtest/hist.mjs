// Light per-recording fuel extractor for the backtest (pit-wall thread 36).
//
//   node tools/sessions/backtest/hist.mjs [out.json]
//
// Reads the .duckdb channels directly (read-only): fuel and Virtual Energy at
// lap boundaries, pit windows, stops. Resumable: files already in out.json are
// skipped. About 1 s a file.
import {columns, rows} from '../duck.mjs';
import {fuelSetup} from '../fuelFacts.mjs';
import {defaultFolder} from '../lmu.mjs';
import {carLabel} from '../../../src/design/carModels.ts';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = (process.env.LMU_TELEMETRY || defaultFolder)
  .split(String.fromCharCode(92))
  .join('/')
  .replace(/\/?$/, '/');
const outPath = process.argv[2] || join(tmpdir(), 'fuel-backtest-hist.json');
const done = existsSync(outPath)
  ? JSON.parse(readFileSync(outPath, 'utf8'))
  : {};
const files = readdirSync(dir)
  .filter(
    f =>
      f.endsWith('.duckdb') &&
      /_(R|P|Q)_/.test(f) &&
      statSync(dir + f).size > 2e6,
  )
  .sort();
console.log(files.length, 'files,', Object.keys(done).length, 'done');
const median = a => {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  return v.length
    ? v.length % 2
      ? v[v.length >> 1]
      : (v[(v.length >> 1) - 1] + v[v.length >> 1]) / 2
    : null;
};
for (const name of files) {
  if (done[name]) continue;
  try {
    const f = dir + name;
    const meta = Object.fromEntries(
      rows(
        f,
        "select key, value from metadata where key in ('TrackName','TrackLayout','CarName','CarClass','SessionType','RecordingTime')",
      ).map(r => [r.key, r.value]),
    );
    const setupRow = rows(
      f,
      "select value from metadata where key='CarSetup'",
    )[0];
    const setup = fuelSetup(setupRow?.value);
    const t0 = Number(rows(f, 'select min(value) v from "GPS Time"')[0].v);
    const fuel = columns(f, 'select value from "Fuel Level"').value;
    const ve = columns(f, 'select value from "Virtual Energy"').value;
    const lap = columns(f, 'select ts, value from "Lap"');
    const pit = columns(f, 'select ts, value from "In Pits"');
    const wins = [];
    let open = null;
    for (let i = 0; i < pit.ts.length; i++) {
      if (pit.value[i] === 1 && open == null) open = pit.ts[i];
      if (pit.value[i] === 0 && open != null) {
        wins.push([open, pit.ts[i]]);
        open = null;
      }
    }
    if (open != null) wins.push([open, Infinity]);
    const idx = t =>
      Math.min(fuel.length - 1, Math.max(0, Math.round((t - t0) * 20)));
    const added = (a, b, arr) => {
      let s = 0;
      for (const [x, y] of wins) {
        const from = Math.max(idx(a) + 1, idx(x)),
          to = Math.min(idx(b), y === Infinity ? arr.length - 1 : idx(y));
        for (let i = from; i <= to; i++) {
          const d = arr[i] - arr[i - 1];
          if (d > 0) s += d;
        }
      }
      return s;
    };
    const laps = [];
    for (let i = 0; i + 1 < lap.ts.length; i++) {
      const a = lap.ts[i],
        b = lap.ts[i + 1];
      const a0 = idx(a),
        b0 = idx(b);
      const inPit = wins.some(([x, y]) => x < b && y > a);
      laps.push({
        n: lap.value[i],
        dur: +(b - a).toFixed(2),
        inPit,
        fuelL: +(fuel[a0] - fuel[b0] + added(a, b, fuel)).toFixed(3),
        vePct: +(ve[a0] - ve[b0] + added(a, b, ve)).toFixed(3),
        endL: +fuel[b0].toFixed(2),
        endVe: +ve[b0].toFixed(2),
      });
    }
    const stops = wins
      .filter(([x]) => x - t0 >= 30)
      .map(([x, y]) => {
        const a0 = idx(x);
        const lapN =
          lap.value[
            Math.max(
              0,
              lap.ts.findLastIndex(t => t < x),
            )
          ];
        return {
          enter: +x.toFixed(1),
          leave: y === Infinity ? null : +y.toFixed(1),
          inPitS: y === Infinity ? null : +(y - x).toFixed(1),
          lap: lapN,
          fuelAtEntry: +fuel[a0].toFixed(2),
          veAtEntry: +ve[a0].toFixed(2),
          addedL: +added(
            x,
            y === Infinity ? t0 + fuel.length / 20 : y,
            fuel,
          ).toFixed(2),
          addedVe: +added(
            x,
            y === Infinity ? t0 + fuel.length / 20 : y,
            ve,
          ).toFixed(2),
        };
      });
    const durMed = median(laps.filter(l => !l.inPit).map(l => l.dur));
    done[name] = {
      name,
      recordedAt: meta.RecordingTime,
      session: meta.SessionType,
      track: meta.TrackName,
      layout: meta.TrackLayout,
      car: meta.CarName,
      cls: meta.CarClass,
      model: carLabel(meta.CarName || '').model,
      startL: +fuel[0].toFixed(2),
      startVe: +ve[0].toFixed(2),
      endL: +fuel[fuel.length - 1].toFixed(2),
      endVe: +ve[ve.length - 1].toFixed(2),
      fillLimitL: setup.fillLimitL,
      tankL: setup.tankL,
      durMed,
      laps,
      stops,
    };
  } catch (e) {
    done[name] = {name, err: String(e.message).slice(0, 80)};
  }
  if (Object.keys(done).length % 25 === 0)
    writeFileSync(outPath, JSON.stringify(done));
}
writeFileSync(outPath, JSON.stringify(done));
console.log(
  'finished',
  Object.keys(done).length,
  'errors',
  Object.values(done).filter(d => d.err).length,
);
