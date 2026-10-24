// Run: node --test tools/sessions/field.test.mjs
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {run, sqlPath} from './duck.mjs';
import {MIN_COVER_SHARE as LIVE_MIN_COVER_SHARE} from './liveSession.mjs';
import {needsDuckdb} from './duckTestSupport.mjs';
import {
  alignment,
  capturesFor,
  capturesOverlapping,
  encode,
  fieldFor,
  fieldAfterSync,
  MIN_COVER_SHARE,
  captureDoubted,
  goodRows,
  listCaptures,
  modelOf,
  undelta,
} from './field.mjs';

const cap = (name, track, start, end, last = end) => ({
  name,
  meta: {track, startUtc: start, endUtc: end},
  files: [],
  lastMs: Date.parse(last),
});

test('goodRows: a Sebring pit car at -1664 m is kept; a minority of garbage is dropped; a majority refuses', () => {
  const col = (lapDist, et = lapDist.map((_, i) => i)) => ({et, lapDist, id: lapDist.map(() => 1)});
  const sebring = col([-1664, 100, 200, 300]);
  assert.equal(goodRows(sebring), sebring);
  const some = goodRows(col([1e12, 100, 200, 300, 400, 500, 600, 700]));
  assert.deepEqual(some.lapDist, [100, 200, 300, 400, 500, 600, 700]);
  assert.deepEqual(some.et, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(goodRows(col([1e12, NaN, 5e9, 100])), null);
});

test('captureDoubted: one doubtful look in 100 is used, 80 in 100 or a bad player layout is not', () => {
  assert.equal(captureDoubted({}), false);
  assert.equal(captureDoubted({layoutSuspect: 'x', layoutDoubtful: 1, layoutChecks: 100}), false);
  assert.equal(captureDoubted({layoutSuspect: 'x', layoutDoubtful: 50, layoutChecks: 100}), false);
  assert.equal(captureDoubted({layoutSuspect: 'x', layoutDoubtful: 80, layoutChecks: 100}), true);
  assert.equal(captureDoubted({playerSuspect: 'x', playerDoubtful: 1, playerChecks: 100}), false);
  assert.equal(captureDoubted({playerSuspect: 'x', playerDoubtful: 90, playerChecks: 100}), true);
});

test('goodRows: a 25.4 km track, 110 cars and a 24 h clock lose no row', () => {
  const n = 110 * 50;
  const c = {
    et: Array.from({length: n}, (_, k) => 86_000 + k * 0.2),
    lapDist: Array.from({length: n}, (_, k) => (k * 17.3) % 25_400),
    id: Array.from({length: n}, (_, k) => k % 110),
  };
  assert.equal(goodRows(c), c);
});

test('listCaptures keeps a capture doubted for most of the drive', () => {
  const root = mkdtempSync(join(tmpdir(), 'caps-'));
  for (const [name, meta] of [
    ['good', {track: 'T'}],
    ['stray', {track: 'T', layoutSuspect: 'car 0', layoutDoubtful: 1, layoutChecks: 100}],
    ['doubt', {track: 'T', layoutSuspect: 'car 0', layoutDoubtful: 80, layoutChecks: 100}],
  ]) {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, 'meta.json'), JSON.stringify(meta));
    writeFileSync(join(root, name, 'field-0000.parquet'), '');
  }
  assert.deepEqual(listCaptures(root).map(c => c.name).sort(), ['doubt', 'good', 'stray']);
  assert.deepEqual(listCaptures(root, {suspect: false}).map(c => c.name).sort(), ['good', 'stray']);
  assert.deepEqual(listCaptures(root, {suspect: true}).map(c => c.name), ['doubt']);
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

test('capturesOverlapping: half the shorter span, same type, largest wins', () => {
  const practice = cap(
    'practice',
    'Other name',
    '2026-10-21T18:00:00Z',
    '2026-10-21T18:40:00Z',
  );
  practice.meta.sim = 'lmu';
  practice.meta.session = 1;
  const quali = cap(
    'quali',
    'Other name',
    '2026-10-21T18:38:00Z',
    '2026-10-21T18:55:00Z',
  );
  quali.meta.sim = 'lmu';
  quali.meta.session = 5;
  const race = cap(
    'race',
    'Other name',
    '2026-10-21T19:00:00Z',
    '2026-10-21T19:40:00Z',
  );
  race.meta.sim = 'lmu';
  race.meta.session = 10;
  const brush = {
    tracks: ['Sebring International Raceway'],
    sim: 'lmu',
    sessionType: 'Qualify',
    startMs: Date.parse('2026-10-21T18:39:00Z'),
    endMs: Date.parse('2026-10-21T18:54:00Z'),
  };
  // Practice only touches the last minute of a 15 min quali: not a cover.
  assert.deepEqual(capturesOverlapping([practice], brush), []);
  // The quali capture covers the session; the practice one does not.
  assert.deepEqual(
    capturesOverlapping([practice, quali], brush).map(c => c.name),
    ['quali'],
  );
  // A race capture of another type does not cover quali even when the clocks overlap.
  const raceOnQuali = cap(
    'race-clock',
    'Other name',
    '2026-10-21T18:39:00Z',
    '2026-10-21T18:54:00Z',
  );
  raceOnQuali.meta.sim = 'lmu';
  raceOnQuali.meta.session = 10;
  assert.deepEqual(capturesOverlapping([raceOnQuali], brush), []);
  // Two covers: the larger overlap is the one used.
  const also = cap(
    'also',
    'Other name',
    '2026-10-21T18:45:00Z',
    '2026-10-21T18:54:00Z',
  );
  also.meta.sim = 'lmu';
  also.meta.session = 5;
  assert.deepEqual(
    capturesOverlapping([also, quali], brush).map(c => c.name),
    ['quali'],
  );
  // No session number on the capture: the type is unknown, so the cover stands.
  delete quali.meta.session;
  assert.deepEqual(
    capturesOverlapping([quali], brush).map(c => c.name),
    ['quali'],
  );
  assert.deepEqual(capturesOverlapping([race], brush), []);
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

test(
  'fieldFor: a capture on disk joins, and a shifted clock is refused',
  needsDuckdb,
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

    // The same capture against a recording whose clock is 5 s off: stored, marked.
    const off = fieldFor(root, session, [
      {t, lapDist: Float64Array.from(t, x => (x - 995) * 40)},
    ]);
    assert.ok(off.field);
    assert.equal(off.meta.mark.kind, 'misaligned');
    assert.match(off.meta.note, /200/);
  },
);

test(
  "fieldFor: each car's bestLapS is the game's lowest positive mBestLapTime, null with none",
  needsDuckdb,
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
      }),
    );
    // The game reads -1 until a car has a lap; car 1 sets 99.5 then 98.501.
    run(
      ':memory:',
      `COPY (SELECT 1000 + u * 0.2 AS et, id AS mID, id = 1 AS mIsPlayer, ` +
        `id AS mPlace, 0 AS mTotalLaps, (u * 0.2 * 40 + (id - 1) * 30) AS mLapDist, 0.5 AS mPathLateral, ` +
        `u * 1.0 AS mPos_x, -u * 1.0 AS mPos_z, 0.0 AS mOri_2_x, -1.0 AS mOri_2_z, false AS mInPits, 0 AS mFlag, ` +
        `CASE WHEN id = 2 THEN -1.0 WHEN u < 100 THEN -1.0 WHEN u < 200 THEN 99.5 ELSE 98.501 END AS mBestLapTime, ` +
        `CASE WHEN id = 1 THEN 'GT3' ELSE 'LMP2' END AS mVehicleClass ` +
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
    const out = fieldFor(root, session, [
      {t, lapDist: Float64Array.from(t, x => (x - 1000) * 40)},
    ]);
    assert.deepEqual(
      out.field.cars.map(c => c.bestLapS),
      [98.501, null],
    );
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
    keptAside: null,
  });
  assert.deepEqual(fieldAfterSync(null, null), {
    field: null,
    upload: false,
    deletePath: null,
    keptAside: null,
  });
  // A new field that covers as much: upload it, and delete the file it replaces.
  const grown = {...fresh, cars: 4, durationS: 100};
  const older = {...stored, cars: 4, durationS: 100};
  assert.deepEqual(fieldAfterSync(grown, older), {
    field: grown,
    upload: true,
    deletePath: stored.path,
    keptAside: null,
  });
  // No size on either: nothing to protect, the new file replaces.
  assert.deepEqual(fieldAfterSync(fresh, stored), {
    field: fresh,
    upload: true,
    deletePath: stored.path,
    keptAside: null,
  });
  // The same content again: same path, nothing to delete.
  assert.deepEqual(fieldAfterSync(stored, stored), {
    field: stored,
    upload: true,
    deletePath: null,
    keptAside: null,
  });
  const smaller = {...fresh, cars: 2, durationS: 10};
  const richer = {...stored, cars: 20, durationS: 100};
  const kept = fieldAfterSync(smaller, richer);
  assert.equal(kept.upload, false);
  assert.equal(kept.deletePath, null);
  assert.equal(kept.field.path, stored.path);
  assert.equal(kept.field.mark.kind, 'smaller');
  assert.equal(kept.field.aside, smaller.path);
  assert.equal(kept.keptAside, smaller);
  // A stored mark stays the one on screen. The aside path still has to be on
  // the field, or the capture never verifies (verifyStored).
  const doubted = {...richer, mark: {kind: 'doubted'}, note: 'Other cars: recording doubted'};
  const overMark = fieldAfterSync(smaller, doubted);
  assert.equal(overMark.upload, false);
  assert.equal(overMark.deletePath, null);
  assert.equal(overMark.field.path, stored.path);
  assert.equal(overMark.field.mark.kind, 'doubted');
  assert.equal(overMark.field.aside, smaller.path);
  assert.equal(overMark.keptAside, smaller);
  // A larger garbage field does not replace a clean one, and does not delete it.
  const garbage = {...fresh, cars: 40, durationS: 100, mark: {kind: 'garbage'}};
  const clean = {...stored, cars: 20, durationS: 180};
  const held = fieldAfterSync(garbage, clean);
  assert.equal(held.upload, false);
  assert.equal(held.deletePath, null);
  assert.equal(held.field.path, stored.path);
  assert.equal(held.field.mark, undefined);
  assert.equal(held.field.aside, garbage.path);
  assert.equal(held.keptAside, garbage);
  const misaligned = {...fresh, cars: 40, durationS: 100, mark: {kind: 'misaligned', alignM: 40}};
  const aligned = fieldAfterSync(misaligned, clean);
  assert.equal(aligned.deletePath, null);
  assert.equal(aligned.field.path, stored.path);
  assert.equal(aligned.field.aside, misaligned.path);
});

test('the cover share matches liveSession, which field.mjs cannot import', () => {
  assert.equal(MIN_COVER_SHARE, LIVE_MIN_COVER_SHARE);
});
