import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {reusableInfo} from './describeCache.mjs';
import {yamlKmToM} from './ibt.mjs';
import {
  CHANNELS,
  describe,
  describeVersion,
  gameLapTimes,
  isRecording,
  lapCrossings,
  mapSessionType,
  playerCar,
  resetTimes,
  sectorCrossings,
  sectorStarts,
  slug,
  writeArchive,
} from './iracing.mjs';
import {loadRecording, sectorSplits, splitAtResets} from './analyze.mjs';

const GR86 =
  'C:\\Users\\Botkin\\Documents\\iRacing\\telemetry\\toyotagr86_virginia 2022 full 2024-10-18 11-06-57.ibt';
const RA_RACE =
  'C:\\Users\\Botkin\\Documents\\iRacing\\telemetry\\fordmustanggt3_roadatlanta full 2026-08-27 21-08-42.ibt';
const RA_RACE_A =
  'C:\\Users\\Botkin\\Documents\\iRacing\\telemetry\\fordmustanggt3_roadatlanta full 2026-08-27 20-57-02.ibt';

test('channel names are unique and never invent VE or field', () => {
  const names = CHANNELS.map(c => c.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(!names.includes('virtual_energy_pct'));
  assert.ok(CHANNELS.every(c => !c.source.startsWith('CarIdx')));
});

test('isRecording and slug', () => {
  assert.equal(isRecording('a.ibt'), true);
  assert.equal(isRecording('a.IBT'), true);
  assert.equal(isRecording('a.duckdb'), false);
  assert.equal(slug('Full Course'), 'full_course');
  assert.equal(slug('127-full_course'), '127-full_course');
});

test('Lone/Open Qualify map to Qualify, Warmup to Practice', () => {
  assert.equal(mapSessionType('Lone Qualify'), 'Qualify');
  assert.equal(mapSessionType('Open Qualify'), 'Qualify');
  assert.equal(mapSessionType('Race'), 'Race');
  assert.equal(mapSessionType('Warmup'), 'Practice');
  assert.equal(mapSessionType('Offline Testing'), 'Practice');
});

test('game lap time is the LastLapTime that settles after the crossing', () => {
  const t = [0, 80, 81, 82, 160, 161, 162];
  const lap = [1, 2, 2, 2, 3, 3, 3];
  const last = [0, 0, 0, 79.15, 79.15, 79.15, 79.97];
  const ev = gameLapTimes(t, lap, last);
  const timed = ev.filter(e => e[2] > 0);
  assert.equal(timed.length, 1);
  assert.equal(timed[0][0], 160);
  assert.equal(timed[0][2], 79.97);
});

test('LastLapTime reused at the next crossing is dropped', () => {
  const t = [0, 80, 160];
  const lap = [1, 2, 3];
  const last = [0, 0, 111.266];
  const xs = lapCrossings(t, lap, last);
  assert.equal(xs[0].time, 0);
  assert.equal(xs[1].time, 0);
});

test('a Lap that goes backwards keeps a monotonic session number', () => {
  const t = [0, 10, 20, 30, 40];
  const lap = [30, 30, 31, 4, 4];
  const last = [79, 79, 79, 80, 80];
  const xs = lapCrossings(t, lap, last);
  assert.deepEqual(
    xs.map(c => c.lap),
    [31, 32],
  );
});

test('TrackLength km string becomes metres', () => {
  assert.equal(Math.round(yamlKmToM('4.0569 km') * 10) / 10, 4056.9);
  assert.equal(yamlKmToM('5.22 km'), 5220);
  assert.equal(yamlKmToM(''), null);
});

test('describe: VIR test file, track key is sim-TrackID-config', {skip: !existsSync(GR86)}, () => {
  const info = describe(GR86);
  assert.equal(info.sim, 'iracing');
  assert.match(info.layout, /^\d+-[a-z0-9_]+$/);
  // The layout's own name is for display (the key above is a slug).
  assert.equal(typeof info.layoutName, 'string');
  assert.notEqual(info.layoutName, info.layout);
  // An offline drive (SubSessionID 0) has no group of its own: the clock groups it.
  assert.ok(info.groupId == null || info.groupId.split('|')[0] === 'iracing');
  assert.ok(info.trackLengthM > 5000);
  assert.ok(!info.channels.some(c => c.name === 'virtual_energy_pct'));
  assert.equal(
    info.channels.find(c => c.name === 'speed_kmh')?.source,
    'Speed',
  );
});

test('describe: Road Atlanta race is groupId subsession+session', {skip: !existsSync(RA_RACE) || !existsSync(RA_RACE_A)}, () => {
  const a = describe(RA_RACE_A);
  const b = describe(RA_RACE);
  assert.equal(a.groupId, b.groupId);
  assert.equal(a.sessionClock, b.sessionClock);
  assert.equal(a.layout, b.layout);
  assert.ok(a.layout.startsWith('232-') || /^\d+-/.test(a.layout));
  assert.equal(Math.round(a.trackLengthM), 4057);
  assert.ok(a.fuelSetup.tankL > 0);
  assert.match(b.car, /Mustang/i);
  assert.equal(b.sessionType, 'Race');
});

test('writeArchive: samples have km/h and fuel, no VE column', {skip: !existsSync(GR86)}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ibt-'));
  try {
    const info = describe(GR86);
    const samples = join(dir, 's.parquet');
    const events = join(dir, 'e.parquet');
    writeArchive(GR86, info, samples, events);
    const rec = loadRecording(info, samples, events);
    assert.ok(rec.s.speed_kmh);
    assert.ok(rec.s.speed_kmh[0] >= 0);
    assert.ok(rec.s.fuel_l);
    assert.equal(rec.s.virtual_energy_pct, undefined);
    assert.ok(rec.events.in_pits?.length);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('a reset is the car landing in its pit stall straight from the track', () => {
  // The Sebring practice of 2026-10-09: on track, then in the stall at 1381.5 s
  // with no pit road before it. A normal stop drives down the pit road first.
  const t = [1380.0, 1381.5, 1382.0, 1500.0, 1501.0, 1502.0];
  const inStall = [0, 1, 1, 0, 0, 1];
  const onPitRoad = [0, 1, 1, 0, 1, 1];
  assert.deepEqual(resetTimes(t, inStall, onPitRoad), [1381.5]);
  assert.deepEqual(resetTimes([0, 1], [1, 1], [1, 1]), [], 'starting in the stall is not a reset');
  // The refill a tick before the stall flag is where the reset starts.
  assert.deepEqual(
    resetTimes([1381.483, 1381.5, 1381.517], [0, 0, 1], [0, 0, 1], [46.86, 55, 55]),
    [1381.5],
  );
});

test('a reset cuts the lap it falls in, and ends one it falls at the end of', () => {
  // Sebring: a reset at 90.5 s inside the out lap, one at 1381.5 s where the
  // lap counter also steps.
  const segs = [
    {start: 0, end: 174.6, lapNumber: 0, partial: true},
    {start: 1354.8, end: 1381.5, lapNumber: 7, partial: false},
    {start: 1381.5, end: 1522, lapNumber: 8, partial: true},
  ];
  const out = splitAtResets(segs, [90.5, 1381.52]);
  assert.deepEqual(
    out.map(s => [s.start, s.end, s.partial, s.resetAt]),
    [
      [0, 90.5, true, 90.5],
      [90.5, 174.6, true, null],
      [1354.8, 1381.5, true, 1381.52],
      [1381.5, 1522, true, null],
    ],
  );
  assert.deepEqual(splitAtResets(segs, []).map(s => s.resetAt), [null, null, null]);
});

test('a file described with the version before the offline grouping fix is described again', () => {
  const stat = {size: 100, mtimeMs: 5};
  const cached = version => ({
    size: 100,
    mtimeMs: 5,
    describeVersion: version,
    info: {groupId: 'iracing|0|0'},
  });
  // What the uploader kept before the fix still says iracing|0|0 ...
  assert.equal(reusableInfo(cached(5), stat, describeVersion), null);
  // ... and what it keeps now is reused.
  assert.deepEqual(reusableInfo(cached(describeVersion), stat, describeVersion), {
    groupId: 'iracing|0|0',
  });
  assert.equal(describeVersion, 7);
});

test("the player's class is its label, and an empty short name never reads the next line", () => {
  const yaml = [
    'DriverInfo:',
    ' DriverCarIdx: 1',
    ' Drivers:',
    ' - CarIdx: 0',
    '   CarScreenName: Cadillac V-Series.R',
    '   CarClassShortName: ',
    '   CarClassRelSpeed: 70',
    '   CarClassID: 4029',
    ' - CarIdx: 1',
    '   CarScreenName: Ford Mustang GT3',
    '   CarClassShortName: ',
    '   CarClassRelSpeed: 52',
    '   CarClassID: 4011',
    '',
  ].join('\n');
  assert.equal(playerCar(yaml).carClass, 'GT3');
  // An unknown id with no name and one model: the model names the class.
  const odd = yaml.replace('CarClassID: 4011', 'CarClassID: 9999');
  assert.equal(playerCar(odd).carClass, 'Ford Mustang GT3');
  // No class id at all: the short name, empty here, never "CarClassRelSpeed: 52".
  const bare = yaml.replace(/\n +CarClassID: \d+/g, '');
  assert.equal(playerCar(bare).carClass, '');
});

test('describe: the Road Atlanta GT3 race names its class GT3', {skip: !existsSync(RA_RACE)}, () => {
  assert.equal(describe(RA_RACE).carClass, 'GT3');
});

test("iRacing's own sectors: starts from SplitTimeInfo, crossings, and a lap's times", () => {
  const yaml =
    'SplitTimeInfo:\n Sectors:\n - SectorNum: 0\n   SectorStartPct: 0.000000\n - SectorNum: 1\n   SectorStartPct: 0.250000\n - SectorNum: 2\n   SectorStartPct: 0.600000\nCarSetup:\n';
  assert.deepEqual(sectorStarts(yaml), [0, 0.25, 0.6]);
  assert.deepEqual(sectorStarts('WeekendInfo:\n'), []);

  // One 10 s lap at a steady pace sampled every second, then a reset that
  // jumps the car back: a jump is not a crossing.
  const t = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const pct = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.0, 0.7];
  const rows = sectorCrossings(t, pct, [0, 0.25, 0.6]);
  assert.deepEqual(
    rows.map(r => [Number(r[0].toFixed(6)), r[1], r[2], r[3]]),
    [
      [2.5, 'sector_start', 2, 3],
      [6, 'sector_start', 3, 3],
    ],
  );

  const events = rows.map(r => ({t: r[0], v: r[2], v2: r[3]}));
  // The last sector runs to the game's lap time, as LMU's S3 does.
  assert.deepEqual(sectorSplits(events, 0, 10, 10.002), [2.5, 3.5, 4.002]);
  // A sector missing from the lap (an out-lap that joined late): no times.
  assert.deepEqual(sectorSplits(events.slice(1), 0, 10, 10), []);
  // No lap time, or a sector under half a second: no times.
  assert.deepEqual(sectorSplits(events, 0, 10, null), []);
  assert.deepEqual(sectorSplits(events, 0, 10, 6.3), []);
});
