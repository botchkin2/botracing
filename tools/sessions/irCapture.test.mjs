import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {run} from './duck.mjs';
import {listCaptures} from './field.mjs';
import {
  LAP_TOLERANCE_S,
  compareLaps,
  crossingsOf,
  describeCheck,
  iracingCapturesFor,
  listIracingCaptures,
  liveLapCheck,
  readLapColumns,
} from './irCapture.mjs';

const posix = p => p.replace(/\\/g, '/');

// A 60 Hz player stream: laps cross at 100 s, 200 s and 300 s (the sim's own
// times for the first two: `times`), the held value showing for 2 ticks first.
function writePlayer(dir, times, {sim = 'iracing', track = 'Sebring', start = '2026-10-09T14:00:00.000Z', end = '2026-10-09T14:06:00.000Z'} = {}) {
  mkdirSync(dir, {recursive: true});
  writeFileSync(
    resolve(dir, 'meta.json'),
    JSON.stringify({sim, track, startUtc: start, endUtc: end}),
  );
  const [a, b] = times;
  const sql =
    `COPY (SELECT i AS tick, i / 60.0 AS SessionTime, ` +
    `(CASE WHEN i < 6000 THEN 1 WHEN i < 12000 THEN 2 ELSE 3 END)::INTEGER AS Lap, ` +
    `(CASE WHEN i < 6000 + 2 THEN 0.0 WHEN i < 12000 + 2 THEN ${a} ELSE ${b} END)::FLOAT AS LapLastLapTime ` +
    `FROM range(0, 18000) t(i)) TO '${posix(resolve(dir, 'player-0000.parquet'))}' (FORMAT parquet)`;
  run(':memory:', sql, {readonly: false});
}

const tmp = () => mkdtempSync(resolve(tmpdir(), 'ir-capture-'));

test('only iRacing captures are listed, and only by their own reader', () => {
  const root = tmp();
  writePlayer(resolve(root, 'ir'), [100, 100]);
  mkdirSync(resolve(root, 'lmu'));
  writeFileSync(resolve(root, 'lmu', 'meta.json'), JSON.stringify({track: 'Sebring', startUtc: 'x'}));
  assert.deepEqual(listIracingCaptures(root).map(c => c.name), ['ir']);
  // The LMU reader (field, damage, race length) skips the iRacing capture:
  // its columns are not LMU's, and reading them was a Binder Error.
  assert.deepEqual(listCaptures(root).map(c => c.name), []);
  rmSync(root, {recursive: true, force: true});
});

test('a capture belongs to a session of its track and time, not another', () => {
  const root = tmp();
  writePlayer(resolve(root, 'ir'), [100, 100]);
  const all = listIracingCaptures(root);
  const span = {track: 'Sebring', startMs: Date.parse('2026-10-09T14:01:00Z'), endMs: Date.parse('2026-10-09T14:04:00Z')};
  assert.equal(iracingCapturesFor(all, span).length, 1);
  assert.equal(iracingCapturesFor(all, {...span, track: 'Monza'}).length, 0);
  assert.equal(iracingCapturesFor(all, {...span, startMs: Date.parse('2026-10-09T15:00:00Z'), endMs: Date.parse('2026-10-09T15:30:00Z')}).length, 0);
  rmSync(root, {recursive: true, force: true});
});

test('the live lap times are read like the .ibt ones, and agree when they are the same', () => {
  const root = tmp();
  writePlayer(resolve(root, 'ir'), [100.0, 100.003]);
  const [cap] = listIracingCaptures(root);
  const cols = readLapColumns(cap.player);
  const live = crossingsOf(cols);
  assert.equal(live.length, 2);
  assert.ok(Math.abs(live[0].time - 100) < 1e-4);
  const same = compareLaps(live, live.map(c => ({...c})));
  assert.equal(same.compared, 2);
  assert.equal(same.bad.length, 0);
  assert.match(describeCheck(same), /2 laps match the \.ibt/);
  rmSync(root, {recursive: true, force: true});
});

test('a lap more than 5 ms apart is named, one inside the tolerance is not', () => {
  const live = [
    {t: 100, lap: 2, time: 100.0},
    {t: 200, lap: 3, time: 100.0},
  ];
  const ibt = [
    {t: 100.0166, lap: 2, time: 100.004},
    {t: 200.0166, lap: 3, time: 100.012},
  ];
  const r = compareLaps(live, ibt);
  assert.equal(r.compared, 2);
  assert.deepEqual(r.bad.map(b => b.lap), [3]);
  assert.ok(Math.abs(r.bad[0].diffS - 0.012) < 1e-9);
  assert.ok(LAP_TOLERANCE_S === 0.005);
  assert.match(describeCheck(r), /1 of 2 laps differ by more than 5 ms: L3 12\.0 ms/);
  // A lap one side has no time for is left out, not counted as a match.
  assert.equal(compareLaps([{t: 1, lap: 1, time: 0}], [{t: 1, lap: 1, time: 90}]).compared, 0);
  assert.equal(describeCheck({compared: 0, worstS: 0, bad: []}), 'live check: no lap in both');
});

test('liveLapCheck finds the capture of the drive and says nothing without one', () => {
  const root = tmp();
  const span = {tracks: ['Sebring', '95-international'], startMs: Date.parse('2026-10-09T14:01:00Z'), endMs: Date.parse('2026-10-09T14:04:00Z')};
  assert.equal(liveLapCheck(root, span, []), null);
  writePlayer(resolve(root, 'ir'), [100.0, 100.003]);
  const [cap] = listIracingCaptures(root);
  const ibt = crossingsOf(readLapColumns(cap.player));
  const r = liveLapCheck(root, span, ibt);
  assert.equal(r.compared, 2);
  assert.equal(r.bad.length, 0);
  rmSync(root, {recursive: true, force: true});
});
