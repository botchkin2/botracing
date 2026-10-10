import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
  assert.deepEqual(planBlock({sessionType: 'Practice', fuel, laps}), {
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
    race: null,
  });
});

test('a session with no fuel channel or no laps gives an empty block, never undefined', () => {
  const empty = planBlock({sessionType: 'Practice', fuel: null, laps: []});
  assert.deepEqual(empty, {
    v: PLAN_VERSION,
    fuel: {fillLimitL: null, startL: null, tankL: null, litresPerVePct: null},
    laps: [],
    race: null,
  });
  assert.deepEqual(
    planBlock({sessionType: 'Practice', fuel: {startL: undefined}, laps: [lap({fuel: null})]}).fuel,
    empty.fuel,
  );
});

test('the block is a valid Firestore value and small: about 100 laps stay under 15 KB', () => {
  const laps = Array.from({length: 100}, (_, i) =>
    lap({lapTime: 90 + (i % 7) / 10, traffic: i % 3 ? null : {trafficAheadS: 1.5, passesSufferedAll: 0, blueFlagS: 0, battleS: 0.5, overtakes: []}}),
  );
  const block = planBlock({sessionType: 'Practice', fuel, laps});
  assert.equal(block.laps.length, 100);
  checkDoc('sessions/x', {plan: block});
  assert.ok(JSON.stringify(block).length < 15_000, String(JSON.stringify(block).length));
});

test('its version is in the block versions, so a bump re-analyses every session', () => {
  assert.equal(blockVersions.plan, PLAN_VERSION);
});

// A race as sync.mjs writes it, trimmed: lap 1 is the formation lap (3.4 L, the
// service before the start in a pit window), laps 2-4 green, lap 5 a stop (pit
// in), laps 6-8 green, lap 9 the last whole lap, lap 10 cut short.
const raceLap = (usedL, over = {}) => ({
  timed: true,
  lapTime: 90,
  comparable: true,
  reasons: [],
  pitIn: false,
  pitStop: null,
  traffic: null,
  fuel: {usedL, endL: 40, veStartPct: null, veEndPct: null, veUsedPct: null, green: true},
  ...over,
});

test('a race adds its ending lap, stops, formation burn and own use, as raceFacts reads them from the laps', () => {
  const laps = [
    raceLap(3.4, {pitStop: {atEntry: {fuelL: 60, vePct: null}}, pitIn: false, fuel: {usedL: 3.4, endL: 56.6, veStartPct: 100, veEndPct: 96, green: false}}),
    raceLap(2.4),
    raceLap(2.5),
    raceLap(2.3),
    raceLap(2.6, {pitIn: true, pitStop: {atEntry: {fuelL: 31.2, vePct: 55.5}}, fuel: {usedL: 2.6, endL: 31.2, veEndPct: 55.5, green: false}}),
    raceLap(2.4),
    raceLap(2.5),
    raceLap(2.4),
    raceLap(2.5, {fuel: {usedL: 2.5, endL: 12.5, veEndPct: 20, green: true}}),
    raceLap(1.1, {reasons: ['partial'], fuel: {usedL: 1.1, endL: null, green: false}}),
  ];
  const plan = planBlock({
    sessionType: 'Race',
    fuel,
    laps,
    race: {minutes: 40},
    result: {finish: {leftEarly: false, lapsDone: 9, classLeaderLapsDone: 9}},
  });
  assert.deepEqual(plan.race, {
    raceLaps: 8, // the ending lap is the 9th: lap 0 is the formation lap
    minutes: 40,
    leftEarly: false,
    playerLapsDone: 9,
    classLeaderLapsDone: 9,
    startVePct: 100,
    formationL: 3.4,
    // green laps: 2.4 2.5 2.3 2.4 2.5 2.4 2.5 -> median 2.4
    ownUse: {fuelL: 2.4, vePct: null},
    end: {lapIndex: 9, fuelL: 12.5, vePct: 20},
    // the service on the first lap (not pit-in) is not a stop
    stops: [{lapIndex: 5, fuelL: 31.2, vePct: 55.5, addedL: null, lossS: null}],
  });
  assert.equal(plan.laps.length, 7, 'green laps with fuel used: 2-4 and 6-9');
});

test('a race with nothing to end on, or not a race, has no race side', () => {
  assert.equal(planBlock({sessionType: 'Race', fuel, laps: [raceLap(2.4, {reasons: ['partial']})]}).race, null);
  assert.equal(planBlock({sessionType: 'Race', fuel, laps: []}).race, null);
  assert.equal(planBlock({sessionType: 'Qualify', fuel, laps: [raceLap(2.4)]}).race, null);
});

test('a first-lap stop that ends in the pit lane is a real stop (Road Atlanta, 25 Sep)', () => {
  const laps = [raceLap(2.4, {pitIn: true, pitStop: {atEntry: {fuelL: 50, vePct: null}}}), raceLap(2.4)];
  assert.deepEqual(planBlock({sessionType: 'Race', fuel, laps}).race.stops, [{lapIndex: 1, fuelL: 50, vePct: null, addedL: null, lossS: null}]);
});

// A real LMU race (Road Atlanta, 3 Oct 2026) through the real sync: the block
// the sync wrote is what planBlock gives from the same lap docs and session
// fields. src/data/sessions/planBlock.equivalence.test.ts holds the app side.
test('a real race: the stored block is what planBlock gives from its lap docs', () => {
  const f = JSON.parse(
    readFileSync(new URL('../../src/data/sessions/__fixtures__/planRace.json', import.meta.url), 'utf8'),
  );
  const again = planBlock({
    sessionType: f.session.sessionType,
    fuel: f.session.fuel,
    laps: f.laps,
    race: f.session.race,
    result: f.session.result,
  });
  assert.deepEqual(again, f.plan);
});

// The pit lane base (src/features/plan/pitBase.ts) reads the laps around a stop;
// the block carries the lane loss so the app needs no lap docs for it.
test('a refuel stop carries the litres added and its lane loss against the stint median', () => {
  const stopLap = (stint, t, over = {}) => ({
    timed: true, lapTime: t, comparable: true, reasons: [], stint, pitIn: false, pitOut: false,
    pitStop: null, traffic: null, fuel: {usedL: 2.4, endL: 40, green: true}, ...over,
  });
  const stop = (added, tyres) => ({
    atEntry: {fuelL: 12, vePct: null},
    added: {fuelL: added, vePct: null},
    tyres,
  });
  const base = [
    stopLap(1, 90.2),
    stopLap(1, 90.0),
    stopLap(1, 90.4),
    stopLap(1, 90.1),
    stopLap(1, 95.0, {pitIn: true, pitStop: stop(40, {changed: false, wheels: []})}),
    stopLap(2, 105.0, {pitOut: true}),
    stopLap(2, 90.3),
  ];
  // stint 1 green laps (comparable, no pit): 90.2 90.0 90.4 90.1 -> median 90.15
  const lossS = 95.0 + 105.0 - 2 * 90.15;
  const stops = planBlock({sessionType: 'Race', fuel, laps: base}).race.stops;
  assert.equal(stops.length, 1);
  assert.equal(stops[0].addedL, 40);
  assert.ok(Math.abs(stops[0].lossS - lossS) < 1e-9, String(stops[0].lossS));

  const lossOf = laps => planBlock({sessionType: 'Race', fuel, laps}).race.stops[0].lossS;
  const withStop = over => base.map((l, i) => (i === 4 ? {...l, pitStop: {...l.pitStop, ...over}} : l));
  assert.equal(lossOf(withStop({tyres: {changed: true, wheels: ['FL']}})), null, 'tyres changed: pitBase leaves it out');
  assert.equal(lossOf(withStop({tyres: null})), null, 'tyres unknown: left out, not guessed');
  assert.equal(lossOf(withStop({added: {fuelL: 0}})), null, 'no fuel added');
  assert.equal(lossOf(base.slice(0, 6).map((l, i) => (i === 5 ? {...l, pitOut: false} : l))), null, 'the next lap is not an out lap');
  assert.equal(lossOf(base.map((l, i) => (i < 4 && i > 1 ? {...l, comparable: false} : l))), null, 'under 3 clean laps in the stint: no median');
});
