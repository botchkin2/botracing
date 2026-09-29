// Run: node --test tools/sessions/field.test.mjs
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {run, sqlPath} from './duck.mjs';
import {
  alignment,
  capturesFor,
  encode,
  fieldFor,
  fieldAfterSync,
  modelOf,
  undelta,
} from './field.mjs';

const cap = (name, track, start, end, last = end) => ({
  name,
  meta: {track, startUtc: start, endUtc: end},
  files: [],
  lastMs: Date.parse(last),
});

test('capturesFor: overlap and either track name', () => {
  const all = [
    cap(
      'a',
      'Daytona International Speedway Road Course',
      '2026-09-26T03:00:00Z',
      '2026-09-26T03:30:00Z',
    ),
    // Cut short: no endUtc, last chunk at 03:40.
    cap(
      'b',
      'Michelin Raceway Road Atlanta',
      '2026-09-26T03:00:00Z',
      null,
      '2026-09-26T03:40:00Z',
    ),
    cap(
      'c',
      'Daytona International Speedway Road Course',
      '2026-09-26T05:00:00Z',
      '2026-09-26T05:10:00Z',
    ),
  ];
  const session = {
    tracks: [
      'Daytona International Speedway',
      'Daytona International Speedway Road Course',
    ],
    startMs: Date.parse('2026-09-26T03:20:00Z'),
    endMs: Date.parse('2026-09-26T03:50:00Z'),
  };
  assert.deepEqual(
    capturesFor(all, session).map(c => c.name),
    ['a'],
  );
  // A cut-short capture joins the session it was recording...
  const atlanta = {...session, tracks: ['Michelin Raceway Road Atlanta']};
  assert.deepEqual(
    capturesFor(all, atlanta).map(c => c.name),
    ['b'],
  );
  // ...and not one on the same track weeks later (scrutineer #682).
  const later = {
    tracks: ['Michelin Raceway Road Atlanta'],
    startMs: Date.parse('2026-10-20T03:00:00Z'),
    endMs: Date.parse('2026-10-20T04:00:00Z'),
  };
  assert.deepEqual(capturesFor(all, later), []);
});

test('modelOf: the telemetry model only, never anything with a car number', () => {
  const models = {1: 'Porsche 911 GT3 R', 2: 'Iron Dames #85', 3: ' '};
  assert.equal(modelOf(models, 1), 'Porsche 911 GT3 R');
  assert.equal(modelOf(models, '1'), 'Porsche 911 GT3 R');
  assert.equal(modelOf(models, 2), null);
  assert.equal(modelOf(models, 3), null);
  assert.equal(modelOf(models, 4), null);
  assert.equal(modelOf(undefined, 1), null);
});

test('alignment: median player gap, wrap-aware at the line', () => {
  const t = Float64Array.from({length: 1000}, (_, i) => 100 + i * 0.01);
  const lapDist = Float64Array.from(t, x => ((x - 100) * 50) % 4000);
  const rec = {
    t,
    lapDist: Float64Array.from(lapDist, (d, i) => (i === 999 ? 3999 : d)),
  };
  const player = {et: [], lapDist: []};
  for (let i = 0; i < 1000; i += 5) {
    player.et.push(t[i]);
    player.lapDist.push(lapDist[i] + 2); // 2 m off everywhere
  }
  assert.equal(alignment(player, [rec]), 2);
  // Across the line: 3999 vs 1 is 2 m apart, not 3998.
  const wrapped = {
    et: [t[999], t[999], t[999], ...player.et],
    lapDist: [1, 1, 1, ...player.lapDist],
  };
  assert.equal(alignment(wrapped, [rec]), 2);
  // Never overlapping: no answer.
  assert.equal(alignment({et: [5, 6], lapDist: [1, 2]}, [rec]), null);
});

test('encode: per-car deltas round-trip, gaps are null, no names', () => {
  const r = {
    et: [10, 10, 10.2, 10.4, 10.4],
    id: [7, 3, 7, 7, 3],
    lapDist: [100.04, 50, 110.5, 121, 60],
    pathLateral: [-1.2, 0.5, -1.1, -1, 0.4],
    x: [1, 2, 3, 4, 5],
    z: [-1, -2, -3, -4, -5],
    // Heading 0 (along +z), +π/2 (along +x), just short of π; car 3 ends just past -π.
    oriX: [0, 0, 1, 0.001, -0.001],
    oriZ: [-1, -1, 0, 1, 1],
    place: [1, 2, 1, 1, 2],
    laps: [3, 3, 3, 3, 3],
    inPits: [0, 0, 0, 0, 1],
    flag: [0, 6, 0, 0, 0],
  };
  const cars = [
    {id: 7, class: 'GT3', vehicle: 'Porsche', player: true},
    {id: 3, class: 'LMP2', vehicle: 'Oreca', player: false},
  ];
  const out = encode(r, cars);
  assert.deepEqual(out.tDs, [0, 2, 4]);
  assert.deepEqual(out.cars, [
    {i: 0, class: 'GT3', vehicle: 'Porsche', player: true},
    {i: 1, class: 'LMP2', vehicle: 'Oreca', player: false},
  ]);
  assert.deepEqual(undelta(out.lapDistDm[0]), [1000, 1105, 1210]);
  assert.deepEqual(undelta(out.lapDistDm[1]), [500, null, 600]);
  assert.equal(out.v, 2);
  assert.deepEqual(undelta(out.yawCrad[0]), [0, 157, 314]);
  // Car 3 ends just past the wrap, so it reads as about -π.
  assert.deepEqual(undelta(out.yawCrad[1]), [0, null, -314]);
  assert.deepEqual(out.inPits[1], [0, null, 1]);
  assert.equal(JSON.stringify(out).includes('name'), false);
});

function duckdbWorks() {
  try {
    run(':memory:', 'SELECT 1');
    return true;
  } catch {
    return false;
  }
}

test(
  'fieldFor: a capture on disk joins, and a shifted clock is refused',
  {skip: !duckdbWorks()},
  () => {
    const root = mkdtempSync(join(tmpdir(), 'field-'));
    const dir = join(root, '2026-09-26T00-38-00Z_road-atlanta_10');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({
        track: 'Michelin Raceway Road Atlanta',
        startUtc: '2026-09-26T00:38:00Z',
        endUtc: '2026-09-26T01:40:00Z',
        vehicleModels: {1: 'Porsche 911 GT3 R'},
      }),
    );
    // Two cars for 60 s at 5 Hz; the player (id 1) runs 40 m/s from lap distance 0.
    run(
      ':memory:',
      `COPY (SELECT 1000 + u * 0.2 AS et, u AS "update", id AS mID, id = 1 AS mIsPlayer, ` +
        `id AS mPlace, 0 AS mTotalLaps, (u * 0.2 * 40 + (id - 1) * 30) AS mLapDist, 0.5 AS mPathLateral, ` +
        `u * 1.0 AS mPos_x, -u * 1.0 AS mPos_z, 0.0 AS mOri_2_x, -1.0 AS mOri_2_z, false AS mInPits, 0 AS mFlag, ` +
        `CASE WHEN id = 1 THEN '911GT3R Custom Team 2025 #397' ELSE 'Iron Dames #85' END AS mVehicleName, ` +
        `CASE WHEN id = 1 THEN 'GT3' ELSE 'LMP2' END AS mVehicleClass, 'Somebody' AS mDriverName ` +
        `FROM range(300) r(u), (VALUES (1), (2)) c(id)) TO ${sqlPath(
          join(dir, 'field-0000.parquet'),
        )} (FORMAT parquet)`,
    );
    const t = Float64Array.from({length: 6000}, (_, i) => 1000 + i * 0.01);
    const session = {
      tracks: ['Michelin Raceway Road Atlanta'],
      startMs: Date.parse('2026-09-26T00:40:00Z'),
      endMs: Date.parse('2026-09-26T01:30:00Z'),
    };
    const good = fieldFor(root, session, [
      {t, lapDist: Float64Array.from(t, x => (x - 1000) * 40)},
    ]);
    assert.equal(good.meta.cars, 2);
    assert.equal(good.meta.alignM, 0);
    assert.deepEqual(good.meta.captures, [
      '2026-09-26T00-38-00Z_road-atlanta_10',
    ]);
    assert.equal(good.field.cars[0].player, true);
    assert.equal(JSON.stringify(good.field).includes('Somebody'), false);
    // Model from the recorder's map; the car without one gets null, never its entry name.
    assert.deepEqual(
      good.field.cars.map(c => c.vehicle),
      ['Porsche 911 GT3 R', null],
    );
    assert.equal(/#\d/.test(JSON.stringify(good.field)), false);

    // The same capture against a recording whose clock is 5 s off: refused.
    const off = fieldFor(root, session, [
      {t, lapDist: Float64Array.from(t, x => (x - 995) * 40)},
    ]);
    assert.equal(off.field, null);
    assert.match(off.reason, /clocks disagree/);
  },
);

test('fieldAfterSync: no new field keeps the stored one; a new one replaces it', () => {
  const stored = {path: 'field/o/s/aaaaaaaaaaaa.json.gz', hash: 'aaaaaaaaaaaa'};
  const fresh = {path: 'field/o/s/bbbbbbbbbbbb.json.gz', hash: 'bbbbbbbbbbbb'};
  // Captures pruned, folder not visible, or clock check failed: nothing lost.
  assert.deepEqual(fieldAfterSync(null, stored), {
    field: stored,
    upload: false,
    deletePath: null,
  });
  assert.deepEqual(fieldAfterSync(null, null), {
    field: null,
    upload: false,
    deletePath: null,
  });
  // A new field: upload it, and delete the file it replaces.
  assert.deepEqual(fieldAfterSync(fresh, stored), {
    field: fresh,
    upload: true,
    deletePath: stored.path,
  });
  // The same content again: same path, nothing to delete.
  assert.deepEqual(fieldAfterSync(stored, stored), {
    field: stored,
    upload: true,
    deletePath: null,
  });
});
