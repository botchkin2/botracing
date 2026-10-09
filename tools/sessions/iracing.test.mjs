import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {yamlKmToM} from './ibt.mjs';
import {
  CHANNELS,
  describe,
  gameLapTimes,
  isRecording,
  lapCrossings,
  mapSessionType,
  resetTimes,
  slug,
  writeArchive,
} from './iracing.mjs';
import {loadRecording, splitAtResets} from './analyze.mjs';

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
  assert.equal(info.groupId.split('|')[0], 'iracing');
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
