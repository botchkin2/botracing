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


// Real stretches and game files from Botkin's PC (the tray's live index and
// the sync's file descriptions, pit wall thread 98): Sebring 2026-10-21, where
// the recorder started 52 s and 66 s after the game file, and Silverstone
// 2026-10-15, one live practice of three stretches with a three-file game
// session, a qualifying and a race.
const SEB = 'Sebring International Raceway';
const SIL = 'Silverstone Grand Prix Circuit - ELMS';
const stretch = (sessionId, layout, sessionType, start, end) => ({
  sessionId, sim: 'lmu', layout, sessionType, startMs: Date.parse(start), endMs: Date.parse(end),
});
const realIndex = {
  'seb_1#0': stretch('e1624db3', SEB, 'Practice', '2026-10-21T00:10:30.738Z', '2026-10-21T00:19:22.945Z'),
  'seb_1#1': stretch('e1624db3', SEB, 'Practice', '2026-10-21T00:20:28.351Z', '2026-10-21T00:25:07.715Z'),
  'seb_10#0': stretch('0dddbcb7', SEB, 'Race', '2026-10-21T00:40:23.279Z', '2026-10-21T01:42:17.293Z'),
  // Written before stretches carried the session type.
  'sil_1#0': stretch('1edfb967', SIL, undefined, '2026-10-15T00:12:46.163Z', '2026-10-15T00:34:42.953Z'),
  'sil_1#1': stretch('1edfb967', SIL, undefined, '2026-10-15T00:35:18.220Z', '2026-10-15T00:35:36.553Z'),
  'sil_1#2': stretch('1edfb967', SIL, undefined, '2026-10-15T00:35:48.174Z', '2026-10-15T00:46:31.586Z'),
  'sil_5#0': stretch('a386725b', SIL, undefined, '2026-10-15T00:58:46.249Z', '2026-10-15T01:07:52.830Z'),
  'sil_10#0': stretch('7e812df9', SIL, undefined, '2026-10-15T01:10:00.100Z', '2026-10-15T02:15:01.638Z'),
};
const gameFile = (layout, sessionType, recordedAt, durationS) => ({
  sim: 'lmu', layout, sessionType, recordedAt, startT: 7, endT: 7 + durationS,
});

test('a game file is covered by the live stretch it overlaps, even when the recorder started late', () => {
  const cover = f => liveCover(realIndex, f)?.sessionId ?? null;
  // The recorder refused the session load (#702) and started 52 s / 66 s late.
  assert.equal(cover(gameFile(SEB, 'Practice', '2026-10-21T00:09:39Z', 582)), 'e1624db3');
  assert.equal(cover(gameFile(SEB, 'Race', '2026-10-21T00:39:17Z', 3778)), '0dddbcb7');
  assert.equal(cover(gameFile(SEB, 'Practice', '2026-10-21T00:20:28Z', 278)), 'e1624db3');
  // Qualifying was never recorded: it stays its own session.
  assert.equal(cover(gameFile(SEB, 'Qualify', '2026-10-21T00:28:01Z', 740)), null);
  // Every Silverstone file stays with the session it had.
  assert.equal(cover(gameFile(SIL, 'Practice', '2026-10-15T00:12:46Z', 1315)), '1edfb967');
  assert.equal(cover(gameFile(SIL, 'Practice', '2026-10-15T00:35:18Z', 18)), '1edfb967');
  assert.equal(cover(gameFile(SIL, 'Practice', '2026-10-15T00:35:48Z', 642)), '1edfb967');
  assert.equal(cover(gameFile(SIL, 'Qualify', '2026-10-15T00:58:46Z', 545)), 'a386725b');
  assert.equal(cover(gameFile(SIL, 'Race', '2026-10-15T01:09:59Z', 3900)), '7e812df9');
});

test('the cover needs the same layout and type and half of the shorter span; the largest overlap wins', () => {
  const index = {
    a: stretch('A', SEB, 'Practice', '2026-10-21T00:00:00Z', '2026-10-21T00:10:00Z'),
    b: stretch('B', SEB, 'Practice', '2026-10-21T00:12:00Z', '2026-10-21T00:30:00Z'),
  };
  const cover = f => liveCover(index, f)?.sessionId ?? null;
  assert.equal(cover(gameFile(SIL, 'Practice', '2026-10-21T00:00:00Z', 600)), null);
  assert.equal(cover(gameFile(SEB, 'Race', '2026-10-21T00:00:00Z', 600)), null);
  // A long file across both: B holds 18 of its 30 min.
  assert.equal(cover(gameFile(SEB, 'Practice', '2026-10-21T00:00:00Z', 1800)), 'B');
  // Its last 4 of 10 minutes inside A, the rest before it: under half.
  assert.equal(cover(gameFile(SEB, 'Practice', '2026-10-20T23:54:00Z', 600)), null);
  // A long practice file after a short stretch ended: no overlap.
  assert.equal(cover(gameFile(SEB, 'Practice', '2026-10-21T00:30:01Z', 3600)), null);
});

test('the best lap is stored to 3 decimals, as an analysed session (the capture gives a float32)', () => {
  const parts = [recording.parts[0], {...recording.parts[1], lapTimeS: 80.49142456054688}];
  const doc = liveSessionDoc({ownerId: 'o', sessionId: 's', recordings: [{...recording, parts}], nowIso: 'x'});
  assert.equal(doc.bestLapTime, 80.491);
});
