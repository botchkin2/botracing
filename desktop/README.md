# BotRacing tray app

A Tauri tray icon (no windows) that runs the Node watcher, `tools/uploader/watch.mjs --remote`, and shows its status. The watcher uploads through the upload function with the signed-in user's token (`tools/sessions/storeClient.mjs`); no Admin credentials.

What the tray keeps is in `%LOCALAPPDATA%\BotRacing\`: `status.jsonl` (the watcher's heartbeat, appended; the tray reads its last line), `token` (the user's Firebase ID token, read by the watcher on every request), `uploader\` (the watcher's own state and log).

Menu: a status line, Open BotRacing (the web app in the system browser, where Google sign-in works; the tray has no webview), Pause uploads (stops the watcher), Open data folder, Quit. The watcher stops itself if the tray dies (`LAP_PARENT_PID`, `tools/uploader/parentGuard.mjs`).

Not built yet: a folder picker, the iRacing live recorder. The watcher uploads iRacing `.ibt` files from `Documents\iRacing	elemetry` like LMU sessions.

## Recorder

The tray records LMU's shared memory itself (`src-tauri/src/capture/`), a port of `tools/capture` that writes the same files: `<startUtc>_<track>_<session>/` under `%LOCALAPPDATA%\lap-capture` (`LAP_CAPTURE` overrides) with `meta.json` and 60 s chunks of `player-`, `field-` and `session-NNNN.parquet`, plus `status.json` at the root. Columns are byte-identical to `columns.py` (float32 only when exact; byte-stream-split on floats only).

- **The layout is read from the game's header at run time** (`LMU_SHM_HEADER_DIR`, default the Steam install), as `layout.py` does. No struct offsets are written down here; a type the parser does not know stops the recorder and the menu says so.
- **A frame is kept only when two copies match**; the scoring read is info, vehicles, info, vehicles. The game's lock and events are never touched.
- **Lifecycle:** records when LMU's shared memory appears; a session change (practice, qualifying, race) closes the folder with `endUtc` and opens a new one; so does the game exiting or Quit. A kill leaves no `endUtc`. A full disk keeps the earlier chunks, drops the open one and shows "Recorder: disk full".
- **Cost:** one thread at below-normal priority; it reads only when the scoring clock or the player's elapsed time changed. Pausing uploads does not pause recording; the files upload when uploads resume.
- **One recorder at a time:** it holds the Python recorder's mutex (`Local\lap-capture-recorder`). If `LapRecorder` is running the menu says "another recorder is running". `BOTRACING_RECORDER=0` turns the tray's recorder off.
- **Menu line:** Recording, Waiting for LMU, or the reason it is not recording.

Tests: `cargo test` runs the fake-memory tests. Three need this PC (`cargo test -- --ignored` with `BOTRACING_DUCKDB`, `LMU_SHM_HEADER_DIR`, `LAP_CAPTURE_SAMPLE`), and the soak measures CPU and memory against a fake game: `SOAK_SECS=600 cargo test --release soak -- --ignored --nocapture`.

## iRacing live reader (step 2 of the iRacing plan, not recording yet)

`src-tauri/src/capture/irsdk.rs` reads iRacing's telemetry map (`Local\IRSDKMemMapFileName`) without the SDK: the header and the variable table (name, type, offset, count) are the SDK's self-describing format, so no per-variable offset is written down. A frame is the newest of the rotating buffers by tick count, kept only when that buffer's tick is unchanged after the copy (retried, never the game's lock). The session text is Windows-1252, re-read when the header's update counter moves. `win.rs` opens the map read-only and whole, and never creates it. Nothing is written to disk yet (step 3). Fake-memory tests cover a zero map, a rewritten buffer mid-copy and a torn session text; with iRacing in-car, `cargo test live_iracing -- --ignored --nocapture` reads the real sim and prints the tick rate and a few variables.

## Run it from the repo

Needs Rust (`rustup`) and a C++ toolchain.

```bash
cd desktop/src-tauri
cargo test                      # the status-line tests
cargo build
BOTRACING_ROOT=<repo root> LMU_TELEMETRY=<a telemetry folder> target/debug/botracing.exe
```

`BOTRACING_ROOT` is where `tools/` and `node_modules/` are (installed: `<resources>/app`). `BOTRACING_NODE` overrides the node executable (installed: `<resources>/node/node.exe`, else `node` on PATH). `LMU_TELEMETRY` points the watcher at another folder.

## Sign in

The tray signs in **through the web app**; it has no Google OAuth client of its own. It listens on `127.0.0.1` on a port the system picks, makes a PKCE `verifier`, a `challenge = base64url(sha256(verifier))` and a `state`, and opens `https://botracing-61.web.app/tray-sign-in?port&state&challenge` in the system browser. The person signs in on the site as usual and clicks Continue (the page shows which account); the page asks `POST /api/tray/code` for a one-time code and sends the browser to `http://127.0.0.1:<port>/callback?code&state`. The tray answers only that request (anything else, a wrong state, a request not addressed to `127.0.0.1:<port>`, gets a bare 404 with no CORS headers), then trades code + verifier at `POST /api/tray/token` for a Firebase custom token **in the response body** (never in a URL), and that for a refresh token with Firebase's `signInWithCustomToken`. The code is single use, lives 120 s and is useless without the verifier, which never leaves the tray (`functions/src/trayCodeCore.ts`; the page is `src/features/trayLink`). The refresh token is kept in Windows Credential Manager (service `BotRacing`); the current ID token is written to `%LOCALAPPDATA%\BotRacing\token`, which the watcher reads on every request, and renewed 10 minutes before it ends.

- **The first sign-in of a user starts Paused.** The menu shows the account, the `uid` and the `owner` key the server holds for it. Un-pausing is what confirms that uid; a different uid signing in later is paused again. Nothing uploads while signed out or paused.
- A refresh that fails deletes the token file and shows "Sign in again". Sign out stops the watcher, deletes the token file, then removes the stored credential.
- The Firebase web key (public, it names the project) is built in. `scripts/build.ps1` takes it from `-FirebaseApiKey`, `BOTRACING_FIREBASE_API_KEY`, or the one in `src/auth/firebase.web.ts`, then builds (`-Release` for the installer, `-Test` for `cargo test`). A build without it still runs; the menu says "Can't sign in: built without the Firebase web key".
- Sign in timing out (5 minutes), the browser closed, or the code expired or already used each end with a sentence in the status line and "Sign in" in the menu again.

## Installer

`.scriptsuild.ps1 -Release` (or `npx tauri build` in `desktop/` with the sign-in variables set) builds the NSIS installer. Before bundling it runs `scripts/stage-resources.mjs`, which fills `src-tauri/resources/` (gitignored): `node/node.exe`, `app/` (the uploader's files, chosen by import closure from `watch.mjs`, `sync.mjs` and `store.mjs`, with `app/package.json` `{"type":"module"}`) and `app/tools/sessions/duckdb.exe`. `tauri.conf.json` bundles `resources/app/` and `resources/node/`, which land next to `botracing.exe` (`<install>app`, `<install>
ode`), where `sidecar::find_root` looks first.

- **No native Node addon and no `node_modules`:** DuckDB is the CLI exe, run by `tools/sessions/duck.mjs`; the uploader imports only its own files and Node built-ins. The stage script fails on an npm import, a missing relative import, a non-literal `import()` or a `new Worker` it cannot follow.
- **Pinned binaries:** `node.exe` (v24.19.0, SHA-256 from nodejs.org's `SHASUMS256.txt`) and the DuckDB CLI zip (v1.4.2, SHA-256 from the GitHub release digest) are checked against hashes written in the stage script, whether they come from the cache (`src-tauri/resources/.cache`), from `BOTRACING_NODE_EXE` / `DUCKDB` (local copies; never `NODE`, which npm sets to the running node), or are downloaded. A mismatch fails the build. To change a pin, take the new value from the publisher, not from the file you downloaded.
- `node scripts/stage-resources.mjs --no-duckdb` stages without DuckDB (a build that cannot analyse); `node --test scripts/stage-resources.test.mjs` tests the staging logic.

## Releases and updates

**Before each tag, run "Tray release" by hand on `main`** (Actions, Run workflow): it runs only the build job, with no secrets (tests, then the unsigned installer through the same `stage-resources` path). A green run on the exact commit is the precondition for the tag; it would have caught the runner-node mismatch that failed the first `tray-v0.1.0` build.

A release is a tag on a commit that is on `main`: bump the version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, merge, then `git tag tray-vX.Y.Z && git push origin tray-vX.Y.Z`. `.github/workflows/tray-release.yml` has two jobs:

- **build** (a tag or a manual run, no secrets): checks the tag and both files agree, runs the tests, and builds an **unsigned** installer, kept as a workflow artifact for testing. It has no update signature, so it can never be used as an update.
- **release** (a tag only, in the `tray-release` GitHub Environment, which needs Botkin's approval for each run): checks the tagged commit is on `main`, builds the signed installer with the sign-in config, and publishes to Storage (`gs://botracing-61-lmu/tray/`): `<version>/<installer>-setup.exe`, its `.sig`, and `latest.json` last. **A published version is never overwritten**; a fix is a new version.

The Environment holds the secrets (setup is at the top of the workflow file): `TAURI_SIGNING_PRIVATE_KEY` and `_PASSWORD` (the updater key), `BOTRACING_FIREBASE_API_KEY`, and `FIREBASE_SERVICE_ACCOUNT_BOTRACING_61` (writes to Storage). **The updater key and its password are also in Secret Manager (`tray-updater-key`, `tray-updater-password` in `botracing-61`), readable by Botkin only; `setup-release-env.ps1` puts them there and deletes the local copies once they read back equal. Lose both copies and installed trays can no longer update.**

- **Install** is per user (`installMode: currentUser`): no admin prompt, files under `%LOCALAPPDATA%`. The installer is **not code signed**, so Windows SmartScreen asks once per install ("More info", "Run anyway").
- **Updates** are signed with Tauri's own ed25519 key (free; not code signing). The public key is in `tauri.conf.json`. The signature is checked when the download is made and again at install; an update that does not verify is refused.
- **The tray** (`src-tauri/src/update.rs`) checks at launch and every 6 hours, **signed in or not** (a release that broke sign-in must still be able to fix itself; the installer is useless without an account). `GET /api/tray/latest` answers anonymously in the Tauri updater format, `{version, notes, pub_date, url, signature}`, or 204 when current; the user's ID token is sent when there is one, only so the endpoint can count versions. The installer is downloaded quietly into `%LOCALAPPDATA%\BotRacing\update\<version>.exe` (not held in memory; a restart of the tray finds it). It installs when the person quits, or picks "Restart to update to X", never while uploading; the installer is started with `/R`, so the tray starts again afterwards. The menu shows `BotRacing <version>` when current.
- A local release build needs the updater key too: `TAURI_SIGNING_PRIVATE_KEY` (the key file's path or text) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; `npx tauri build` then also writes the `.sig`. `npx tauri build --config src-tauri/tauri.unsigned.conf.json` builds without a key.

## Start with Windows, install and uninstall

- **Start with Windows** is on by default: the first launch writes `HKCU\...\Run\BotRacing` (the quoted exe path) and records the choice in `settings.json`; the menu item turns it off and on. A person who turns it off stays off, including after an update; an update only rewrites the path if the exe moved. If Task Manager's Startup tab switched it off (`StartupApproved\Run\BotRacing`, first byte odd), the menu shows it unchecked; turning it on from the menu clears that switch. A walkthrough profile never touches the Run key.
- **Install** (`src-tauri/windows/hooks.nsh`, Tauri's NSIS hooks): asks a running tray to quit (`botracing.exe --quit` goes through the single-instance hold; the watcher stops and the recorder closes its chunk with its end time; the hook waits up to 5 s), then removes the old `LapUploader` and `LapRecorder` logon tasks by exact name if they exist. If a task will not delete (made with highest privileges), the installer carries on, writes the name to `%LOCALAPPDATA%\BotRacing\old-tasks.txt`, and the tray says "Remove the old LapRecorder task (Task Scheduler)" once. The old tasks' runtime folder (`lap-runtime`) is never touched.
- **Uninstall** quits the tray the same way, then removes the Run value and the Task Manager switch, the Credential Manager sign-in (`account.BotRacing`) and the `token` file. `%LOCALAPPDATA%\BotRacing` (settings, status) stays unless "Delete the application data" is ticked, and then only that folder: `%LOCALAPPDATA%\lap-capture` is raw race data shared with the Python tools and is never deleted.
- **An update** (run by the tray, `$UpdateMode`) keeps all of this: data, settings, sign-in and the Run value.
- A leftover `LapRecorder` that still runs at logon holds the recorder lock, so the tray's recorder line reads "another recorder is running" (`capture::win` tests the lock).

## Walkthroughs without touching a real sign-in

`BOTRACING_PROFILE=<name>` runs a separate copy of the tray: its own data folder (`%LOCALAPPDATA%\BotRacing-<name>`), its own Credential Manager entry (`BotRacing-<name>`), its own watcher lock pipe, and it is not held to a single instance with the real tray (the tooltip says which is which). Unset, every name is what it always was. Only letters, digits, `-` and `_` count (at most 32). **Debug builds only:** a release build (the installer) ignores the variable, because a profile skips the single-instance hold. Use it to walk the signed-out first launch, sign-out and switching accounts without a real stored sign-in being read, refreshed or deleted.
