# Tray/API contract

What the tray sends and what the API takes, tested on real bodies only. Roadmap row 0, pit-wall thread 1 #5113–#5117. Why: #597, where a server test sent `gameVersion: '1.2'`, a value the tray never sends, and every heartbeat was refused during a live drive.

## The parts

- **The rules** live with the server: `functions/src/contract/<message>.ts` (today `heartbeat.ts`). The server validates with it. Sender tests import the same module, never a copy.
- **Real payloads** live in `payloads/<message>/`, as a tray wrote or sent them:
  - `heartbeat/`: beats as sent to `POST /api/upload/heartbeat`, taken from a tray's `status.jsonl`.
  - `recorder-status/`: the recorder's `status.json`.
  - `capture-meta/`: a capture's `meta.json`. Only the game version is used.
  - `results-input/`: a session's results input as the tray puts it in the store (`inputs/<owner>/<session>/results.json.gz`, `tools/sessions/resultsInput.mjs`), which the cloud reader takes. `dev-iracing-ibt-qualifying.json` is the iRacing producer's (`irResults.mjs`, run on his Road Atlanta file, cut to six cars): replace it with the input of the tray build that ships the writer (ticket 61 item 4). Tested in `resultsInput.contract.test.mjs`: the reader takes it, it gives no finish, and the producer writes no key or type it lacks.
- **`payloads.mjs`** loads them (`loadPayloads`, `payload`), makes a negative case (`mutate`: one field of a copy of a real payload), and compares shapes (`shapeOf`, `newShape`: keys and JSON types, values ignored).
- **`check.mjs`** is the contract for a sender in another language: the Rust tray's `cargo test` pipes the JSON it builds to it (`desktop/src-tauri/src/contract.rs`).

## The rules for tests

- A test of the tray/API line sends a payload from `payloads/`, or `mutate()` of one. It never writes a body field by hand. `payloads.test.mjs` fails on hand-written recorder or disk fields in `functions/test`, `tools/uploader`, `tools/dev` and `contract`.
- Each sender's own code builds its body in its test, and that body goes through the server's rules:
  - the watcher: `tools/uploader/heartbeat.contract.test.mjs`
  - the tray: `failure_report.rs` and `capture/recorder.rs`, through `check.mjs`
- A body is never accepted by the rules alone: it must also have no key or type that no real payload has. A tray build that writes something new fails until a real payload of it is saved here. The set is refreshed by the change that needs it, not from memory.

## The replay

`functions/test/replay/` runs the tray's own watcher against the API in the emulators. Requests go through the Hosting emulator's `/api` rewrites, which are built from `firebase.json` itself. It uses real recordings:
- a live capture replayed lap by lap (`--live`, via `tools/dev/liveE2E.mjs`)
- finished LMU and iRacing game files (`--file`)

The recordings are in the golden bucket under `golden/live-capture/` and `golden/finished-file/`, pinned by sha256 in the `contract-replay` job of `.github/workflows/test.yml`.

The replay fails on any of these:
- a request the API refused (a 429 is the server's pacing, which the sender honours)
- a lap that does not land
- a heartbeat the contract refuses, or with a shape no real beat has
- a replayed status.json unlike the recorder's

The one emulator-only branch is in `uploadApi.ts`: the Storage emulator cannot check a signed URL, so it takes a media POST and the upload-url answer says so (`method`). Production answers PUT. An installed tray's own client is tested against the server in `uploadCore.test.mjs`. Production's signed PUT is proven by the release gate's live run.

```bash
npm --prefix functions run build
node functions/test/replay/emulators.mjs -- functions/test/replay/run.mjs --live <capture folder> --file <game file>
```

The emulators need Java 21.

## Adding a payload

**After a tray release.** The release can't be tagged until the tray released before it has a beat here (`Release tray`'s first check, `RELEASE_CANDIDATE` in `heartbeat.test.mjs`), so a tag never turns main red. Each release run saves its installed candidate's own beat, already scrubbed, as the artifact `heartbeat-<version>` (the live-laps gate, `tools/dev/liveE2E.mjs --beat-out`). Add it before the next release:

```
gh run download <release run id> -n heartbeat-<version> -D tmp-beat
```

then commit `tmp-beat/beat.json` as `heartbeat/<version>-<state>-rec-<recorder state>.json`. A beat from a real PC's `status.jsonl` works too, as below.

**By hand.**


1. Take it from a real tray, for example `%LOCALAPPDATA%\BotRacing\status.jsonl` (one beat a line, drop `lastSeenAt`) or `%LOCALAPPDATA%\lap-capture\status.json`.
2. Scrub it:
   - `hostId` becomes `deadbeef`
   - `label` becomes `Test PC`
   - `playerName` becomes `seat-test`
   - nothing else changes.
   The loader refuses a file with a user folder, an email, a Firebase uid or a token in it, or with any of those three fields not scrubbed.
3. Name it `<tray version>-<what it shows>.json`.

`heartbeat/0.1.12-update-waiting-rec-none.json` is a beat the real `tools/uploader/watch.mjs --once` wrote in a scratch home (`LAP_VERSION=0.1.12`, `uploader/update-waiting.json` = `{"version":"0.1.13"}`, the e2e seams of `watch.e2e.test.mjs`), scrubbed as above. No released tray sends `updateWaiting` yet; replace it with a beat from a real 0.1.12 tray from `status.jsonl` once one runs.

**Never delete a version's payloads while any PC still sends from it** (`GET /api/uploaders`, last 30 days). The server deploys on every merge; trays update when they update.
