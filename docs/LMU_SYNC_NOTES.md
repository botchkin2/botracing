# LMU sync notes

Working notes for adding Le Mans Ultimate laps to this app. Written 2026-09-25 from this PC. Nothing here is committed as a decision until we start the work.

> **Status, 2026-09-30:** these are the original planning notes. The Garage 61 client and its proxy (`garage61Proxy`, the OAuth handlers and the `/api/garage61/**` rewrite), the old `tools/lmu-sync` extractor and the `sample_data/` files described below were deleted; laps now reach the app through the sessions uploader (`tools/sessions`, `tools/uploader`) and the LMU API in `functions/`. Read `docs/API.md` and `tools/uploader/README.md` for how it works today. What follows is kept for the LMU file findings.

## This machine

| Thing                  | Where                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| Repo                   | `C:\Users\Botkin\Projects\garage61-session-analysis`                         |
| Remote                 | https://github.com/botchkin2/garage61-session-analysis (`main` at `2765b12`) |
| LMU install            | `C:\Program Files (x86)\Steam\steamapps\common\Le Mans Ultimate`             |
| Recorded laps          | `...\Le Mans Ultimate\UserData\Telemetry\*.duckdb` (543 files, about 10 GB)  |
| Auto record            | On, in `UserData\player\Settings.JSON`                                       |
| Channel rates          | `UserData\Telemetry\config.json`                                             |
| DuckDB file version    | v1.4.0 (CLI used to inspect: DuckDB 1.4.2)                                   |
| Coach Dave Delta cache | `C:\Users\Botkin\AppData\Local\CoachDaveDelta\app-6.2.0\resources\*.delta`   |
| Garage 61 agent        | Installed. It uploads iRacing `.ibt` files only.                             |

Delta's `.delta` files are a private format and live inside the app's version folder, so they get left behind on an update. The DuckDB files are the source we will read.

## What the app already expects

The phone never talks to Garage 61 directly. It calls Firebase Hosting (`botracing-61`), which rewrites `/api/garage61/**` to the `garage61Proxy` Cloud Function (Node 22, `us-central1`). That function holds the OAuth session and forwards to `https://garage61.net/api/v1`.

_Removed 2026-09-30: the Garage 61 lap list and its CSV parser (`src/utils/dataProcessing.ts`) no longer exist. The column facts below are how that export looked._

`LapDistPct, Lat, Lon, Brake, Throttle, RPM, SteeringWheelAngle, Speed, Gear`

The old sample export (Road Atlanta, deleted) showed:

- `Speed` is meters per second (about 63 m/s in 5th gear, not km/h).
- `Throttle` and `Brake` are 0 to 1.
- `LapDistPct` is a 0 to 1 fraction. The parser multiplies by 100.
- `SteeringWheelAngle` is radians, the iRacing channel.
- `Gear` is an integer.

The chart code only reads those nine columns. Extra columns in the sample (`Clutch`, `ABSActive`, and so on) are ignored.

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

Recorder x/z is not the road: at Road Atlanta T7 (1,950 to 2,150 m) it sits about 8 m off the measured road for every car, the player included, while `Path Lateral` and lap distance agree with the trace (pit-wall #3833). The Race map therefore puts each car's x/z onto the measured centre line near its lap distance (`projectOnLine`, within 30 m), then offsets it by `Path Lateral` to the right of travel. Raw x/z is used only where lap distance is missing or the projection is more than 30 m away (#455).

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

Steering is the one column we cannot make match iRacing. Two LMU laps compared with each other can share percent-of-lock in that column and the existing chart will overlay them. An LMU lap overlaid on an iRacing lap will not have a meaningful steering trace. That is acceptable for the first version, because the two sims are separate sessions.

## Dev tools installed 2026-09-25

- Git was already present (`git 2.55.0`).
- GitHub CLI `2.101.0` via winget (`GitHub.cli`). Not logged in yet. Run `gh auth login` once, in a terminal, and approve it in the browser.
- Node.js `24.19.0` LTS via winget (`OpenJS.NodeJS.LTS`). Cloud Functions in this repo are pinned to Node 22 at deploy time. Node 24 is fine for the Expo app and for the sync script on this PC.
- PowerShell's default execution policy blocks `npm.ps1`. Use `npm.cmd`, or allow local scripts for the current user (`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).

Python is not installed (the `python` command is the Microsoft Store stub). We do not need it. The sync script should be Node, same language as the app and the Cloud Functions.

## Storage status

Botkin has not approved the current store. One CSV per lap in Cloud Storage is only for this testing round. See `pit-wall/decisions/lap/2026-09-26-storage-not-approved.md`.

## Cloud

Deploy is already automatic. A push to `main` runs two workflows:

- `.github/workflows/firebase-functions-deploy.yml` builds `functions/` on Node 22 and runs `firebase deploy --only functions`, using the `FIREBASE_SERVICE_ACCOUNT_BOTRACING_61` secret.
- `.github/workflows/firebase-hosting-merge.yml` builds the Expo web app and deploys Hosting to the live channel. Pull requests deploy a Hosting preview.

`firebase.json` rewrites `/api/garage61/**` to the `garage61Proxy` function. There is no Storage or Firestore rules file in the repo. Firestore is already used for the Garage 61 session cookie.

LMU does not go through Garage 61. A lap is the thing you overlay. A stint is the group those laps came from.

One lap at chart resolution (about 10 samples per second, nine channels) is on the order of 50–100 KB of JSON. That fits in a Firestore document, whose limit is 1 MB. A whole stint does not, so the stint is not one document and it is not one Storage object either. A Storage object per stint would make "my best lap from last week" download that entire old stint.

Firestore, which this project already uses for the Garage 61 session:

- `lmuStints/{stintId}` is the row in the list: track, car, session type, start time, lap count, id of the best timed lap.
- `lmuLaps/{lapId}` is one lap: stint id, lap number, duration, game lap time, tags (`inPit`, `leftAsphalt`, `gameDidNotTime`), and the trace arrays.
- The PC uploads a stint by writing those documents through `lmuSync`. The function checks a sync token stored like the OAuth secrets (`firebase functions:secrets:set`).
- The phone calls `/api/lmu/**` (another Hosting rewrite). One call can be "this stint" or "these lap ids". The function reads the lap documents and returns one JSON body, so opening a stint is still a single download, and overlaying last week's best lap is those ids plus one extra id in the same call.
- A pinned reference is just a lap id saved on the phone. Same track and car is how you find the best one (`lmuStints` already stores that lap id per stint).

Firestore rules go in the repo and deploy with the functions workflow (`firebase deploy --only functions,firestore`). No Storage bucket. If traces later grow past what a document can hold, the trace arrays can move to Storage and the lap document keeps the summary and a pointer. That is a later change.

Adding the function and the rewrite is enough for CI. The next merge to `main` ships it. The Windows script is not in CI. It only runs on this PC, where the DuckDB files are.

## App shape

Pick the source on the way in: Garage 61, or LMU. They stay separate lists. Garage 61 laps use Garage 61 ids and the per-lap CSV API. LMU laps use ids we assign, grouped by stint.

Today the compare screen fires one telemetry request per lap and, by default, pre-selects only `lap.clean`. For LMU the screen asks for the stint's lap ids in one call, and can add a lap id from any other stint on the same track. Each lap carries tags so you can hide pits and untimed laps, and they are present either way.

Garage 61 can later get the same "one download for this set of laps" treatment by bundling those CSVs in a function. That is independent of LMU.

## Phases

Botkin set the order. Detail and the open question on upload timing are in `pit-wall/threads/003-phases.md`.

1. Playable MVP on this PC: overlay, playback, delta along the lap, and a mark where a wheel left the asphalt.
2. Upload program. Proposed trigger is "the recording file stopped growing," not a live stream and not a midnight batch. Not built yet.
3. Architecture cleanup of the existing app, after the MVP shows what is worth keeping.
4. Design pass. Consistency and mobile playback are the thing to make excellent.

## Try it

_Removed 2026-09-30: the `LMU try` screen, its `sample_data/lmu/stint.json` and `npm run lmu:extract` were replaced by the sessions uploader and the real Session, Compare and Corner screens._

## Execution plan

1. **Read one stint locally.** _(Done, then replaced by `tools/sessions`.)_ Open one `.duckdb` and print every lap segment, with duration, pit tag, and left-asphalt tag. No upload.
2. **Write laps the phone can mix.** Downsample every lap onto lap distance. Save one local JSON per lap, plus a stint record that lists those lap ids and the best timed lap. Load two laps from different files into the compare screen, including a pit lap and an untimed lap.
3. **Remember what was uploaded.** A local ledger of path, size, and modified time. Skip a file the game still has open.
4. **Upload through the new function.** Write `lmuStints` and `lmuLaps`. Deploy by merging to `main`. Set the sync token with `firebase functions:secrets:set` once.
5. **Source picker.** After sign-in, choose Garage 61 or LMU. Opening an LMU stint fetches that stint's laps in one call. Pinning a lap stores its id so another stint can request it in the same call.
6. **Run it in the background.** A scheduled task on this PC. First run can walk the existing files.

Out of scope until the overlay works: tyre and brake channels, the setup JSON, live shared memory, official track-limit points, and Dave Delta's files.
