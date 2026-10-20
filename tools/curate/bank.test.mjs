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
const BIASES = [0, 0.2, -0.2, 0.1, -0.1, 0]; // six laps that agree to well under 1.5 degrees
const laps = (len, rollAt, opts = i => ({bias: BIASES[i]}), count = 6) => Array.from({length: count}, (_, i) => lap(len, rollAt, opts(i)));

test('the median roll is placed on the map length by lap fraction', () => {
  const built = bankFromLaps(laps(200, bankedAtEnd), 100);
  assert.deepEqual(built.refusals, []);
  assert.equal(built.bank.stepM, 5);
  assert.equal(built.bank.rollDeg.length, 21);
  assert.equal(built.bank.rollDeg[0], 0);
  assert.equal(built.bank.rollDeg[10], 0);
  assert.equal(built.bank.rollDeg[20], 4);
  assert.match(built.bank.source, /mOri/);
});

test('samples the car was not settled for (pit lane, slow, off asphalt) are left out of the median', () => {
  const kerbed = lap(200, () => 30, {okAt: () => false});
  const built = bankFromLaps([...laps(200, bankedAtEnd), kerbed], 100);
  assert.deepEqual(built.refusals, []);
  assert.equal(built.bank.rollDeg[19], 4);
});

test('a short lap is left out of the median', () => {
  const built = bankFromLaps([...laps(100, () => 2), lap(50, () => 40)], 100);
  assert.deepEqual(built.refusals, []);
  assert.equal(built.stats.dropped, 1);
  assert.equal(built.bank.rollDeg[10], 2);
});

test('fewer than three laps is refused', () => {
  const built = bankFromLaps([lap(100, () => 1), lap(100, () => 1)], 100);
  assert.equal(built.bank, null);
  assert.match(built.refusals.join(' '), /3 are needed/);
});

test('a step needs at least five laps and half the kept laps: with too few laps every step is unmeasured and the bank is refused', () => {
  const built = bankFromLaps(laps(100, () => 1, () => ({}), 4), 100);
  assert.equal(built.bank, null);
  assert.match(built.refusals.join(' '), /fewer than 5 clean laps/);
  // thirty laps need fifteen at a step
  const thirty = laps(100, () => 1, () => ({}), 30);
  assert.equal(bankFromLaps(thirty, 100).stats.stepsNeed, 15);
});

test('laps that disagree at every step (over 1.5 degrees, p10 to p90) leave nothing measured and the bank is refused', () => {
  const built = bankFromLaps(laps(100, () => 0, i => ({bias: [-4, 4][i % 2]})), 100);
  assert.equal(built.bank, null);
  assert.match(built.refusals.join(' '), /disagree by over 1.5 deg/);
});

test('one noisy step is filled from its neighbours, not drawn as a tilt', () => {
  // 1000 m map: six laps agree on a 2 degree bank everywhere except 10 m (1%), where the even laps read +6 and the odd -2
  const inNoise = f => f >= 0.5 && f < 0.51;
  const built = bankFromLaps(
    BIASES.map((bias, i) => lap(1000, f => (inNoise(f) ? (i % 2 === 0 ? 6 : -2) : 2), {bias})),
    1000,
  );
  assert.deepEqual(built.refusals, []);
  assert.ok(built.stats.stepsTooNoisy >= 1, 'the noisy step was counted');
  assert.ok(Math.abs(built.bank.rollDeg[100] - 2) < 0.3, `the step took its neighbours' 2 degrees, not the median of the noise (${built.bank.rollDeg[100]})`);
});

test('a step with too few clean laps is filled, and said so', () => {
  // four of six laps are off asphalt for 10 m of a 1000 m lap: two laps are fewer than the five a step needs
  const off = f => !(f >= 0.3 && f < 0.31);
  const built = bankFromLaps(laps(1000, () => 1, i => ({bias: BIASES[i], okAt: i < 4 ? off : () => true})), 1000);
  assert.deepEqual(built.refusals, []);
  assert.ok(built.stats.stepsTooFew >= 1);
  assert.ok(Math.abs(built.bank.rollDeg[60] - 1) < 0.3);
});

test('a long stretch no lap measured is refused, a short gap is filled from its neighbours', () => {
  const gap = (from, to) => f => !(f >= from && f < to);
  const refused = bankFromLaps(laps(200, f => f * 10, i => ({okAt: gap(0.3, 0.6)})), 100);
  assert.equal(refused.bank, null);
  assert.match(refused.refusals.join(' '), /fewer than 5 clean laps/);

  const built = bankFromLaps(laps(200, f => f * 10, i => ({okAt: gap(0.5, 0.52)})), 100);
  assert.deepEqual(built.refusals, []);
  assert.ok(Math.abs(built.bank.rollDeg[10] - 5) < 0.3);
});

test('a gap longer than 100 m is refused even when it is a small share of a long lap', () => {
  const gap = f => !(f >= 0.4 && f < 0.43); // 3% of 5,000 m is 150 m
  const built = bankFromLaps(laps(5000, () => 1, () => ({okAt: gap})), 5000);
  assert.equal(built.bank, null);
  assert.match(built.refusals.join(' '), /more than 100 m/);
});

test('no map length or no laps is refused', () => {
  assert.match(bankFromLaps([lap(100, () => 0)], 0).refusals.join(' '), /no lap length/);
  assert.match(bankFromLaps([], 100).refusals.join(' '), /no laps/);
});

const mapped = {catalogRev: 3, track: {lengthM: 100, corners: [{n: 1}]}};

test('a bank plan sets only the bank on a curated map and says what it holds, with its extremes and how many laps stand behind them', () => {
  const built = bankFromLaps(laps(200, bankedAtEnd), 100);
  const plan = planBank({trackId: 'lmu-x', current: mapped, built, blast: {sessions: 2}});
  assert.deepEqual(plan.refusals, []);
  assert.deepEqual(Object.keys(plan.set), ['bank']);
  assert.equal(plan.newRev, 4);
  const text = renderPlan(plan).join(' | ');
  assert.match(text, /ADD BANK to lmu-x/);
  assert.match(text, /21 rolls, step 5 m, 6 laps/);
  assert.match(text, /lowest -?\d\.?\d* deg at \d+ m \(6 laps, p10-p90 [\d.]+ deg\), highest 4 deg at \d+ m \(6 laps/);
  assert.match(summaryOf(plan), /^bank: .*mOri roll/);
});

test('a bank plan is refused for a track with no curated map, and carries the build refusals', () => {
  const built = bankFromLaps([lap(100, () => 1)], 100);
  const plan = planBank({trackId: 'lmu-x', current: {catalogRev: 0, track: null}, built, blast: null});
  assert.deepEqual(plan.set, {});
  assert.match(plan.refusals.join(' '), /no curated map/);
  assert.match(plan.refusals.join(' '), /3 are needed/);
});
