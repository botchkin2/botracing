import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';

import {
  DELETING_RESOLUTIONS,
  defaultResultsFolder,
  driversOf,
  lapOfStrike,
  lapSpansOf,
  parseResults,
  resultsFor,
  strikesOf,
} from './lmuResults.mjs';
import {readResultsInput, resultsInput} from './resultsInput.mjs';

const row = (driver, lap, res, et, pts = 0) =>
  `<TrackLimits Driver="${driver}" ID="1" Lap="${lap}" WarningPoints="${pts}" CurrentPoints="${pts}" Resolution="${res}" et="${et}">x</TrackLimits>`;
// A driver block: laps as [num, start et, time or null for the deleted `--.----`].
const driver = (name, laps) =>
  `<Driver><Name>${name}</Name>\n${laps
    .map(
      ([n, et, t]) =>
        `<Lap num="${n}" p="2" et="${et}" s1="25.1" topspeed="290">${
          t ?? '--.----'
        }</Lap>`,
    )
    .join('\n')}\n</Driver>`;
const file = (rows, drivers = '', over = '') => `<rFactorXML><RaceResults>
<DateTime>1792025756</DateTime><TrackCourse>Silverstone Grand Prix Circuit - ELMS</TrackCourse>${over}
<Stream>${rows.join('\n')}</Stream>
${drivers}</RaceResults></rFactorXML>`;

// His Silverstone race 2026-10-14 (results file 2026_10_14_22_14_53-60R1.xml),
// scrubbed to a name: the start of each of his laps 10 to 22 and the four
// Warnings the game gave him, which sit in the four laps it deleted.
const REAL_LAPS = [
  [10, 1257.1201, 121.4208],
  [11, 1378.54, null],
  [12, 1499.8999, 125.7372],
  [13, 1625.6201, null],
  [14, 1747.5, null],
  [15, 1870.74, 127.0432],
  [16, 1997.78, 192.8878],
  [17, 2190.6599, 122.1628],
  [18, 2312.8401, 121.3938],
  [19, 2434.22, 122.6792],
  [20, 2556.8999, 122.1462],
  [21, 2679.04, null],
  [22, 2800.76, 121.3989],
];
const REAL_ROWS = [
  row('Me', 10, 4, 1390.7, 0.25),
  row('Me', 12, 4, 1675.1, 0.5),
  row('Me', 13, 4, 1759.8, 0.5),
  row('Me', 20, 4, 2691.4, 0.25),
  row('Me', 14, 7, 1900),
];

test('a row identical to the one before it, et included, is one strike; two strikes at different et are two', () => {
  const xml = file([
    row('A', 0, 7, 166.7),
    row('A', 0, 7, 166.7),
    row('Me', 23, 4, 6795.5, 0.25),
    row('Me', 23, 4, 6813.4, 0.25),
  ]);
  const r = parseResults(xml);
  assert.deepEqual(
    r.rows.map(x => [x.driver, x.et]),
    [
      ['A', 166.7],
      ['Me', 6795.5],
      ['Me', 6813.4],
    ],
  );
  assert.equal(r.startedAtMs, 1792025756000);
});

test('the Resolution code is the ruling, and 4, 5 and 6 are the ones that delete the lap', () => {
  const r = parseResults(
    file([
      row('Me', 1, 4, 1),
      row('Me', 2, 5, 2),
      row('Me', 3, 6, 3),
      row('Me', 4, 7, 4),
      row('Me', 5, 9, 5),
    ]),
  );
  assert.deepEqual(
    r.rows.map(x => x.outcome),
    ['warning', 'invalidCut', 'invalidOff', 'none'],
  );
  assert.deepEqual([...DELETING_RESOLUTIONS].sort(), [4, 5, 6]);
});

test("a lap is its start et to the next lap's: et[n+1] - et[n] is lap n's time, so a strike goes in the lap it began, not the one before", () => {
  // Lap 1 starts at 7.1 s and lasts 136.3 s: lap 2 starts at 143.4.
  const xml = file(
    [],
    driver('Me', [
      [1, 7.1, 136.3],
      [2, 143.4, 112.2],
      [3, 255.6, 110.0],
    ]),
  );
  const spans = lapSpansOf(xml, 'Me');
  assert.deepEqual(spans, [
    {num: 1, start: 7.1, end: 143.4},
    {num: 2, start: 143.4, end: 255.6},
    {num: 3, start: 255.6, end: null},
  ]);
  assert.equal(lapOfStrike(spans, 143.4).num, 2);
  assert.equal(lapOfStrike(spans, 143.3).num, 1);
  assert.equal(lapOfStrike(spans, 255.5).num, 2);
  // The last lap has no end: its strikes are unplaced, and so is one before his first lap.
  assert.equal(lapOfStrike(spans, 300), null);
  assert.equal(lapOfStrike(spans, 5), null);
});

test('his real race: the four Warnings land in the four laps the game deleted, by his lap spans', () => {
  const r = strikesOf(file(REAL_ROWS, driver('Me', REAL_LAPS)), 'Me');
  // Each Warning's et lies in the lap the game deleted: XML laps 11, 13, 14 and 21.
  const spans = lapSpansOf(file(REAL_ROWS, driver('Me', REAL_LAPS)), 'Me');
  assert.deepEqual(
    r.strikes
      .filter(s => s.outcome === 'warning')
      .map(s => [s.et, lapOfStrike(spans, s.et).num, s.points]),
    [
      [1390.7, 11, 0.25],
      [1675.1, 13, 0.5],
      [1759.8, 14, 0.5],
      [2691.4, 21, 0.25],
    ],
  );
  // The file rules laps 10 (start 1257.12) to 22 (the last, its start 2800.76).
  assert.equal(r.coveredFrom, 1257.1201);
  assert.equal(r.coveredTo, 2800.76);
  assert.equal(
    r.strikes.find(s => s.outcome === 'none').ruling,
    'No Further Action',
  );
  assert.equal(r.strikes[0].ruling, 'Warning');
  assert.equal(r.unplaced, 0);
});

test('a strike outside every lap of his is counted, not placed and not guessed onto a lap (Road Atlanta 10-02: rows after he stopped)', () => {
  const xml = file(
    [
      row('Me', 2, 7, 100),
      row('Me', 2, 7, 2234.6),
      row('Me', 7, 7, 2545.6),
      row('Me', 3, 4, 250),
    ],
    driver('Me', [
      [1, 7.1, 130],
      [2, 137.1, 120],
      [3, 257.1, null],
    ]),
  );
  const r = strikesOf(xml, 'Me');
  // 100 is in lap 1 and 250 in lap 2 (137.1-257.1); the two after he stopped are
  // counted, not placed. The file covers his laps from 7.1 to 257.1.
  assert.deepEqual(
    r.strikes.map(s => s.et),
    [100, 250],
  );
  assert.equal(r.unplaced, 2);
  assert.deepEqual([r.coveredFrom, r.coveredTo], [7.1, 257.1]);
});

test('resultsFor picks the file by its session letter and by being the first written after the recording ends, not by the header (a weekend shares one DateTime)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'results-'));
  try {
    // Tonight's Silverstone weekend (2026-10-15 UTC): three files, one event
    // start in all three headers, written when each session ended. The race file
    // also "reaches back" over the qualifying window by its header and lastEt.
    const laps = [
      [1, 7.1, 130],
      [2, 137.1, 120],
      [3, 257.1, 120],
    ];
    const weekend = {
      '2026_10_14_20_49_36-66P1.xml': [
        '2026-10-15T00:58:30Z',
        [row('Me', 1, 5, 150, 0.25)],
      ],
      '2026_10_14_21_09_46-39Q1.xml': [
        '2026-10-15T01:09:46Z',
        [row('Me', 1, 7, 150)],
      ],
      '2026_10_14_22_14_53-60R1.xml': [
        '2026-10-15T02:14:53Z',
        [row('Me', 1, 4, 150, 0.5), row('Me', 2, 7, 9000)],
      ],
    };
    for (const [name, [written, rows]] of Object.entries(weekend)) {
      const path = join(dir, name);
      writeFileSync(path, file(rows, driver('Me', laps)));
      utimesSync(path, new Date(written), new Date(written));
    }
    const window = (startedAt, endedAt) => ({startedAt, endedAt});
    const ask = (sessionType, span) =>
      resultsFor({span, driverName: 'Me', sessionType, folder: dir});
    // Qualifying: its own window and the race file overlaps it by header; Q1 is the Q file written at its end.
    const q = ask(
      'Qualify',
      window('2026-10-15T00:58:39Z', '2026-10-15T01:09:53Z'),
    );
    assert.deepEqual(
      q.strikes.map(k => k.outcome),
      ['none'],
    );
    // The race: R1, with the row after his laps counted, not placed.
    const r = ask(
      'Race',
      window('2026-10-15T01:09:59Z', '2026-10-15T02:14:50Z'),
    );
    assert.deepEqual(
      r.strikes.map(k => [k.outcome, k.points]),
      [['warning', 0.5]],
    );
    assert.equal(r.unplaced, 1);
    // Practice: P1.
    const p = ask(
      'Practice',
      window('2026-10-15T00:12:23Z', '2026-10-15T00:58:20Z'),
    );
    assert.deepEqual(
      p.strikes.map(k => k.outcome),
      ['invalidCut'],
    );
    // A recording that ended before a file was written there cannot be its session; another letter finds none.
    assert.deepEqual(
      ask('Race', window('2026-10-15T00:12:23Z', '2026-10-15T00:58:20Z')),
      {
        absent: 'no results file covers the session',
      },
    );
    assert.deepEqual(
      ask('', window('2026-10-15T00:12:23Z', '2026-10-15T00:58:20Z')),
      {absent: 'no session type'},
    );
    assert.deepEqual(
      resultsFor({
        span: window('2026-10-15T00:12:23Z', '2026-10-15T00:58:20Z'),
        driverName: '',
        sessionType: 'P',
        folder: dir,
      }),
      {
        absent: 'no driver name',
      },
    );
    assert.deepEqual(
      resultsFor({
        span: window('2026-10-15T00:12:23Z', '2026-10-15T00:58:20Z'),
        driverName: 'Me',
        sessionType: 'P',
        folder: join(dir, 'missing'),
      }),
      {
        absent: 'no results folder',
      },
    );
    assert.deepEqual(
      ask('Practice', window('2026-10-15T00:12:23Z', '2026-10-15T00:58:20Z'))
        .unplaced,
      0,
    );
    const nobody = resultsFor({
      span: window('2026-10-15T00:12:23Z', '2026-10-15T00:58:20Z'),
      driverName: 'Nobody',
      sessionType: 'P',
      folder: dir,
    });
    const {drivers, ...strikes} = nobody;
    assert.deepEqual(strikes, {
      strikes: [],
      unplaced: 0,
      coveredFrom: null,
      coveredTo: null,
    });
    // The file's drivers still come, none of them him.
    assert.ok(drivers.length > 0 && drivers.every(d => !d.player));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test("the game's real doubled pair (2026_10_14_22_14_53-60R1.xml lines 39-40, name scrubbed) is one strike", () => {
  const real =
    '<TrackLimits Driver="AI One" ID="3" Lap="0" WarningPoints="0" CurrentPoints="0" Resolution="7" et="166.7">No Further Action</TrackLimits>';
  const r = parseResults(
    file([
      real,
      real,
      real.replace('166.7', '192.9'),
      real.replace('166.7', '192.9'),
    ]),
  );
  assert.deepEqual(
    r.rows.map(x => x.et),
    [166.7, 192.9],
  );
});

test('a name is matched exactly: accents and a trailing space count, XML entities are decoded', () => {
  const laps = [
    [1, 7.1, 130],
    [2, 137.1, 120],
    [3, 257.1, null],
  ];
  const xml = file(
    [
      row('Zoë Müller ', 1, 4, 150, 0.25),
      row('Zoë Müller', 1, 5, 160),
      row('Tom &amp; Jerry', 1, 6, 170),
    ],
    driver('Zoë Müller ', laps) +
      driver('Zoë Müller', laps) +
      driver('Tom &amp; Jerry', laps),
  );
  const ets = name => strikesOf(xml, name).strikes.map(s => s.et);
  assert.deepEqual(ets('Zoë Müller '), [150]);
  assert.deepEqual(ets('Zoë Müller'), [160]);
  assert.deepEqual(ets('Tom & Jerry'), [170]);
  assert.deepEqual(ets('Zoe Muller'), []);
});

test('a file written minutes before the recording ends is that session (Road Atlanta 2 Oct: the race left running after the flag), and one written before it began is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'results-'));
  try {
    const laps = [
      [1, 7.1, 130],
      [2, 137.1, null],
      [3, 267.1, 130],
    ];
    for (const [name, written] of [
      ['2026_10_02_20_58_14-47R1.xml', '2026-10-15T00:58:14Z'],
      ['2026_10_02_18_00_00-10R1.xml', '2026-10-14T22:00:00Z'],
    ]) {
      const path = join(dir, name);
      writeFileSync(path, file([row('Me', 1, 4, 150)], driver('Me', laps)));
      utimesSync(path, new Date(written), new Date(written));
    }
    const found = resultsFor({
      span: {
        startedAt: '2026-10-15T00:12:24Z',
        endedAt: '2026-10-15T01:05:45Z',
      },
      driverName: 'Me',
      sessionType: 'Race',
      folder: dir,
    });
    assert.deepEqual(
      found.strikes.map(k => k.outcome),
      ['warning'],
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('a lap with no start time (the garage out-lap of a qualifying run) is no span, and the coverage starts at the first lap that has one (tonight, 62Q1)', () => {
  const xml = file(
    [row('Me', 2, 7, 200)],
    `<Driver><Name>Me</Name>
<Lap num="1" p="4" et="--.---" topspeed="241">--.----</Lap>
<Lap num="2" p="4" et="175.02" s1="30.5">121.5</Lap>
<Lap num="3" p="5" et="299.66" s1="29.5">120.1</Lap>
</Driver>`,
  );
  assert.deepEqual(
    lapSpansOf(xml, 'Me').map(s => [s.num, s.start, s.end]),
    [
      [2, 175.02, 299.66],
      [3, 299.66, null],
    ],
  );
  const r = strikesOf(xml, 'Me');
  assert.equal(r.coveredFrom, 175.02);
  assert.equal(r.strikes.length, 1);
});

// ---- driversOf: every driver of a file, for the results input v2 (ticket 20, thread 111) ----

const FIXTURES = new URL('../../src/analysis/__fixtures__/', import.meta.url);
const fixture = name =>
  JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')).drivers;

const secs = v => (v == null ? '--.----' : String(v));
// A results file's `<Driver>` blocks the way the game writes them, built from
// input drivers; every one carries a name with a Steam id, a team, a car number
// and a vehicle name, which the output must never hold.
function xmlOf(drivers) {
  const blocks = drivers.map(
    (d, i) => `<Driver>
<Name>${d.player ? 'Me' : `Rival ${i}#10${i}`}</Name>
<VehName>Team ${i} #${i}:ELMS25</VehName>
<CarType>${d.car}</CarType>
<CarClass>${d.cls}</CarClass>
<CarNumber>${i}</CarNumber>
<TeamName>Team ${i} #${i}</TeamName>
<isPlayer>${d.player ? 1 : 0}</isPlayer>
<Position>${d.overall ?? ''}</Position>
<ClassPosition>${d.pos ?? ''}</ClassPosition>
${d.laps
  .map(
    (l, n) =>
      `<Lap num="${n + 1}" p="1" et="${n * 100}" s1="${secs(l.s1)}" s2="${secs(
        l.s2,
      )}" s3="${secs(l.s3)}" topspeed="280.1" fcompound="0,Medium"${
        l.pit ? ' pit="1"' : ''
      }>${secs(l.t)}</Lap>`,
  )
  .join('\n')}
<BestLapTime>100.1</BestLapTime>
<Laps>${d.laps.length}</Laps>
${d.status ? `<FinishStatus>${d.status}</FinishStatus>` : ''}
</Driver>`,
  );
  return `<rFactorXML><RaceResults><DateTime>1792025756</DateTime>\n${blocks.join(
    '\n',
  )}</RaceResults></rFactorXML>`;
}

for (const name of ['classPaceQ.json', 'classPaceR.json']) {
  test(`driversOf reads ${name}'s file back as the fixture says, through the reader, with nobody dropped and no name, team or number out`, () => {
    const expected = fixture(name);
    const xml = xmlOf(expected);
    const drivers = driversOf(xml, 'Me');
    assert.deepEqual(drivers, expected);
    const stored = JSON.stringify(
      resultsInput({
        strikes: [],
        unplaced: 0,
        coveredFrom: null,
        coveredTo: null,
        drivers,
      }),
    );
    const back = readResultsInput(stored);
    assert.equal(back.drivers.length, expected.length, 'no driver dropped');
    assert.deepEqual(back.drivers, expected);
    assert.ok(back.drivers.every(d => d.overall != null && d.pos != null));
    assert.equal(back.drivers.filter(d => d.player).length, 1);
    for (const leak of [/Rival/, /Team/, /#\d/, /Me\b/, /ELMS25/, /isPlayer/])
      assert.doesNotMatch(stored, leak);
  });
}

test('driversOf: the player is the name that matches, never isPlayer; a deleted lap and a missing sector are null; a pit lap is flagged; no FinishStatus is null', () => {
  const xml = `<rFactorXML><RaceResults>
<Driver><Name>Me</Name><CarClass>GT3</CarClass><CarType>Car</CarType><isPlayer>1</isPlayer><Position>3</Position><ClassPosition>1</ClassPosition>
<Lap num="1" p="1" et="0" s1="20.5" s2="--.----" s3="30.25" pit="1">--.----</Lap>
<Lap num="2" p="1" et="90" s1="20.5" s2="30.1" s3="30.25">80.85</Lap>
<FinishStatus>Finished Normally</FinishStatus></Driver>
<Driver><Name>Other Human</Name><CarClass>GT3</CarClass><CarType>Car</CarType><isPlayer>1</isPlayer><Position>4</Position><ClassPosition>2</ClassPosition>
<Lap num="1" p="1" et="0" s1="20.5" s2="30.1" s3="30.25">80.85</Lap></Driver>
</RaceResults></rFactorXML>`;
  const [me, other] = driversOf(xml, 'Me');
  assert.equal(me.player, true);
  assert.equal(other.player, false);
  assert.deepEqual(me.laps, [
    {t: null, s1: 20.5, s2: null, s3: 30.25, pit: true},
    {t: 80.85, s1: 20.5, s2: 30.1, s3: 30.25, pit: false},
  ]);
  assert.deepEqual(
    [me.overall, me.pos, me.status, other.overall, other.status],
    [3, 1, 'Finished Normally', 4, null],
  );
});

// His two real files, when they are on this PC (a Sebring qualifying and the race
// of 21 October): the fixtures are trimmed copies, so here every driver of the
// whole file goes through the writer and the reader. Skipped where the folder is
// not, as in CI.
for (const [resultsFile, driversInFixture] of [
  ['2026_10_21_19_39_09-06Q1.xml', 'classPaceQ.json'],
  ['2026_10_21_20_45_08-82R1.xml', 'classPaceR.json'],
]) {
  const path = resolve(defaultResultsFolder, resultsFile);
  test(
    `driversOf on his real ${resultsFile}: all drivers come back through the reader, overall and status on every row, no name, Steam id, team or vehicle out`,
    {skip: !existsSync(path)},
    () => {
      const xml = readFileSync(path, 'utf8');
      const blocks = xml.split('<Driver>').length - 1;
      // The first human by isPlayer stands in for the recording's driver name.
      const player =
        /<Name>([^<]*)<\/Name>(?:(?!<\/Driver>)[\s\S])*?<isPlayer>1/.exec(xml);
      assert.ok(player, 'the file has a human');
      const stored = JSON.stringify(
        resultsInput({
          strikes: [],
          unplaced: 0,
          coveredFrom: null,
          coveredTo: null,
          drivers: driversOf(xml, player[1]),
        }),
      );
      const back = readResultsInput(stored);
      assert.equal(back.drivers.length, blocks, 'no driver dropped');
      assert.ok(back.drivers.every(d => d.overall != null && d.status != null));
      assert.ok(back.drivers.some(d => d.player));
      for (const tag of ['Name', 'TeamName', 'VehName'])
        for (const [, v] of xml.matchAll(
          new RegExp(`<${tag}>([^<]+)</${tag}>`, 'g'),
        ))
          if (v.length > 3)
            assert.ok(!stored.includes(v), `${tag} ${v} is not in the output`);
      assert.doesNotMatch(stored, /#\d{3,}/);
      // Same cars and classes as the committed trimmed copy.
      const kept = fixture(driversInFixture);
      for (const k of kept)
        assert.ok(back.drivers.some(d => d.cls === k.cls && d.car === k.car));
    },
  );
}
