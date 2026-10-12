# LMU capture adapter: notes (kingpin/capture-adapter)

`lmuCapture.mjs` (+ `lmuCaptureChannels.mjs`) builds lmu.mjs's archive from the tray's
live capture. Test: `lmuCapture.test.mjs` on `fixtures/lmu-capture` (laps 3-4 of the
3 Oct race, capture + the matching .duckdb archive slice).

## Contract (uploader `sync --live`)

- `describeCapture(dir)` -> `{stretches: [{key, ended, startMs, endMs, info, laps}]}`; one
  stretch per mInRealtime-on run. `laps`: `{lapNumber, t0, t1, partial, lapTimeS}`, half-open,
  first part [stretch start, first crossing) partial; trailing part listed once `ended`
  (realtime off after it, or meta.json endUtc).
- `writeCaptureArchive(dir, info, {t0, t1}, samplesOut, eventsOut)`: one DuckDB run.
  `tick` = round((t - info.startT) * 400), so parts read through one glob equal one window
  (checked: 3 Oct, 22 parts vs one window, sample/event rows and lap docs identical).

## Verified on the fixtures

- The game's .duckdb spans one realtime stretch (2 Oct race through pit-lane stops is one
  file). The .duckdb's first sample is ~1.7 s after realtime entry; the capture's stretch starts at it.
- Hypercar: SoC = `mSoC` as is, Regen = `mRegen * 1000` (match the .duckdb scale, Daytona).
- The .duckdb clamps negative lap distance (rolling start, before the line) to ~0.001; the
  adapter clamps at 0.

## Known differences from the .duckdb archive (parity runs, same windows)

- Not in the capture: weather (''), venue name (track = the scoring/layout name, so Daytona's
  track.name differs; layout and trackId match), the setup's fill limit (null).
  Daytona tankL: mFuelCapacity 110 vs setup 106.
- tyres_rubber_temp is approximated (mean of inner layers and carcass): 0.2-0.4 C on GT3,
  2-3.5 C on the Hypercar.
- Sampling: the capture is ~100 Hz on its own phase, the .duckdb 10/20/50 Hz on another, so
  values read at a lap boundary can differ by one sample (2 Oct: fuel 0.01 L, VE 0.08 % on
  2 laps; pit stationary 0.2 s), and surface-based off-track seconds by <= 0.07 s.
- analyze.mjs edge: a first segment under 5 s whose lap distance resets at its last tick is
  trimmed to that tick (lapTicks), so it is not marked partial; the .duckdb's 10 Hz distance
  hides it. Fixture windows start 9 s before the line.
