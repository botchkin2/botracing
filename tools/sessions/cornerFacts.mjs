// One lap through the track's corner windows (pit-wall thread 45, #1590): the
// time in each window and what happened in it. The windows tile the lap from
// the line to the line (src/analysis/cornerBoundaries.ts), so everything stays
// inside this lap and the start straight plus the sections add up to its lap
// time, no wrap and no borrowing from the next lap.
//
// Per section (and per part of a compound one):
//   segTime        the window's time, boundary to the next boundary
//   fromM, toM     the window, in the map's frame (lap fraction times the
//                  track map's length), like every distance the boundaries use
//   runInS, cornerS, exitS   the window's time split at the lap's own onset
//                  (the one the boundary rests on) and where it reaches full
//                  throttle and stays there; they add up to segTime
//   brakeApps      the brake applications in the window, by the corner each is
//                  for (sections only)
//   pit            the lap's pit lane overlaps this window, so only this
//                  window is not comparable, not the whole lap
//   four speeds that tell the story without the trace: onsetSpeedKmh (what
//                  the lap carried into it), the minimum and where (minSpeedPart),
//                  fullThrottleSpeedKmh, and endSpeedKmh (the exit carried down
//                  the straight, which is why the straight belongs to this corner)
//   the pedal and speed facts the map's corners always had (minimum speed,
//   brake point, first full throttle, off-track and local-yellow time)
import {
  brakeApplications,
  fullThrottlePointM,
  splitWindow,
} from '../../src/analysis/cornerBoundaries.ts';
import {brakeStart, fullThrottleStart, sampleTicks} from './pedalPoints.mjs';

export const GRID_M = 5;

function round(value, digits) {
  if (value == null || !Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

/**
 * rec: the loaded recording; lap: the analysis lap (grid, dist, i0, i1);
 * windows: the CornerWindows of the layout (`windowsOf`); sections: the map's
 * sections (their parts carry turn-in, apex and exit); flags: this recording's
 * flag intervals; pits: its pit windows; lengthM: the map's length; onsets:
 * per section, this lap's onset in the map's frame or null.
 * Returns {corners, startStraight}.
 */
export function cornerFacts({
  rec,
  lap,
  windows,
  sections,
  flags,
  pits,
  lengthM,
  onsets,
}) {
  const {grid} = lap;
  const {s} = rec;
  const n = grid.time.length;
  const ratio = lap.distanceM / lengthM;
  const raw = m => m * ratio;
  const atGrid = m => Math.min(n - 1, Math.max(0, Math.round(raw(m) / GRID_M)));
  // The lap's time at a distance of the map's frame; the line is the lap time.
  const timeAt = m =>
    m >= lengthM - 1e-6 ? lap.lapTime : grid.time[atGrid(m)];
  // The first tick at or past a raw lap distance, and a tick's raw distance.
  const tickAt = rawM => {
    let lo = 0;
    let hi = lap.dist.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lap.dist[mid] < rawM) lo = mid + 1;
      else hi = mid;
    }
    return lap.i0 + lo;
  };
  const distAt = i => lap.dist[i - lap.i0];
  const mapAt = i => distAt(i) / ratio;
  const pedal = s.throttle_pos_unfiltered
    ? 'throttle_pos_unfiltered'
    : 'throttle_pct';

  const sectionWindows = windows.filter(w => w.kind === 'section');
  const startWindow = windows.find(w => w.kind === 'start-straight') ?? null;

  // The facts of one window. u: {fromM, toM, turnInM, exitM, apexM} in the
  // map's frame; onsetM: the lap's onset for it; withApps: the section's own
  // CornerWindow, when its brake applications are wanted.
  const unit = (u, onsetM, withApps, parts = []) => {
    const fromTick = tickAt(raw(u.fromM));
    const toTick = u.toM >= lengthM - 1e-6 ? lap.i1 : tickAt(raw(u.toM));
    const turnInTick = tickAt(raw(u.turnInM));
    const exitTick = tickAt(raw(u.exitM));
    // The slowest recorded sample between turn-in and exit (speed is logged
    // at 100 Hz, every tick), at its own distance; then the brake point
    // before it and the first full throttle after it, before the next window.
    let minTick = turnInTick;
    for (let i = turnInTick; i <= exitTick; i++) {
      if (s.speed_kmh[i] < s.speed_kmh[minTick]) minTick = i;
    }
    // Slowest on the window's edge: the car was still slowing at turn-in or
    // already slower at the exit, so the minimum is the boundary's, not the
    // corner's (pitlane #645). The speed at the map's apex is the corner fact
    // that holds either way.
    const minAtEdge = minTick - turnInTick <= 1 || exitTick - minTick <= 1;
    const apexTick = tickAt(raw(u.apexM));
    const brake = brakeStart(
      s.brake_pct,
      sampleTicks(rec.hz.brake_pct, rec.baseHz, lap.i0, exitTick),
      distAt,
      fromTick,
    );
    const pedalSamples = sampleTicks(
      rec.hz[pedal],
      rec.baseHz,
      minTick,
      toTick,
    );
    const full = fullThrottleStart(s[pedal], pedalSamples, distAt);
    // Full already at the first sample of the search, which starts at the
    // slowest sample: on a corner taken flat that is the turn-in edge, so the
    // point is the boundary's, as with minSpeedAtEdge (pitlane #712).
    const fullAtEdge = Boolean(
      full && full.atM === distAt(pedalSamples.ticks[0]),
    );
    // The split point: where full throttle is reached and held (a flick of
    // the pedal does not end the corner), from the slowest sample on.
    const held = fullThrottlePointM(
      {
        distM: pedalSamples.ticks.map(mapAt),
        brakePct: pedalSamples.ticks.map(() => 0),
        throttlePct: pedalSamples.ticks.map(i => s[pedal][i]),
        timeS: pedalSamples.ticks.map(i => s.t[i]),
      },
      {fromM: mapAt(minTick), toM: u.toM},
    );
    const split = splitWindow(timeAt, u, {
      onsetM,
      fullThrottleAtM: held,
    });
    const t0 = s.t[fromTick];
    const t1 = s.t[toTick];
    const speedAt = rawM => round(s.speed_kmh[tickAt(rawM)], 1);
    // The part the slowest sample falls in: the last one that turned in by then.
    const minAtMap = mapAt(minTick);
    const minPart = parts.length
      ? (parts.filter(p => p.turnInM <= minAtMap).pop() ?? parts[0]).n
      : null;
    const f = {
      segTime: round(timeAt(u.toM) - timeAt(u.fromM), 3),
      fromM: round(u.fromM, 1),
      toM: round(u.toM, 1),
      runInS: round(split.runInS, 3),
      cornerS: round(split.cornerS, 3),
      exitS: round(split.exitS, 3),
      onsetM: onsetM == null ? null : round(onsetM, 1),
      onsetSpeedKmh: onsetM == null ? null : speedAt(raw(onsetM)),
      fullThrottleSpeedKmh: held == null ? null : speedAt(raw(held)),
      endSpeedKmh:
        s.speed_kmh[toTick] == null ? null : round(s.speed_kmh[toTick], 1),
      localYellowSec: 0,
      courseYellowSec: 0,
      offTrackSec: 0,
      pit: pits.some(([a, b]) => a <= t1 && b >= t0),
      minSpeedKmh: round(s.speed_kmh[minTick], 1),
      minSpeedAtM: round(distAt(minTick), 1),
      minSpeedPart: minPart,
      minSpeedAtEdge: minAtEdge,
      apexSpeedKmh: round(s.speed_kmh[apexTick], 1),
      brakeAtM: brake && round(brake.atM, 1),
      brakeAtResM: brake?.resM == null ? null : round(brake.resM, 1),
      fullThrottleAtM: full && round(full.atM, 1),
      fullThrottleAtResM: full?.resM == null ? null : round(full.resM, 1),
      fullThrottleAtEdge: fullAtEdge,
    };
    if (withApps) {
      const ticks = sampleTicks(
        rec.hz.brake_pct,
        rec.baseHz,
        fromTick,
        toTick,
      ).ticks;
      f.brakeApps = brakeApplications(
        {
          distM: ticks.map(mapAt),
          brakePct: ticks.map(i => s.brake_pct[i]),
        },
        withApps,
      ).map(a => ({
        onsetM: round(a.onsetM, 1),
        peakPct: round(a.peakPct, 1),
        part: a.part,
      }));
    }
    return f;
  };

  const corners = sectionWindows.map((w, k) => {
    const section = sections[k];
    const first = section.parts?.[0] ?? section;
    const last = section.parts?.[section.parts.length - 1] ?? section;
    const slowest = (section.parts ?? [section]).reduce((a, b) =>
      b.minSpeedKmh < a.minSpeedKmh ? b : a,
    );
    const f = unit(
      {
        fromM: w.fromM,
        toM: w.toM,
        turnInM: first.turnInM,
        exitM: last.exitM,
        apexM: slowest.apexM,
      },
      onsets[k],
      w,
      section.parts ?? [],
    );
    // The same facts for each single corner inside a section, for drilling
    // in: the part windows when it has several, else the section's own.
    if (section.parts) {
      const partWindows = w.parts.length
        ? w.parts
        : [{n: first.n, fromM: w.fromM, toM: w.toM}];
      f.parts = partWindows.map((pw, i) => {
        const part = section.parts[i];
        return unit(
          {
            fromM: pw.fromM,
            toM: pw.toM,
            turnInM: part.turnInM,
            exitM: part.exitM,
            apexM: part.apexM,
          },
          null,
          null,
        );
      });
    }
    return f;
  });

  // The start straight, from the line to the first window: its time and what
  // happened in it, so the windows add up to the lap time.
  const startStraight = startWindow
    ? {
        segTime: round(timeAt(startWindow.toM) - timeAt(0), 3),
        fromM: 0,
        toM: round(startWindow.toM, 1),
        localYellowSec: 0,
        courseYellowSec: 0,
        offTrackSec: 0,
        pit: pits.some(
          ([a, b]) =>
            a <= s.t[tickAt(raw(startWindow.toM))] && b >= s.t[lap.i0],
        ),
      }
    : null;

  // Off-track, local-yellow, and full-course-yellow time by window.
  const {local, course} = flags;
  const windowOf = rawM => {
    const m = rawM / ratio;
    if (startWindow && m < startWindow.toM) return -1;
    for (let k = sectionWindows.length - 1; k >= 0; k--) {
      if (sectionWindows[k].fromM <= m) return k;
    }
    return -1;
  };
  let li = 0;
  for (let i = lap.i0; i < lap.i1; i++) {
    const k = windowOf(lap.dist[i - lap.i0]);
    const target = k < 0 ? startStraight : corners[k];
    if (!target) continue;
    const dt = s.t[i + 1] - s.t[i];
    if (lap.off[i - lap.i0]) target.offTrackSec += dt;
    while (li < local.length && local[li][1] < s.t[i]) li++;
    if (li < local.length && local[li][0] <= s.t[i])
      target.localYellowSec += dt;
    if (course.some(([a, b]) => a <= s.t[i] && s.t[i] < b))
      target.courseYellowSec += dt;
  }
  for (const f of [startStraight, ...corners].filter(Boolean)) {
    f.offTrackSec = round(f.offTrackSec, 2);
    f.localYellowSec = round(f.localYellowSec, 2);
    f.courseYellowSec = round(f.courseYellowSec, 2);
  }
  // A part's off-track and yellow time: by its own window inside its section.
  corners.forEach((f, k) => {
    for (const p of f.parts ?? []) {
      p.offTrackSec = 0;
      p.localYellowSec = 0;
      p.courseYellowSec = 0;
    }
    if (!f.parts) return;
    let pl = 0;
    for (let i = lap.i0; i < lap.i1; i++) {
      if (windowOf(lap.dist[i - lap.i0]) !== k) continue;
      const m = lap.dist[i - lap.i0] / ratio;
      let pi = f.parts.length - 1;
      while (pi > 0 && f.parts[pi].fromM > m) pi--;
      const dt = s.t[i + 1] - s.t[i];
      if (lap.off[i - lap.i0]) f.parts[pi].offTrackSec += dt;
      while (pl < local.length && local[pl][1] < s.t[i]) pl++;
      if (pl < local.length && local[pl][0] <= s.t[i])
        f.parts[pi].localYellowSec += dt;
      if (course.some(([a, b]) => a <= s.t[i] && s.t[i] < b))
        f.parts[pi].courseYellowSec += dt;
    }
    for (const p of f.parts) {
      p.offTrackSec = round(p.offTrackSec, 2);
      p.localYellowSec = round(p.localYellowSec, 2);
      p.courseYellowSec = round(p.courseYellowSec, 2);
    }
  });
  return {corners, startStraight};
}
