// The capture adapter against lmu.mjs on the same two laps.
//
// fixtures/lmu-capture: laps 3 and 4 (415.0 s to 586.0 s on the session clock)
// of the 3 Oct 2026 Road Atlanta race, from the local lap-fixtures copies.
// capture/: the tray's chunks cut to that span and to the columns
// lmuCapture.mjs reads (doubles other than the clock stored as FLOAT to stay
// under 2 MB; the player's own scoring rows only; no driver or entry names).
// duckdb/: lmu.mjs writeArchive() of the game's .duckdb for the same race, cut
// to the same span with the analysis channels only; its events open with each
// state's last value, as a file's first events do.
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {analyzeFromArchive} from './analyzeFromArchive.mjs';
import {rows} from './duck.mjs';
import {needsDuckdb} from './duckTestSupport.mjs';
import {describeCapture, writeCaptureArchive} from './lmuCapture.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixture = resolve(here, 'fixtures/lmu-capture');
const capture = resolve(fixture, 'capture');

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

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'lmu-capture-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

test('describeCapture lists the stretch and its laps, crossing to crossing', needsDuckdb, () => {
  const {stretches} = describeCapture(capture);
  assert.equal(stretches.length, 1);
  const [st] = stretches;
  assert.equal(st.key, 'capture#0');
  // meta.json has endUtc: the stretch has ended, so its trailing part is listed.
  assert.equal(st.ended, true);
  assert.ok(st.startMs < st.endMs);
  assert.deepEqual(
    st.laps.map(l => [l.lapNumber, l.partial, l.lapTimeS && +l.lapTimeS.toFixed(3)]),
    [
      [2, true, null],
      [3, false, 80.769],
      [4, false, 80.491],
      [5, true, null],
    ],
  );
  for (let k = 1; k < st.laps.length; k++) assert.equal(st.laps[k].t0, st.laps[k - 1].t1);
  assert.equal(st.info.baseHz, 100);
  assert.ok(st.info.channels.every(c => c.hz === 100));
});

test('lap times, sector times and stints equal lmu.mjs on the same laps', needsDuckdb, () => {
  const {stretches} = describeCapture(capture);
  const [st] = stretches;
  const duckInfo = JSON.parse(readFileSync(resolve(fixture, 'duckdb/info.json'), 'utf8'));
  const duck = analyze(
    duckInfo,
    resolve(fixture, 'duckdb/samples.parquet'),
    resolve(fixture, 'duckdb/events.parquet'),
  );
  const cap = withTmp(dir => {
    const samples = join(dir, 's.parquet');
    const events = join(dir, 'e.parquet');
    writeCaptureArchive(capture, st.info, {t0: st.laps[0].t0, t1: st.laps.at(-1).t1}, samples, events);
    return analyze(st.info, samples, events);
  });
  const timed = laps => laps.filter(l => !l.partial && l.timed);
  const key = l => ({
    lapNumber: l.lapNumber,
    lapTime: l.lapTime,
    sectors: l.sectors,
    stint: l.stint,
    stintLap: l.stintLap,
  });
  assert.equal(timed(duck.laps).length, 2);
  assert.deepEqual(timed(cap.laps).map(key), timed(duck.laps).map(key));
  // Every lap in both, the partial ends included.
  assert.deepEqual(
    cap.laps.map(l => [l.lapNumber, l.stint]),
    duck.laps.map(l => [l.lapNumber, l.stint]),
  );
});

test('per-lap parts read back through one glob equal one window', needsDuckdb, () => {
  const [st] = describeCapture(capture).stretches;
  withTmp(dir => {
    const one = [join(dir, 'one.s.parquet'), join(dir, 'one.e.parquet')];
    writeCaptureArchive(capture, st.info, {t0: st.laps[0].t0, t1: st.laps.at(-1).t1}, ...one);
    st.laps.forEach((lap, k) =>
      writeCaptureArchive(capture, st.info, lap, join(dir, `s-${k}.parquet`), join(dir, `e-${k}.parquet`)),
    );
    const posix = p => p.replace(/\\/g, '/');
    for (const [single, glob] of [
      [one[0], join(dir, 's-*.parquet')],
      [one[1], join(dir, 'e-*.parquet')],
    ]) {
      const [a, b] = [`'${posix(single)}'`, `'${posix(glob)}'`];
      const [diff] = rows(
        ':memory:',
        `SELECT (SELECT count(*) FROM (SELECT * FROM ${a} EXCEPT ALL SELECT * FROM ${b})) +
          (SELECT count(*) FROM (SELECT * FROM ${b} EXCEPT ALL SELECT * FROM ${a})) AS n,
          (SELECT count(*) FROM ${a}) AS rows`,
      );
      assert.equal(Number(diff.n), 0);
      assert.ok(Number(diff.rows) > 0);
    }
  });
});
