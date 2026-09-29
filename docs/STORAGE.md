# Lap storage

How recorded sessions are kept. The decision and its reasons are in the pit-wall room (`decisions/2026-09-27-lasting-storage.md`).

## Where things live

| What                                                         | Where                                                                                                | Why there                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Recordings, sessions, laps (the numbers you filter and sort) | Firestore                                                                                            | Queryable, small docs, scales to many sims and users                                                    |
| Chart trace for one lap                                      | `gs://botracing-61-lmu/traces/{ownerId}/{lapId}/v2.csv.gz`                                           | Fetched only for laps being overlaid                                                                    |
| Full recording archive                                       | `gs://botracing-61-lmu/archive/{sim}/{sessionId}/{recordingId}/samples.parquet` and `events.parquet` | Our own sim-neutral copy of every channel, so analysis can be recomputed later                          |
| Consistency band                                             | `gs://botracing-61-lmu/bands/{ownerId}/{sessionId}/v1.json.gz`                                       | Median and p10/p90 of speed, throttle, brake on a 5 m grid                                              |
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
- `sessions/{sessionId}`: recordings grouped by owner, sim, track, layout, car, session type, and game session time. It holds the precomputed lap table, stints, pit in and out, the session consistency band, and `consistency`: pace trend per stint, scatter, off-pace laps, per-corner spread and loss, an `overview` text, and the thresholds used. Fields include `ownerId`, `sim`, `trackId`, `carId`, and `startedAt`.
- `laps/{lapId}`: one lap. It holds comparability reasons, a pointer to its trace, and everything `src/analysis/consistency.ts` needs to rerun on any selection of laps: stint lap, start, fresh tyres, tyre carcass temperature, full-course yellow time, and per-section facts (segment time brake to brake, off-track and local-yellow time, minimum speed, brake point, full-throttle point; the two points are recorded pedal samples, with `brakeAtResM` and `fullThrottleAtResM` giving the distance since the previous sample, see `tools/sessions/pedalPoints.mjs`), each with `parts`: the same facts for every single corner inside the section, summing to the section's time. `excluded` says why the lap is not in the default "normal racing" selection; `consistency` holds its residual to the pace trend and where it lost time. Fields include `ownerId`, `sim`, `sessionId`, `lapNumber`, `trackId`, `carId`, and `lapTime`.
- `tracks/{trackId}`: one track layout's corner map (`src/analysis/corners.ts`), so corner numbers stay the same from session to session. Custom sectors and official turn names will attach here. It is created by the first session analyzed at that layout with at least 8 clean laps of the same length, and never replaced automatically. A session the stored map does not fit (lap length off by more than 3%) is analyzed with a map of its own, which is not stored, and the session doc says so (`trackMapSource`, `trackMapMismatch`). Replace a map on purpose with `sync.mjs --rebuild-track <trackId> --force`. A map with an older `mapVersion` counts as no map and is rebuilt the same way; version 3 groups corners into sections by how the driver links them (a braked corner with a straight before it starts a section; lifts and flat corners join their neighbours). Anything the driver sets on a track (edited sectors, turn names) goes in its own field, never inside the generated map, and refers to corners by `apexM`, so a rebuild or a new `mapVersion` never discards it. The uploader also keeps a copy in its work folder (`tracks/{trackId}.json`).

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

## Field

When the recorder (`tools/capture`) was running, `sync.mjs` joins its captures to the session (`tools/sessions/field.mjs`). A capture joins when its time window overlaps the session's and its track matches (the scoring name, or the recording's venue or layout). It is then aligned on the session clock: field `et` and the `.duckdb` GPS Time are the same clock. The alignment is checked: the player car's lap distance must agree between the two sources to within 20 m (median). If it doesn't (a restart or rejoin reset the clock), the session gets `field: null` and the sync logs why.

A capture the recorder never closed (no `endUtc`: crash, kill, power) ends at its last chunk, so it cannot join a later session on the same track. Cars are labelled with the model the recorder read from each car's telemetry slot (`meta.vehicleModels`), never the entry name, which carries the car number.

The session doc then has `field: {path, hash, hz, cars, durationS, captures, alignM}`. The file name is a hash of its content; a new field replaces the file (deleted after the doc points at the new one). A sync that finds no field (captures pruned, the capture folder not visible, a failed clock check) keeps the stored one. `captures` lists the capture folder names; the uploader's pruner treats a capture listed there as uploaded. The file carries no driver names or car numbers, because the API is public and the session's `eventId` would name every car in one lookup. The names stay in the local capture.
