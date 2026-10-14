# Session pipeline

How a drive becomes a stored session, and what every session must have. This
is the one place that says it: STORAGE.md, LMU_SYNC_NOTES.md and the code
comments point here. A claim in this file that something "adds nothing" or
"is covered" names the test that proves it, or it is not made.

## Flows

There are three, and no others.

| Flow | When | Input | Who runs it |
|---|---|---|---|
| A. Recorded drive | the tray's recorder ran during the drive | the capture (live during, final at the end of the drive) | the tray |
| B. Unrecorded drive | before install, tray off, recorder off, older sessions | the game's file (.duckdb, .ibt) | the tray |
| C. Repair | a stored session is stale (rules or catalog changed) | the stored archive and stored inputs | the cloud |

### Tray side (torsion)

### The recorder

- **LMU:** `desktop/src-tauri/src/capture/recorder.rs` reads LMU's shared memory (`LMU_Data`) and writes parquet chunks per minute: `player-NNNN` (telemetry at ~100 Hz, every field of the player's `TelemInfoV01` incl. `mWheel[4]` as `fl_/fr_/rl_/rr_` columns), `field-NNNN` (scoring at 5 Hz, every car), `session-NNNN` (scoring info at 5 Hz), `meta.json` (track, start and end, vehicle models per car id), and `status.json` (state, sessionDir, lastLapAt, gameVersion, layout check).
- **iRacing:** `capture/ir_recorder.rs`, the same folder shape from the iRacing SDK.
- A new capture folder starts on each game session; a reset to the garage splits the stretch inside it.
- **What the capture holds that the game file does not:** every other car (the field) and the damage series. **What only the game file holds:** the car setup (tank and fill limit, LMU `VM_FUEL_LEVEL`) and LMU GPS.

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

<!-- sidepod: feature table (feature, built by, source per flow, test that proves it / "none today") -->

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
| GPS | **missing** (LMU) | LMU `.duckdb` | allow-listed |
| Weather | **missing** until #619 | game file | **none today** |

## Analysis

<!-- sidepod: one engine, its callers and the inputs each passes -->

## Store

<!-- sidepod: uploadSession / uploadLive / what a write keeps from the stored doc -->

## App

<!-- sidepod: how the app learns a session changed and what it reads -->

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
3. GPS for flow A (LMU): read the game file by time when it lands, as one input of flow A, not a second build.
4. A raw LMU_Data fixture: a few seconds of real shared memory from a normal drive, kept by the tray in its own folder and stored as test data only with Botkin's OK (it holds other drivers' names). The recorder test then runs on real game memory.
5. The script-era cleanup above.
