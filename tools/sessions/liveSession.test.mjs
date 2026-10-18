import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isStale} from './versionKey.mjs';
import {analysisVersion, blockVersions} from './analyze.mjs';
import {LIVE_STAMP, liveCover, liveRecordingDoc, liveSessionDoc} from './liveSession.mjs';

const info = {
  sim: 'lmu',
  track: 'Michelin Raceway Road Atlanta',
  layout: 'Michelin Raceway Road Atlanta',
  car: '911GT3R Custom Team 2025 #397',
  carClass: 'GT3',
  sessionType: 'Practice',
  weather: 'Clear',
  recordedAt: '2026-10-12T20:00:00.000Z',
  startT: 100,
};
const recording = {
  id: 'r1',
  info,
  parts: [
    {lapNumber: 0, t0: 100, t1: 190, lapTimeS: null, partial: true},
    {lapNumber: 1, t0: 190, t1: 271.2, lapTimeS: 81.2},
    {lapNumber: 2, t0: 271.2, t1: 351.9, lapTimeS: 80.7},
  ],
};

test('the list shows a live session before any analysis: lap count and the best timed lap', () => {
  const doc = liveSessionDoc({ownerId: 'o', sessionId: 's', recordings: [recording], nowIso: '2026-10-12T20:06:00.000Z'});
  assert.equal(doc.lapCount, 3);
  assert.equal(doc.bestLapTime, 80.7);
  assert.equal(doc.archiveParts, 3);
  assert.deepEqual(doc.recordingIds, ['r1']);
  assert.equal(doc.startedAt, info.recordedAt);
  assert.equal(doc.endedAt, '2026-10-12T20:04:11.900Z');
  assert.equal(doc.trackId, 'lmu-michelin_raceway_road_atlanta');
});

test('a live session is stale under any rules, so opening it analyses it', () => {
  assert.equal(isStale(LIVE_STAMP, analysisVersion, blockVersions), true);
});

test('no timed lap yet: no best', () => {
  const doc = liveSessionDoc({
    ownerId: 'o',
    sessionId: 's',
    recordings: [{...recording, parts: recording.parts.slice(0, 1)}],
    nowIso: 'x',
  });
  assert.equal(doc.bestLapTime, null);
});

test('the recording names one archive part per lap, in order', () => {
  const doc = liveRecordingDoc({ownerId: 'o', sessionId: 's', recording});
  assert.deepEqual(doc.archive.parts.map(p => p.samples), [
    'archive/lmu/s/r1/samples.000.parquet',
    'archive/lmu/s/r1/samples.001.parquet',
    'archive/lmu/s/r1/samples.002.parquet',
  ]);
  assert.equal(doc.durationSec, 251.9);
});


test('a game file a live stretch covers is found; another layout or time is not', () => {
  const index = {
    'cap#0': {sessionId: 's', sim: 'lmu', layout: 'RA', startMs: Date.parse('2026-10-12T20:00:00Z'), endMs: Date.parse('2026-10-12T20:40:00Z')},
  };
  const at = recordedAt => ({sim: 'lmu', layout: 'RA', recordedAt});
  assert.equal(liveCover(index, at('2026-10-12T20:00:02Z'))?.sessionId, 's');
  assert.equal(liveCover(index, at('2026-10-12T19:59:50Z'))?.sessionId, 's');
  assert.equal(liveCover(index, at('2026-10-12T21:00:00Z')), null);
  assert.equal(liveCover(index, {...at('2026-10-12T20:00:02Z'), layout: 'Sebring'}), null);
});

test('the best lap is stored to 3 decimals, as an analysed session (the capture gives a float32)', () => {
  const parts = [recording.parts[0], {...recording.parts[1], lapTimeS: 80.49142456054688}];
  const doc = liveSessionDoc({ownerId: 'o', sessionId: 's', recordings: [{...recording, parts}], nowIso: 'x'});
  assert.equal(doc.bestLapTime, 80.491);
});

test('the live doc carries online, offline as false, and leaves the key off when unknown', () => {
  const doc = online => liveSessionDoc({ownerId: 'o', sessionId: 's', recordings: [recording], nowIso: 'x', online});
  assert.equal(doc(false).online, false);
  assert.equal(doc(true).online, true);
  assert.equal('online' in doc(null), false);
  assert.equal('online' in doc(undefined), false);
});
