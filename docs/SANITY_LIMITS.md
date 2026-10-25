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
`layoutSuspect`; nothing is refused or deleted. A mark held for most of the
drive is still used (`field.mjs` `captureDoubted`, `syncLive.mjs`): the laps
go up and the field is stored with `mark {kind: 'doubted'}` (pit-wall thread
100, L1 audit row 3). All are layout-wrongness detectors, so each must be far
from any real value.

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
| Capture cap | 14 days, 10 GB (`prune_policy.rs`) | Disk use | Keep: the cap takes only captures whose every session was read back from the store and matched (`verifyStored.mjs`), oldest first. An unverified one goes only at 14 days (Botkin: "14 days is acceptable") and shows in Problems with the days left; over the cap it is kept and shown (thread 100, L6) |

## Uploader and session grouping (`tools/sessions`)

| Limit | Value | Effect | Meant to catch | Verdict |
|---|---|---|---|---|
| `MIN_RECORDING_SEC` (`sessionFiles.mjs:15`) | 30 s | A shorter recording is skipped | A menu, a false start | Keep: no real session is under 30 s; but it must log the file, not skip silently (check) |
| `SESSION_GAP_H` (`:11`) | 6 h | A longer gap between recordings starts a new session | Separate sessions | **Change**: a 24 h race can hold a 6 h red flag. Use the same event (same track, series and session clock restart rules already in `sessionFiles`) instead of wall time, or scale to the race length |
| `RESTART_MAX_SEC`, `RESTART_GAP_SEC` (`:12-13`) | 300 s, 120 s | Whether two recordings are one race with a restart | Two races starting on the default clock | Keep: relative to the start clock, not size |
| `MAX_ALIGN_M` (`field.mjs`) | 20 m | The field is stored with `mark {kind: 'misaligned', alignM}` and one line says how far off it is. It is not dropped | A restart or rejoin reset the clock | Done (gauge #6846, thread 100, L1 audit row 4). 20 m stays as the threshold for the mark |
| `MAX_TICK_RISE_M` (`gridLap.mjs:24`) | 100 m per sample | The lap is flagged partial (kept, not comparable) | A race lap 0 from the grid (Sebring 0 to 4800 m) | Keep: per sample, not per lap; 100 m in 10 ms is 36000 km/h |
| `LINE_M`, `LENGTH_TOLERANCE` (`analyze.mjs:944-945`) | 30 m, 2% of the map length | A lap starting past 30 m or off the length gets no corner split (lap kept) | Grid start, reset | `LENGTH_TOLERANCE` is relative to the track: keep. `LINE_M` is the first sample past the line, which does not depend on track length. **Tried the lap's own step (3 x median step, floor 1 m) and the golden sessions moved** (Road Atlanta race: comparable 10 to 11, stdev 0.624 to 1.186, corner medians), so real laps start further past the line than their step: **keep 30 m**, not a size limit, and not changed without a golden update that Botkin sees |
| `GRID_PARKED_SEC` (`gridLap.mjs:40`) | 10 s | Picks the partial reason | Grid start | Keep (a label) |
| Slow lap | relative: 3.5 robust sigmas above the stint pace curve, at least 0.3 s, needs 5 laps (`paceEvents.ts`) | A lap is not comparable (kept) | Slow laps | Keep: relative to the session's own pace |
| `MAX_DOC_BYTES` (`docShape.mjs:9`, `uploadCore.ts:27`) | 900 000 bytes | The whole upload is refused (413) | Firestore's 1 MiB doc limit | **Measured, by block, not as one assembled doc** (a Le Mans 24 h field of 62 cars in 4 classes, 86 400 s, a pit stop every 12 laps, through the real `classLapsDoc`, `classBestsDoc`, `finishDoc`): `classLaps` 374 B, `classBests` 1032 B, `result` 170 B. The field-driven blocks do not grow with cars or laps (five numbers per class). What grows is his own laps: `lapTable` 212-224 B/lap (three real golden slices) = ~90 KB for 400 laps; `consistency` is ~1.7-2.2 KB for 7-16 laps and is stint/corner based, so ~20 KB with 35 stints (inferred); `paceSet` ~3 KB; plan stops ~10 KB (inferred). **About 130 KB for a 24 h Le Mans, the 900 KB limit is hit at ~3 800 laps** (a 96 h race at 90 s laps). Keep; no change. Not measured: the assembled doc through `analyzeFromArchive` (needs a full synthetic archive) |
| Field file size (`field.mjs`, gz in the bucket) | grows with cars x hours | none today | Scale row | **Measured on his real Algarve 10-17 field (38 cars, 4 806 s): 22 MB raw JSON, 2.23 MB gzip, `JSON.parse` 41 ms, the app's `toField` 818 ms, heap ~150-330 MB.** Scaled linearly (inferred, not run) to Le Mans 24 h with 62 cars, x29: **~645 MB raw JSON (past a JS engine's string limit of ~512 MB, so `JSON.parse` cannot read it), ~65 MB gzip (under `MAX_FILE_BYTES` 200 MB), `toField` ~24 s, several GB of heap: it cannot load on a phone and the cloud runs (dataApi 256 MiB) cannot read it.** Needs design: a field split into time windows (or fewer Hz when long), loaded by the replay's clock. No number is raised; this is a design row for a 24 h race, not a limit to move |
| `MAX_OPS` (`uploadCore.ts:32`) | 400 per request | 413, the client chunks (`CHUNK_OPS`) | Firestore's 500 batch limit | Keep |
| `MAX_FILE_BYTES`, `MAX_BODY_BYTES` | 200 MB, 8 MB | 413 | Bound a signed URL; files go by URL | Keep: per-lap parts are a few MB |

## Analysis and app (`src/analysis`)

| Limit | Value | Effect | Meant to catch | Verdict |
|---|---|---|---|---|
| `MAX_SPEED_MS` (`classLaps.ts:152`) | 120 m/s x dt + 20 m | A jump that is bigger is not a line crossing: the lap is not counted | A reset to the garage, a teleport | Keep: scales with the time step, above any car |
| `MAX_EDGE_M`, `MAX_GAP_M` (`trackSurface.ts`) | was 20 m, 30 m | An edge reading over 20 m from the car was dropped; a longer gap gave no heading | Daytona pit entry reads 25.8 m against a 14.8 m p90 | **Changed (this PR).** Measured on his game files, 20 m clipped real edges at four tracks; Algarve's flat 30.0 looks like the game's range cap. Now an edge is kept within 3x the median edge distance of its own 10 m bin and side, over every lap of the build (a bin under 5 samples takes its neighbours' median; no metre constant left), and a gap is 8 of the lap's own median steps. Before/after over all his files of each track (edge samples kept): Algarve 96.48% to 99.96% (largest kept 30.0), Sebring 99.36% to 99.78% (51.8), Circuit of the Americas 99.19% to 99.92% (25.2), Daytona 99.66% to 99.98% (29.2). `SURFACE_RULES` 3 makes the stored surfaces rebuild. The surface stays the measured asphalt (a Sebring pit-entry opening reads ~50 m on every lap); only the 3D's drawn half-width is bounded, in `worldRoad.ts`, at 3x that side's own median (Sebring right: 17.8 m, was 49.4 uncapped), so the posts and the ground follow. Over his tracks only Sebring and Daytona (9 bins) change; Road Atlanta, La Sarthe, Spa, Silverstone and COTA are drawn exactly as measured |
| `MAX_LATERAL_M`, `OUTLIER_M`, `MIN_SPEED_MS` (`worldRoad.ts:20-24`) | 30 m, 4 m, 2 m/s | Samples dropped from the road fit | Grid, spin, pit exit | `MAX_LATERAL_M` is a lateral offset from the path; the edge data above (readings to 30-52 m at wide-open areas) says 30 m can also clip real samples at Sebring. Same proposal. The others are about the car: keep |
| `MAX_PROJECT_M` (`fieldOnLine.ts:63`) | 30 m | A car further from the centre path is drawn at its world x/z | Position handling | Keep: it falls back, it does not drop |
| Bank (`bank.mjs`) | `MIN_SPEED_KPH` 60, `MAX_GAP_M` 100, share limits | Curation of banking | Curator data | Keep: curation, not user data |
| Minimum laps (`MIN_*_LAPS`) | 3 to 20 | A statistic is not shown | Sufficiency | Out of scope |

## Not found

No absolute minimum or maximum lap time, no lap-count cap, no car-count cap
beyond the layout's array, no session-length cap: the audit found none to remove.

## Nordschleife-scale proof (to add with the changes above)

The proof is two scales, because size grows with laps: Nordschleife (25.4 km laps, 8:30 laps, 110 cars) and Le Mans 24 h (~23 000 car-laps, 62 cars, 86 400 s clock). A test at each that
passes every row marked Keep: the recorder's `check_scoring` and the field's
`goodRows`; `classLaps` counts every crossing; `gridLap` flags no real lap
partial; a synthetic Le Mans 24 h session doc is under `MAX_DOC_BYTES`; the 24 h field file's size and decode time are measured and written here.
