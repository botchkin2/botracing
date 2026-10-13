// The iRacing live capture adapter (irLiveCapture.mjs).
//
// fixtures/ir-capture: two spans of the 9 Oct 2026 Sebring practice .ibt
// written in the recorder's capture shape (irCaptureFromIbt.mjs), cut to the
// columns the adapter reads: 775-800 s (the lap 3 to 4 line) and 1370-1395 s
// (the reset to the pits at 1381.5 s). meta.json is ir_session.rs's keys with
// the player's car only; it holds no names of people.
//
// The handwritten captures below are built in DuckDB: 60 Hz rows with laps and
// lap times where the test puts them.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {columns, rows, run} from './duck.mjs';
import {needsDuckdb} from './duckTestSupport.mjs';
import {
  ARCHIVE_SOURCES,
  surfaceCode,
  surfaceSql,
  writeArchiveOf,
} from './iracing.mjs';
import {describeCapture, writeCaptureArchive} from './irLiveCapture.mjs';
import {captureAdapterFor} from './syncLive.mjs';
import * as irLiveCapture from './irLiveCapture.mjs';
import * as lmuCapture from './lmuCapture.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixture = resolve(here, 'fixtures/ir-capture');
const posix = p => p.replace(/\\/g, '/');

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ir-live-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

/** Rows in either file and not the other (EXCEPT ALL both ways), and a's rows. */
function rowDiff(a, b, select = '*') {
  const [x, y] = [`'${posix(a)}'`, `'${posix(b)}'`];
  const [d] = rows(
    ':memory:',
    `SELECT (SELECT count(*) FROM (SELECT ${select} FROM ${x} EXCEPT ALL SELECT ${select} FROM ${y})) +
      (SELECT count(*) FROM (SELECT ${select} FROM ${y} EXCEPT ALL SELECT ${select} FROM ${x})) AS n,
      (SELECT count(*) FROM ${x}) AS rows`,
  );
  return {differ: Number(d.n), rows: Number(d.rows)};
}

const window = st => ({t0: st.laps[0].t0, t1: st.laps.at(-1).t1});

test(
  'the fixture: one stretch per span, laps crossing to crossing',
  needsDuckdb,
  () => {
    const {stretches} = describeCapture(fixture);
    assert.deepEqual(
      stretches.map(st => [
        st.key,
        st.ended,
        new Date(st.startMs).toISOString(),
        st.info.ticks,
      ]),
      [
        ['ir-capture#0', true, '2026-10-09T14:22:05.550Z', 1500],
        ['ir-capture#1', true, '2026-10-09T14:32:00.550Z', 1499],
      ],
    );
    const laps = stretches.map(st =>
      st.laps.map(l => [
        l.lapNumber,
        +l.t0.toFixed(3),
        +l.t1.toFixed(3),
        l.partial,
      ]),
    );
    // The reset blinks one tick (1381.5 s) and stays one stretch, as the .ibt does.
    assert.deepEqual(laps, [
      [
        [3, 775, 782.667, true],
        [4, 782.667, 799.984, true],
      ],
      [
        [7, 1370, 1381.5, true],
        [1, 1381.5, 1394.984, true],
      ],
    ]);
    const {info} = stretches[0];
    assert.equal(info.sim, 'iracing');
    assert.equal(info.layout, '95-international');
    assert.equal(info.carClass, 'GT3');
    assert.equal(info.groupId, null);
    assert.equal(info.sessionClock, '0:0');
    assert.deepEqual(info.fuelSetup, {fillLimitL: 55, tankL: 110});
    assert.deepEqual(info.raceLength, {minutes: 35});
    assert.equal(info.sectorStarts.length, 7);
    assert.equal(info.baseHz, 60);
    assert.ok(info.channels.every(c => c.hz === 60));
  },
);

test(
  'the archive equals iracing.mjs on the same rows: samples, laps, resets, sectors, states',
  needsDuckdb,
  () => {
    const {stretches} = describeCapture(fixture);
    withTmp(dir => {
      for (const [k, st] of stretches.entries()) {
        const wall0 = Date.parse(st.info.recordedAt);
        const have = new Set(
          rows(
            ':memory:',
            `SELECT column_name FROM (DESCRIBE SELECT * FROM '${posix(
              fixture,
            )}/player-*.parquet')`,
          ).map(r => r.column_name),
        );
        const raw = columns(
          ':memory:',
          `SELECT ${ARCHIVE_SOURCES.filter(s => have.has(s))
            .map(s => `${s}::DOUBLE AS ${s}`)
            .join(', ')} FROM '${posix(fixture)}/player-*.parquet'
          WHERE wall_ms >= ${wall0} AND wall_ms <= ${
            st.endMs
          } ORDER BY wall_ms, tick`,
        );
        const ibt = [
          join(dir, `i${k}.s.parquet`),
          join(dir, `i${k}.e.parquet`),
        ];
        const written = writeArchiveOf(
          raw,
          {
            ticks: st.info.ticks,
            steerMaxRad: raw.SteeringWheelAngleMax[0],
            sectorStarts: st.info.sectorStarts,
            name: `fixture-${k}`,
          },
          ...ibt,
        );
        assert.ok(Array.isArray(written.rounded), "writeArchiveOf returns {rounded}");
        const cap = [
          join(dir, `c${k}.s.parquet`),
          join(dir, `c${k}.e.parquet`),
        ];
        writeCaptureArchive(fixture, st.info, window(st), ...cap);
        // tick: the .ibt numbers its rows, the capture the sim's ticks (the
        // reset's missed tick shows), so rows are compared without it.
        const samples = rowDiff(ibt[0], cap[0], '* EXCLUDE (tick)');
        assert.deepEqual(
          samples,
          {differ: 0, rows: st.info.ticks},
          `stretch ${k} samples`,
        );
        const events = rowDiff(ibt[1], cap[1]);
        assert.equal(events.differ, 0, `stretch ${k} events`);
        assert.ok(events.rows > 0);
      }
      const names = rows(
        ':memory:',
        `SELECT DISTINCT name FROM '${posix(dir)}/c*.e.parquet' ORDER BY name`,
      ).map(r => r.name);
      // The fixture holds a crossing, a reset, sectors and every state.
      for (const name of [
        'gear',
        'in_pits',
        'lap',
        'reset',
        'sector_start',
        'surface',
        'yellow_flag',
      ])
        assert.ok(names.includes(name), name);
    });
  },
);

test(
  'per-lap parts read back through one glob equal one window',
  needsDuckdb,
  () => {
    for (const st of describeCapture(fixture).stretches) {
      withTmp(dir => {
        const one = [join(dir, 'one.s.parquet'), join(dir, 'one.e.parquet')];
        writeCaptureArchive(fixture, st.info, window(st), ...one);
        st.laps.forEach((lap, k) =>
          writeCaptureArchive(
            fixture,
            st.info,
            lap,
            join(dir, `s-${k}.parquet`),
            join(dir, `e-${k}.parquet`),
          ),
        );
        assert.equal(rowDiff(one[0], join(dir, 's-*.parquet')).differ, 0);
        assert.equal(rowDiff(one[1], join(dir, 'e-*.parquet')).differ, 0);
      });
    }
  },
);

// A 60 Hz capture from `rows` ticks: SessionTime 100 s at tick 0, laps cross
// every 50 s (3000 ticks), the sim's lap time showing 30 ticks after each
// crossing. `drop`: tick ranges left out (the player out of the car).
// `clockBack`: from this tick on the session clock reads 900 s less.
function writeCap(dir, {ticks, drop = [], endUtc = null, clockBack = null}) {
  mkdirSync(dir, {recursive: true});
  const kept =
    drop.map(([a, b]) => `NOT (i >= ${a} AND i < ${b})`).join(' AND ') ||
    'true';
  const clock =
    clockBack == null ? '0' : `CASE WHEN i >= ${clockBack} THEN 900 ELSE 0 END`;
  run(
    ':memory:',
    `COPY (SELECT i::BIGINT AS tick, (1791555041000 + round(i * 1000 / 60))::BIGINT AS wall_ms,
      (100 + i / 60 - ${clock})::DOUBLE AS SessionTime, 0::BIGINT AS SessionNum,
      (1 + i // 3000)::BIGINT AS Lap,
      (CASE WHEN i < 3030 THEN 0 WHEN (i - 30) // 3000 = 1 THEN 50.0 ELSE 49.98 END)::FLOAT AS LapLastLapTime,
      ((i % 3000) / 3000)::FLOAT AS LapDistPct, (i % 3000 * 1.0)::FLOAT AS LapDist,
      30::FLOAT AS Speed, 0.5::FLOAT AS Throttle, 0::FLOAT AS Brake, 0::FLOAT AS SteeringWheelAngle,
      7.59::FLOAT AS SteeringWheelAngleMax, 6000::FLOAT AS RPM, (50 - i * 0.001)::FLOAT AS FuelLevel,
      3::BIGINT AS Gear, false AS OnPitRoad, false AS PlayerCarInPitStall, 3::BIGINT AS PlayerTrackSurface,
      1::BIGINT AS PlayerTrackSurfaceMaterial, 0::BIGINT AS SessionFlags
      FROM range(0, ${ticks}) r(i) WHERE ${kept}) TO '${posix(
      join(dir, 'player-0000.parquet'),
    )}' (FORMAT parquet)`,
  );
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      sim: 'iracing',
      endUtc,
      trackId: 1,
      track: 'T',
      trackConfig: 'C',
      sessionNum: 0,
    }),
  );
}

const lapsOf = st =>
  st.laps.map(l => [
    l.lapNumber,
    +l.t0.toFixed(3),
    +l.t1.toFixed(3),
    l.partial,
    l.lapTimeS,
  ]);

test(
  'a lap is listed once the next lap is on disk, and stays the same as the capture grows',
  needsDuckdb,
  () => {
    withTmp(dir => {
      const at = ticks => {
        writeCap(join(dir, String(ticks)), {ticks});
        return describeCapture(join(dir, String(ticks))).stretches;
      };
      // Before the line: nothing finished, the capture is still open.
      assert.deepEqual(lapsOf(at(2990)[0]), []);
      assert.deepEqual(lapsOf(at(3010)[0]), [[1, 100, 150, true, null]]);
      // Lap 2 finished; its time is not out yet, then it is.
      assert.deepEqual(lapsOf(at(6010)[0]), [
        [1, 100, 150, true, null],
        [2, 150, 200, false, null],
      ]);
      const later = at(6100)[0];
      assert.deepEqual(lapsOf(later), [
        [1, 100, 150, true, null],
        [2, 150, 200, false, Math.fround(49.98)],
      ]);
      assert.equal(later.ended, false);
      // The archive of lap 2 written early equals the one written later.
      const early = at(6010)[0];
      const a = [join(dir, 'a.s.parquet'), join(dir, 'a.e.parquet')];
      const b = [join(dir, 'b.s.parquet'), join(dir, 'b.e.parquet')];
      writeCaptureArchive(join(dir, '6010'), early.info, early.laps[1], ...a);
      writeCaptureArchive(join(dir, '6100'), later.info, later.laps[1], ...b);
      assert.equal(rowDiff(...[a[0], b[0]]).differ, 0);
      assert.equal(rowDiff(...[a[1], b[1]]).differ, 0);
    });
  },
);

test('the trailing part is listed once the capture ends', needsDuckdb, () => {
  withTmp(dir => {
    writeCap(dir, {ticks: 4000, endUtc: '2026-10-09T14:12:00.000Z'});
    const [st] = describeCapture(dir).stretches;
    assert.equal(st.ended, true);
    assert.deepEqual(lapsOf(st).at(-1), [
      2,
      150,
      +(100 + 3999 / 60 + 0.001).toFixed(3),
      true,
      null,
    ]);
  });
});

test(
  'a gap over a second is two stretches; a shorter one is not',
  needsDuckdb,
  () => {
    withTmp(dir => {
      writeCap(join(dir, 'long'), {ticks: 4000, drop: [[3500, 3570]]});
      const two = describeCapture(join(dir, 'long')).stretches;
      assert.deepEqual(
        two.map(st => [st.key.split('#')[1], st.ended, st.info.ticks]),
        [
          ['0', true, 3500],
          ['1', false, 430],
        ],
      );
      // The first ended when the second began: its trailing part is listed.
      assert.equal(lapsOf(two[0]).at(-1)[3], true);
      writeCap(join(dir, 'short'), {ticks: 4000, drop: [[3500, 3530]]});
      assert.equal(describeCapture(join(dir, 'short')).stretches.length, 1);
    });
  },
);

test(
  'a session clock that goes back starts a stretch that reads only its own rows',
  needsDuckdb,
  () => {
    withTmp(dir => {
      // At tick 2000 the clock reads 900 s less: its times repeat nothing of
      // the first stretch's, but a window must not take rows across it.
      writeCap(dir, {
        ticks: 4000,
        clockBack: 2000,
        endUtc: '2026-10-09T14:12:00.000Z',
      });
      const {stretches} = describeCapture(dir);
      assert.equal(stretches.length, 2);
      for (const st of stretches) {
        const s = join(dir, `${st.key.split('#')[1]}.s.parquet`);
        writeCaptureArchive(
          dir,
          st.info,
          window(st),
          s,
          join(dir, 'e.parquet'),
        );
        const [n] = rows(
          ':memory:',
          `SELECT count(*) n, min(tick) t0 FROM '${posix(s)}'`,
        );
        assert.equal(Number(n.n), st.info.ticks);
        assert.equal(Number(n.t0), 0);
      }
    });
  },
);

test('the live adapter is picked by the capture meta.json sim', () => {
  withTmp(dir => {
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({sim: 'iracing'}));
    assert.equal(captureAdapterFor(dir).adapter, irLiveCapture);
    // The LMU recorder's meta.json names no sim.
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({track: 'X'}));
    assert.deepEqual(captureAdapterFor(dir), {sim: 'lmu', adapter: lmuCapture});
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({sim: 'acc'}));
    assert.throws(
      () => captureAdapterFor(dir),
      /no live adapter for sim "acc"/,
    );
  });
});

test('surfaceSql is surfaceCode', needsDuckdb, () => {
  const pairs = [];
  for (let loc = -1; loc <= 4; loc++)
    for (let mat = 0; mat <= 30; mat++) pairs.push([loc, mat]);
  const got = rows(
    ':memory:',
    `SELECT ${surfaceSql('loc', 'mat')} AS code FROM (VALUES ${pairs
      .map(([l, m]) => `(${l}, ${m})`)
      .join(', ')}) v(loc, mat)`,
  ).map(r => Number(r.code));
  assert.deepEqual(
    got,
    pairs.map(([l, m]) => surfaceCode(l, m)),
  );
});
