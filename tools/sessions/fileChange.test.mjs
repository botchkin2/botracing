// Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileChange} from './fileChange.mjs';

const cutOnTrack = {partial: true, pitIn: false};

test('the first file starts the session', () => {
  assert.equal(
    fileChange({lastLap: null, gapS: null, startsInPits: true}),
    'session',
  );
});

test('cut short on track, next file in the pits 10 s later: a reset', () => {
  assert.equal(
    fileChange({lastLap: cutOnTrack, gapS: 10, startsInPits: true}),
    'reset',
  );
});

test('the same, but 10 minutes later: only a gap', () => {
  assert.equal(
    fileChange({lastLap: cutOnTrack, gapS: 600, startsInPits: true}),
    'gap',
  );
});

test('next file starts on track, or the game clock restarted: a gap', () => {
  assert.equal(
    fileChange({lastLap: cutOnTrack, gapS: 10, startsInPits: false}),
    'gap',
  );
  assert.equal(
    fileChange({lastLap: cutOnTrack, gapS: -30, startsInPits: true}),
    'gap',
  );
});

test('the previous file ended in the pits: a pit stop', () => {
  assert.equal(
    fileChange({
      lastLap: {partial: true, pitIn: true},
      gapS: 10,
      startsInPits: true,
    }),
    'pit',
  );
});
