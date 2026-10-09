import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {run} from './duck.mjs';
import {needsDuckdb} from './duckTestSupport.mjs';
import {undelta} from './field.mjs';
import {irFieldFor} from './irField.mjs';

const posix = p => p.replace(/\\/g, '/');
const LENGTH = 1000;

// A capture of 10 s at 5 Hz: car 0 (the player, GT3) laps at 100 m/s, car 3
// (LMP2) sits 200 m ahead, car 5 is not in the world (-1). The session clock
// of update u is 100 + u / 5.
function writeCapture(root, {offsetM = 0} = {}) {
  const dir = resolve(root, 'cap');
  mkdirSync(dir, {recursive: true});
  writeFileSync(
    resolve(dir, 'meta.json'),
    JSON.stringify({
      sim: 'iracing',
      track: 'Sebring',
      startUtc: '2026-10-09T14:00:00.000Z',
      endUtc: '2026-10-09T14:10:00.000Z',
      trackLengthM: LENGTH,
      playerCarIdx: 0,
      cars: [
        {
          carIdx: 0,
          className: 'GT3',
          carName: 'Ford Mustang GT3',
          isPlayer: true,
        },
        {carIdx: 3, className: 'LMP2', carName: 'Oreca 07', isPlayer: false},
      ],
    }),
  );
  const out = f => posix(resolve(dir, f));
  run(
    ':memory:',
    `COPY (SELECT u AS "update", 100 + u / 5.0 AS SessionTime FROM range(0, 50) t(u)) ` +
      `TO '${out('session-0000.parquet')}' (FORMAT parquet)`,
    {readonly: false},
  );
  run(
    ':memory:',
    `COPY (SELECT u AS "update", c AS CarIdx, ` +
      `(CASE c WHEN 0 THEN ((u * 20 + ${offsetM}) % ${LENGTH}) / ${LENGTH}.0 WHEN 3 THEN ((u * 20 + 200) % ${LENGTH}) / ${LENGTH}.0 ELSE -1.0 END)::FLOAT AS CarIdxLapDistPct, ` +
      `(c + 1)::INTEGER AS CarIdxPosition, 4::INTEGER AS CarIdxLapCompleted, ` +
      `(c = 3)::BOOLEAN AS CarIdxOnPitRoad ` +
      `FROM range(0, 50) a(u), (VALUES (0), (3), (5)) b(c)) ` +
      `TO '${out('field-0000.parquet')}' (FORMAT parquet)`,
    {readonly: false},
  );
  // The player stream is what makes a folder a capture; its rows are not used here.
  run(
    ':memory:',
    `COPY (SELECT 0 AS tick) TO '${out(
      'player-0000.parquet',
    )}' (FORMAT parquet)`,
    {readonly: false},
  );
  return dir;
}

// The .ibt's player: same clock, same lap distance.
const ibtRecs = () => {
  const t = Float64Array.from({length: 600}, (_, i) => 100 + i / 60);
  const lapDist = Float64Array.from(t, x => ((x - 100) * 5 * 20) % LENGTH);
  return [{t, lapDist}];
};
const span = {
  tracks: ['Sebring', '95-international'],
  startMs: Date.parse('2026-10-09T14:01:00Z'),
  endMs: Date.parse('2026-10-09T14:05:00Z'),
};

test(
  'the field of an iRacing capture: cars with class and model, lap distance in metres, no positions',
  needsDuckdb,
  () => {
    const root = mkdtempSync(resolve(tmpdir(), 'ir-field-'));
    writeCapture(root);
    const r = irFieldFor(root, span, ibtRecs());
    assert.ok(r.field, r.reason);
    assert.equal(r.meta.cars, 2, 'the car outside the world has no rows');
    assert.equal(r.field.hz, 5);
    assert.deepEqual(
      r.field.cars.map(c => [c.class, c.vehicle, c.player]),
      [
        ['GT3', 'Ford Mustang GT3', true],
        ['LMP2', 'Oreca 07', false],
      ],
    );
    // Lap distance, decimetres: the player at 100 m/s... 20 m per update.
    const player = undelta(r.field.lapDistDm[0]);
    assert.equal(player[0], 0);
    assert.equal(player[1], 200);
    assert.equal(undelta(r.field.lapDistDm[1])[0], 2000);
    // Positions and heading are absent, not zero.
    for (const key of ['xDm', 'zDm', 'yawCrad', 'pathLateralDm'])
      assert.ok(
        r.field[key].every(car => car.every(v => v === null)),
        key,
      );
    assert.deepEqual(r.field.place[0].slice(0, 2), [1, 1]);
    assert.deepEqual(r.field.inPits[1].slice(0, 2), [1, 1]);
    assert.equal(r.field.laps[0][0], 4);
    rmSync(root, {recursive: true, force: true});
  },
);

test(
  'a capture whose player is 100 m off the .ibt is no field, not a shifted one',
  needsDuckdb,
  () => {
    const root = mkdtempSync(resolve(tmpdir(), 'ir-field-'));
    writeCapture(root, {offsetM: 100});
    const r = irFieldFor(root, span, ibtRecs());
    assert.equal(r.field, null);
    assert.match(r.reason, /clocks disagree/);
    rmSync(root, {recursive: true, force: true});
  },
);

test(
  'no capture of the track in the time: no field, and it says why',
  needsDuckdb,
  () => {
    const root = mkdtempSync(resolve(tmpdir(), 'ir-field-'));
    writeCapture(root);
    assert.deepEqual(
      irFieldFor(root, {...span, tracks: ['Monza']}, ibtRecs()),
      {field: null, reason: 'no capture'},
    );
    assert.equal(
      irFieldFor(resolve(root, 'none'), span, ibtRecs()).reason,
      'no capture',
    );
    rmSync(root, {recursive: true, force: true});
  },
);
