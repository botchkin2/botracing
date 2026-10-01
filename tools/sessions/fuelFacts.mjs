// Fuel and Virtual Energy per lap, per pit stop and per stint (roadmap E4).
// Pure functions over the sample arrays, so they are tested without a game.
//
// What the recordings show (audit, pit-wall thread 34; the six races with a
// stop and ~110 GT3 files since 2026-08): `Fuel Level` (L) and `Virtual
// Energy` (%) are 20 Hz channels in every file. Both only fall on track and
// only rise inside an `In Pits` window, as a ramp of about 3.4 L/s. So a
// lap's use is start minus end plus what was added in the pits, and a stop's
// "added" is the rise across its pit window. The two are separate budgets:
// VE per litre differs by car and track (1.0 to 1.5 %/L), so neither is
// derived from the other.
//
// Values are read at the lap's first and last tick, straight between the two
// nearest 20 Hz samples: at most one 20 Hz step from a recorded value, about
// 0.003 L driving and 0.2 L while refuelling.

// A pit window that starts within this long of the recording's start is the
// drive off the grid or out of the garage, not a stop (Daytona 09-29: 7 to
// 11 s, no service).
export const SESSION_START_S = 30;
// A stint's median needs at least this many green laps; fewer gives none,
// never a borrowed session median (apex, thread 34 #958).
export const MIN_GREEN_LAPS = 3;

const round = (v, d) => {
  if (v == null || !Number.isFinite(v)) return null;
  const p = 10 ** d;
  return Math.round(v * p) / p;
};

function firstIndexAtOrAfter(times, t) {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// The rise of a series across [i0, i1] ticks that falls inside a pit window:
// the sum of positive steps at ticks whose time is in [a, b].
function addedInPits(values, times, i0, i1, pits) {
  let added = 0;
  for (const [a, b] of pits) {
    const from = Math.max(i0 + 1, firstIndexAtOrAfter(times, a));
    for (let i = from; i <= i1 && times[i] <= b; i++) {
      const d = values[i] - values[i - 1];
      if (d > 0) added += d;
    }
  }
  return added;
}

/**
 * One lap's fuel and VE. s: {t, fuel_l, virtual_energy_pct} (either channel
 * may be missing: that part is null); [i0, i1] the lap's ticks; pits the
 * recording's pit windows as [enter, leave] times (leave may be Infinity).
 */
export function lapFuel(s, i0, i1, pits) {
  const one = (values, digits) => {
    if (!values) return null;
    const start = values[i0];
    const end = values[i1];
    if (![start, end].every(Number.isFinite)) return null;
    const added = addedInPits(values, s.t, i0, i1, pits);
    return {
      start: round(start, digits),
      end: round(end, digits),
      added: round(added, digits),
      used: round(start - end + added, digits),
    };
  };
  const fuel = one(s.fuel_l, 2);
  const ve = one(s.virtual_energy_pct, 2);
  if (!fuel && !ve) return null;
  return {
    startL: fuel?.start ?? null,
    endL: fuel?.end ?? null,
    usedL: fuel?.used ?? null,
    addedL: fuel?.added ?? null,
    veStartPct: ve?.start ?? null,
    veEndPct: ve?.end ?? null,
    veUsedPct: ve?.used ?? null,
    veAddedPct: ve?.added ?? null,
    // Filled in once the stint's median is known.
    lapsLeftFuel: null,
    lapsLeftVe: null,
    green: false,
  };
}

// A wheel's wear reading rising by more than this within TYRE_STEP_S is a new
// tyre (pit-wall thread 38, grip #1103: full sets and single wheels alike jump
// to 100, dead-sensor wheels from 0). Real wear only falls, and the session
// start's garage exit steps 100 to 98, a fall. 0.5 sits between the channel's
// float noise (a rise of at most 0.011 inside a pit window) and the smallest
// real change (98.7 to 100, a short stint's tyre, 1.3): across the 516 local
// recordings with wear, 73 positive steps in all, 69 inside a pit window and
// the other 4 the first tick of one recording (thread 44, hairpin #1568).
// It was 5, which missed any tyre swapped after a short run.
export const TYRE_JUMP_PCT = 0.5;
// The wear channel is 10 Hz and the analysis draws a straight line between its
// real samples, so the step is spread over about 0.1 s of ticks (Silverstone
// 09-16: 89.8 to 100 is 1 % a tick), never one tick. Look back this far.
const TYRE_STEP_S = 0.25;
const WHEELS = [
  ['FL', 'tyres_wear_fl'],
  ['FR', 'tyres_wear_fr'],
  ['RL', 'tyres_wear_rl'],
  ['RR', 'tyres_wear_rr'],
];
// The wear reading updates a moment after the pit window opens or closes
// (grip aligned on 1 s either side).
const TYRE_MARGIN_S = 1;

/**
 * Which wheels got a new tyre in the pit window [a, b] (b may be Infinity):
 * those whose wear reading rises by more than TYRE_JUMP_PCT within
 * TYRE_STEP_S inside it. Null when the recording has no wear channel.
 * The compound event is not used: it only fires for a full set.
 */
export function tyreChange(s, a, b) {
  const channels = WHEELS.filter(([, key]) => s[key]);
  if (channels.length === 0) return null;
  const lo = Math.max(1, firstIndexAtOrAfter(s.t, a - TYRE_MARGIN_S));
  const hi = Math.min(
    s.t.length - 1,
    b === Infinity
      ? s.t.length - 1
      : firstIndexAtOrAfter(s.t, b + TYRE_MARGIN_S),
  );
  const wheels = [];
  for (const [name, key] of channels) {
    const wear = s[key];
    let j = lo - 1;
    for (let i = lo; i <= hi; i++) {
      while (s.t[j] < s.t[i] - TYRE_STEP_S) j++;
      if (wear[i] - wear[j] > TYRE_JUMP_PCT) {
        wheels.push(name);
        break;
      }
    }
  }
  return {changed: wheels.length > 0, wheels};
}

/**
 * Per-wheel wear (%) at the time `at`, {FL, FR, RL, RR}; a wheel with no
 * channel or a dead 0 reading is null, and the whole thing null when `at` is
 * not in the recording. The same wheel names as tyreChange.
 */
function wearAt(s, at) {
  const i = firstIndexAtOrAfter(s.t, at);
  if (!Number.isFinite(at) || i >= s.t.length) return null;
  const out = {};
  for (const [name, key] of WHEELS) {
    const v = s[key]?.[i];
    out[name] = Number.isFinite(v) && v > 0 ? round(v, 1) : null;
  }
  return out;
}

/**
 * The pit stop entered during the lap's time window (startT, endT] (its
 * first, if there are two), or null. A window that starts in the first SESSION_START_S of the
 * recording is not a stop. `added` can be 0: a drive-through or a penalty.
 */
export function lapPitStop(s, startT, endT, pits) {
  const t0 = s.t[0];
  const enter = pits.find(
    ([a]) => a - t0 >= SESSION_START_S && a > startT && a <= endT,
  );
  if (!enter) return null;
  const [a, b] = enter;
  const last = s.t.length - 1;
  const from = firstIndexAtOrAfter(s.t, a);
  const to = Math.min(
    last,
    b === Infinity ? last : firstIndexAtOrAfter(s.t, b),
  );
  const at = (values, digits) => (values ? round(values[from], digits) : null);
  const added = (values, digits) =>
    values ? round(addedInPits(values, s.t, from, to, [[a, b]]), digits) : null;
  return {
    atEntry: {
      fuelL: at(s.fuel_l, 2),
      vePct: at(s.virtual_energy_pct, 2),
    },
    added: {
      fuelL: added(s.fuel_l, 2),
      vePct: added(s.virtual_energy_pct, 2),
    },
    inPitS: b === Infinity ? null : round(b - a, 1),
    tyres: pitTyres(s, a, b),
    // Filled in once the stint's median is known.
    lapsLeftAtEntry: {fuel: null, ve: null},
  };
}

/**
 * The stop's tyre facts: tyreChange's `changed` and `wheels`, plus the wear of
 * each wheel at pit entry and at pit exit (`entryPct`, `exitPct`), the same
 * second after the window the change test reads (TYRE_MARGIN_S), so a new
 * tyre shows as exit above entry. `exitPct` is null when the session ended in
 * the pits. Null without a wear channel.
 */
function pitTyres(s, a, b) {
  const change = tyreChange(s, a, b);
  if (!change) return null;
  return {
    ...change,
    entryPct: wearAt(s, a),
    exitPct: b === Infinity ? null : wearAt(s, b + TYRE_MARGIN_S),
  };
}

const median = values => {
  const v = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const stdev = values => {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
};

/**
 * A lap whose use counts as normal running: timed, whole, not the session's
 * first lap (a standing or rolling start burns differently: Road Atlanta
 * 09-26 lap 0 used 0.73 L against 2.4), no pit in or out, no full-course
 * yellow, not cut short by a reset.
 */
export function isGreen(lap) {
  return (
    lap.timed &&
    !lap.partial &&
    !lap.start &&
    !lap.pitIn &&
    !lap.pitOut &&
    !lap.endedInReset &&
    !lap.afterReset &&
    !(lap.courseYellowSec > 0)
  );
}

/**
 * A stint's median use per green lap and its spread (standard deviation),
 * for fuel and VE. Null medians under MIN_GREEN_LAPS laps.
 */
export function stintFuel(stintLaps) {
  const green = stintLaps.filter(l => l.fuel && isGreen(l));
  const enough = green.length >= MIN_GREEN_LAPS;
  const used = key => green.map(l => l.fuel[key]);
  return {
    greenLaps: green.length,
    medianFuelL: enough ? round(median(used('usedL')), 2) : null,
    fuelSpreadL: enough ? round(stdev(used('usedL')), 2) : null,
    medianVePct: enough ? round(median(used('veUsedPct')), 2) : null,
    veSpreadPct: enough ? round(stdev(used('veUsedPct')), 2) : null,
  };
}

/**
 * Marks each lap's `fuel.green` (see isGreen), so a history across sessions
 * counts the same laps as the stint medians (clutch, thread 35 #984).
 * Mutates the laps.
 */
export function markGreen(laps) {
  for (const lap of laps) if (lap.fuel) lap.fuel.green = isGreen(lap);
}

/**
 * Litres of fuel per 1 % of Virtual Energy, the number that turns VE into
 * fuel and back (camber, thread 35 #1004/#1013). It depends on the fill limit
 * (0.68 at 75 L, 0.81 at 84 L, 0.98 at 100 L), is steady within a session
 * (spread 0.02) and is not in the car setup, so it is measured:
 *  - `drive`: the median over green laps of litres used per % VE used, the
 *    one consumption follows;
 *  - `stop`: litres added over % VE added at the pit stops, a cross-check
 *    about 2 % away from the drive value (Road Atlanta 0.694 against 0.678).
 * Either is null without the laps or stops to measure it. Stops that added
 * under 1 % VE are left out: a top-up of a few ticks is all rounding.
 */
export function litresPerVePct(laps) {
  const drive = laps
    .filter(l => l.fuel?.green && l.fuel.usedL > 0 && l.fuel.veUsedPct > 0)
    .map(l => l.fuel.usedL / l.fuel.veUsedPct);
  const stop = laps
    .filter(l => l.pitStop?.added.fuelL > 0 && l.pitStop.added.vePct >= 1)
    .map(l => l.pitStop.added.fuelL / l.pitStop.added.vePct);
  return {
    drive: drive.length ? round(median(drive), 3) : null,
    stop: stop.length ? round(median(stop), 3) : null,
  };
}

/** Laps a level lasts at a median use (whole and part); null without one. */
export function lapsLeft(level, medianUse) {
  if (!Number.isFinite(level) || !medianUse || medianUse <= 0) return null;
  return round(level / medianUse, 1);
}

/**
 * Every lap's laps-left and every stop's laps-left-at-entry, from its own
 * stint's median. Mutates the laps.
 */
export function fillLapsLeft(laps, stintMedians) {
  for (const lap of laps) {
    const m = stintMedians.get(lap.stint);
    if (!m) continue;
    if (lap.fuel) {
      lap.fuel.lapsLeftFuel = lapsLeft(lap.fuel.endL, m.medianFuelL);
      lap.fuel.lapsLeftVe = lapsLeft(lap.fuel.veEndPct, m.medianVePct);
    }
    if (lap.pitStop) {
      lap.pitStop.lapsLeftAtEntry = {
        fuel: lapsLeft(lap.pitStop.atEntry.fuelL, m.medianFuelL),
        ve: lapsLeft(lap.pitStop.atEntry.vePct, m.medianVePct),
      };
    }
  }
}

const LITRES_PER_US_GALLON = 3.785411784;

/**
 * True when a channel is recorded but never leaves 0. An LMP2 still logs
 * Virtual Energy (and SoC, Regen Rate) as a flat 0, which is "this car has
 * none", not "0 % left" (tonight's Daytona LMP2 race, thread 39 #1072). Any
 * other constant, or a NaN, does not count: a GT3 that never left the garage
 * holds a constant VE that is not 0.
 */
export function neverLeavesZero(values) {
  if (!values || values.length === 0) return false;
  for (let i = 0; i < values.length; i++) if (values[i] !== 0) return false;
  return true;
}

/**
 * The fill limit and physical tank from the recording's CarSetup JSON.
 *
 * GT3 form: VM_FUEL_LEVEL.stringValue is a bare number, the fill limit in
 * litres divided by 100, not a fraction of the tank (camber and apex, thread
 * 34 #983/#986): the Proton at Silverstone has stringValue 0.89 and maxValue
 * 115 and started at 89.0 L, so a fraction of the tank would say 102 L; the
 * Manthey at Daytona has 1.00 and maxValue 117 and started at 100 L, not 117.
 * VE 100 % is that full load. maxValue is the tank in litres when the event
 * allows it, else the limit itself (75 at Road Atlanta).
 *
 * LMP2 form (Daytona 2026-09-30, thread 39 #1070): stringValue is gallons and
 * the game's laps estimate, '19.8gal (0.0 laps)' = 74.95 L, and the car
 * started at 75.0 L. maxValue (71) is a slider step count there, not litres,
 * so the tank is unknown.
 *
 * Anything else, or a missing setup, gives null for both; an empty string
 * (the 2026-09-29 Daytona Manthey files) keeps the tank. A Hypercar's string is unchecked.
 */
export function fuelSetup(setupJson) {
  let level = null;
  try {
    level = JSON.parse(setupJson)?.VM_FUEL_LEVEL ?? null;
  } catch {
    // No usable setup: both stay null.
  }
  const text = String(level?.stringValue ?? '').trim();
  const bare = /^\d*\.?\d+$/.test(text) ? parseFloat(text) : NaN;
  const gallons = text.match(/^(\d*\.?\d+)gal(?:\s|$)/)?.[1];
  const tank = Number(level?.maxValue);
  if (bare > 0) {
    return {
      fillLimitL: round(bare * 100, 1),
      tankL: Number.isFinite(tank) && tank > 0 ? tank : null,
    };
  }
  if (gallons !== undefined && parseFloat(gallons) > 0) {
    return {
      fillLimitL: round(parseFloat(gallons) * LITRES_PER_US_GALLON, 1),
      tankL: null,
    };
  }
  // An empty string is a GT3 with no limit recorded: its maxValue is still
  // litres. Any other string is a form nobody has checked.
  return {
    fillLimitL: null,
    tankL: text === '' && Number.isFinite(tank) && tank > 0 ? tank : null,
  };
}
