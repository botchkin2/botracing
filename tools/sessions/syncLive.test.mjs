import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {syncLive} from './syncLive.mjs';

const info = {
  sim: 'lmu',
  track: 'Michelin Raceway Road Atlanta',
  layout: 'Michelin Raceway Road Atlanta',
  car: '911GT3R Custom Team 2025 #397',
  carClass: 'GT3',
  sessionType: 'Practice',
  sessionClock: '',
  recordedAt: '2026-10-12T20:00:00.000Z',
  startT: 100,
  endT: 400,
};

// A capture whose laps grow between calls, and an archive writer that counts.
function fakeCapture(laps) {
  const written = [];
  return {
    written,
    setLaps: n => (laps = n),
    describeCapture: () => ({
      stretches: [
        {
          key: 'cap#0',
          info,
          laps: Array.from({length: laps}, (_, i) => ({
            lapNumber: i,
            t0: 100 + 80 * i,
            t1: 180 + 80 * i,
            lapTimeS: i === 0 ? null : 80 + i / 10,
            partial: i === 0,
          })),
        },
      ],
    }),
    writeCaptureArchive: (_dir, _info, lap, samples, events) => {
      written.push(lap.lapNumber);
      writeFileSync(samples, `s${lap.lapNumber}`);
      writeFileSync(events, `e${lap.lapNumber}`);
    },
  };
}

function memoryStore() {
  const outs = [];
  return {outs, uploadLive: async out => (outs.push(out), {sent: 0})};
}

test('each lap writes only its own part; ids stay the same as laps arrive', async () => {
  const work = mkdtempSync(join(tmpdir(), 'syncLive-'));
  const capture = fakeCapture(2);
  const store = memoryStore();
  const run = () => syncLive({captureDir: 'C:/cap', ownerId: 'o', work, store, capture, now: () => 'now'});
  await run();
  capture.setLaps(3);
  await run();
  assert.deepEqual(capture.written, [0, 1, 2]);
  const [a, b] = store.outs;
  assert.equal(a.session.id, b.session.id);
  assert.deepEqual(a.session.recordingIds, b.session.recordingIds);
  assert.equal(b.session.lapCount, 3);
  assert.equal(b.session.bestLapTime, 80.1);
  assert.equal(b.files.length, 6);
  assert.match(b.files[4].dest, /^archive\/lmu\/[0-9a-f]+\/[0-9a-f]+\/samples\.002\.parquet$/);
});

test('a capture with no finished lap uploads nothing', async () => {
  const work = mkdtempSync(join(tmpdir(), 'syncLive-'));
  const store = memoryStore();
  const r = await syncLive({captureDir: 'C:/cap', ownerId: 'o', work, store, capture: fakeCapture(0)});
  assert.deepEqual(r, {sessions: 0});
  assert.equal(store.outs.length, 0);
});
