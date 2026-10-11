# LMU recordings

What Le Mans Ultimate writes on this PC, and the rules the app takes from it. The pipeline that reads them is `tools/sessions/*` (`docs/STORAGE.md`, `docs/API.md`).

## Where they are

| Thing         | Where                                                            |
| ------------- | ---------------------------------------------------------------- |
| LMU install   | `C:\Program Files (x86)\Steam\steamapps\common\Le Mans Ultimate` |
| Recorded laps | `...\Le Mans Ultimate\UserData\Telemetry\*.duckdb`               |
| Auto record   | On, in `UserData\player\Settings.JSON`                           |
| Channel rates | `UserData\Telemetry\config.json`                                 |

## What one LMU file contains

One `.duckdb` is one stint, not one lap. Filename: `{Track}_{P|Q|R}_{utc timestamp}Z.duckdb`. `P` practice, `Q` qualifying, `R` race.

- `metadata`: `TrackName`, `TrackLayout`, `CarName`, `CarClass`, `SessionType`, `RecordingTime`, `WeatherConditions`, `DriverName`, and `CarSetup` (full garage JSON).
- `channelsList`: name, sample rate, unit.
- High-rate channels have a single `value` column and no timestamp. Row `i` lines up with `GPS Time`, which is the session clock in seconds at 100 Hz.
- Four-corner channels use `value1`..`value4` (FL, FR, RL, RR).
- `Lap` events: `ts` plus the new lap number, fired at the start/finish line.
- `Lap Time` events: `ts` plus the completed lap time in seconds. `0` means invalid or reset.
- `Gear` events: `ts` plus gear. `0` is neutral, including the brief neutral during a shift.
- `Lap Dist` is meters along the lap and resets each lap (Road Atlanta tops out at 4082 m). It is recorded at 10 Hz.

Checked against `Michelin Raceway Road Atlanta_P_2026-09-25T00_10_40Z.duckdb`: 67,613 speed samples at 100 Hz matched `GPS Time` from 6094.55 to 6770.67, and the `Lap Time` values matched the gaps between `Lap` events.

The game locks the file while it is still recording. Copy it, or wait until the size stops changing.

## Laps to keep

Every segment between start/finish crossings goes into the stint, plus the partial piece before the first crossing and the partial piece after the last one. That includes out-laps, in-laps, pit cycles, and laps the game did not time.

`Lap Time` of 0 means the game did not record a time. Those laps stay, tagged `gameDidNotTime`. `In Pits` (1 = in the pit lane, 0 = out) is a tag, not a reason to drop the lap. On the Road Atlanta practice file there were three pit visits.

The phone loads one stint and overlays whichever laps you turn on. Nothing is filtered out before upload.

## Track limits

Off track (the race screen) is measured against the road, not a fixed number: a car is off when its `Path Lateral` passes the measured road edge at its lap distance plus 1 m (half a car width), held 0.3 s (`OFF_HOLD_S`, #321). An edge needs 3 laps (`MIN_EDGE_LAPS`) to count; a side no lap measured takes the median half-width. With no measured edge, the old 7.5 m applies. The edge comes from `trackSurface.ts`; `raceState.ts` applies the rule at read time, so stored sessions need no re-analysis.

Recorder x/z is not the road: at Road Atlanta T7 (1,950 to 2,150 m) it sits about 8 m off the measured road for every car, the player included, while `Path Lateral` and lap distance agree with the trace (pit-wall #3833). The Race map therefore puts each car's x/z onto the measured centre line near its lap distance (`projectOnLine` (`analysis/fieldOnLine.ts`), within 30 m), then offsets it by `Path Lateral` to the right of travel. Raw x/z is used only where lap distance is missing or the projection is more than 30 m away (#455).

The recording does not contain LMU's official track-limit penalty counter. That counter exists on the live shared-memory struct (`mTrackLimitsSteps` in community notes) and is not one of the DuckDB channels. Dave Delta's `.delta` files do not document it either, so we will not try to scrape it from there.

What the DuckDB file does contain, confirmed on the Road Atlanta practice file and in `Support\SharedMemoryInterface\InternalsPlugin.hpp`:

- `SurfaceTypes`, one value per wheel. `0` dry asphalt, `1` wet asphalt, `2` grass, `3` dirt, `4` gravel, `5` rumble strip, `6` special. This file had grass (about 1,000 wheel samples) and a little gravel, plus a lot of rumble. Grass or gravel means a wheel left the asphalt. Rumble is a kerb, not an off.
- `Path Lateral` is the car's offset from the approximate center path. `Track Edge` is the edge distance on the car's side of that path. On this file, 150 of 6,762 samples sat past that edge.
- `In Pits` marks the pit lane.
- Sector flag channels are described in the header as local yellows. This file only stores the values 1 and 11, so they are not a track-limits signal until that encoding is known.

A lap can be tagged `leftAsphalt` when any wheel reports grass, dirt, or gravel. That is a physics fact from the game, not the sporting "track limits" call. The overlay still includes the lap.

## Unit map into the existing chart columns

| App column         | LMU source                            | Conversion                                             |
| ------------------ | ------------------------------------- | ------------------------------------------------------ |
| Speed              | Ground Speed (km/h, 100 Hz)           | divide by 3.6                                          |
| Throttle           | Throttle Pos (%, 50 Hz)               | divide by 100                                          |
| Brake              | Brake Pos (%, 50 Hz)                  | divide by 100                                          |
| RPM                | Engine RPM (100 Hz)                   | as-is                                                  |
| Gear               | Gear events                           | hold last gear, drop neutrals shorter than about 50 ms |
| Lat, Lon           | GPS Latitude / Longitude (deg, 10 Hz) | as-is                                                  |
| LapDistPct         | Lap Dist (m, 10 Hz)                   | meters / lap length, so the column stays 0 to 1        |
| SteeringWheelAngle | Steering Pos (% of lock, 100 Hz)      | no radian equivalent in the file                       |

Steering is % of lock for both sims: LMU's Steering Pos as recorded, iRacing's `SteeringWheelAngle` scaled by `SteeringWheelAngleMax` (`tools/sessions/iracing.mjs`).
