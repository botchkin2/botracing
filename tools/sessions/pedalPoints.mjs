// Brake and full-throttle points taken from recorded samples only.
// Pedals are logged at 50 Hz in a 100 Hz file (measured on 40 archive
// recordings, thread 28). A point is the first real sample at or past the
// threshold, placed at that sample's own distance, with the distance since
// the previous real sample as its resolution. No interpolated crossings.

// Brake 10%: across 16,191 brake-on runs, 96% peak below 2% (rest foot,
// flicker), about 150 peak between 2% and 50%, the rest are real stops.
// 10% sits in that empty valley.
export const BRAKE_ON_PCT = 10;
// One application lasts until the pedal is released below 2%, the rest-foot
// level above. Trail braking often hovers around 10% (Road Atlanta 44-lap
// race, lap 16: 8-11% for 15 m before the apex), and must not split it.
export const BRAKE_RELEASED_PCT = 2;
// Throttle 95%, on the driver's unfiltered pedal: of pedal samples above
// 50%, 87.1% are exactly 100 and 88.4% are at 95 or more, so 95 is "full"
// without counting a part pedal. The filtered throttle is what the car's
// electronics let through: in all 40 recordings sampled it read below 95%
// for about 8% of moving time while the pedal was floored (traction control
// flicking 67/100 on corner exit), which puts a full-throttle point wherever
// the cut happened to pause.
export const FULL_THROTTLE_PCT = 95;

// Ticks in [a, b] where a channel logged at hz gets a new sample in a file
// at baseHz. Sample k starts at tick ceil(k * baseHz / hz), matching how the
// loader lays out held channels.
// before is the sample just ahead of the window (null at the file start), so
// the first point in the window still has a resolution.
export function sampleTicks(hz, baseHz, a, b) {
  const step = baseHz / Math.min(hz, baseHz);
  const ticks = [];
  let before = null;
  for (let k = Math.max(0, Math.floor(a / step) - 1); ; k++) {
    const i = Math.max(0, Math.ceil(k * step - 1e-9));
    if (i > b) break;
    if (i >= a) ticks.push(i);
    else before = i;
  }
  return {ticks, before};
}

function point({ticks, before}, j, distAt) {
  const prev = j > 0 ? ticks[j - 1] : before;
  return {
    atM: distAt(ticks[j]),
    resM: prev == null ? null : distAt(ticks[j]) - distAt(prev),
  };
}

// The first sample at or past 10% in the last brake application of the
// window: walk back from the end until the pedal was released.
export function brakeStart(values, samples, distAt) {
  const {ticks} = samples;
  let found = -1;
  for (let j = ticks.length - 1; j >= 0; j--) {
    const v = values[ticks[j]];
    if (v >= BRAKE_ON_PCT) found = j;
    else if (found >= 0 && v < BRAKE_RELEASED_PCT) break;
  }
  return found < 0 ? null : point(samples, found, distAt);
}

// The first sample at full throttle.
export function fullThrottleStart(values, samples, distAt) {
  const {ticks} = samples;
  for (let j = 0; j < ticks.length; j++) {
    if (values[ticks[j]] >= FULL_THROTTLE_PCT) return point(samples, j, distAt);
  }
  return null;
}
