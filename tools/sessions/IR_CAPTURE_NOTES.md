# iRacing capture adapter: notes (kingpin/ir-capture-adapter)

`irLiveCapture.mjs` builds iracing.mjs's archive from the tray's iRacing capture
(`desktop/src-tauri/src/capture/ir_*.rs`). Same contract as `lmuCapture.mjs`
(LMU_CAPTURE_NOTES.md); `syncLive.mjs` picks the adapter by meta.json `sim`.

## Contract

- `describeCapture(dir)`: one stretch per IsOnTrack run. The recorder writes rows only on
  track, so a stretch ends at a gap in the sim's tick over 60 (1 s), a tick or session clock
  that goes back, or a new SessionNum. Laps are iracing.mjs `lapCrossings` over the stretch
  (computed from the rows it looks at: each Lap change, the row before, the first new
  LapLastLapTime within 3 s), so lap numbers and times match the .ibt's.
- `writeCaptureArchive`: two DuckDB runs (the crossings, then both files). `tick` is the
  sim's tick from the stretch's first row: a missed tick shows as a step of 2 (the .ibt
  numbers rows, so ticks differ after one; analysis only orders by tick).
- The recorder (kingpin/ir-per-lap-cut) cuts a chunk 3.1 s after each crossing (the lap
  time comes up to 0.85 s late on the 9 Oct Sebring .ibt) and writes `lastLapAt` to
  `<root>/status-iracing.json`; watch.mjs runs `sync --sim iracing --live` on it.

## What the capture needs from meta.json (ir_session.rs on kingpin/ir-per-lap-cut)

trackShort (layout slug when there is no config), trackSkies (weather), fuelMaxL and
fuelMaxPct (fuelSetup), sessions (raceLength), sectorStarts (SplitTimeInfo: sector_start
events from LapDistPct, as the .ibt's). A capture from the older recorder has none of them:
no sectors, fuel, race length or weather, and a config-less track's layout differs from the
.ibt's. `SteeringWheelAngleMax` is a player column from that branch on; without it
steer_pct falls back to pi rad for full lock.

## Parity (irLiveParity.mjs on captures built by irCaptureFromIbt.mjs)

Sebring 9 Oct 10-10-41 (9 laps, a reset) and Fuji 4 Oct (4 laps): every lap doc field
equal, except Fuji lap 3 tyres.wearPct / pitStop.entryPct (0.5): the .ibt archive's CSV
type sniffing made tyres_wear_* (and throttle/brake on that file) BIGINT and rounded them;
the capture keeps doubles. This proves the mapping only: a built capture has the .ibt's own
values, wall clock and ticks, and no field. The recorder's fidelity needs a real capture.
