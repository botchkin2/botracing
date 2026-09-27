# Lap storage

How recorded sessions are kept. The decision and its reasons are in the pit-wall room (`decisions/2026-09-27-lasting-storage.md`).

## Where things live

| What | Where | Why there |
|---|---|---|
| Recordings, sessions, laps (the numbers you filter and sort) | Firestore | Queryable, small docs, scales to many sims and users |
| Chart trace for one lap | `gs://botracing-61-lmu/traces/{ownerId}/{lapId}/v1.csv.gz` | Fetched only for laps being overlaid |
| Full session archive | `gs://botracing-61-lmu/archive/{sim}/{sessionId}.parquet` | Our own sim-neutral copy, so analysis can be recomputed later |

The raw `.duckdb` from LMU is never uploaded.

Nothing is deleted on a schedule.

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
