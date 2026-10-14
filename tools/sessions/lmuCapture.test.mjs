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
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {analyzeFromArchive} from './analyzeFromArchive.mjs';
import {rows, run} from './duck.mjs';
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

test(
  'describeCapture lists the stretch and its laps, crossing to crossing',
  needsDuckdb,
  () => {
    const {stretches} = describeCapture(capture);
    assert.equal(stretches.length, 1);
    const [st] = stretches;
    assert.equal(st.key, 'capture#0');
    // meta.json has endUtc: the stretch has ended, so its trailing part is listed.
    assert.equal(st.ended, true);
    assert.ok(st.startMs < st.endMs);
    assert.deepEqual(
      st.laps.map(l => [
        l.lapNumber,
        l.partial,
        l.lapTimeS && +l.lapTimeS.toFixed(3),
      ]),
      [
        [2, true, null],
        [3, false, 80.769],
        [4, false, 80.491],
        [5, true, null],
      ],
    );
    for (let k = 1; k < st.laps.length; k++)
      assert.equal(st.laps[k].t0, st.laps[k - 1].t1);
    assert.equal(st.info.baseHz, 100);
    assert.ok(st.info.channels.every(c => c.hz === 100));
  },
);

test(
  'lap times, sector times, stints and pit flags equal lmu.mjs on the same laps',
  needsDuckdb,
  () => {
    const {stretches} = describeCapture(capture);
    const [st] = stretches;
    const duckInfo = JSON.parse(
      readFileSync(resolve(fixture, 'duckdb/info.json'), 'utf8'),
    );
    const duck = analyze(
      duckInfo,
      resolve(fixture, 'duckdb/samples.parquet'),
      resolve(fixture, 'duckdb/events.parquet'),
    );
    const cap = withTmp(dir => {
      const samples = join(dir, 's.parquet');
      const events = join(dir, 'e.parquet');
      writeCaptureArchive(
        capture,
        st.info,
        {t0: st.laps[0].t0, t1: st.laps.at(-1).t1},
        samples,
        events,
      );
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
    // Every lap in both, the partial ends included, with its pit-lane flags.
    const flags = l => [
      l.lapNumber,
      l.stint,
      l.partial,
      l.timed,
      l.pitlane,
      l.pitIn,
      l.pitOut,
      l.excluded,
      // A pit out-lap closes with lap time -1 in the capture and no time in
      // the game file: not invalid in either (spring #5422).
      l.invalid,
    ];
    assert.deepEqual(cap.laps.map(flags), duck.laps.map(flags));
  },
);

test(
  'per-lap parts read back through one glob equal one window',
  needsDuckdb,
  () => {
    const [st] = describeCapture(capture).stretches;
    withTmp(dir => {
      const one = [join(dir, 'one.s.parquet'), join(dir, 'one.e.parquet')];
      writeCaptureArchive(
        capture,
        st.info,
        {t0: st.laps[0].t0, t1: st.laps.at(-1).t1},
        ...one,
      );
      st.laps.forEach((lap, k) =>
        writeCaptureArchive(
          capture,
          st.info,
          lap,
          join(dir, `s-${k}.parquet`),
          join(dir, `e-${k}.parquet`),
        ),
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
  },
);

// fixtures/lmu-capture-reset: the 2 Oct 2026 23:38 Road Atlanta practice
// capture, whose session clock restarts at 23:55:32 (1201 s, then 0.1 s), cut
// to wall-clock slices around each realtime edge (same columns and stripping as
// lmu-capture). Three stretches: 23:38:35, 23:40:11 and 23:56:19, matching the
// game's three .duckdb files.
const resetCapture = resolve(here, 'fixtures/lmu-capture-reset');
const RESET_MS = 1790985332002;

test(
  'a session clock restart: stretches in wall-clock order, each on its own clock',
  needsDuckdb,
  () => {
    const {stretches} = describeCapture(resetCapture);
    assert.deepEqual(
      stretches.map(st => [
        st.key,
        new Date(st.startMs).toISOString(),
        +st.info.startT.toFixed(4),
      ]),
      [
        ['lmu-capture-reset#0', '2026-10-02T23:38:35.929Z', 335.4025],
        ['lmu-capture-reset#1', '2026-10-02T23:40:11.161Z', 430.6125],
        ['lmu-capture-reset#2', '2026-10-02T23:56:19.319Z', 81.6025],
      ],
    );
    // Each ends where its own realtime went off, on its own clock; the second
    // at its reset's lap bump (1201.22), as its .duckdb does (endT 1201.195).
    assert.deepEqual(
      stretches.map(st => +st.laps.at(-1).t1.toFixed(3)),
      [426.6, 1201.22, 216.404],
    );
    // mCloudCoverage 3 at each start; the three .duckdb files say Mostly Cloudy.
    assert.deepEqual(
      stretches.map(st => st.info.weather),
      ['Mostly Cloudy', 'Mostly Cloudy', 'Mostly Cloudy'],
    );
    assert.ok(stretches.every(st => st.ended && st.startMs < st.endMs));
    assert.equal(
      stretches[2].endMs > RESET_MS && stretches[1].endMs < RESET_MS,
      true,
    );
  },
);

test('a stretch reads only rows of its own clock epoch', needsDuckdb, () => {
  const {stretches} = describeCapture(resetCapture);
  const posix = p => p.replace(/\\/g, '/');
  withTmp(dir => {
    // The same capture split at the restart: what each epoch alone holds.
    for (const [name, where] of [
      ['before', `wall_ms < ${RESET_MS}`],
      ['after', `wall_ms >= ${RESET_MS}`],
    ]) {
      const to = join(dir, name);
      mkdirSync(to);
      copyFileSync(join(resetCapture, 'meta.json'), join(to, 'meta.json'));
      for (const kind of ['player', 'field', 'session']) {
        run(
          ':memory:',
          `COPY (SELECT * FROM '${posix(
            join(resetCapture, `${kind}-0000.parquet`),
          )}' WHERE ${where})
            TO '${posix(join(to, `${kind}-0000.parquet`))}' (FORMAT parquet)`,
        );
      }
    }
    for (const [k, alone] of [
      [0, 'before'],
      [2, 'after'],
    ]) {
      const st = stretches[k];
      const window = {t0: st.laps[0].t0, t1: st.laps.at(-1).t1};
      const whole = [
        join(dir, `w${k}.s.parquet`),
        join(dir, `w${k}.e.parquet`),
      ];
      const own = [join(dir, `o${k}.s.parquet`), join(dir, `o${k}.e.parquet`)];
      writeCaptureArchive(resetCapture, st.info, window, ...whole);
      writeCaptureArchive(join(dir, alone), st.info, window, ...own);
      for (let i = 0; i < 2; i++) {
        const [a, b] = [`'${posix(whole[i])}'`, `'${posix(own[i])}'`];
        const [diff] = rows(
          ':memory:',
          `SELECT (SELECT count(*) FROM (SELECT * FROM ${a} EXCEPT ALL SELECT * FROM ${b})) +
            (SELECT count(*) FROM (SELECT * FROM ${b} EXCEPT ALL SELECT * FROM ${a})) AS n,
            (SELECT count(*) FROM ${a}) AS rows`,
        );
        assert.equal(Number(diff.n), 0, `stretch ${k} file ${i}`);
        assert.ok(Number(diff.rows) > 0);
      }
      const [n] = rows(
        ':memory:',
        `SELECT count(*) n FROM '${posix(whole[0])}'`,
      );
      assert.equal(Number(n.n), st.info.ticks);
    }
  });
});

// fixtures/lmu-capture-bump: the 14 Oct 2026 Silverstone practice capture,
// 6236-6275 s (same columns and stripping as lmu-capture). A reset to the
// garage at 6260.2: the game bumps mLapNumber 18 -> 19 at 6260.06 with no lap
// time and refills the tank to 75 L, then realtime goes off; the next stretch
// starts in the pits at 6266.0. The game's .duckdb ends lap 18 mid-lap.
const bumpCapture = resolve(here, 'fixtures/lmu-capture-bump');

test(
  'a reset ends the cut lap as the trailing partial, not at its lap bump',
  needsDuckdb,
  () => {
    const {stretches} = describeCapture(bumpCapture);
    assert.deepEqual(
      stretches.map(st =>
        st.laps.map(l => [l.lapNumber, l.partial, +l.t1.toFixed(2)]),
      ),
      [
        [
          [17, true, 6241.14],
          [18, true, 6260.06],
        ],
        [[19, true, 6274.99]],
      ],
    );
    assert.equal(stretches[0].info.weather, 'Mostly Cloudy');
    const a = withTmp(dir => {
      const recordings = stretches.map((st, k) => {
        const samplesPath = join(dir, `${k}.s.parquet`);
        const eventsPath = join(dir, `${k}.e.parquet`);
        writeCaptureArchive(
          bumpCapture,
          st.info,
          {t0: st.laps[0].t0, t1: st.laps.at(-1).t1},
          samplesPath,
          eventsPath,
        );
        return {id: `r${k}`, info: st.info, samplesPath, eventsPath};
      });
      return analyzeFromArchive({
        ownerId: 'o',
        sessionId: 's',
        recordings,
        trackMap: null,
        boundaries: null,
        catalogOnly: true,
        damage: null,
        raceLength: null,
        event: {series: null, eventId: null},
        fieldFor: () => ({field: null}),
      });
    });
    const cut = a.laps.find(l => l.lapNumber === 18);
    const next = a.laps.find(l => l.lapNumber === 19);
    assert.equal(cut.partial, true);
    assert.equal(cut.partialWhy, 'file');
    assert.equal(cut.endedInReset, true);
    assert.equal(cut.invalid, false);
    assert.equal(next.afterReset, true);
    // The refill at the reset is not on the cut lap (it was -17.22 L).
    assert.equal(cut.fuel.usedL, 0.19);
    assert.equal(a.session.weather, 'Mostly Cloudy');
  },
);

// fixtures/lmu-capture-invalid: the same capture, 7018-7040 s. Lap 24 closes
// at 7028.63 on a real crossing with mLastLapTime -1 (the game did not count it).
test(
  'a lap closed at a real crossing with lap time -1 is invalid',
  needsDuckdb,
  () => {
    const [st] = describeCapture(
      resolve(here, 'fixtures/lmu-capture-invalid'),
    ).stretches;
    const a = withTmp(dir => {
      const s = join(dir, 's.parquet');
      const e = join(dir, 'e.parquet');
      writeCaptureArchive(
        resolve(here, 'fixtures/lmu-capture-invalid'),
        st.info,
        {t0: st.laps[0].t0, t1: st.laps.at(-1).t1},
        s,
        e,
      );
      return analyze(st.info, s, e);
    });
    assert.deepEqual(
      a.laps.map(l => [l.lapNumber, l.invalid, l.timed]),
      [
        [24, true, false],
        [25, false, false],
      ],
    );
  },
);

// fixtures/lmu-capture-pitlaps: the same capture, 3530-3735 s, the player's
// rows only. Lap 3 ends at 3536.8 into the pit lane, lap 4 leaves it at
// 3598.8 and closes at 3728.3; both close with mLastLapTime -1, which is the
// pit, not the game's track-limits call (spring #5422).
test('a pit in-lap and out-lap closing with lap time -1 are not invalid', needsDuckdb, () => {
  const dir = resolve(here, 'fixtures/lmu-capture-pitlaps');
  // The garage visit splits the capture: the in-lap ends the first stretch.
  const laps = describeCapture(dir).stretches.flatMap(st =>
    withTmp(tmp => {
      const s = join(tmp, 's.parquet');
      const e = join(tmp, 'e.parquet');
      writeCaptureArchive(dir, st.info, {t0: st.laps[0].t0, t1: st.laps.at(-1).t1}, s, e);
      return analyze(st.info, s, e).laps;
    }),
  );
  assert.deepEqual(
    laps.map(l => [l.lapNumber, l.pitIn, l.pitOut, l.invalid]),
    [
      [3, false, false, false],
      [4, false, true, false],
      [5, false, false, false],
    ],
  );
});
