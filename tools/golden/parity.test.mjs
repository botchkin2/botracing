// The parity gate (docs/SESSION_PIPELINE.md). The rules run everywhere; the
// real pairs (a capture and the game file of the same drive) run where
// PARITY_PAIRS names their folder, which CI's contract-replay job fetches.
import assert from 'node:assert/strict';
import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
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

// PARITY_PAIRS: a folder of pairs, one folder each (see README).
const pairsDir = process.env.PARITY_PAIRS;
const pairs = pairsDir
  ? readdirSync(pairsDir).filter(n => existsSync(join(pairsDir, n, 'catalog.json')))
  : [];
test('the pairs are there when PARITY_PAIRS is set', {skip: !pairsDir && 'PARITY_PAIRS not set'}, () => {
  assert.ok(pairs.length >= 2, `pairs in ${pairsDir}: ${pairs}`);
});
// The entries that explained something, over all the pairs (see the last test).
const usedEntries = new Set();
for (const name of pairs.length ? pairs : ['(none)'])
  test(
    `pair ${name}: the capture path and the game-file path agree, and both are complete`,
    {skip: pairs.length ? false : 'PARITY_PAIRS not set (CI contract-replay sets it)'},
    async () => {
      const pair = await buildPair(join(pairsDir, name));
      const r = judge({...pair, name});
      for (const e of r.used) usedEntries.add(e);
      assert.deepEqual(r.failures, [], 'differences outside parityAllow.json');
      assert.deepEqual(checkSession(pair.capture, {otherCars: pair.otherCars}), [], 'capture path');
      assert.deepEqual(checkSession(pair.game, {otherCars: pair.otherCars}), [], 'game-file path');
    },
  );

// A gap entry says "deleted when fixed"; nothing else notices the fix, and the
// stale entry would hide the next regression. judge() is given the pair's name
// here (a pair-scoped entry could not match without it).
test(
  'every gap and pair entry still explains a difference on some pair (fixed? delete the entry)',
  {skip: pairs.length ? false : 'PARITY_PAIRS not set (CI contract-replay sets it)'},
  () => {
    const unused = loadAllow()
      .filter(e => (e.gap || e.pair) && ![...usedEntries].some(u => u.path === e.path && u.pair === e.pair))
      .map(e => `${e.pair ?? 'all pairs'}: ${e.path}`);
    assert.deepEqual(unused, [], 'entries that matched nothing');
  },
);

test('a section time 5.9 s off is not explained by the edge-scaling gap (one tolerance per unit)', () => {
  const edge = loadAllow().filter(e => e.gap && e.tol != null);
  const bounds = {};
  for (const [unit, field] of [['m', 'onsetM'], ['s', 'segTime'], ['kmh', 'apexSpeedKmh']]) {
    const path = `laps.#.corners.#.${field}`;
    const rules = edge.filter(e => e.re.test(path));
    assert.equal(rules.length, 1, `${unit}: one edge entry for ${field}`);
    bounds[unit] = rules[0].tol;
  }
  assert.ok(bounds.m >= 6 && bounds.s <= 0.3 && bounds.kmh <= 3, JSON.stringify(bounds));
});

test('the manifest refuses an invalid flag on a pit lap', () => {
  const misses = checkSession(
    {session: session(), laps: [lap({timed: false, invalid: true, pitOut: true})]},
    {otherCars: 1},
  );
  assert.ok(misses.some(m => m.startsWith('invalid:')), String(misses));
});

test('a rule can name the last lap, an untimed lap, a pair, and bound two times in seconds', () => {
  const allow = [
    {path: 'laps\.last\.lapTime', tol: 0.02, re: /^laps\.last\.lapTime$/},
    {path: 'laps\.#\.durationSec', when: 'untimed', tol: 2, re: /^laps\.#\.durationSec$/},
    {path: 'laps\.#\.impactMax', pair: 'p1', re: /^laps\.#\.impactMax$/},
    {path: 'session\.startedAt', tolS: 2, re: /^session\.startedAt$/},
  ];
  const run = (capture, game, name = 'p1') =>
    judge({capture: {session: capture.s ?? {}, laps: capture.l}, game: {session: game.s ?? {}, laps: game.l}, name}, allow).failures.map(f => f.path);
  const two = over => [lap({lapNumber: 1, ...over[0]}), lap({lapNumber: 2, ...over[1]})];
  assert.deepEqual(run({l: two([{}, {lapTime: 5.006}])}, {l: two([{}, {lapTime: 4.988}])}), []);
  assert.deepEqual(run({l: two([{lapTime: 5.006}, {}])}, {l: two([{lapTime: 4.988}, {}])}), ['laps.1.lapTime']);
  assert.deepEqual(run({l: two([{timed: false, durationSec: 91}, {}])}, {l: two([{timed: false, durationSec: 89.3}, {}])}), []);
  assert.deepEqual(run({l: two([{durationSec: 91}, {}])}, {l: two([{durationSec: 89.3}, {}])}), ['laps.1.durationSec']);
  assert.deepEqual(run({l: two([{impactMax: 0}, {}])}, {l: two([{impactMax: 1}, {}])}, 'p2'), ['laps.1.impactMax']);
  assert.deepEqual(run({s: {startedAt: '2026-10-03T00:12:27.285Z'}, l: []}, {s: {startedAt: '2026-10-03T00:12:27Z'}, l: []}), []);
  assert.deepEqual(run({s: {startedAt: '2026-10-03T01:12:27Z'}, l: []}, {s: {startedAt: '2026-10-03T00:12:27Z'}, l: []}), ['session.startedAt']);
});
