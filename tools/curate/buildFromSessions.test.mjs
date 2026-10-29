// Run: node --test tools/curate/buildFromSessions.test.mjs
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {buildFromSessions, LoaderError} from './loader.mjs';
import {median, poolLines} from './poolReport.mjs';

const distanceM = 1000;
const gridN = Math.floor(distanceM / 5) + 1;

function lap(n, length = distanceM) {
  const fill = v => Float64Array.from({length: gridN}, () => v);
  return {
    lapTime: 60 + n,
    distanceM: length,
    comparable: true,
    timed: true,
    partial: false,
    clean: true,
    courseYellowSec: 0,
    pitlane: false,
    pitIn: false,
    pitOut: false,
    dist: [0, length],
    grid: {
      time: fill(0),
      speed: fill(150),
      throttle: fill(100),
      brake: fill(0),
      lat: fill(33.74),
      lon: fill(-84.2),
    },
  };
}

const session = (id, recordedAt) => ({
  id,
  files: [
    {
      id: `${id}-r1`,
      path: `/x/${id}.ibt`,
      info: {
        sim: 'iracing',
        track: 'Test',
        layout: '9-full',
        car: 'GT3',
        sessionType: 'practice',
        recordedAt,
      },
    },
  ],
});
const adapter = {writeArchive() {}};
const workDir = mkdtempSync(join(tmpdir(), 'pool-'));
const lapsOf = {
  late: [lap(1), lap(2), lap(3), lap(4)],
  early: [lap(5), lap(6), lap(7), lap(8)],
};
const deps = {
  load: (info, samples) => ({samples}),
  analyze: (recs, {sessionId}) => ({
    laps: sessionId === 'late' ? lapsOf.late : lapsOf.early,
  }),
};

test('four laps in each of two sessions clear the 8-lap floor that neither clears alone, folded oldest first', () => {
  const sessions = [
    session('late', '2026-02-02T10:00:00.000Z'),
    session('early', '2026-02-01T10:00:00.000Z'),
  ];
  const pooled = buildFromSessions({adapter, sessions, workDir, deps});
  assert.equal(pooled.lapsUsed, 8);
  assert.equal(pooled.sessionId, 'early,late');
  assert.deepEqual(
    pooled.perSession.map(s => [s.id, s.laps]),
    [
      ['early', 4],
      ['late', 4],
    ],
  );
  assert.equal(pooled.track.variant, '9-full');

  const alone = buildFromSessions({
    adapter,
    sessions: [sessions[0]],
    workDir,
    deps,
  });
  assert.equal(alone.lapsUsed, 4);
  assert.equal(alone.boundaries, null, 'one session is under the floor');
});

test('the TrackVersion of each session comes from the reader the caller passes', () => {
  const sessions = [
    session('late', '2026-02-02T10:00:00.000Z'),
    session('early', '2026-02-01T10:00:00.000Z'),
  ];
  const versionOf = path =>
    path.includes('early') ? '2025.01.01.01' : '2026.01.01.01';
  const pooled = buildFromSessions({
    adapter,
    sessions,
    workDir,
    versionOf,
    deps,
  });
  assert.deepEqual(
    pooled.perSession.map(s => s.versions),
    [['2025.01.01.01'], ['2026.01.01.01']],
  );
  const none = buildFromSessions({adapter, sessions, workDir, deps});
  assert.deepEqual(
    none.perSession.map(s => s.versions),
    [[], []],
  );
});

test('no sessions are refused', () => {
  assert.throws(
    () => buildFromSessions({adapter, sessions: [], workDir, deps}),
    LoaderError,
  );
});

test("the report names each session's laps and a TrackVersion whose laps are a different length from the rest", () => {
  const same = [1000, 1000.4, 999.8];
  const perSession = [
    {id: 'aaaa', laps: 3, lapLengthsM: same, versions: ['v1']},
    {id: 'bbbb', laps: 3, lapLengthsM: same, versions: ['v1']},
    {
      id: 'cccc',
      laps: 3,
      lapLengthsM: [1006, 1006.2, 1005.9],
      versions: ['v2'],
    },
  ];
  const lines = poolLines(perSession);
  assert.ok(lines.includes('  aaaa: 3 lap(s) used, TrackVersion v1'));
  assert.ok(lines.includes('  9 lap(s) from 3 session(s)'));
  assert.ok(lines.includes('  TrackVersion v2: 3 lap(s), median 1006.0 m'));
  const warned = lines.filter(l => l.startsWith('warning:'));
  assert.equal(warned.length, 1);
  assert.match(warned[0], /TrackVersion v2 laps are 6\.0 m longer/);

  const quiet = poolLines(perSession.slice(0, 2));
  assert.equal(quiet.filter(l => l.startsWith('warning:')).length, 0);
  assert.equal(
    poolLines([{id: 'x', laps: 2, lapLengthsM: same, versions: []}]).length,
    2,
    'a sim with no TrackVersion reports laps only',
  );
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test('a session that spans two TrackVersions is named', () => {
  const lines = poolLines([
    {
      id: 'dddd',
      laps: 3,
      lapLengthsM: [1000, 1000, 1000],
      versions: ['v1', 'v2'],
    },
  ]);
  assert.ok(lines.some(l => /session dddd spans TrackVersions v1, v2/.test(l)));
});
