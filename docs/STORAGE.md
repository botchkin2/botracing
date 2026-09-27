# Lap storage

How recorded sessions are kept. The decision and its reasons are in the pit-wall room (`decisions/2026-09-27-lasting-storage.md`).

## Where things live

| What | Where | Why there |
|---|---|---|
| Recordings, sessions, laps (the numbers you filter and sort) | Firestore | Queryable, small docs, scales to many sims and users |
| Chart trace for one lap | `gs://botracing-61-lmu/traces/{ownerId}/{lapId}/v1.csv.gz` | Fetched only for laps being overlaid |
| Full recording archive | `gs://botracing-61-lmu/archive/{sim}/{sessionId}/{recordingId}/samples.parquet` and `events.parquet` | Our own sim-neutral copy of every channel, so analysis can be recomputed later |
| Consistency band | `gs://botracing-61-lmu/bands/{ownerId}/{sessionId}/v1.json.gz` | Median and p10/p90 of speed, throttle, brake on a 5 m grid |

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

## Access

The app never touches Firestore or the bucket. It calls the `lmuApi` function, which reads with the Admin SDK. The PC uploader writes with Google Cloud application-default credentials. `firestore.rules` denies all clients. The bucket is not linked to Firebase Storage and stays private through IAM.

There is no sign-in. Every doc carries `ownerId` and `sim` so that more than one driver and more than one sim fit later without a migration.

## Collections

- `recordings/{recordingId}`: one source file. Fields include `sessionId` and `startedAt`. One race can span several LMU files.
- `sessions/{sessionId}`: recordings grouped by owner, sim, track, layout, car, session type, and game session time. It holds the precomputed lap table, stints, pit in and out, and the session consistency band. Fields include `ownerId`, `sim`, `trackId`, `carId`, and `startedAt`.
- `laps/{lapId}`: one lap. It holds per-corner metrics, comparability reasons, and a pointer to its trace. Fields include `ownerId`, `sim`, `sessionId`, `lapNumber`, `trackId`, `carId`, and `lapTime`.

IDs are deterministic hashes, so re-uploading the same file overwrites instead of duplicating.

Firestore docs cap at 1 MiB. Anything per-sample goes in the bucket.

## Indexes

`firestore.indexes.json` covers these queries:

- An owner's sessions, newest first, optionally at one track.
- A session's recordings in order.
- A session's laps in order.
- The best laps for an owner at a track in a car.

Rules and indexes deploy with functions on merge to main (`firebase deploy --only functions,firestore`).
