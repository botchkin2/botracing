// The live capture's archive against the .ibt's for one drive, analysed the
// same way: lap docs compared by lap number, field by field, plus the capture's
// per-lap parts read through one glob against its single window.
//
//   node tools/sessions/irLiveParity.mjs <file.ibt> <captureDir> [--json]
//
// With a capture built from the .ibt (irCaptureFromIbt.mjs) this checks the
// adapter's mapping; with a real tray capture of the same drive it also
// checks the recorder.
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {analyzeFromArchive} from './analyzeFromArchive.mjs';
import {rows} from './duck.mjs';
import {describe, writeArchive} from './iracing.mjs';
import {describeCapture, writeCaptureArchive} from './irLiveCapture.mjs';

function analyze(info, samplesPath, eventsPath) {
  return analyzeFromArchive({
    ownerId: 'o',
    sessionId: 's',
    recordings: [{id: 'r', info, samplesPath, eventsPath}],
    trackMap: null,
    boundaries: null,
    catalogOnly: true,
    damage: null,
    raceLength: null,
    event: {series: null, eventId: null},
    fieldFor: () => ({field: null}),
  });
}

const posix = p => p.replace(/\\/g, '/');

/** Rows in one file and not the other, both ways, and the row count. */
export function rowDiff(a, b) {
  const [x, y] = [`'${posix(a)}'`, `'${posix(b)}'`];
  const [d] = rows(
    ':memory:',
    `SELECT (SELECT count(*) FROM (SELECT * FROM ${x} EXCEPT ALL SELECT * FROM ${y})) +
      (SELECT count(*) FROM (SELECT * FROM ${y} EXCEPT ALL SELECT * FROM ${x})) AS n,
      (SELECT count(*) FROM ${x}) AS rows`,
  );
  return {differ: Number(d.n), rows: Number(d.rows)};
}

// Each top-level field of two lap docs: equal, or the largest numeric gap.
function compareField(a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return {equal: true};
  let worst = 0;
  let numeric = true;
  const walk = (x, y) => {
    if (typeof x === 'number' && typeof y === 'number') {
      worst = Math.max(worst, Math.abs(x - y));
    } else if (x && y && typeof x === 'object' && typeof y === 'object') {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
        walk(x[k], y[k]);
    } else if (x !== y) numeric = false;
  };
  walk(a, b);
  return {equal: false, worst: numeric ? worst : null};
}

export function parity(ibtPath, captureDir) {
  const work = mkdtempSync(join(tmpdir(), 'ir-parity-'));
  try {
    const ibtInfo = describe(ibtPath);
    const ibtFiles = [join(work, 'ibt.s.parquet'), join(work, 'ibt.e.parquet')];
    writeArchive(ibtPath, ibtInfo, ...ibtFiles);
    const A = analyze(ibtInfo, ...ibtFiles);

    // The stretch the .ibt is: the one starting nearest its start.
    const at = Date.parse(ibtInfo.recordedAt);
    const st = describeCapture(captureDir).stretches.sort(
      (x, y) => Math.abs(x.startMs - at) - Math.abs(y.startMs - at),
    )[0];
    const one = [join(work, 'cap.s.parquet'), join(work, 'cap.e.parquet')];
    writeCaptureArchive(
      captureDir,
      st.info,
      {t0: st.laps[0].t0, t1: st.laps.at(-1).t1},
      ...one,
    );
    const B = analyze(st.info, ...one);
    st.laps.forEach((lap, k) => {
      const n = String(k).padStart(3, '0');
      writeCaptureArchive(
        captureDir,
        st.info,
        lap,
        join(work, `part.s.${n}.parquet`),
        join(work, `part.e.${n}.parquet`),
      );
    });
    const globs = [
      join(work, 'part.s.*.parquet'),
      join(work, 'part.e.*.parquet'),
    ];
    const C = analyze(st.info, ...globs);

    const byNumber = laps => new Map(laps.map(l => [l.lapNumber, l]));
    const [a, b] = [byNumber(A.laps), byNumber(B.laps)];
    const fields = new Map();
    for (const [n, la] of a) {
      const lb = b.get(n);
      if (!lb) continue;
      for (const key of new Set([...Object.keys(la), ...Object.keys(lb)])) {
        const r = compareField(la[key], lb[key]);
        const f = fields.get(key) ?? {equal: 0, differ: 0, worst: 0, laps: []};
        if (r.equal) f.equal++;
        else {
          f.differ++;
          f.laps.push(n);
          f.worst =
            r.worst == null || f.worst == null
              ? null
              : Math.max(f.worst, r.worst);
        }
        fields.set(key, f);
      }
    }
    return {
      ibtLaps: [...a.keys()],
      captureLaps: [...b.keys()],
      captureParts: st.laps.length,
      fields: Object.fromEntries(fields),
      infoDiffers: Object.keys(ibtInfo).filter(
        k =>
          k !== 'source' &&
          JSON.stringify(ibtInfo[k]) !== JSON.stringify(st.info[k]),
      ),
      partsVsWindow: {
        samples: rowDiff(one[0], globs[0]),
        events: rowDiff(one[1], globs[1]),
        lapDocsEqual: JSON.stringify(B.laps) === JSON.stringify(C.laps),
      },
    };
  } finally {
    rmSync(work, {recursive: true, force: true});
  }
}

if (process.argv[1]?.endsWith('irLiveParity.mjs')) {
  const [ibtPath, captureDir] = process.argv.slice(2);
  const r = parity(ibtPath, captureDir);
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else {
    console.log(
      `laps .ibt ${r.ibtLaps.join(',')} | capture ${r.captureLaps.join(',')} (${
        r.captureParts
      } parts)`,
    );
    console.log(`info differs: ${r.infoDiffers.join(', ') || 'nothing'}`);
    for (const [key, f] of Object.entries(r.fields))
      console.log(
        `${key.padEnd(18)} ${
          f.differ
            ? `DIFFERS on ${f.differ} (laps ${f.laps.join(',')}), max ${
                f.worst
              }`
            : `equal on ${f.equal}`
        }`,
      );
    console.log(`parts vs window: ${JSON.stringify(r.partsVsWindow)}`);
  }
}
