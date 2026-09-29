# Runtime clone

The logon tasks run from a dedicated clone, `C:\Users\Botkin\Projects\lap-runtime`, pinned to `origin/main`. They never run from the main checkout, where sessions edit files and switch branches.

- `update.ps1`: clones it if missing, otherwise resets it to `origin/main`, runs `npm ci` for `functions`, keeps a copy of `duckdb.exe` inside it, and restarts any running `Lap*` task. Run it after a merge that changes the uploader or the recorder.
- Each task's installer calls `update.ps1` first: `tools/uploader/install.ps1` (LapUploader), and `tools/capture` for LapRecorder.

Never edit files in `lap-runtime`: `update.ps1` refuses to update a clone with local changes to tracked files, and lists them.
