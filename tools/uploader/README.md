# Uploader

Syncs new LMU sessions to the lap app by itself, and reports its status to the app's Settings screen. Plan and contract: pit wall thread 30.

- `watch.mjs`: the loop. Every 30 s it checks the game process and LMU's Telemetry folder, and runs `tools/sessions/sync.mjs` in a child process when there is something new.
- `trigger.mjs`: when to sync. Never while LMU runs (VR frame time beats upload latency). After the game exits, or at logon if telemetry is newer than the last sync (a PC crash mid-session needs nothing special). A session that fails waits on its own backoff (`retries.mjs`: 30 min, doubling, up to 8 h) and is skipped (`sync.mjs --skip`) until then; the other sessions and a version resync go ahead. Only a sync that crashes with no session blamed waits as a whole.
- `retries.mjs`: the per-session backoff map kept in `state.json`. The heartbeat state is `retrying` (with `retryAt`) while one is pending, `error` only after a crash.
- `heartbeat.mjs`: the `uploaders/{hostId}` doc. The endpoint is public, so the id is a hash of the machine name, the name shown is `label` from `config.json` (`{"label": "Race PC"}`), and errors are one line with user folders scrubbed. (`GET /api/lmu/uploaders`, docs/API.md), written on each change and at least every 5 minutes. It copies the recorder's `%LOCALAPPDATA%\lap-capture\status.json` (tools/capture) into `recorder`; older than 2 minutes reads as `not-running`.
- `install.ps1`: registers the `LapUploader` logon task (headless, one instance, restarted on failure), running from the runtime clone (`tools/runtime`). Run it once; after later merges, `tools/runtime/update.ps1` is enough.

Local files, in `%LOCALAPPDATA%\lap-uploader\`: `watch.log` (every sync's output; rotated at 5 MB), `state.json` (last sync, per-session retries), `config.json` (optional). One instance holds the named pipe `\\.\pipe\lap-uploader-watch`; Windows frees it when the process ends.

Needs what `sync.mjs` needs: `npm ci --prefix functions` and `gcloud auth application-default login`.

Test without touching the store: `node tools/uploader/watch.mjs --once -- --local --work <dir>` (everything after `--` goes to `sync.mjs`; `LMU_TELEMETRY=<dir>` points it at another folder).
