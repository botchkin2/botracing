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
    // Filled in once the stint's median is known.
    lapsLeftAtEntry: {fuel: null, ve: null},
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

/**
 * The fill limit and physical tank from the recording's CarSetup JSON.
 *
 * VM_FUEL_LEVEL.stringValue is the fill limit in litres divided by 100, not a
 * fraction of the tank (camber and apex, thread 34 #983/#986): the Proton at
 * Silverstone has stringValue 0.89 and maxValue 115 and started at 89.0 L, so
 * a fraction of the tank would say 102 L; the Manthey at Daytona has 1.00 and
 * maxValue 117 and started at 100 L, not 117. VE 100 % is that full load.
 * maxValue is the tank in litres when the event allows it, else the limit
 * itself (75 at Road Atlanta). Both are null when the setup is missing or
 * empty (the 2026-09-29 Daytona Manthey files).
 *
 * Every recording in the Telemetry folder is a GT3 (468 files, one class),
 * so a Hypercar or an LMP2 is unchecked: if one shows a start fuel that is
 * not stringValue x 100, this is the place to look.
 */
export function fuelSetup(setupJson) {
  let level = null;
  try {
    level = JSON.parse(setupJson)?.VM_FUEL_LEVEL ?? null;
  } catch {
    // No usable setup: both stay null.
  }
  const fraction = parseFloat(level?.stringValue);
  const tank = Number(level?.maxValue);
  return {
    fillLimitL:
      Number.isFinite(fraction) && fraction > 0
        ? round(fraction * 100, 1)
        : null,
    tankL: Number.isFinite(tank) && tank > 0 ? tank : null,
  };
}
