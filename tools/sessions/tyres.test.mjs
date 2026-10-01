import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {lapTyres, settleHotPressure} from './tyres.mjs';

const HZ = 10;
const N = 2400; // 240 s

// A recording of 240 s at 10 Hz with the four wheels' channels. Wear falls
// slowly; the front right gets a new tyre (wear back to 100) at t = 100 s,
// inside the pit window [95, 110].
function recording(extra = {}) {
  const t = Float64Array.from({length: N}, (_, i) => 1000 + i / HZ);
  const wear = (fromT, jumpAt) =>
    Float64Array.from({length: N}, (_, i) => {
      const sec = i / HZ;
      return sec >= jumpAt ? 100 - (sec - jumpAt) * 0.1 : 100 - sec * 0.1;
    });
  const flat = value => new Float64Array(N).fill(value);
  return {
    t,
    tyres_wear_fl: wear(0, Infinity),
    tyres_wear_fr: wear(0, 100),
    tyres_wear_rl: wear(0, Infinity),
    tyres_wear_rr: wear(0, Infinity),
    // Hot pressure 160, but 130 while in the pit lane (the stop cools it).
    tyres_pressure_fl: Float64Array.from({length: N}, (_, i) =>
      i / HZ >= 95 && i / HZ <= 110 ? 130 : 160,
    ),
    tyres_pressure_fr: flat(161),
    tyres_pressure_rl: flat(0), // a dead sensor
    tyres_pressure_rr: flat(162),
    tyres_rubber_temp_fl: flat(80),
    tyres_rubber_temp_fr: flat(81),
    tyres_rubber_temp_rl: flat(82),
    tyres_rubber_temp_rr: flat(83),
    tyres_carcass_temp_fl: flat(70),
    tyres_carcass_temp_fr: flat(71),
    tyres_carcass_temp_rl: flat(72),
    tyres_carcass_temp_rr: flat(73),
    ...extra,
  };
}

const pits = [[1095, 1110]];
// The lap that the pit exit (t = 1110, tick 1100) falls in: 1060..1120 s.
const lapOfExit = {i0: 600, i1: 1199, seg: {start: 1060, end: 1120}};
const lapBefore = {i0: 0, i1: 599, seg: {start: 1000, end: 1060}};

const tyres = (s, lap, window = pits) =>
  lapTyres(s, lap.i0, lap.i1, lap.seg, window, 1);

describe('lapTyres', () => {
  it('reads wear at the end of the lap, per wheel, in {FL, FR, RL, RR}', () => {
    const t = tyres(recording(), lapBefore);
    assert.deepEqual(Object.keys(t.wearPct), ['FL', 'FR', 'RL', 'RR']);
    // 59.9 s into the recording: 100 - 5.99 = 94.0.
    assert.equal(t.wearPct.FL, 94);
    assert.equal(t.v, 1);
  });

  it('takes the lap median of pressure, outside the pit lane, dead zeros out', () => {
    const t = tyres(recording(), lapOfExit);
    // FL reads 130 only inside the pit window, which is left out.
    assert.equal(t.pressureKpa.FL, 160);
    assert.equal(t.pressureKpa.FR, 161);
    // A wheel that only ever reads 0 is a dead sensor: null, never 0.
    assert.equal(t.pressureKpa.RL, null);
    assert.equal(t.rubberC.RR, 83);
    assert.equal(t.carcassC.FL, 70);
  });

  it('reads the stabilised hot pressure at the lap end, outside the pit lane, dead zeros out', () => {
    const s = recording({
      // Pressure climbs 1 kPa every 6 s: 160 at the start.
      tyres_pressure_fr: Float64Array.from({length: N}, (_, i) => 160 + i / 60),
    });
    const t = tyres(s, lapBefore);
    // The lap's last tick is 59.9 s in: 160 + 599 / 60.
    assert.equal(t.hotPressureKpa.FR, 170);
    assert.equal(t.hotPressureKpa.FL, 160);
    assert.equal(t.hotPressureKpa.RL, null);
    // A lap that ends in the pit lane has no reading to take.
    assert.equal(tyres(s, lapOfExit, [[1100, 1130]]).hotPressureKpa.FR, null);
  });

  it('settleHotPressure keeps it from the third lap of a stint and nulls it before', () => {
    const laps = [0, 1, 2, 3].map(stintLap => ({
      stintLap,
      tyres: tyres(recording(), lapBefore),
    }));
    settleHotPressure(laps);
    assert.deepEqual(
      laps.map(l => l.tyres.hotPressureKpa?.FR ?? null),
      [null, null, 161, 161],
    );
    // A lap with no tyre block is left alone.
    assert.doesNotThrow(() => settleHotPressure([{stintLap: 0, tyres: null}]));
  });

  it('names the wheels changed in the stop that ended during the lap', () => {
    assert.deepEqual(tyres(recording(), lapOfExit).changed, ['FR']);
    // The lap before has no stop ending in it.
    assert.deepEqual(tyres(recording(), lapBefore).changed, []);
  });

  it('skips a pit window in the first 30 s of the recording (the garage exit)', () => {
    const s = recording();
    const t = lapTyres(s, 0, 599, {start: 1000, end: 1060}, [[1005, 1020]], 1);
    assert.deepEqual(t.changed, []);
  });

  it('puts a stop that never ends in the lap it was entered in', () => {
    const t = lapTyres(
      recording(),
      600,
      1199,
      {start: 1060, end: 1120},
      [[1095, Infinity]],
      1,
    );
    assert.deepEqual(t.changed, ['FR']);
  });

  it('leaves a wheel null when only its channel is missing, a field null when none exists', () => {
    const s = recording();
    delete s.tyres_pressure_fr;
    for (const w of ['fl', 'fr', 'rl', 'rr'])
      delete s[`tyres_rubber_temp_${w}`];
    const t = tyres(s, lapOfExit);
    assert.equal(t.pressureKpa.FR, null);
    assert.equal(t.pressureKpa.FL, 160);
    assert.equal(t.rubberC, null);
  });

  it('has no changed list without a wear channel, and nothing without any channel', () => {
    const s = recording();
    for (const w of ['fl', 'fr', 'rl', 'rr']) delete s[`tyres_wear_${w}`];
    assert.equal(tyres(s, lapOfExit).changed, null);
    const bare = {t: s.t};
    assert.equal(tyres(bare, lapOfExit), null);
  });
});
