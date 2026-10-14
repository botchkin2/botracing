# Session pipeline

How a drive becomes a stored session, and what every session must have. This
is the one place that says it: STORAGE.md, LMU_SYNC_NOTES.md and the code
comments point here. A claim in this file that something "adds nothing" or
"is covered" names the test that proves it, or it is not made.

## Design (target)

One flow. Only the reader depends on where the drive came from.

1. **One source per drive.** The capture if the recorder ran, else the game
   file (.duckdb, .ibt). Never both, never a supplement: for LMU the game file
   adds nothing the analysis reads that the capture lacks, except the setup's
   fill limit, which gets its own reader of LMU's setup (gap). This is
   unproven until the parity diff (gap) runs in CI. The 2026-10-14 Silverstone
   diff (pit wall #5324) is the evidence so far.
2. **Readers** turn a source into the same thing: per-lap archive parts
   (samples, events), the recording descriptions, and the inputs
   (`sessionInputs()`: field, damage, race length, setup, event), each a value
   or `{absent: reason}`. Readers are the only sim- or source-specific code.
3. **One uploader** sends parts as they exist: each lap as it closes during a
   drive, all of them at once for a drive found later (the backlog), and a
   closing run at the end of a drive (`liveClosed`). The same code, order and
   idempotency (md5) in every case.
   For a backlog drive, the reader also writes the lap count and best lap from
   the game's own times into the session doc. The list row is then complete
   before any analysis, and the manifest checks it.
4. **Session identity.** Whoever uploads a drive first mints its id. Every
   later source asks the store first: is there a session of this owner, sim
   and layout whose time overlaps? If so, it uses that id and mints none. One
   id function, imported everywhere (today `sessionFiles.mjs groupFiles` and
   `ownerCopy.mjs` each derive ids, and they differ on `groupId`). The cover
   rule no longer lives in a local file (`work/live/index.json`), which a
   reinstall or a new PC loses.
5. **One analysis, in the cloud** (`runAnalysis` → `analyzeStored` →
   `analyzeFromArchive`), over the stored parts and inputs. Triggers: a live
   lap lands (`liveAnalyze`); a stale session is opened (rules or catalog
   changed, or a backlog session never analysed; no compute on sessions never
   looked at).
   - **Incremental:** `analyzeParts(new parts)` → per-lap facts, stored with
     each lap's grid; `aggregate(all lap facts + inputs)` → the session
     (lap numbers, stints, slow and comparable, laps left, hot pressure,
     consistency, band, class, result, plan). A run costs its new laps plus a
     cheap aggregate, not the whole drive again.
     - Preconditions: the grid length comes from the curated map's `lengthM`,
       not the best lap's distance (`analyze.mjs` 1038-1050).
     - A track with no curated map gets a full re-run.
   - **Concurrency:** one run per session under a token lease no shorter than
     the function's timeout. Every session write is fenced on the token, so a
     run that lost its lease writes nothing (#622).
   - **Measurement gate:** the PC stops analysing only after one measured run,
     as seat-test, on the longest stored race, through `analyzeApi` (120 s)
     and `liveAnalyze` (300 s): peak memory and time. Until then the PC's
     analysis stays.
6. **Every analysis checks the feature manifest** and stores the misses on the
   session (Settings > Problems).

**Repairs.**
- A rule change re-runs the analysis from the stored parts.
- A recorder bug needs the raw source again: the capture (pruned 14 days after
  the drive) or the game file. Such a repair is the same reader and uploader,
  under a version. It must run before the captures it needs are pruned. The
  per-wheel repair of the 0.1.9-0.1.10 captures (#619) has that deadline.

**Off-track (on the plan list, not on this design's path).** Two separate facts,
never merged:
- **INV:** the game's own track-limits call (`mCountLapFlag`, lap time −1).
- **OFF:** our geometry: all four wheels past the line (the centre past the
  edge by more than half the car's track width), or 2+ wheels on grass, dirt or
  gravel.

Today the surface rule cannot see tarmac run-off (it reads code 0, the same as
the track; pit wall #5382, #5387). One open question first: whether LMU's
Track Edge is the white line or the outer edge of the kerb.

## Today

What runs now, with file:line. Each part that differs from the design above is
a gap at the end.

### Tray side (torsion)

### The recorder

- **LMU:** `desktop/src-tauri/src/capture/recorder.rs` reads LMU's shared memory (`LMU_Data`) and writes parquet chunks per minute: `player-NNNN` (telemetry at ~100 Hz, every field of the player's `TelemInfoV01` incl. `mWheel[4]` as `fl_/fr_/rl_/rr_` columns), `field-NNNN` (scoring at 5 Hz, every car), `session-NNNN` (scoring info at 5 Hz), `meta.json` (track, start and end, vehicle models per car id), and `status.json` (state, sessionDir, lastLapAt, gameVersion, layout check).
- **iRacing:** `capture/ir_recorder.rs`, the same folder shape from the iRacing SDK.
- A new capture folder starts on each game session; a reset to the garage splits the stretch inside it.
- **What the capture holds that the game file does not:** every other car (the field) and the damage series. **What only the game file holds:** the car setup's fill limit (LMU `VM_FUEL_LEVEL`). LMU has no real GPS in either source: its `.duckdb` and the capture both give world position projected onto LMU's fake origin at 60° N, 0° (`src/analysis/geo.ts` LMU_FAKE_ORIGIN; sidepod #5369), and the app georeferences both the same way.

### Flow A: a recorded drive

1. **During the drive (live):** the watcher (`tools/uploader/watch.mjs`) runs `sync.mjs --live <capture>` when the recorder reports a new lap on disk (`status.json` lastLapAt; `trigger.mjs` decideLive). That runs `syncLive.mjs`:
   - `describeCapture` cuts the capture into stretches and laps (`lmuCapture.mjs` / `irLiveCapture.mjs`);
   - each finished lap becomes one archive part, `samples.N` + `events.N` parquet (`writeCaptureArchive`), written once;
   - `liveInputs.mjs` builds the field (`field.mjs fieldFor`, LMU) and the capture extract (damage, race length) from the same capture;
   - `store.uploadLive` sends the parts not yet in the bucket (md5), the field when its content changed, the extract, then the recording docs and the session doc (merged). It writes **no lap docs**.
   - The server's `liveAnalyze` (an event function on the session doc's `live.updatedAt`) analyses the session from the stored parts, field and extract, and writes the lap docs. A lap is in the app ~5-30 s after the line.
2. **End of the drive, defined:** the recorder's `status.json` stops saying `recording` for the capture live laps were following (game exit, back to the menus, a new session). Before #619 the watcher waited for `sessionDir` to change, and the recorder keeps the old one on a game exit, so the last lap never went up (L27 on 2026-10-14).
   **When the capture closes:** the recorder stops recording (game exit, back to the menus, a new session) and `trigger.mjs liveClosed` makes the watcher run the live path once more. That sends the last lap and the stretch after the final crossing. It is the same code; there is no second, "final" build.
3. **Session id:** the live session id stands for the drive. After the game exits, flow B skips the drive's game files (`liveCover`), so they never create a second session.

### Flow B: game file only

After the game exits (and on a timer), the watcher runs `sync.mjs` per sim:
- it scans the telemetry folder, groups recordings into sessions (`sessionFiles.mjs`) and skips files the live index covers;
  - except a capture whose four wheels read as one (the 0.1.9-0.1.10 recorder, `brokenWheels.mjs`): it covers nothing, and the game file builds the drive with the real wheels. Its live session is deleted by hand (`deleteSessions.mjs`) after the owner says yes;
- `build()` converts each recording to the neutral archive, runs `analyzeFromArchive` locally (the field and extract come from a capture if one is on the PC, else none), and `store.upload` sends archive, laps, traces, slices, field and session.

### Tests that cover this half

- **Contract (every tray message against the server's rules, real payloads):** `contract/`, `functions/test/heartbeat.test.mjs`.
- **Replay gate (CI, `contract-replay`):** the golden live capture replayed through the real watcher into the emulators; asserts every lap's rows exist with nobody opening the session, the heartbeats are accepted, and (with #619) the field exists.
- **Parity diff (CI, sidepod):** the golden pair built through flow A and flow B; fails on any difference outside a short reviewed allow-list.
- **Recorder (cargo):** layout, columns and probe tests; the four-wheel tests above.
- **Release gate:** the installed tray's own node and uploader replay a capture against production as seat-test (`release-tray.yml` live job).

## Feature set

Every session has each of these, or names why not (`{absent: reason}`), never
a silent null.

### Analysis-side rows (sidepod), to merge into the table

What the analysis builds, from which input, and what proves it. **R** is a test
on real recorded data, **S** a stub or synthetic input. The golden set
(`tools/golden`) runs `analyzeSession` alone (`golden.mjs:28`), so it covers
nothing that comes from an input or from the store: field, damage, race
length, event, kept values.

| Feature | Built in | Input | Test |
|---|---|---|---|
| Lap time, sectors, timed | `analyze.mjs analyzeLap` (548, 600-625) | `lap`, `lap_time`, sector events | golden (R, game file); `lmuCapture.test.mjs:88` capture = game file on the same laps (R); `irLiveCapture.test.mjs:107` (R) |
| Partial, reset (`partial`, `endedInReset`, `afterReset`) | `analyze.mjs analyzeSession` (979-1005), `gridLap.mjs partialWhy` | recording boundaries, `lap_dist` | golden `partial` (R, game file); capture: `lmuCapture.test.mjs:187,217` clock restart (R). Reset laps from the capture: **none today** (#619) |
| Pit in/out, pit stop and visit | `analyze.mjs` (588-590, 641), `fuelFacts.mjs lapPitStop`, `pitVisit.mjs` | `in_pits`, fuel and tyre channels, damage | golden (R, damage null); visit with damage: `pitVisit.test.mjs`, `keepCapture.test.mjs` (S) |
| Stints | `analyze.mjs` (963-1009, 1273) | derived | golden (R); `lmuCapture.test.mjs:88` (R) |
| Fuel per lap and session fuel | `fuelFacts.mjs lapFuel`, `stintFuel`; `analyze.mjs` 1229-1236 | fuel/VE channels; `recording.fuelSetup` (tank, fill limit) | golden (R, game file); fill limit: `fuelFacts.test.mjs:205` (S). From the capture: **none** (the capture has no fill limit, `lmuCapture.mjs:217`) |
| Tyres per wheel | `tyres.mjs lapTyres`, `settleHotPressure` | tyre channels per wheel | `tyres.test.mjs` (S); golden checks only the tyre change (R). Four distinct wheels on real data: **none today** |
| Off track | `analyze.mjs` (553-573, 609-611) | `surface` events per wheel | golden (R, game file only); from the capture: **none today** |
| Corners, start straight, slices | `analyze.mjs` (1084-1141), `cornerFacts.mjs`, `cornerSlices.mjs` | trace, curated map and boundaries | golden corners (R); slices `cornerSlices.test.mjs` (S) |
| Consistency, band | `analyze.mjs` (1043-1052, 1146-1206) | derived | golden (R) |
| Field file | `field.mjs fieldFor` (LMU), `irField.mjs irFieldFor` (iRacing), named by content (`analyzeFromArchive.mjs` 225-231) | the capture's field chunks | `field.test.mjs` (S, synthetic capture). On a real capture through upload and analysis: **none today** (#619 replay assertion) |
| Class laps, class bests, result | `src/analysis/classLaps.ts`, `raceResult.ts` (`analyzeFromArchive.mjs` 292-304; again in `store.mjs` 433-459 from the stored field) | field | `classLaps.test.ts`, `classBests.test.ts`, `raceResult.test.ts` (S) |
| Traffic per lap and session | `lapTraffic.mjs` (`analyzeFromArchive.mjs` 196; `store.mjs` 412-421, 460-468, 508) | field | `lapTraffic.test.mjs` (S) |
| Damage | `playerDamage.mjs damageFor`, stored as the capture extract (`captureExtract.mjs`) | capture | `neverResync.test.mjs:57` (S); `damageFor`: **none** |
| Race length | `raceLength.mjs raceLengthFor` (LMU), `.ibt` YAML (iRacing) | capture / .ibt | `raceLength.test.mjs`, `keepCapture.test.mjs` (S) |
| Weather | `analyzeFromArchive.mjs:249` from `recording.weather` | game file (`lmu.mjs:178`); the capture sets `''` (`lmuCapture.mjs:218`) | **none** |
| GPS | trace and map channels (`analyze.mjs` 683-702, 796-810, 841) | LMU has no real GPS in either source. Its .duckdb "GPS" is world metres projected at a fake origin, 60° N 0° E, and the capture reproduces it (`lmuCaptureChannels.mjs:24-25`). Road Atlanta 2026-10-03: game lat 59.98591-60.0005, capture 59.985907-60.000501. The app places both in that frame (`geo.ts:42`, `mapPlace.ts:121-124`). iRacing's .ibt GPS is real; the live iRacing capture's is unchecked | `geo.test.mjs` (S + one real sample); capture vs game file on the same drive: **none** (parity diff) |
| Track map, boundaries | `analyze.mjs planTrackMap`, `catalogStamp` | curated `tracks/` and `trackBoundaries/` docs | `catalogOnly.test.mjs`, `catalogStamp.test.mjs` (S); golden `trackMapSource` (R) |
| Online event (series, eventId) | `sync.mjs eventsOf` (`lmuEvents.mjs`) → `analyzeFromArchive.mjs` 251-252 | LMU trace logs on the PC, read only by the game-file sync. **Live sessions: never set** (`liveSessionDoc` has none; the skipped sync step was the only caller, same cause as the field) | `lmuEvents.test.mjs` (S); live: **none** |
| Plan | `planBlock.mjs` (`store.mjs` 501-507) | fuel, laps, race, result | `planBlock.test.mjs` (S, one real race fixture) |

### Tray-side rows (torsion), to merge into the table

| Feature | Flow A source | Flow B source | Test |
|---|---|---|---|
| Every finished lap, timed by the game, or flagged invalid with its line-to-line time | capture `lap` / `lap_time` events (the −1 the game gives an invalidated lap) | game file | **none today** (parity diff, sidepod, after #619) |
| The last lap of the drive | the closing live run (`liveClosed`, #619) | game file | `trigger.test.mjs liveClosed` (#619); replay gate: **none today** |
| Reset laps partial, the next stint starting on "reset" | capture recording boundaries; the end-of-recording lap event is the reset, not a crossing (#619) | game file boundaries | **none today** (#619, parity diff) |
| Four distinct wheels (wear, pressure, temps, surface) | capture `mWheel[4]`, stepped by `Layout::size_of` (#619) | game file | `columns.rs each_wheel_reads_its_own_slot_of_mwheel`, `probe.rs a_wheel_by_position_is_its_own_slot` (#619, fixture header bytes); on real game memory: **none today** |
| Other cars, class times, result, traffic | capture field (`liveInputs.mjs`, #619) | capture field if on the PC, else none | `uploadLive.test.mjs` field tests (#619); replay gate field assertion: **none today** |
| Damage (repair detection), LMU race length | capture extract (#619) | capture extract if on the PC | **none today** |
| Fuel and the fill limit | **missing** (see *Gaps*) | game file setup | **none** |
| Position (LMU's fake-origin lat/lon) | capture, LMU's own convention (`lmuCaptureChannels.mjs:24-25`, same frame as the `.duckdb` to ~0.3 m) | game file | **none today** (a parity row) |
| Weather | **missing** until #619 | game file | **none today** |

## Analysis

One engine: `tools/sessions/analyzeFromArchive.mjs` turns a session's archive
plus its inputs into the session doc, lap docs, traces, slices, band and field
file. It runs in Cloud Run (`functions/src/engine.ts` loads it) and on the PC.
Its inputs are everything that is not in the archive: the recordings'
descriptions, the curated track map and boundaries, `fieldFor`, `damage`,
`raceLength`, `event`, `catalogOnly`.

**Today the callers pass different inputs, and that is what broke on
2026-10-14:**

| Caller | Runs | fieldFor | damage, race length | event | fuel setup |
|---|---|---|---|---|---|
| `sync.mjs build()` | PC, flow B | `fieldFor` / `irFieldFor` on the PC's capture | `damageFor`, `raceLengthFor` on the capture | `eventsOf` (trace logs) | `recording.fuelSetup` from the game file |
| `analyzeStored.mjs` | cloud: `liveAnalyze` on each live lap, `analyzeApi` when a stale session is opened | **always none** (`:160`); the store keeps a stored field, and a live session has none to keep | from the stored capture extract; live sessions had none before #619 | the stored session's | from the recording doc; a live recording has no fill limit |
| `irLiveParity.mjs`, `lmuCapture.test.mjs` | tests | none | none | none | as described |

**Target** (gap 1 below; #619 starts it with `liveInputs.mjs`): one
`sessionInputs()` gathers every input for every caller. Each is a value or
`{absent: reason}`, never a default null, so a caller that does without one
says so where a reviewer and the manifest check see it. The cloud reads stored
inputs (field file, capture extract, setup on the recording doc), and the PC
stops analysing (*Repair paths*).

**Today, when the cloud analyses** (`functions/src/analyzeCore.ts runAnalysis`):
- a live lap lands: `liveAnalyze` fires on `live.updatedAt` (`liveLapLanded`);
- a stale session is opened: the app posts `/api/analyze/{id}` (stale = older
  rules or catalog, `analyzeStored.mjs staleNow`).

A run that takes the lease over a session that is already current
(`engine.ts isSessionStale`, the test the session route answers with) writes
nothing and answers done, so an open after a live lap's run, a retry or a
second tab never runs the analysis twice. That test needs no DuckDB: only the
functions that analyse stage its binary in /tmp (`engine.ts analysisEngine`),
which is memory on Cloud Run (dataApi has 256 MiB).

Both take one lease per session (`analysisRuns/{id}`, 330 s); a second caller
gets 202 and waits. A run that sees the live stamp move runs again, at most 3
times.

## Store

**Today.** `tools/sessions/store.mjs` writes over a backend (Admin on the PC,
HTTP from the tray, the same calls in the cloud).

- **`upload`** (after an analysis): the session, its laps (laps the run did not
  make are deleted), traces, slices, band, field file, capture extract.
- **`uploadLive`** (the tray, each lap): parts (md5), recording docs, the
  session doc merged. No lap docs, no analysis; what the last analysis wrote
  stays until the next one.
- **`keepNewerLive`**: a cloud write never moves `live` or `archiveParts`
  backwards; a lap that landed during the run leaves the session stale.

**What `upload` keeps from the stored doc when its run lacked an input**
(`store.mjs` 387-499): the field and the class laps, bests and result made
from it; lap traffic redone from the stored field; the LMU race length; pit
visits built from damage. Each kept block is named in `analysis.kept`.

These keep rules are inputs in disguise: they are why a cloud run without a
field looked fine for every game-file session and silently empty for every
live one.

**Target** (gap 1): `sessionInputs()` reads the stored field and extract as
inputs, and the keep rules are deleted.

Tests: `uploadLive.test.mjs`, `keepCapture.test.mjs`, `field.test.mjs:248`,
`sessionLast.test.mjs` (S, stub backends). A real session through upload and
analysis against the emulators: `functions/test/replay/run.mjs` (R), which
checks only that laps land in time.

## App

**Today.** The app reads the session doc, then its laps, band, field and
traces (`src/data/sessions/queries.ts`). It never builds a session.

- **Sessions list:** read on mount and focus, and again when `/uploaders`
  (one small call a minute while the list is open) reports a new upload
  (`useNewUploads`).
- **An open session:** read every 5 s while `live.updatedAt` is under 10 min
  old (`live.ts livePoll`, `queries.ts:73`). When the doc's `updatedAt`
  changes, laps and band are read again (`queries.ts` `useSession`). A drive
  that resumes after 10 quiet minutes is not seen until the screen is left and
  reopened.
- **Stale on open:** the app posts `/api/analyze/{id}` once per id and part
  count (`analysisOnOpen.ts`, `queries.ts:86`). For a live session
  `liveAnalyze` already runs each lap, and the post only joins its lease (prod
  2026-10-14, seat-test: 3 posts, 202 in 0.13-0.15 s, no second run).

**Target.** A session live in the last 2 h listens for uploads to it, so a
resumed drive shows (#618, open). The post on open stays for rule changes and
the backlog, and is skipped while a session is live.

Tests: `src/data/sessions/*.test.ts` (S); the screen side of live laps is the
release gate's pane check (`tools/dev/liveE2E.mjs`, R, prod as seat-test).

## Repair paths

<!-- torsion + sidepod: analyze-on-open, archiveRepair, capture-extract backlog, ownerCopy: keep, merge or delete -->

### Tray side (torsion)

Today's tray-side repairs, each a one-time pass recorded in its own state key, and what happens to each:

| Repair | What it does | Verdict |
|---|---|---|
| `archiveRepair.mjs` (`state.archiveRepair`) | iRacing archives written with guessed column types (0.1.10) re-sent | **merge** into one versioned repair runner |
| `uploadCaptureBacklog` (`state.extracts`) | capture extracts for sessions uploaded before extracts existed | **merge** (same runner) |
| live field backfill (`watch.mjs`, #619) | live sessions since 0.1.9 get their field from their capture | **merge** (same runner) |
| live per-wheel repair (#619, planned) | the two live sessions from the 0.1.9-0.1.10 recorder rebuilt from their game files under their live ids | **merge** (same runner); then deleted once both have run |

One runner, one state key per session (`repairs: {name: version}`), each repair a small module with a test. The server's analysis on open (a stale stamp re-analyses) and `ownerCopy` are sidepod's half.

### Server and app side (sidepod)

| Path | What it does | Verdict |
|---|---|---|
| Analysis on open (`analyzeApi`, stale stamp) | a session made under older rules or catalog is analysed again when opened | **keep**, as the one cloud analysis with a second trigger; it is how the backlog is analysed (no compute on sessions never looked at, `decisions/lap/2026-10-12-analysis-on-open.md`) |
| `liveAnalyze` | analysis on each live lap | **keep**: the same `runAnalysis` |
| `ownerCopy` / `migrateOwner.mjs` | one-time copy of Botkin's data from owner key `botkin` to his uid | **not a flow**: an ops tool, out of this document; delete once the switch is done (docs/OWNER_COPY.md) |
| Keep rules in `store.upload` | stored field, class blocks, race, visits kept when a run lacks the input | **delete**, replaced by `sessionInputs()` reading the stored inputs |
| PC-side analysis (`sync.mjs build` → `analyzeFromArchive`) | flow B analyses on the PC | **delete** with the one-uploader design: flow B uploads parts and the session is analysed on open. The corner-boundary fold (`build(..., {foldOnly})`) needs a home first (curation) |

## Script-era cruft

<!-- both: what goes -->

### Tray side (torsion)

The pipeline started as separate scripts run by hand; the tray now runs them as child processes. What is left over:

- **sync.mjs's command-line surface.** `--local`, `--rebuild-track`, `--events-only`, `--list`, `--check`, `--force`, `--owner`, `--only`, `--since`, `--first-window-days`, `--folder`, `--log-folder`, `--jobs`, `--quiet-min`: the tray passes a fixed few. Each flag the tray does not pass is either a curation tool (moves to `tools/curate`) or goes.
- **Configuration by environment variables** (`LAP_API`, `LAP_UPLOADER_HOME`, `LAP_TOKEN_FILE`, `LAP_HEARTBEAT_FILE`, `LAP_CAPTURE`, `LAP_SIM`, `LMU_TELEMETRY`, …): the tray sets them on the sidecar; one typed config the tray writes replaces them.
- **Three state files with overlapping jobs:** the watcher's `state.json`, sync's `state.json` per sim, and the live index. One record per session: its flow, its uploaded parts and the repairs it has had.
- **Old folder names:** `%LOCALAPPDATA%\lap-sessions` and `lap-uploader` beside `BotRacing\`; captures in `lap-capture` (shared with the Python tools).
- **The Python recorder** (`tools/capture/`): superseded by the tray's Rust recorder. It stays only as long as captures it wrote are read (14 days after the last one; it already wrote none since 2026-10-13).
- **Profiles share the capture folder** (#5281): a `BOTRACING_PROFILE` tray records into, and prunes, the real tray's captures unless `LAP_CAPTURE` is set. A profile gets its own capture folder.

## Gaps

<!-- both: every 'none today' above, as a roadmap row -->

### Tray side (torsion)

1. #619: field, last lap, reset laps, per-wheel recorder fix, weather, backfill and repair. In review.
2. Fuel setup (tank, fill limit) for flow A: from LMU's setup (its REST API or the setup file), not the game file. Until then flow A sessions have no fill limit and the Plan says so.
3. ~~GPS for flow A~~: not a gap. LMU's game file has no real GPS either (#5369). iRacing's `.ibt` GPS is real; the live iRacing capture's lat/lon needs the same check before any claim.
4. A raw LMU_Data fixture: a few seconds of real shared memory from a normal drive, kept by the tray in its own folder and stored as test data only with Botkin's OK (it holds other drivers' names). The recorder test then runs on real game memory.
5. The script-era cleanup above.

### Server and app side (sidepod)

1. `sessionInputs()`: one gatherer for every analysis caller, `{absent: reason}` instead of null; the store's keep rules go.
2. Parity diff in CI (`tools/golden`): the golden pair (a capture and the game file of the same drive) through the capture path and the game-file path, every session and lap field compared, failing outside a reviewed allow-list (GPS, start-time precision, out-lap crossing clocks).
3. The feature manifest, in code: run by CI on the golden sessions and by every cloud analysis on the session it wrote; misses stored on the session and shown in Settings > Problems.
4. Golden covers the inputs: the golden runner calls `analyzeFromArchive` with real inputs (field, damage, race length), not `analyzeSession` alone.
5. Online event for live sessions (never set today).
6. Weather from the capture (`''` today).
7. One session id per drive, whichever reader saw it first (tonight's drive was `682524ed` from the capture and `9b96efed` from the game file).
