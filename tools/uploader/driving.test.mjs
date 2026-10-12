// Run: node --test tools/uploader/driving.test.mjs
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {inGarage, lastState, lmuState} from './driving.mjs';
import {decide} from './trigger.mjs';

const now = 1_000_000_000;
const ago = s => now - s * 1000;
const line = (t, a, b) =>
  `  ${t}s game.cpp      555: [State Change] Changing session state from ${a} to ${b}\n`;

test('the last state change in the log is the state', () => {
  const log =
    line(78.4, 'LOADING', 'MONITOR_MENU') +
    line(82.5, 'MONITOR_MENU', 'DRIVING') +
    line(140.1, 'DRIVING', 'MONITOR_MENU');
  assert.equal(lastState(log), 'MONITOR_MENU');
  assert.equal(lastState('no states here'), null);
});

test('the garage and the menus are the garage; every other state is a drive', () => {
  assert.equal(inGarage('MONITOR_MENU'), true);
  assert.equal(inGarage('DISABLED'), true);
  for (const state of [
    'DRIVING',
    'PAUSED',
    'PAUSED_AI_IN_PIT',
    'END_OF_RACE_GRACE',
    'LOADING',
  ])
    assert.equal(inGarage(state), false, state);
  // No log read: not known, so not the garage.
  assert.equal(inGarage(null), false);
});
