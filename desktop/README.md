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
