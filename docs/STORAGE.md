# Lap storage

How recorded sessions are kept. The decision and its reasons are in the pit-wall room (`decisions/2026-09-27-lasting-storage.md`).

## Where things live

| What                                                         | Where                                                                                                | Why there                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Recordings, sessions, laps (the numbers you filter and sort) | Firestore                                                                                            | Queryable, small docs, scales to many sims and users                                                    |
| Chart trace for one lap                                      | `gs://botracing-61-lmu/traces/{ownerId}/{lapId}/v2.csv.gz`                                           | Fetched only for laps being overlaid                                                                    |
| Full recording archive                                       | `gs://botracing-61-lmu/archive/{sim}/{sessionId}/{recordingId}/samples.parquet` and `events.parquet` | Our own sim-neutral copy of every channel, so analysis can be recomputed later                          |
| Consistency band                                             | `gs://botracing-61-lmu/bands/{ownerId}/{sessionId}/v1.json.gz`                                       | Median and p10/p90 of speed, throttle, brake on a 5 m grid                                              |
| Corner slices (every lap around each corner) | `gs://botracing-61-lmu/slices/{ownerId}/{sessionId}/{hash}/c{n}.json.gz` | The Corner screen draws every lap without fetching whole-lap CSVs. One small file per corner; the folder is named by content, so a resync never serves a stale slice |
| Field (every car, 5 Hz)                                      | `gs://botracing-61-lmu/field/{ownerId}/{sessionId}/{hash}.json.gz`                                   | From the local live capture (`tools/capture`), joined at sync time. No names. About 2 MB per race-hour. |

The raw `.duckdb` from LMU is never uploaded.

Nothing is deleted on a schedule.

## The archive

`samples.parquet` has one row per 100 Hz tick and one column per channel. Slower channels hold their last value. Values are fixed-point decimals by unit (0.01 km/h, 0.1 mm, 0.1 °C), which keeps a race-hour near 16 MB. Core channels have neutral names (`speed_kmh`, `throttle_pct`, `lap_dist_m`, ...). Every other channel keeps a slug of the sim's name, so nothing is dropped.

`events.parquet` is `(t, name, v1..v4)`, one row per change: `lap`, `lap_time`, `in_pits`, `gear`, `surface`, `impact`, and the rest.

A new sim needs one adapter that writes these two files. Analysis only reads them.

## Uploading

```bash
node tools/sessions/sync.mjs
```

It scans the LMU telemetry folder, skips files written in the last 3 minutes, groups recordings into sessions, and uploads only sessions that changed since the last run. `--local` writes everything to the work folder instead. `--list` shows the grouping. `--since YYYY-MM-DD` limits by day. It needs `npm ci --prefix functions` once and `gcloud auth application-default login`.

A session is recordings with the same sim, track layout, car, and session type, where the game's session timer kept pace with the wall clock between files (runs back to the pits) or restarted with the same session clock (a race restart).

## Online events

A recording does not say which online event it was. LMU's trace logs (`UserData\Log\trace_*.txt`) do: one line per server join, with the series name and the official event id. `tools/sessions/lmuEvents.mjs` reads them. A join lasts until the game returns to the main menu, the next join, or the end of that log. A recording that starts inside a join gets `event: {eventId, series, kind, joinedAt, gapS}` (`kind` is `practice` or `race`; the race server holds qualifying and the race). The session gets `series` and `eventId` from its first matched recording. Offline sessions get `null`.

LMU keeps only a few weeks of trace logs, so every join seen is kept in `events.json` in the work folder. Sessions older than the oldest log stay `null`.

`--events-only --since YYYY-MM-DD` sets these fields on sessions already uploaded, without analysis or archive uploads. Use it instead of a full resync to backfill.

## Access

The app never touches Firestore or the bucket. It calls the `lmuApi` function, which reads with the Admin SDK. The PC uploader writes with Google Cloud application-default credentials. `firestore.rules` denies all clients. The bucket is not linked to Firebase Storage and stays private through IAM.

There is no sign-in. Every doc carries `ownerId` and `sim` so that more than one driver and more than one sim fit later without a migration.

## Collections

- `recordings/{recordingId}`: one source file. Fields include `sessionId` and `startedAt`. One race can span several LMU files.
- `sessions/{sessionId}`: recordings grouped by owner, sim, track, layout, car, session type, and game session time. It holds the precomputed lap table, stints (each with `greenLaps` and the median and spread of fuel per green lap, `medianFuelL`/`fuelSpreadL`, and of Virtual Energy, `medianVePct`/`veSpreadPct`, null under 3 green laps: a green lap is timed, whole, not the first, no pit in or out, no full-course yellow, not cut short by a reset), `fuel` (`startL`; `litresPerVePct`, the litres of fuel per 1 % of Virtual Energy measured as the median over green laps of used litres per used %, which depends on the fill limit and is not in the setup, and `litresPerVePctStop`, the same from litres and % added at the stops, a cross-check; `fillLimitL`, the most fuel the event lets the car take, from the car setup's `VM_FUEL_LEVEL` × 100, and `tankL`, `VM_FUEL_LEVEL.maxValue`, both null when the setup is empty), pit in and out, the session consistency band, and `consistency`: every stint of the session (a stint with no selected laps reads `laps: 0` and `emptyReason`), each with its start reason, first and last lap, lap ids, pace trend and its 95% interval (`trendPerLapLow`/`High`, Sen's rank interval, null below 5 laps; it assumes independent laps, with outliers already out of the selection) and spread around the trend; scatter, off-pace laps, per-corner spread and loss, an `overview` text, and the thresholds used. Fields include `ownerId`, `sim`, `trackId`, `carId`, and `startedAt`.
- `laps/{lapId}`: one lap. It holds comparability reasons, a pointer to its trace, and everything `src/analysis/consistency.ts` needs to rerun on any selection of laps: stint lap, start, fresh tyres, tyre carcass temperature, full-course yellow time, and per-section facts (segment time brake to brake, off-track and local-yellow time, minimum speed and where (`minSpeedAtM`), from the slowest recorded 100 Hz sample between turn-in and exit), brake point, full-throttle point; the two points are recorded pedal samples, with `brakeAtResM` and `fullThrottleAtResM` giving the distance since the previous sample, see `tools/sessions/pedalPoints.mjs`), each with `parts`: the same facts for every single corner inside the section, summing to the section's time. `fuel` holds the lap's fuel and Virtual Energy (`startL`, `endL`, `usedL`, `addedL`, `veStartPct`, `veEndPct`, `veUsedPct`, `veAddedPct`, and `green`: whether the lap counts as a green lap (see the stint medians), `lapsLeftFuel`/`lapsLeftVe`: the end level over the stint's median use, null without a median): used is start minus end plus what was added in the pits, read over the lap's whole time window so consecutive laps tile with nothing unaccounted for; `pitStop` (on the lap the pit lane is entered, its first if there are two) holds `atEntry` (`fuelL`, `vePct`), `added` (`fuelL`, `vePct`; 0 for a drive-through or penalty), `inPitS` and `lapsLeftAtEntry` (`fuel`, `ve`); a pit window in the first 30 s of a recording is the drive off the grid, not a stop; both are null without the channels (`tools/sessions/fuelFacts.mjs`, evidence in pit-wall thread 34). `traffic` holds the cars around the player from the field, in seconds and counts (`draftS`: within 30 m behind a car in the same lane above 200 km/h; `trafficAheadS` and `trafficBehindS`: a car within 1 s on the road in the same lane; `blueFlagS`; `passesMade` and `passesSuffered`: passes on the road with cars of the player's class, including a slower car of the same class being lapped, so not a place change (a Hypercar lapping a GT3 is not counted); `passesMadeAll` and `passesSufferedAll`: every car; `battleS`: seconds within 1 s of a car of the player's class, ahead or behind, in any lane, including a lapped one), null when the session has no field; see `tools/sessions/fieldTags.mjs` for the evidence behind each threshold. `excluded` says why the lap is not in the default "normal racing" selection; `consistency` holds its residual to the pace trend and where it lost time. Fields include `ownerId`, `sim`, `sessionId`, `lapNumber`, `trackId`, `carId`, and `lapTime`.
- `tracks/{trackId}`: one track layout's corner map (`src/analysis/corners.ts`), so corner numbers stay the same from session to session. Custom sectors and official turn names will attach here. It is created by the first session analyzed at that layout with at least 8 clean laps of the same length, and never replaced automatically. A session the stored map does not fit (lap length off by more than 3%) is analyzed with a map of its own, which is not stored, and the session doc says so (`trackMapSource`, `trackMapMismatch`). Replace a map on purpose with `sync.mjs --rebuild-track <trackId> --force`. A map with an older `mapVersion` counts as no map and is rebuilt the same way; version 3 groups corners into sections by how the driver links them (a braked corner with a straight before it starts a section; lifts and flat corners join their neighbours); version 4 puts a corner's apex at its slowest point, or at its tightest point when the slowest is on the turn-in or exit edge (a corner taken while accelerating, or flat). Anything the driver sets on a track (edited sectors, turn names) goes in its own field, never inside the generated map, and refers to corners by `apexM`, so a rebuild or a new `mapVersion` never discards it. The uploader also keeps a copy in its work folder (`tracks/{trackId}.json`).

The same analysis code runs in the uploader and in the app, so a selection made on the phone gives the same numbers the uploader stored for the default selection. `node tools/sessions/consistency-report.mjs --work <dir>` checks that on `--local` output.

IDs are deterministic hashes, so re-uploading the same file overwrites instead of duplicating.

Firestore docs cap at 1 MiB. Anything per-sample goes in the bucket.

## Indexes

`firestore.indexes.json` covers these queries:

- An owner's sessions, newest first, optionally at one track.
- A session's recordings in order.
- A session's laps in order.
- The best laps for an owner at a track in a car.

Rules and indexes deploy with functions on merge to main (`firebase deploy --only functions,firestore`).

## Corner slices

`tools/sessions/cornerSlices.mjs` cuts, for every lap and every corner of the track map (parts count as corners), the window apex-300 m to apex+200 m out of the lap's trace and writes one file per corner: `slices/{ownerId}/{sessionId}/{hash}/c{n}.json.gz`. The session doc has `slices: {format, hash, prefix, corners, beforeM, afterM, stepM}`. The hash is over the files' content; a sync writes the new folder, then deletes the session's other slice folders after the doc points at the new one. Format and route: `docs/API.md`.

What a slice holds is what the app draws from the lap's CSV today, produced by the same code (`src/analysis/traceCsv.ts` and `resample.ts`, run by the uploader): every channel's **recorded samples** at their own distances (slower channels are not held or repeated), plus time, latitude and longitude on the 5 m grid. Values keep the CSV's own precision, distances are millimetres, and every array is integer deltas. Measured on the Road Atlanta 44-lap race (11 corners): 104 to 180 KB gzipped per corner, 1.6 MB for the whole race, against about 0.55 MB per lap when the app fetched the CSVs.

Limits: the window is clipped at the start/finish line (a corner within 300 m of the line has a shorter window, as the per-lap CSV path always did); the file lists every lap the session has, including pit and partial laps; a trace from before analysis version 9 has no lateral samples.

## Field

When the recorder (`tools/capture`) was running, `sync.mjs` joins its captures to the session (`tools/sessions/field.mjs`). A capture joins when its time window overlaps the session's and its track matches (the scoring name, or the recording's venue or layout). It is then aligned on the session clock: field `et` and the `.duckdb` GPS Time are the same clock. The alignment is checked: the player car's lap distance must agree between the two sources to within 20 m (median). If it doesn't (a restart or rejoin reset the clock), the session gets `field: null` and the sync logs why.

A capture the recorder never closed (no `endUtc`: crash, kill, power) ends at its last chunk, so it cannot join a later session on the same track. Cars are labelled with the model the recorder read from each car's telemetry slot (`meta.vehicleModels`), never the entry name, which carries the car number.

The session doc then has `field: {path, hash, hz, cars, durationS, captures, alignM}`. The file name is a hash of its content; a new field replaces the file (deleted after the doc points at the new one). A sync that finds no field (captures pruned, the capture folder not visible, a failed clock check) keeps the stored one. `captures` lists the capture folder names; the uploader's pruner treats a capture listed there as uploaded. Each car's heading (`yawCrad`, file version 2) comes from the game's orientation matrix; older files (`v: 1`) lack it. An existing field is rewritten on the next `analysisVersion` change while its capture is still local (7 days). The file carries no driver names or car numbers, because the API is public and the session's `eventId` would name every car in one lookup. The names stay in the local capture.
