import assert from 'node:assert/strict';
import {test} from 'node:test';

import {blockVersions} from './analyze.mjs';
import {checkDoc} from './docShape.mjs';
import {PLAN_VERSION, planBlock} from './planBlock.mjs';

// Lap docs as sync.mjs writes them, trimmed to the fields the block reads.
const lap = (over = {}) => ({
  timed: true,
  lapTime: 91.234,
  comparable: true,
  fuel: {usedL: 2.41, veUsedPct: 2.7, green: true, startL: 60, endL: 57.59},
  traffic: null,
  ...over,
});
const fuel = {
  startL: 60,
  fillLimitL: 60,
  tankL: 105,
  litresPerVePct: 0.89,
  litresPerVePctStop: 0.9,
};

test('a session gives its fuel facts and only its green laps, numbered as the app numbers them', () => {
  const laps = [
    lap({fuel: {usedL: 1.2, veUsedPct: null, green: false}}), // formation / pit lap
    lap(),
    lap({lapTime: 92.5, comparable: false, fuel: {usedL: 2.5, veUsedPct: null, green: true}}),
    lap({timed: false, lapTime: 0}), // green fuel but untimed
    lap({fuel: {usedL: 0, veUsedPct: 0, green: true}}), // nothing used
    lap({fuel: null}),
    lap({lapTime: 90.9, traffic: {trafficAheadS: 3.2, passesSufferedAll: 1, blueFlagS: 0.4, battleS: 0, overtakes: [{atM: 10}, {atM: 20}]}}),
  ];
  assert.deepEqual(planBlock({fuel, laps}), {
    v: PLAN_VERSION,
    fuel: {fillLimitL: 60, startL: 60, tankL: 105, litresPerVePct: 0.89},
    laps: [
      {n: 2, usedL: 2.41, veUsedPct: 2.7, timeS: 91.234, comparable: true, traffic: null},
      {n: 3, usedL: 2.5, veUsedPct: null, timeS: 92.5, comparable: false, traffic: null},
      {
        n: 7,
        usedL: 2.41,
        veUsedPct: 2.7,
        timeS: 90.9,
        comparable: true,
        traffic: {aheadS: 3.2, passes: 1, blueS: 0.4, battleS: 0, overtakes: 2},
      },
    ],
  });
});

test('a session with no fuel channel or no laps gives an empty block, never undefined', () => {
  const empty = planBlock({fuel: null, laps: []});
  assert.deepEqual(empty, {
    v: PLAN_VERSION,
    fuel: {fillLimitL: null, startL: null, tankL: null, litresPerVePct: null},
    laps: [],
  });
  assert.deepEqual(
    planBlock({fuel: {startL: undefined}, laps: [lap({fuel: null})]}).fuel,
    empty.fuel,
  );
});

test('the block is a valid Firestore value and small: about 100 laps stay under 15 KB', () => {
  const laps = Array.from({length: 100}, (_, i) =>
    lap({lapTime: 90 + (i % 7) / 10, traffic: i % 3 ? null : {trafficAheadS: 1.5, passesSufferedAll: 0, blueFlagS: 0, battleS: 0.5, overtakes: []}}),
  );
  const block = planBlock({fuel, laps});
  assert.equal(block.laps.length, 100);
  checkDoc('sessions/x', {plan: block});
  assert.ok(JSON.stringify(block).length < 15_000, String(JSON.stringify(block).length));
});

test('its version is in the block versions, so a bump re-analyses every session', () => {
  assert.equal(blockVersions.plan, PLAN_VERSION);
});
