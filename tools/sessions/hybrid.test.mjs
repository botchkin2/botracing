import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  energyKwh,
  hasHybrid,
  HYBRID_VERSION,
  lapHybrid,
  liftAndCoast,
  MIN_COAST_S,
  stintHybrid,
} from './hybrid.mjs';

// 100 Hz, 60 s. The power is built from a list of [fromS, toS, watts].
const HZ = 100;
const N = 6000;
const col = fn => Float64Array.from({length: N}, (_, i) => fn(i / HZ));
const power = spans => t => {
  for (const [a, b, w] of spans) if (t >= a && t < b) return w;
  return 0;
};

function recording(over = {}) {
  return {
    t: col(t => 100 + t),
    // 1.3 kWh battery: 1 % is 0.013 kWh; start at 80 %.
    so_c: col(t => 80 - t * 0.1),
    regen_rate: col(power([])),
    speed_kmh: col(() => 200),
    throttle_pct: col(() => 100),
    brake_pct: col(() => 0),
    ...over,
  };
}

const hzOf = {throttle_pct: HZ, throttle_pos_unfiltered: HZ};
const win = {a: 0, b: N - 1};
const dist = i => i * 0.5;

describe('energyKwh', () => {
  it('integrates watts over time: 50 kW for 36 s is 0.5 kWh deployed', () => {
    const s = recording({regen_rate: col(power([[0, 36, -50_000]]))});
    const e = energyKwh(s, 0, N - 1);
    assert.ok(Math.abs(e.deployKwh - 0.5) < 1e-3);
    assert.equal(e.regenKwh, 0);
    assert.equal(e.peakDeployKw, 50);
  });

  it('keeps regen and deploy apart: positive is regen, negative is deploy', () => {
    const s = recording({
      regen_rate: col(
        power([
          [0, 18, 100_000],
          [20, 30, -40_000],
        ]),
      ),
    });
    const e = energyKwh(s, 0, N - 1);
    assert.ok(Math.abs(e.regenKwh - 0.5) < 1e-3);
    assert.ok(Math.abs(e.deployKwh - (40 * 10) / 3600) < 1e-3);
    assert.equal(e.peakRegenKw, 100);
    assert.equal(e.peakDeployKw, 40);
  });

  it('adds nothing for a sample with no reading', () => {
    const r = col(power([[0, 10, -50_000]]));
    r[200] = NaN;
    const e = energyKwh(recording({regen_rate: r}), 0, N - 1);
    // One 10 ms sample out of 10 s.
    assert.ok(Math.abs(e.deployKwh - (50 * 9.99) / 3600) < 1e-3);
  });
});

describe('hasHybrid', () => {
  it('needs both channels, and one that leaves 0', () => {
    assert.equal(hasHybrid(recording()), true);
    const zero = col(() => 0);
    assert.equal(hasHybrid(recording({so_c: zero, regen_rate: zero})), false);
    assert.equal(hasHybrid({t: col(t => t)}), false);
    const {regen_rate, ...noRegen} = recording();
    assert.equal(hasHybrid(noRegen), false);
  });
});

describe('lapHybrid', () => {
  const s = recording({
    regen_rate: col(
      power([
        [10, 30, -50_000],
        [40, 50, 120_000],
      ]),
    ),
  });

  it('reads SoC at the ends of the lap window and the energy over it', () => {
    const h = lapHybrid(s, hzOf, HZ, 0, N - 1, dist, win);
    assert.equal(h.v, HYBRID_VERSION);
    assert.equal(h.socStartPct, 80);
    assert.equal(h.socEndPct, 74);
    assert.equal(h.peakDeployKw, 50);
    assert.equal(h.peakRegenKw, 120);
    assert.ok(Math.abs(h.deployKwh - (50 * 20) / 3600) < 1e-3);
    assert.ok(Math.abs(h.regenKwh - (120 * 10) / 3600) < 1e-3);
    assert.equal(
      h.netKwh,
      Math.round((h.regenKwh - h.deployKwh) * 1000) / 1000,
    );
  });

  it('tiles: one lap ends at the SoC and the energy the next starts from', () => {
    const mid = 3000;
    const one = lapHybrid(s, hzOf, HZ, 0, mid, dist, {a: 0, b: mid});
    const two = lapHybrid(s, hzOf, HZ, mid, N - 1, dist, {a: mid, b: N - 1});
    assert.equal(one.socEndPct, two.socStartPct);
    const all = lapHybrid(s, hzOf, HZ, 0, N - 1, dist, win);
    assert.ok(Math.abs(one.deployKwh + two.deployKwh - all.deployKwh) < 2e-3);
    assert.ok(Math.abs(one.regenKwh + two.regenKwh - all.regenKwh) < 2e-3);
  });

  it('is null without a hybrid, or without a lap', () => {
    const zero = col(() => 0);
    assert.equal(
      lapHybrid(
        recording({so_c: zero, regen_rate: zero}),
        hzOf,
        HZ,
        0,
        100,
        dist,
        win,
      ),
      null,
    );
    assert.equal(lapHybrid(s, hzOf, HZ, 5, 5, dist, win), null);
    assert.equal(lapHybrid(s, hzOf, HZ, 0, 100, dist, {a: 7, b: 7}), null);
  });

  it('splits the energy by window in the map frame', () => {
    // 0.5 m a tick: tick i is at i / 2 m. Deploy runs t 10-30 s = ticks
    // 1000-3000 = 500-1500 m; regen 40-50 s = 2000-2500 m.
    const sections = {
      windows: [
        {section: null, fromM: 0, toM: 400},
        {section: 1, fromM: 400, toM: 1600},
        {section: 2, fromM: 1600, toM: 3000},
      ],
      mapM: i => i * 0.5,
    };
    const h = lapHybrid(s, hzOf, HZ, 0, N - 1, dist, win, sections);
    const by = Object.fromEntries(
      h.sections.map(x => [x.section ?? 'start', x]),
    );
    assert.equal(by.start.deployKwh, 0);
    assert.ok(Math.abs(by[1].deployKwh - (50 * 20) / 3600) < 1e-3);
    assert.equal(by[1].regenKwh, 0);
    // Net is regen minus deploy: negative where the battery empties, positive where it fills.
    assert.ok(by[1].netKwh < 0 && by[2].netKwh > 0);
    assert.equal(by[1].fromM, 400);
    assert.equal(by[1].toM, 1600);
    assert.equal(by[2].deployKwh, 0);
    assert.ok(Math.abs(by[2].regenKwh - (120 * 10) / 3600) < 1e-3);
    // The window opens at 400 m, tick 800, 8 s in: 80 - 0.1 x 8.
    assert.equal(by[1].socStartPct, 79.2);
    // The windows add up to the lap's energy.
    const sum = h.sections.reduce((a, x) => a + x.deployKwh + x.regenKwh, 0);
    assert.ok(Math.abs(sum - (h.deployKwh + h.regenKwh)) < 3e-3);
  });

  it('leaves out a window the lap never reaches', () => {
    const h = lapHybrid(s, hzOf, HZ, 0, N - 1, dist, win, {
      windows: [{section: 9, fromM: 99_000, toM: 99_500}],
      mapM: i => i * 0.5,
    });
    assert.deepEqual(h.sections, []);
  });
});

describe('liftAndCoast', () => {
  // Full throttle, then lifted for `lift` s with no brake, then a brake
  // application at t = 20 s.
  const run = ({liftFrom = 17, over = {}} = {}) =>
    recording({
      throttle_pct: col(t => (t >= liftFrom && t < 20 ? 0 : 100)),
      brake_pct: col(t => (t >= 20 && t < 23 ? 80 : 0)),
      ...over,
    });
  const read = s => liftAndCoast(s, HZ, HZ, 0, N - 1, dist);

  it('measures the lift before a brake application, in seconds and metres', () => {
    const r = read(run());
    assert.equal(r.count, 1);
    assert.ok(Math.abs(r.events[0].coastS - 3) < 0.02);
    assert.ok(Math.abs(r.events[0].coastM - 3 * 100 * 0.5) < 1);
    assert.equal(r.events[0].fromKmh, 200);
    assert.equal(r.seconds, r.events[0].coastS);
    assert.equal(r.metres, r.events[0].coastM);
  });

  it('counts no coast when the brake follows full throttle at once', () => {
    assert.equal(read(run({liftFrom: 20})).count, 0);
  });

  it('ignores a lift shorter than a pedal change, and a crawl', () => {
    assert.equal(read(run({liftFrom: 19.9})).count, 0);
    // The usual 0.1 to 0.3 s throttle-to-brake change is not a lift ...
    assert.equal(read(run({liftFrom: 19.75})).count, 0);
    // ... and a deliberate one of the floor's length is.
    assert.equal(read(run({liftFrom: 20 - MIN_COAST_S - 0.1})).count, 1);
    assert.equal(read(run({over: {speed_kmh: col(() => 40)}})).count, 0);
  });

  it('does not count a lift with no braking after it', () => {
    const s = recording({
      throttle_pct: col(t => (t >= 17 && t < 20 ? 0 : 100)),
    });
    assert.equal(read(s).count, 0);
  });

  it('counts a trail-braking application once, not each time the pedal wobbles', () => {
    const s = run({
      over: {
        brake_pct: col(t =>
          t >= 20 && t < 23 ? (Math.floor(t * 10) % 2 ? 8 : 40) : 0,
        ),
      },
    });
    assert.equal(read(s).count, 1);
  });

  it('is null without pedal channels, and prefers the unfiltered throttle', () => {
    const {throttle_pct, ...noThrottle} = run();
    assert.equal(read(noThrottle), null);
    // The driver lifts (unfiltered 0) while the electronics still pass 100.
    const s = run({
      over: {
        throttle_pos_unfiltered: col(t => (t >= 17 && t < 20 ? 0 : 100)),
        throttle_pct: col(() => 100),
      },
    });
    assert.equal(read(s).count, 1);
  });
});

describe('stintHybrid', () => {
  const lap = (stintLap, start, end, deploy, regen) => ({
    stintLap,
    hybrid: {
      socStartPct: start,
      socEndPct: end,
      deployKwh: deploy,
      regenKwh: regen,
    },
    green: true,
  });
  const isGreen = l => l.green;

  it('gives the SoC at the ends, the slope per green lap and the totals', () => {
    const laps = [
      lap(0, 80, 70, 1, 0.5),
      lap(1, 70, 60, 1, 0.5),
      lap(2, 60, 50, 1, 0.5),
      lap(3, 50, 40, 1, 0.5),
    ];
    const h = stintHybrid(laps, isGreen);
    assert.equal(h.socStartPct, 80);
    assert.equal(h.socEndPct, 40);
    assert.equal(h.socPerLapPct, -10);
    assert.equal(h.laps, 4);
    assert.equal(h.deployKwh, 4);
    assert.equal(h.regenKwh, 2);
  });

  it('uses the lap number in the stint, so a missing lap does not shift the rest', () => {
    // Stint lap 2 has no hybrid facts: the points are at 0, 1, 3, 4.
    const laps = [
      lap(0, 80, 70, 1, 0.5),
      lap(1, 70, 60, 1, 0.5),
      lap(3, 50, 40, 1, 0.5),
      lap(4, 40, 30, 1, 0.5),
    ];
    assert.equal(stintHybrid(laps, isGreen).socPerLapPct, -10);
  });

  it('has no slope under three green laps, and leaves a non-green lap out of it', () => {
    const a = {...lap(1, 70, 60, 1, 0.5), green: false};
    const h = stintHybrid(
      [lap(0, 80, 70, 1, 0.5), a, lap(2, 60, 50, 1, 0.5)],
      isGreen,
    );
    assert.equal(h.socPerLapPct, null);
    assert.equal(h.greenLaps, 2);
    assert.equal(h.laps, 3);
  });

  it('is null when no lap has a hybrid', () => {
    assert.equal(
      stintHybrid([{hybrid: null}], () => true),
      null,
    );
  });
});
