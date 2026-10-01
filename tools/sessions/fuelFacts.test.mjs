// Run: node --test tools/sessions/fuelFacts.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  MIN_GREEN_LAPS,
  fillLapsLeft,
  fuelSetup,
  neverLeavesZero,
  isGreen,
  lapFuel,
  litresPerVePct,
  markGreen,
  lapPitStop,
  tyreChange,
  lapsLeft,
  stintFuel,
} from './fuelFacts.mjs';

// A recording at 10 Hz for 400 s. Fuel falls 0.05 L/s (3 L a minute); between
// 200 s and 220 s the car is in the pits and takes on 2 L/s for 10 s (+20 L).
// VE falls 0.06 %/s and is refilled at 3 %/s in the same window (+30 %).
function recording({stopAt = 200, service = true} = {}) {
  const n = 4001;
  const t = Float64Array.from({length: n}, (_, i) => i / 10);
  const fuel = new Float64Array(n);
  const ve = new Float64Array(n);
  let f = 80;
  let v = 100;
  for (let i = 0; i < n; i++) {
    const inPit = t[i] >= stopAt && t[i] <= stopAt + 20;
    const filling = service && t[i] > stopAt + 5 && t[i] <= stopAt + 15;
    if (i > 0) {
      if (!inPit) {
        f -= 0.005;
        v -= 0.006;
      }
      if (filling) {
        f += 0.2;
        v += 0.3;
      }
    }
    fuel[i] = f;
    ve[i] = v;
  }
  return {t, fuel_l: fuel, virtual_energy_pct: ve};
}
const pits = [[200, 220]];
const tick = (_s, sec) => Math.round(sec * 10);

test('a steady lap: used is start minus end, nothing added', () => {
  const s = recording();
  const lap = lapFuel(s, tick(s, 0), tick(s, 100), pits);
  assert.equal(lap.usedL, 5);
  assert.equal(lap.addedL, 0);
  assert.equal(lap.veUsedPct, 6);
  assert.equal(lap.startL, 80);
  assert.equal(lap.endL, 75);
});

test('a lap with a stop adds the refuel back instead of reading negative', () => {
  const s = recording();
  const lap = lapFuel(s, tick(s, 150), tick(s, 300), pits);
  // 150 s of driving at 0.05 L/s is 7.5 L; the stop adds 20 L.
  assert.equal(lap.addedL, 20);
  assert.equal(lap.veAddedPct, 30);
  // Driving 50 s before the stop and 80 s after: 130 s at 0.05 L/s is 6.5 L,
  // not the -13.5 L the raw start minus end would read.
  assert.ok(Math.abs(lap.usedL - 6.5) < 0.02, `usedL ${lap.usedL}`);
  assert.ok(Math.abs(lap.veUsedPct - 7.8) < 0.02, `veUsedPct ${lap.veUsedPct}`);
  assert.ok(lap.startL - lap.endL < 0);
});

test('missing channels give nulls, not zeros', () => {
  const s = recording();
  const onlyFuel = lapFuel({t: s.t, fuel_l: s.fuel_l}, 0, 1000, pits);
  assert.equal(onlyFuel.veUsedPct, null);
  assert.equal(onlyFuel.usedL, 5);
  assert.equal(lapFuel({t: s.t}, 0, 1000, pits), null);
});

test('a stop: fuel and VE at entry, what was added, how long in the pits', () => {
  const s = recording();
  const stop = lapPitStop(s, 150, 300, pits);
  // 200 s of driving at 0.05 L/s from 80 L, and 100 % at 0.06 %/s.
  assert.ok(
    Math.abs(stop.atEntry.fuelL - 70) < 0.02,
    `fuel ${stop.atEntry.fuelL}`,
  );
  assert.ok(
    Math.abs(stop.atEntry.vePct - 88) < 0.02,
    `ve ${stop.atEntry.vePct}`,
  );
  assert.equal(stop.added.fuelL, 20);
  assert.equal(stop.added.vePct, 30);
  assert.equal(stop.inPitS, 20);
});

test('a lap without a pit entry has no stop', () => {
  const s = recording();
  assert.equal(lapPitStop(s, 0, 100, pits), null);
});

test('a pit window in the first 30 s is the drive off the grid, not a stop', () => {
  const s = recording();
  assert.equal(lapPitStop(s, 0, 100, [[7, 11]]), null);
});

test('a stop with no service has added 0: a drive-through or a penalty', () => {
  const s = recording({service: false});
  const stop = lapPitStop(s, 150, 300, pits);
  assert.equal(stop.added.fuelL, 0);
  assert.equal(stop.added.vePct, 0);
});

test('a stop still in progress when the recording ends has no duration', () => {
  const s = recording();
  const stop = lapPitStop(s, 150, 300, [[200, Infinity]]);
  assert.equal(stop.inPitS, null);
});

const lap = (over = {}) => ({
  timed: true,
  partial: false,
  start: false,
  pitIn: false,
  pitOut: false,
  endedInReset: false,
  afterReset: false,
  courseYellowSec: 0,
  ...over,
});

test('green laps: timed, whole, not the first lap, no pit in or out, no full-course yellow, no reset', () => {
  assert.equal(isGreen(lap()), true);
  for (const bad of [
    {timed: false},
    {partial: true},
    {start: true},
    {pitIn: true},
    {pitOut: true},
    {endedInReset: true},
    {afterReset: true},
    {courseYellowSec: 12},
  ]) {
    assert.equal(isGreen(lap(bad)), false, JSON.stringify(bad));
  }
});

const withFuel = (usedL, veUsedPct, over = {}) =>
  lap({fuel: {usedL, veUsedPct}, ...over});

test('a stint median needs 3 green laps; fewer gives none, never a borrowed one', () => {
  assert.equal(MIN_GREEN_LAPS, 3);
  const two = stintFuel([withFuel(7.6, 9.3), withFuel(7.7, 9.4)]);
  assert.equal(two.greenLaps, 2);
  assert.equal(two.medianFuelL, null);
  assert.equal(two.medianVePct, null);
  const three = stintFuel([
    withFuel(7.6, 9.3),
    withFuel(7.7, 9.4),
    withFuel(7.5, 9.2),
    withFuel(20, 30, {pitIn: true}), // not green: left out
  ]);
  assert.equal(three.greenLaps, 3);
  assert.equal(three.medianFuelL, 7.6);
  assert.equal(three.medianVePct, 9.3);
  assert.equal(three.fuelSpreadL, 0.1);
});

test("laps left at the median, per lap and per stop, from the lap's own stint", () => {
  const laps = [
    {stint: 1, fuel: {endL: 38, veEndPct: 46.5}, pitStop: null},
    {
      stint: 1,
      fuel: {endL: 7.6, veEndPct: 9.3},
      pitStop: {atEntry: {fuelL: 2.1, vePct: 4}},
    },
    // A stint with no median: nothing shown.
    {stint: 2, fuel: {endL: 60, veEndPct: 90}, pitStop: null},
  ];
  fillLapsLeft(
    laps,
    new Map([
      [1, {medianFuelL: 7.6, medianVePct: 9.3}],
      [2, {medianFuelL: null, medianVePct: null}],
    ]),
  );
  assert.equal(laps[0].fuel.lapsLeftFuel, 5);
  assert.equal(laps[0].fuel.lapsLeftVe, 5);
  assert.equal(laps[1].pitStop.lapsLeftAtEntry.fuel, 0.3);
  assert.equal(laps[1].pitStop.lapsLeftAtEntry.ve, 0.4);
  assert.equal(laps[2].fuel.lapsLeftFuel, null);
  assert.equal(lapsLeft(10, 0), null);
  assert.equal(lapsLeft(NaN, 3), null);
});

test('the fill limit and tank come from the CarSetup, null when it is empty', () => {
  const setup = level => JSON.stringify({VM_FUEL_LEVEL: level});
  // Road Atlanta: the event caps the fill at the tank (real setup, 2026-09-26).
  assert.deepEqual(fuelSetup(setup({stringValue: '0.75', maxValue: 75})), {
    fillLimitL: 75,
    tankL: 75,
  });
  // Silverstone, the Proton (start fuel 89.0 L): a 115 L tank, 89 L to fill.
  // A fraction of the tank would say 102 L.
  assert.deepEqual(fuelSetup(setup({stringValue: '0.89', maxValue: 115})), {
    fillLimitL: 89,
    tankL: 115,
  });
  // Daytona, the Manthey (start fuel 100 L): a 117 L tank, 100 L to fill.
  assert.deepEqual(fuelSetup(setup({stringValue: '1.00', maxValue: 117})), {
    fillLimitL: 100,
    tankL: 117,
  });
  // Sarthe: 84 L to fill, a 117 L tank.
  assert.deepEqual(fuelSetup(setup({stringValue: '0.84', maxValue: 117})), {
    fillLimitL: 84,
    tankL: 117,
  });
  // The 2026-09-29 Daytona Manthey files: empty strings.
  assert.deepEqual(fuelSetup(setup({stringValue: '', maxValue: 117})), {
    fillLimitL: null,
    tankL: 117,
  });
  // Daytona LMP2 (2026-09-30, start fuel 75.0 L): gallons, and maxValue 71 is a
  // slider step count. 1980 L and a 71 L tank would be wrong.
  assert.deepEqual(
    fuelSetup(setup({stringValue: '19.8gal (0.0 laps)', maxValue: 71})),
    {fillLimitL: 75, tankL: null},
  );
  assert.deepEqual(fuelSetup(setup({stringValue: 'N/A', maxValue: 1})), {
    fillLimitL: null,
    tankL: null,
  });
  assert.deepEqual(fuelSetup('not json'), {fillLimitL: null, tankL: null});
  assert.deepEqual(fuelSetup(undefined), {fillLimitL: null, tankL: null});
});

test('a channel counts as none only when it never leaves 0', () => {
  assert.equal(neverLeavesZero(new Float64Array([0, 0, 0])), true);
  // An LMP2's Virtual Energy: flat 0 all race.
  assert.equal(neverLeavesZero(new Float64Array(17801)), true);
  // A GT3 that never left the garage: constant, but not 0.
  assert.equal(neverLeavesZero(new Float64Array([100, 100])), false);
  assert.equal(neverLeavesZero(new Float64Array([0, 0.5])), false);
  assert.equal(neverLeavesZero(new Float64Array([0, NaN])), false);
  assert.equal(neverLeavesZero(new Float64Array([])), false);
  assert.equal(neverLeavesZero(undefined), false);
});

test('every lap with fuel says whether its use counts as green', () => {
  const laps = [
    {timed: true, fuel: {green: false}},
    {timed: true, pitIn: true, fuel: {green: true}},
    {timed: true, start: true, fuel: {}},
    {timed: true, courseYellowSec: 4, fuel: {}},
    {timed: true}, // no fuel channels: untouched
  ];
  markGreen(laps);
  assert.deepEqual(
    laps.map(l => l.fuel?.green),
    [true, false, false, false, undefined],
  );
});

test('litres per 1 % VE: the drive median over green laps, and the stops as a cross-check', () => {
  const green = (usedL, veUsedPct) => ({
    timed: true,
    fuel: {green: true, usedL, veUsedPct},
  });
  const laps = [
    green(2.4, 3.6),
    green(2.44, 3.6),
    green(2.36, 3.5),
    // Not green: a pit lap's use is left out.
    {timed: true, fuel: {green: false, usedL: 9, veUsedPct: 30}},
    // A stop: 41.72 L for 60.1 % VE (Road Atlanta 09-26).
    {
      timed: true,
      fuel: {green: false, usedL: 2, veUsedPct: 3},
      pitStop: {added: {fuelL: 41.72, vePct: 60.1}},
    },
    // A stop that added nothing, and one under 1 % VE: left out.
    {timed: true, pitStop: {added: {fuelL: 0, vePct: 0}}},
    {timed: true, pitStop: {added: {fuelL: 0.3, vePct: 0.4}}},
  ];
  const r = litresPerVePct(laps);
  assert.equal(r.drive, 0.674); // median of 0.667, 0.674, 0.678
  assert.equal(r.stop, 0.694);
  assert.deepEqual(litresPerVePct([]), {drive: null, stop: null});
});

// Tyre wear at 100 Hz for 400 s, the way the analysis holds a 10 Hz channel:
// a straight line between real samples, so a step up is spread over 0.1 s of
// ticks (Silverstone 09-16: 89.8 to 100 is about 1 % a tick, not 10).
function wearRecording(steps = [], {wheels = ['fl', 'fr', 'rl', 'rr']} = {}) {
  const n = 40000;
  const s = {t: Float64Array.from({length: n}, (_, i) => i / 100)};
  for (const w of wheels) {
    const wear = new Float64Array(n);
    // Real wear only falls, about 1 % a minute.
    for (let i = 0; i < n; i++) wear[i] = 90 - i / 6000;
    for (const step of steps.filter(x => x.wheel === w)) {
      const at = Math.round(step.at * 100);
      for (let i = at; i < n; i++) {
        const k = Math.min(1, (i - at) / 10);
        wear[i] = step.from + (step.to - step.from) * k;
      }
    }
    s[`tyres_wear_${w}`] = wear;
  }
  return s;
}

test('a full set: every wheel steps up to 100 inside the pit window', () => {
  const s = wearRecording(
    ['fl', 'fr', 'rl', 'rr'].map(wheel => ({
      wheel,
      at: 205,
      from: 88,
      to: 100,
    })),
  );
  assert.deepEqual(tyreChange(s, 200, 220), {
    changed: true,
    wheels: ['FL', 'FR', 'RL', 'RR'],
  });
});

test('a tyre swapped after a short run: 97 to 100 counts, float noise does not', () => {
  // A 3-lap qualifying or splash stint, or a puncture early in a stint: the
  // rise is a few %, which the old 5 % threshold missed (hairpin #1568).
  const short = wearRecording([{wheel: 'fl', at: 205, from: 97, to: 100}]);
  assert.deepEqual(tyreChange(short, 200, 220), {
    changed: true,
    wheels: ['FL'],
  });
  // The channel's float noise inside a pit window is at most 0.011.
  const noise = wearRecording([
    {wheel: 'fl', at: 205, from: 86.583, to: 86.594},
  ]);
  assert.equal(tyreChange(noise, 200, 220).changed, false);
});

test('single wheels: a healthy one replaced alone, and a dead sensor read as 0', () => {
  const healthy = wearRecording([{wheel: 'rl', at: 205, from: 84, to: 100}]);
  assert.deepEqual(tyreChange(healthy, 200, 220), {
    changed: true,
    wheels: ['RL'],
  });
  // Daytona 09-29: FR read 0.0, then 100 at the stop.
  const dead = wearRecording([
    {wheel: 'fr', at: 150, from: 90, to: 0},
    {wheel: 'fr', at: 208, from: 0, to: 100},
  ]);
  assert.deepEqual(tyreChange(dead, 200, 220), {changed: true, wheels: ['FR']});
});

test('no change: wear that only falls, and a fall inside the window', () => {
  assert.deepEqual(tyreChange(wearRecording(), 200, 220), {
    changed: false,
    wheels: [],
  });
  // The garage exit at a session start steps 100 to 98 on all four.
  const fall = wearRecording(
    ['fl', 'fr', 'rl', 'rr'].flatMap(wheel => [
      {wheel, at: 50, from: 88, to: 100},
      {wheel, at: 205, from: 100, to: 98},
    ]),
  );
  assert.equal(tyreChange(fall, 200, 220).changed, false);
});

test('a step just outside the window and its margin is not this stop', () => {
  const s = wearRecording([{wheel: 'fl', at: 300, from: 88, to: 100}]);
  assert.equal(tyreChange(s, 200, 220).changed, false);
  // Within the one second the reading lags the window: counted.
  const lag = wearRecording([{wheel: 'fl', at: 220.5, from: 88, to: 100}]);
  assert.deepEqual(tyreChange(lag, 200, 220), {changed: true, wheels: ['FL']});
});

test('a session that ends in the pits still gets its tyres (Silverstone 06-09)', () => {
  const s = wearRecording([{wheel: 'rl', at: 390, from: 0, to: 100}]);
  assert.deepEqual(tyreChange(s, 380, Infinity), {
    changed: true,
    wheels: ['RL'],
  });
});

test('no wear channel: unknown, not "not changed"', () => {
  const s = wearRecording([], {wheels: []});
  assert.equal(tyreChange(s, 200, 220), null);
  // Some wheels only: judged on those.
  const some = wearRecording([{wheel: 'fl', at: 205, from: 88, to: 100}], {
    wheels: ['fl', 'fr'],
  });
  assert.deepEqual(tyreChange(some, 200, 220), {changed: true, wheels: ['FL']});
});

test('a stop carries its tyres', () => {
  const s = {
    ...recording(),
    ...wearRecording([{wheel: 'fr', at: 205, from: 88, to: 100}]),
  };
  const stop = lapPitStop(s, 150, 300, pits);
  assert.deepEqual(stop.tyres.wheels, ['FR']);
  assert.equal(stop.tyres.changed, true);
  // Wear at entry and at exit: FR steps 88 to 100 at 205 s; the others only fall.
  assert.equal(stop.tyres.entryPct.FR, 86.7);
  assert.equal(stop.tyres.exitPct.FR, 100);
  assert.ok(stop.tyres.exitPct.FL < stop.tyres.entryPct.FL);
  // A session that ends in the pits has no exit reading.
  const ends = lapPitStop(s, 150, 300, [[200, Infinity]]);
  assert.equal(ends.tyres.exitPct, null);
});
