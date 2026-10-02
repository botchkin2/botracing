# Runtime clone

The logon tasks run from a dedicated clone, `C:\Users\Botkin\Projects\lap-runtime`, pinned to `origin/main`. They never run from the main checkout, where sessions edit files and switch branches.

- `update.ps1`: clones it if missing, otherwise resets it to `origin/main`, runs `npm ci` for `functions`, keeps a copy of `duckdb.exe` inside it, runs `node tools/sessions/sync.mjs --check` on the new code (on every update, about 2 min; if it exits non-zero, LapUploader is left stopped, not restarted, and the script fails with that), restarts any running `Lap*` task, then checks a minute later that each one's node/python child is alive (retries once, fails loudly if not). Run it after a merge that changes the uploader or the recorder.
- Each task's installer calls `update.ps1` first: `tools/uploader/install.ps1` (LapUploader), and `tools/capture` for LapRecorder.

Never edit files in `lap-runtime`: `update.ps1` refuses to update a clone with local changes to tracked files, and lists them.

`sync.mjs --check` from a Claude desktop shell reads a different `state.json` than the logon tasks (the MSIX redirect of `%LOCALAPPDATA%`), so it reports every session as "to do" (e.g. `372 to do`). That is not a problem; the check's job is that it exits 0.
