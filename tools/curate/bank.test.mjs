import assert from 'node:assert/strict';
import test from 'node:test';
import {bankFromLaps} from './bank.mjs';
import {planBank, renderPlan, summaryOf} from './plan.mjs';

// A straight lap of `len` metres sampled every 0.5 m; the roll is a function of the lap fraction.
const lap = (len, rollAt, {bias = 0, okAt = () => true} = {}) => {
  const n = Math.round(len / 0.5) + 1;
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const rollDeg = new Float64Array(n);
  const ok = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    x[i] = f * len;
    rollDeg[i] = rollAt(f) + bias;
    ok[i] = okAt(f) ? 1 : 0;
  }
  return {x, z, rollDeg, ok};
};

const bankedAtEnd = f => (f > 0.8 ? 4 : 0);

test('the median roll is placed on the map length by lap fraction', () => {
  const laps = [0, 0.2, -0.2].map(bias => lap(200, bankedAtEnd, {bias}));
  const built = bankFromLaps(laps, 100);
  assert.deepEqual(built.refusals, []);
  assert.equal(built.bank.stepM, 5);
  assert.equal(built.bank.rollDeg.length, 21);
  assert.equal(built.bank.rollDeg[0], 0);
  assert.equal(built.bank.rollDeg[10], 0);
  assert.equal(built.bank.rollDeg[20], 4);
  assert.match(built.bank.source, /mOri/);
});

test('samples the car was not settled for (pit lane, slow, off asphalt) are left out of the median', () => {
  const clean = [1, 2, 3].map(() => lap(200, bankedAtEnd));
  const kerbed = lap(200, () => 30, {okAt: () => false});
  const built = bankFromLaps([...clean, kerbed], 100);
  assert.deepEqual(built.refusals, []);
  assert.equal(built.bank.rollDeg[19], 4);
});

test('a short lap is left out of the median', () => {
  const laps = [lap(100, () => 2), lap(100, () => 2), lap(100, () => 2), lap(50, () => 40)];
  const built = bankFromLaps(laps, 100);
  assert.deepEqual(built.refusals, []);
  assert.equal(built.stats.dropped, 1);
  assert.equal(built.bank.rollDeg[10], 2);
});

test('fewer than three laps is refused', () => {
  const built = bankFromLaps([lap(100, () => 1), lap(100, () => 1)], 100);
  assert.equal(built.bank, null);
  assert.match(built.refusals.join(' '), /3 are needed/);
});

test('laps that disagree about the roll by more than the spread limit are refused', () => {
  const laps = [-4, 0, 4].map(bias => lap(100, () => 0, {bias}));
  const built = bankFromLaps(laps, 100);
  assert.equal(built.bank, null);
  assert.match(built.refusals.join(' '), /spread/);
});

test('a long stretch no lap measured is refused, a short gap is filled from its neighbours', () => {
  const gap = (from, to) => f => !(f >= from && f < to);
  const long = [1, 2, 3].map(() => lap(200, f => f * 10, {okAt: gap(0.3, 0.6)}));
  const refused = bankFromLaps(long, 100);
  assert.equal(refused.bank, null);
  assert.match(refused.refusals.join(' '), /fewer than 3 clean laps/);

  const short = [1, 2, 3].map(() => lap(200, f => f * 10, {okAt: gap(0.5, 0.52)}));
  const built = bankFromLaps(short, 100);
  assert.deepEqual(built.refusals, []);
  assert.ok(Math.abs(built.bank.rollDeg[10] - 5) < 0.3);
});

test('a gap longer than 100 m is refused even when it is a small share of a long lap', () => {
  const gap = f => !(f >= 0.4 && f < 0.43); // 3% of 5,000 m is 150 m
  const laps = [1, 2, 3].map(() => lap(5000, () => 1, {okAt: gap}));
  const built = bankFromLaps(laps, 5000);
  assert.equal(built.bank, null);
  assert.match(built.refusals.join(' '), /more than 100 m/);
});

test('no map length or no laps is refused', () => {
  assert.match(bankFromLaps([lap(100, () => 0)], 0).refusals.join(' '), /no lap length/);
  assert.match(bankFromLaps([], 100).refusals.join(' '), /no laps/);
});

const mapped = {catalogRev: 3, track: {lengthM: 100, corners: [{n: 1}]}};

test('a bank plan sets only the bank on a curated map and says what it holds', () => {
  const built = bankFromLaps([0, 0.2, -0.2].map(bias => lap(200, bankedAtEnd, {bias})), 100);
  const plan = planBank({trackId: 'lmu-x', current: mapped, built, blast: {sessions: 2}});
  assert.deepEqual(plan.refusals, []);
  assert.deepEqual(Object.keys(plan.set), ['bank']);
  assert.equal(plan.newRev, 4);
  const text = renderPlan(plan).join(' ');
  assert.match(text, /ADD BANK to lmu-x/);
  assert.match(text, /21 rolls, step 5 m, 3 laps/);
  assert.match(summaryOf(plan), /^bank: .*mOri roll/);
});

test('a bank plan is refused for a track with no curated map, and carries the build refusals', () => {
  const built = bankFromLaps([lap(100, () => 1)], 100);
  const plan = planBank({trackId: 'lmu-x', current: {catalogRev: 0, track: null}, built, blast: null});
  assert.deepEqual(plan.set, {});
  assert.match(plan.refusals.join(' '), /no curated map/);
  assert.match(plan.refusals.join(' '), /3 are needed/);
});
