# Lap API

One Cloud Function, `lmuApi`, behind Hosting at `/api/lmu`. It reads only; the PC uploader (`tools/sessions/sync.mjs`) writes. Storage layout: `docs/STORAGE.md`.

## v2: for the redesigned screens

| Route | Returns |
| --- | --- |
| `GET /sessions?age=<days>&track=<trackId>` | `{items, total}`: sessions newest first (default 30 days). Per item: track, car, type, start/end, weather, lap and comparable counts, best/median/spread, `stints`, `bestLapId`, and `series`/`eventId` when known. |
| `GET /sessions/{id}` | The whole session doc: `lapTable`, `stints`, `consistency` (overview, pace trend, off-pace laps, corners, damage checks, thresholds), `band` pointer, `trackMapSource`. |
| `GET /sessions/{id}/laps` | `{items}`: every lap doc in driving order. Time, sectors, stint, `excluded` and why, off-track and past-edge seconds, impact, compound, wetness, per-section facts with `parts` per corner, and `trace.path`. |
| `GET /sessions/{id}/band` | Median and p10/p90 of speed, throttle and brake every `stepM` metres over the comparable laps. |
| `GET /sessions/{id}/map` | The track's corner map (sections with their corners), plus, when fitted, `georef`, `quality` (`good`/`fair`/`poor`), `qualityNote`, `attribution` and the OSM `outline` (GeoJSON). Draw on a real basemap only when `quality` isn't `poor`. |
| `GET /laps/{id}/csv` | One lap's 100 Hz trace: `Speed,LapDistPct,Lat,Lon,Brake,Throttle,RPM,SteeringWheelAngle,Gear,OffAsphalt`. Lat/Lon (10 Hz) and Brake/Throttle (50 Hz) are empty on rows where they recorded no sample. |
| `GET /uploaders` | `{items}`: one status per PC uploader (`tools/uploader/`): `hostId`, `version`, `lmuFound`, `state` (`waiting-for-game`, `recording`, `syncing`, `error`), `lastSeenAt`, `lastUploadAt`, `lastSessionId`, `queue`, `sessionsDone`, `lastError` `{at, message, path}`, `disk` `{captureBytes, freeBytes}`, and `recorder` `{state, gameVersion, layoutOk, layoutReason, lastChunkAt}` or null. Times are ISO. |

Unknown ids return 404. Lat/Lon in traces are the sim's coordinates. Real metres, but placed around a fake origin; apply `georef` (`src/analysis/geo.ts`) to put them on the real map.

## v1 (legacy, for the current screens)

`GET /tracks` and `GET /laps?age=&tracks=&event=` return laps in the old Garage 61-style shape. They go away with the old screens.
