# tools/capture: LMU live recorder

Records LMU's shared memory while the game runs, to local Parquet. The `.duckdb` the game writes has ~100 channels of the player car. This adds what only live memory has: every numeric field of the player car at ~100 Hz (camber, toe, patch and ground velocities, unfiltered inputs, optimal tyre temp, ...) and **every car** in the session at 5 Hz (position, gaps, pit and flag state, world position). Research behind the field list: `telemetry-research/notes/lmu/live.md`. Plan: pit-wall thread 30.

```
uv run --project tools/capture tools/capture/recorder.py              # to %LOCALAPPDATA%\lap-capture
uv run --project tools/capture tools/capture/recorder.py --root D:\x  # elsewhere
uv run --project tools/capture --group dev pytest tools/capture        # tests
```

The recorder waits for the game, records each session, and idles between. One instance per user.

`install.ps1` registers it as the `LapRecorder` logon task (headless, below-normal priority), next to `LapUploader`. It runs from the runtime clone (`tools/runtime`), never from the main checkout.

## Files

| File          | What it does                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout.py`   | Builds the ctypes structs from the header in the LMU install at start. The header is S397's and not ours to publish, and reading it follows game updates. |
| `shm.py`      | Opens the game's mapping read-only (never creates it) and copies frames. No lock and no frame events; see the file for why.                               |
| `sanity.py`   | Checks that the layout reads real data, at the start of each session. If it doesn't, the session is refused and nothing is written.                       |
| `capture.py`  | One capture folder: `meta.json` and 60 s Parquet chunks.                                                                                                  |
| `columns.py`  | Raw struct bytes to named columns, one numpy decode per chunk.                                                                                            |
| `recorder.py` | The loop and `status.json`.                                                                                                                               |

## Output

`%LOCALAPPDATA%\lap-capture\<startUtc>_<track>_<session>\`:

- `meta.json`: written at the start, and again at the end with `endUtc` and `chunks`. No `endUtc` means the capture was cut short (crash, kill, power).
- `player-NNNN.parquet`: one row per telemetry frame. Columns keep LMU's names (`mLocalVel_x`, `fl_mTemperature_0`, wheels `fl fr rl rr`). Temperatures are Kelvin.
- `field-NNNN.parquet`: one row per car per scoring update, plus `update` (the update's index in the chunk) and `et` (session clock).
- `session-NNNN.parquet`: one row per scoring update: flags, weather, phase.

Chunks are written with byte-stream-split (zstd) on numbers, and the doubles the game only fills with float32 values (`FLOAT32_PLAYER`, `FLOAT32_FIELD` in `columns.py`) are stored as float32 when that is bit-exact for the chunk. Both are lossless: read back as double, every value equals the game's. A race is about 5.9 MB/min, down from 9.4. The raw archive is never decimated; slow channels are downsampled by what the uploader derives (pit-wall thread 30, #765).

Every row has `wall_ms` (UTC epoch ms): the poll time, so up to ~4 ms after the game wrote the frame. Use it to match captures to the `.duckdb` and the trace-log event, and use the game's clocks (`mElapsedTime`, `et`) for ordering and anything finer.

`meta.json` also counts `suspectFrames`: player frames whose speed or position jumps more than physics allows since the previous frame. Each frame is copied twice and kept only when both copies match, so this should stay near 0; the count is how we find out.

A pause, or a garage wait with the clock stopped, stays in one capture for up to 10 minutes. After that, or on a new session, a restart or the game closing, the capture ends and the next one starts a new folder. The uploader should expect several captures for one game session.

The recorder runs at below-normal priority so it always yields to the game, the VR compositor and SimHub.

`status.json` in the root: `{state: no-game | waiting | recording | refused | stopped, gameVersion, layoutOk, layoutReason, lastChunkAt, sessionDir, captureBytes, pid, updatedAt}`. It is rewritten on change and every 30 s, so a stale `updatedAt` means the recorder is not running. The uploader copies it into its heartbeat.

Raw captures stay on this PC, including other drivers' names in the field chunks: the uploader never sends names, car numbers or entry names, and the uploader deletes captures after 7 days once they have been uploaded (pit-wall thread 30, #491).
