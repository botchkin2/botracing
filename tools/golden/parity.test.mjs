// The parity gate (docs/SESSION_PIPELINE.md). The rules run everywhere; the
// real pair (a capture and the game file of the same drive) runs where
// PARITY_PAIR names its folder, which CI's contract-replay job fetches.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {checkSession} from '../sessions/manifest.mjs';
import {buildPair, differences, judge, loadAllow} from './parity.mjs';

const lap = over => ({
  lapNumber: 1,
  timed: true,
  partial: false,
  pitIn: false,
  pitOut: false,
  traffic: {aheadS: 1},
  tyres: {wearPct: {FL: 99, FR: 98, RL: 97, RR: 96}},
  ...over,
});
const session = over => ({
  sessionType: 'Race',
  weather: 'Clear',
  fuel: {startL: 60},
  stints: [{n: 1}],
  race: {minutes: 40},
  field: {cars: 20},
  classLaps: {},
  classBests: {},
  result: {},
  traffic: {},
  ...over,
});

test('differences walks every leaf, arrays by index', () => {
  assert.deepEqual(differences({a: [1, {b: 2}], c: 'x'}, {a: [1, {b: 3}], c: 'x'}), [
    ['a.1.b', 2, 3],
  ]);
  assert.deepEqual(differences({a: [1]}, {a: [1, 2]}), [['a.length', 1, 2]]);
});

test('judge fails what the allow-list does not explain, and holds a tolerance', () => {
  const allow = [
    {path: 'laps\\.#\\.distanceM', tol: 1, re: /^laps\.#\.distanceM$/},
  ];
  const pair = d => ({
    capture: {session: {}, laps: [lap({distanceM: 100})]},
    game: {session: {}, laps: [lap({distanceM: 100 + d})]},
  });
  assert.equal(judge(pair(0.5), allow).failures.length, 0);
  assert.equal(judge(pair(2), allow).failures.length, 1);
  const missing = judge({
    capture: {session: {}, laps: [lap()]},
    game: {session: {}, laps: [lap(), lap({lapNumber: 2})]},
  }, allow);
  assert.deepEqual(missing.failures.map(f => f.path), ['laps.2']);
});

test('the allow-list loads, and every entry says why', () => {
  for (const e of loadAllow()) assert.ok(e.why?.length > 10, e.path);
});

test('the manifest passes a complete session', () => {
  assert.deepEqual(checkSession({session: session(), laps: [lap()]}, {otherCars: 19}), []);
});

test('the manifest names what the 2026-10-14 live sessions lacked', () => {
  const misses = checkSession(
    {
      session: session({field: null, classLaps: null, classBests: null, result: null, traffic: null, weather: ''}),
      laps: [
        lap({traffic: null, tyres: {wearPct: {FL: 93, FR: 93, RL: 93, RR: 93}}}),
        lap({lapNumber: 2, timed: false, traffic: null, tyres: {wearPct: {FL: 92, FR: 92, RL: 92, RR: 92}}}),
      ],
    },
    {otherCars: 5},
  );
  for (const feature of ['other cars', 'class laps', 'class bests', 'result', 'traffic', 'weather', 'tyres', 'lap time'])
    assert.ok(misses.some(m => m.startsWith(`${feature}:`)), `${feature} in ${misses}`);
});

test('a whole lap the game invalidated is not a miss; a cut or pit lap is never asked for a time', () => {
  const laps = [
    lap({timed: false, invalid: true}),
    lap({lapNumber: 2, timed: false, partial: true}),
    lap({lapNumber: 3, timed: false, pitOut: true}),
  ];
  assert.deepEqual(checkSession({session: session(), laps}, {otherCars: 1}), []);
});

const pairDir = process.env.PARITY_PAIR;
test(
  'the golden pair: the capture path and the game-file path agree, and both are complete',
  {skip: pairDir ? false : 'PARITY_PAIR not set (CI contract-replay sets it)'},
  async () => {
    const pair = await buildPair(pairDir);
    const r = judge(pair);
    assert.deepEqual(r.failures, [], 'differences outside parityAllow.json');
    assert.deepEqual(checkSession(pair.capture, {otherCars: pair.otherCars}), [], 'capture path');
    assert.deepEqual(checkSession(pair.game, {otherCars: pair.otherCars}), [], 'game-file path');
  },
);
