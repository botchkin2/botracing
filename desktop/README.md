# BotRacing tray app

A Tauri tray icon (no windows) that runs the Node watcher, `tools/uploader/watch.mjs --remote`, and shows its status. The watcher uploads through the upload function with the signed-in user's token (`tools/sessions/storeClient.mjs`); no Admin credentials.

What the tray keeps is in `%LOCALAPPDATA%\BotRacing\`: `status.jsonl` (the watcher's heartbeat, appended; the tray reads its last line), `token` (the user's Firebase ID token, read by the watcher on every request), `uploader\` (the watcher's own state and log).

Menu: a status line, Open BotRacing, Pause uploads (stops the watcher), Open data folder, Quit. The watcher stops itself if the tray dies (`LAP_PARENT_PID`, `tools/uploader/parentGuard.mjs`).

Not built yet: sign-in (nothing writes `token` yet), the installer with node and a pruned `node_modules` as resources, a folder picker, iRacing.

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

The tray signs the user in with Google (OAuth for desktop apps: PKCE, a loopback redirect on 127.0.0.1 with a random port and a state check) and trades that for a Firebase session (`signInWithIdp`: the Google ID token first, the access token when Firebase refuses the ID token's audience; the one that worked is written to `last-signin.txt` in the data folder). The refresh token is kept in Windows Credential Manager (service `BotRacing`); the current ID token is written to `%LOCALAPPDATA%\BotRacing\token`, which the watcher reads on every request, and renewed 10 minutes before it ends.

- **The first sign-in of a user starts Paused.** The menu shows the account, the `uid` and the `owner` key the server holds for it. Un-pausing is what confirms that uid; a different uid signing in later is paused again. Nothing uploads while signed out or paused.
- A refresh that fails deletes the token file and shows "Sign in again". Sign out stops the watcher, deletes the token file, then removes the stored credential.
- The OAuth client and the Firebase web key are not in git. `scripts/build.ps1` reads the client JSON from `~\.botracing\oauth-desktop.json` and takes the web key from `-FirebaseApiKey` or `BOTRACING_FIREBASE_API_KEY`, then builds (`-Release` for the installer, `-Test` for `cargo test`). A build without them still runs; the menu says "Can't sign in: built without ...".

## Installer

`.scriptsuild.ps1 -Release` (or `npx tauri build` in `desktop/` with the sign-in variables set) builds the NSIS installer. Before bundling it runs `scripts/stage-resources.mjs`, which fills `src-tauri/resources/` (gitignored): `node/node.exe`, `app/` (the uploader's files, chosen by import closure from `watch.mjs`, `sync.mjs` and `store.mjs`, with `app/package.json` `{"type":"module"}`) and `app/tools/sessions/duckdb.exe`. `tauri.conf.json` bundles `resources/app/` and `resources/node/`, which land next to `botracing.exe` (`<install>app`, `<install>
ode`), where `sidecar::find_root` looks first.

- **No native Node addon and no `node_modules`:** DuckDB is the CLI exe, run by `tools/sessions/duck.mjs`; the uploader imports only its own files and Node built-ins. The stage script fails on an npm import, a missing relative import, a non-literal `import()` or a `new Worker` it cannot follow.
- **Pinned binaries:** `node.exe` (v24.19.0, SHA-256 from nodejs.org's `SHASUMS256.txt`) and the DuckDB CLI zip (v1.4.2, SHA-256 from the GitHub release digest) are checked against hashes written in the stage script, whether they come from the cache (`src-tauri/resources/.cache`), from `NODE` / `DUCKDB` (local copies), or are downloaded. A mismatch fails the build. To change a pin, take the new value from the publisher, not from the file you downloaded.
- `node scripts/stage-resources.mjs --no-duckdb` stages without DuckDB (a build that cannot analyse); `node --test scripts/stage-resources.test.mjs` tests the staging logic.
