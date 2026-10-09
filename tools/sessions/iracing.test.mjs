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
  slug,
  writeArchive,
} from './iracing.mjs';
import {loadRecording} from './analyze.mjs';

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
