// A synthetic recording of one lap, for the tests of the corner windows and the
// layout's boundaries: the track map it runs on and a lap through it.
// A synthetic lap of 2,000 m at 100 Hz through two corners, driven at a steady
// 50 m/s except in the corners: brake from `brakeAt` for 60 m, then 20 m/s
// through the corner, then back on the throttle. Corner 1 turns in at 700 m
// (exit 820), corner 2 at 1500 m (exit 1620).
export const LENGTH_M = 2000;
export const map = {
  lengthM: LENGTH_M,
  corners: [
    {
      n: 1,
      entryM: 650,
      turnInM: 700,
      apexM: 760,
      exitM: 820,
      parts: [
        {
          n: 1,
          entryM: 650,
          turnInM: 700,
          apexM: 760,
          exitM: 820,
          minSpeedKmh: 72,
        },
      ],
    },
    {
      n: 2,
      entryM: 1450,
      turnInM: 1500,
      apexM: 1560,
      exitM: 1620,
      parts: [
        {
          n: 2,
          entryM: 1450,
          turnInM: 1500,
          apexM: 1560,
          exitM: 1620,
          minSpeedKmh: 72,
        },
      ],
    },
  ],
};

export function makeLap(brake1, brake2, {pitFrom = null} = {}) {
  const speedAt = d => {
    for (const [from, to] of [
      [700, 820],
      [1500, 1620],
    ]) {
      if (d >= from && d < to) return 20;
    }
    return 50;
  };
  const t = [];
  const dist = [];
  const speed = [];
  const brake = [];
  const throttle = [];
  let d = 0;
  let time = 1000;
  while (d < LENGTH_M) {
    t.push(time);
    dist.push(d);
    speed.push(speedAt(d) * 3.6);
    const braking = [brake1, brake2].some(
      b => b != null && d >= b && d < b + 60,
    );
    brake.push(braking ? 80 : 0);
    const inCorner = (d >= 700 && d < 800) || (d >= 1500 && d < 1600);
    throttle.push(braking || inCorner ? 20 : 100);
    d += speedAt(d) / 100;
    time += 0.01;
  }
  const n = t.length;
  const rec = {
    s: {
      t: Float64Array.from(t),
      speed_kmh: Float64Array.from(speed),
      brake_pct: Float64Array.from(brake),
      throttle_pct: Float64Array.from(throttle),
    },
    hz: {brake_pct: 100, throttle_pct: 100},
    baseHz: 100,
  };
  // The 5 m grid the analysis keeps.
  const gridN = Math.floor(LENGTH_M / 5) + 1;
  const grid = {
    time: new Float64Array(gridN),
    speed: new Float64Array(gridN),
    brake: new Float64Array(gridN),
    throttle: new Float64Array(gridN),
  };
  let j = 0;
  for (let g = 0; g < gridN; g++) {
    while (j < n - 2 && dist[j + 1] < g * 5) j++;
    grid.time[g] = t[j] - t[0];
    grid.speed[g] = speed[j];
    grid.brake[g] = brake[j];
    grid.throttle[g] = throttle[j];
  }
  const lap = {
    grid,
    dist,
    i0: 0,
    i1: n - 1,
    distanceM: LENGTH_M,
    lapTime: t[n - 1] - t[0],
    off: new Uint8Array(n),
    comparable: true,
    clean: true,
    courseYellowSec: 0,
    pitlane: pitFrom != null,
    pitIn: false,
    pitOut: false,
  };
  return {rec, lap};
}
