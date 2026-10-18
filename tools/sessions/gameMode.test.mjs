// Run: node --test tools/sessions/gameMode.test.mjs
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {captureExtract, readCaptureExtract} from './captureExtract.mjs';
import {onlineFor, onlineOfMode} from './gameMode.mjs';

const T0 = Date.parse('2026-10-17T00:11:06Z');
const span = {tracks: ['Algarve'], startMs: T0 + 60_000, endMs: T0 + 600_000};

// A capture folder as the recorder writes it: meta.json beside a field chunk
// (listCaptures only needs the file to exist).
function capture(root, name, meta) {
  const dir = join(root, name);
  mkdirSync(dir);
  writeFileSync(join(dir, 'field-0001.parquet'), '');
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      track: 'Algarve',
      startUtc: new Date(T0).toISOString(),
      endUtc: new Date(T0 + 3_600_000).toISOString(),
      ...meta,
    }),
  );
}

function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'gamemode-'));
  try {
    fn(root);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

test('the game mode: 0 offline, 1-3 online, anything else unknown', () => {
  assert.equal(onlineOfMode(0), false);
  for (const m of [1, 2, 3]) assert.equal(onlineOfMode(m), true);
  for (const m of [undefined, null, 4, -1, '2'])
    assert.equal(onlineOfMode(m), null);
});

test('offline: the Algarve practice capture (mode 0, server -none-)', () =>
  withRoot(root => {
    capture(root, 'a', {gameMode: 0, serverName: '-none-'});
    assert.equal(onlineFor(root, span), false);
  }));

test('online: the Silverstone capture (mode 2)', () =>
  withRoot(root => {
    capture(root, 'a', {gameMode: 2, serverName: ''});
    assert.equal(onlineFor(root, span), true);
  }));

test('a capture without gameMode, no capture, or captures that disagree: null', () =>
  withRoot(root => {
    assert.equal(onlineFor(root, span), null);
    capture(root, 'a', {});
    assert.equal(onlineFor(root, span), null);
    capture(root, 'b', {gameMode: 0});
    capture(root, 'c', {gameMode: 2});
    assert.equal(onlineFor(root, span), null);
  }));

test('a capture on another track says nothing about this session', () =>
  withRoot(root => {
    capture(root, 'a', {gameMode: 2, track: 'Silverstone'});
    assert.equal(onlineFor(root, span), null);
  }));

test('the extract keeps offline (false) and reads it back', () => {
  const extract = captureExtract({
    damage: null,
    raceLength: null,
    online: false,
  });
  assert.equal(extract.online, false);
  const back = readCaptureExtract(JSON.stringify(extract));
  assert.equal(back.online, false);
  assert.equal(captureExtract({damage: null, raceLength: null}), null);
  assert.equal(
    readCaptureExtract(JSON.stringify({v: 1, damage: null, raceLength: null}))
      .online,
    null,
  );
});
