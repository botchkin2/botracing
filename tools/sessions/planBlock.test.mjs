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
    raceLaps: 9, // the ending lap is L9: the first lap holds the formation and L1, as the results file's lapsDone says
    minutes: 40,
    leftEarly: false,
    playerLapsDone: 9,
    classLeaderLapsDone: 9,
    startVePct: 100,
    // the first lap (3.4 L) less the race's median green lap (2.4 L)
    formationL: 1,
    // green laps: 2.4 2.5 2.3 2.4 2.5 2.4 2.5 -> median 2.4
    ownUse: {fuelL: 2.4, vePct: null},
    end: {lap: 9, fuelL: 12.5, vePct: 20},
    // the service on the first lap (not pit-in) is not a stop
    stops: [{lap: 5, fuelL: 31.2, vePct: 55.5, addedL: null, lossS: null, kind: null, detail: null, fillLPerS: null}],
  });
  assert.equal(plan.laps.length, 7, 'green laps with fuel used: 2-4 and 6-9');
});

test('laps are named by the game counter, not the list: a capture that starts in the pits on L2 (Daytona 10-07)', () => {
  // LMU counter 1 is racing lap 2; the stop there is a real one, and the race
  // side has no start load or formation (the capture began after both).
  const laps = [
    raceLap(2.0, {lapNumber: 1, pitOut: true, pitStop: {atEntry: {fuelL: 40, vePct: null}}, fuel: {usedL: 2.0, endL: 60, veStartPct: 80, green: false}}),
    raceLap(2.4, {lapNumber: 2}),
    raceLap(2.4, {lapNumber: 3}),
    raceLap(2.5, {lapNumber: 4, fuel: {usedL: 2.5, endL: 52, green: true}}),
  ];
  const race = planBlock({sessionType: 'Race', fuel, laps}).race;
  assert.equal(race.raceLaps, 5);
  assert.deepEqual(race.end, {lap: 5, fuelL: 52, vePct: null});
  assert.deepEqual(race.stops.map(s => s.lap), [2]);
  assert.equal(race.startVePct, null);
  assert.equal(race.formationL, null);
});

test("iRacing's counter-0 lap is the formation: its own burn, and L1 is counter 1", () => {
  const laps = [
    raceLap(0.9, {sim: 'iracing', lapNumber: 0, fuel: {usedL: 0.9, endL: 99.1, green: false}}),
    raceLap(2.4, {sim: 'iracing', lapNumber: 1}),
    raceLap(2.4, {sim: 'iracing', lapNumber: 2}),
    raceLap(2.5, {sim: 'iracing', lapNumber: 3, fuel: {usedL: 2.5, endL: 92, green: true}}),
  ];
  const race = planBlock({sessionType: 'Race', fuel, laps}).race;
  assert.equal(race.formationL, 0.9);
  assert.equal(race.raceLaps, 3);
});

test('a race with nothing to end on, or not a race, has no race side', () => {
  assert.equal(planBlock({sessionType: 'Race', fuel, laps: [raceLap(2.4, {reasons: ['partial']})]}).race, null);
  assert.equal(planBlock({sessionType: 'Race', fuel, laps: []}).race, null);
  assert.equal(planBlock({sessionType: 'Qualify', fuel, laps: [raceLap(2.4)]}).race, null);
});

test('a first-lap stop that ends in the pit lane is a real stop (Road Atlanta, 25 Sep)', () => {
  const laps = [raceLap(2.4, {pitIn: true, pitStop: {atEntry: {fuelL: 50, vePct: null}}}), raceLap(2.4)];
  assert.deepEqual(planBlock({sessionType: 'Race', fuel, laps}).race.stops, [{lap: 1, fuelL: 50, vePct: null, addedL: null, lossS: null, kind: null, detail: null, fillLPerS: null}]);
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
    fillLPerS: 3.37,
    // 40 L at 3.37 L/s is 11.9 s of fill; the car stood still 15 s.
    visit: {kind: 'service', detail: null, stationaryS: 15},
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
  assert.equal(stops[0].kind, 'service');
  assert.equal(stops[0].fillLPerS, 3.37);
  assert.ok(Math.abs(stops[0].lossS - lossS) < 1e-9, String(stops[0].lossS));

  const lossOf = laps => planBlock({sessionType: 'Race', fuel, laps}).race.stops[0].lossS;
  const withStop = over => base.map((l, i) => (i === 4 ? {...l, pitStop: {...l.pitStop, ...over}} : l));
  assert.equal(lossOf(withStop({tyres: {changed: true, wheels: ['FL']}})), null, 'tyres changed: pitBase leaves it out');
  assert.equal(lossOf(withStop({tyres: null})), null, 'tyres unknown: left out, not guessed');
  assert.equal(lossOf(withStop({added: {fuelL: 0}})), null, 'no fuel added');
  // A repair that also refuelled (Daytona 29 Sep, 4 L in a 60 s repair) stood
  // still for the repair: its time says nothing about the lane or the pump.
  assert.equal(lossOf(withStop({visit: {kind: 'repair', detail: null}})), null, 'a repair teaches no pit loss');
  assert.equal(lossOf(withStop({visit: {kind: 'penalty', detail: 'stop-go'}})), null, 'a penalty teaches no pit loss');
  assert.equal(lossOf(withStop({visit: undefined})), null, 'an unclassified visit teaches no pit loss');
  // Daytona 29 Sep without its capture (pruned after 7 days): the repair has no
  // damage readings left, so it classes as a service. It stood still 60.6 s for
  // 4.04 L (1.2 s of fill): not a service's time, so it teaches no pit loss
  // (bias, #496 review). Its tyre change alone would also drop it; here the
  // tyres are known and unchanged, so only the time rule can.
  assert.equal(
    lossOf(withStop({added: {fuelL: 4.04, vePct: null}, visit: {kind: 'service', detail: null, stationaryS: 60.6}})),
    null,
    'a "service" that stood still far longer than its fill teaches no pit loss',
  );
  assert.ok(
    lossOf(withStop({added: {fuelL: 4.04, vePct: null}, visit: {kind: 'service', detail: null, stationaryS: 9}})) != null,
    'a short top-up that fits its fill still teaches it',
  );
  assert.equal(lossOf(withStop({visit: {kind: 'service', detail: null}})), null, 'no stationary time: nothing to check, left out');
  assert.equal(lossOf(base.slice(0, 6).map((l, i) => (i === 5 ? {...l, pitOut: false} : l))), null, 'the next lap is not an out lap');
  assert.equal(lossOf(base.map((l, i) => (i < 4 && i > 1 ? {...l, comparable: false} : l))), null, 'under 3 clean laps in the stint: no median');
});
