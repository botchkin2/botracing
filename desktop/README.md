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
