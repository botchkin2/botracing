# LMU capture adapter: WIP notes (kingpin/capture-adapter)

Status: investigation only. `lmuCapture.mjs`, its test and fixture are NOT written yet.
No CPU-per-lap number measured on this branch. No parity run on this branch.

## Verified on the fixtures (lap-fixtures/capture + telemetry)

- The game's .duckdb spans one realtime period: file created at realtime entry
  (session `mInRealtime` 0->1; metadata RecordingTime = wall clock then, SessionTime =
  `mTimeOfDay` then, e.g. 75623.195 s = 21:00:23), first sample ~1.7-2 s later
  (2 Oct: realtime 23.2, GPS Time 25.1975; 3 Oct: 4.8 vs 6.5275), last sample at
  realtime exit after the finish (fs=2, garage): 2027.25/2027.4, 1903.52/1903.6, 421.12/421.2.
- 2 Oct race (repair + penalty stops) has ONE .duckdb (stops are pit-lane, not garage),
  so "one .duckdb per stint" does not hold here; split recordings on `mInRealtime`
  transitions, not on pit stops. uploaded.json lists two sessionIds for that capture: unexplained.
- Daytona capture starts 0.25 s after the .duckdb (0.4225 vs 0.1725).
- After the 3 Oct race the capture continues 1903-3057 s at 50 Hz with mInRealtime=0: cut there.
- Hypercar scales: .duckdb SoC = `mSoC` as is (already 0-100; scratch adapter's `*100` is WRONG);
  Regen Rate = `mRegen * 1000` (W under a kW label; -51554..164946 in both). VE = mVirtualEnergy*100.
- .duckdb rates: pedals 50 Hz, lat/lon/lap dist/path lateral/edge 10 Hz, fuel/VE/SoC 20 Hz,
  carcass 5 Hz, wear/pressure/rubber 10 Hz, tread L/C/R 100 Hz. Events sit on a 0.0025 s
  grid (surface, gear), finer than the capture's 100 Hz: off-track seconds cannot match exactly.
- Initial events at file start: lap_time 0, sector1/2 0, impact false.

## Scratch parity (scratchpad cap/, 3 Oct, capture trimmed to the .duckdb window, from the
earlier scratch run, not rerun here)

Laps 0-21 both sides. lapTime identical except partial L21 (23.337 vs 23.340).
Differs: startTime (~2 s, recordedAt source), durationSec med 0.008 max 0.017,
distanceM med 3 m max 5.5, pastEdgeSec med 0.08 max 0.17, maxSpeedAtM <=0.6 m,
rubber temp <=0.3 C (approximated), pressures/temps 0.1, offTrackSec <=0.07 and
L4 offtrack/clean flips (surface sampled at 100 Hz vs 400 Hz). Stints, pit visits,
fuel/VE, excluded, consistency: not shown differing in that run, but not checked on 2 Oct or Daytona.

## Plan (unbuilt)

One DuckDB CLI call per window: temp tables for player [t0-1, t1), player field rows
[t0-1, t1+1), session rows; lap distance = anchor mLapDist (or 0 at mLapStartET) +
trapezoid speed integral partitioned by anchor (window-independent, so parts concatenate);
path lateral/edge by ASOF prev/next lerp; state events by lag() change detection with
an initial event at window start (lap_time initial 0, skipped when the window starts on a crossing);
two COPYs + one info SELECT. All channels 100 Hz.
