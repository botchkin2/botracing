# Sanity limits audit

Botkin, 2026-10-20: "do not set arbitrary limits that are overly restrictive and
break things for real tracks. some are giant, like nurburgring or le mans."
**Rule:** a bound comes from the session's own data (relative to the track's own
length, the field's own median) or from physics with a wide margin, never from
the tracks we have driven. A check **marks, never drops**. Reference scale for
every row: Nordschleife (25+ km lap, 8+ min laps), 100+ cars, a 24 h race.

Found by reading every constant that rejects, drops, clamps or skips data
(recorder, uploader, analysis, functions, app). Display tuning (corner
thresholds, pedal percentages, minimum lap counts for statistics) is out: it
decides what to show, not what to keep. Lines are at the sha this file was
written on.

## Recorder (`desktop/src-tauri/src/capture/sanity.rs`)

Since the never-drop recorder (#705) every row below only **marks** the capture
`layoutSuspect`; nothing is refused or deleted. A mark makes the tray use none
of the capture, so the numbers still matter: a false mark costs the drive's
field. All are layout-wrongness detectors, so each must be far from any real
value.

| Limit | Value | Meant to catch | Verdict |
|---|---|---|---|
| Lap distance | finite, `abs < 100 km`; marks above a quarter of cars | A wrong layout reads garbage in every car. A pit-lane car at Sebring reads -1664 m | Keep: 4x the longest real lap, physics margin. Could be relative to the scoring info's track length (`mLapDist` of the session) x N; no real case needs it |
| Session clock | `0 <= et < 1e6 s` (11.6 days) | Garbage clock | Keep: a 24 h race is 8.6e4 |
| Player speed | `< 150 m/s` (540 km/h) | Garbage telemetry | Keep: fastest LMU car ~100 m/s |
| Gear | `-2..=12` | Garbage | Keep |
| Tyre/brake temps | `200..=1500 K` | Garbage (Kelvin) | Keep: carbon discs ~1370 K |
| Vehicle count | `1..=max_vehicles` (from the layout's array size) | Garbled count | Keep: it is the game's own array |
| Car `place` | `<= max_vehicles` | Wrong layout | Keep |
| Names | printable; marks above a quarter | Garbled names | Keep |
| iRacing SDK header | 4 buffers, 4096 vars, 1 MiB frame, 4 MiB session info (`irsdk.rs:18-24`) | A header that is not iRacing's | Keep: sizes of the SDK's own structs |
| Capture cap | 14 days, 10 GB (`prune_policy.rs`) | Disk use | Keep: deletes uploaded captures only, oldest first |

## Uploader and session grouping (`tools/sessions`)

| Limit | Value | Effect | Meant to catch | Verdict |
|---|---|---|---|---|
| `MIN_RECORDING_SEC` (`sessionFiles.mjs:15`) | 30 s | A shorter recording is skipped | A menu, a false start | Keep: no real session is under 30 s; but it must log the file, not skip silently (check) |
| `SESSION_GAP_H` (`:11`) | 6 h | A longer gap between recordings starts a new session | Separate sessions | **Change**: a 24 h race can hold a 6 h red flag. Use the same event (same track, series and session clock restart rules already in `sessionFiles`) instead of wall time, or scale to the race length |
| `RESTART_MAX_SEC`, `RESTART_GAP_SEC` (`:12-13`) | 300 s, 120 s | Whether two recordings are one race with a restart | Two races starting on the default clock | Keep: relative to the start clock, not size |
| `MAX_ALIGN_M` (`field.mjs:21`) | 20 m | The whole field is dropped when the player's lap distance differs from the game file by more | A restart or rejoin reset the clock | **Change to mark**: keep the field, stamp `fieldMissing` "does not match", never wrong positions silently. Scale: 20 m is a car and a half; fine at any track length |
| `MAX_TICK_RISE_M` (`gridLap.mjs:24`) | 100 m per sample | The lap is flagged partial (kept, not comparable) | A race lap 0 from the grid (Sebring 0 to 4800 m) | Keep: per sample, not per lap; 100 m in 10 ms is 36000 km/h |
| `LINE_M`, `LENGTH_TOLERANCE` (`analyze.mjs:944-945`) | 30 m, 2% of the map length | A lap starting past 30 m or off the length gets no corner split (lap kept) | Grid start, reset | `LENGTH_TOLERANCE` is relative: keep. `LINE_M` 30 m is absolute: **make it a share of the sample step** (2 samples at the lap's own speed) so a 25 km lap at 5 Hz capture rates is not wrongly cut |
| `GRID_PARKED_SEC` (`gridLap.mjs:40`) | 10 s | Picks the partial reason | Grid start | Keep (a label) |
| Slow lap | relative: 3.5 robust sigmas above the stint pace curve, at least 0.3 s, needs 5 laps (`paceEvents.ts`) | A lap is not comparable (kept) | Slow laps | Keep: relative to the session's own pace |
| `MAX_DOC_BYTES` (`docShape.mjs:9`, `uploadCore.ts:27`) | 900 000 bytes | The whole upload is refused (413) | Firestore's 1 MiB doc limit | Keep the number (it is Firestore's); **prove** a 24 h, 100-car session doc fits (test below) |
| `MAX_OPS` (`uploadCore.ts:32`) | 400 per request | 413, the client chunks (`CHUNK_OPS`) | Firestore's 500 batch limit | Keep |
| `MAX_FILE_BYTES`, `MAX_BODY_BYTES` | 200 MB, 8 MB | 413 | Bound a signed URL; files go by URL | Keep: per-lap parts are a few MB |

## Analysis and app (`src/analysis`)

| Limit | Value | Effect | Meant to catch | Verdict |
|---|---|---|---|---|
| `MAX_SPEED_MS` (`classLaps.ts:152`) | 120 m/s x dt + 20 m | A jump that is bigger is not a line crossing: the lap is not counted | A reset to the garage, a teleport | Keep: scales with the time step, above any car |
| `MAX_EDGE_M`, `MAX_GAP_M` (`trackSurface.ts:73,75`) | 20 m, 30 m | An edge further than 20 m from the centre is not road; a longer gap gives no heading | Daytona pit entry reads 25.8 m against a 14.8 m p90 | **Change**: relative to the track's own p90 half-width (e.g. 3x), not metres picked from tracks we drove |
| `MAX_LATERAL_M`, `OUTLIER_M`, `MIN_SPEED_MS` (`worldRoad.ts:20-24`) | 30 m, 4 m, 2 m/s | Samples dropped from the road fit | Grid, spin, pit exit | `MAX_LATERAL_M`: **relative** like above. The others are about the car, keep |
| `MAX_PROJECT_M` (`fieldOnLine.ts:63`) | 30 m | A car further from the centre path is drawn at its world x/z | Position handling | Keep: it falls back, it does not drop |
| Bank (`bank.mjs`) | `MIN_SPEED_KPH` 60, `MAX_GAP_M` 100, share limits | Curation of banking | Curator data | Keep: curation, not user data |
| Minimum laps (`MIN_*_LAPS`) | 3 to 20 | A statistic is not shown | Sufficiency | Out of scope |

## Not found

No absolute minimum or maximum lap time, no lap-count cap, no car-count cap
beyond the layout's array, no session-length cap: the audit found none to remove.

## Nordschleife-scale proof (to add with the changes above)

A test with 25.4 km laps, 8:30 laps, 110 cars and a 24 h clock (86 400 s) that
passes every row marked Keep: the recorder's `check_scoring` and the field's
`goodRows`; `classLaps` counts every crossing; `gridLap` flags no real lap
partial; a synthetic 24 h, 110-car session doc is under `MAX_DOC_BYTES`.
