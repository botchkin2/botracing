# Uploader

Syncs new LMU sessions to the lap app by itself, and reports its status to the app's Settings screen. Plan and contract: pit wall thread 30.

- `watch.mjs`: the loop. Every 30 s it checks the game process and LMU's Telemetry folder, and runs `tools/sessions/sync.mjs` in a child process when there is something new.
- `trigger.mjs`: when to sync. After the game exits; at logon if telemetry is newer than the last sync (a PC crash mid-session needs nothing special); while the game runs, only after 10 quiet minutes, with 2 workers at low priority so VR frame time is left alone.
- `heartbeat.mjs`: the `uploaders/{hostId}` doc (`GET /api/lmu/uploaders`, docs/API.md), written on each change and at least every 5 minutes. It copies the recorder's `%LOCALAPPDATA%\lap-capture\status.json` (tools/capture) into `recorder`; older than 2 minutes reads as `not-running`.
- `install.ps1`: registers the `LapUploader` logon task (headless, one instance). Botkin runs it once.

Local files, in `%LOCALAPPDATA%\lap-uploader\`: `watch.log` (every sync's output), `state.json` (last sync), `watch.pid` (the one-instance lock).

Needs what `sync.mjs` needs: `npm ci --prefix functions` and `gcloud auth application-default login`.

Test without touching the store: `node tools/uploader/watch.mjs --once -- --local --work <dir>` (everything after `--` goes to `sync.mjs`; `LMU_TELEMETRY=<dir>` points it at another folder).
