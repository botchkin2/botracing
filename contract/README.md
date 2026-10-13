# Tray/API contract

What the tray sends and what the API takes, tested on real bodies only. Roadmap row 0, pit-wall thread 1 #5113–#5117. Why: #597, where a server test sent `gameVersion: '1.2'`, a value the tray never sends, and every heartbeat was refused during a live drive.

## The parts

- **The rules** live with the server: `functions/src/contract/<message>.ts` (today `heartbeat.ts`). The server validates with it. Sender tests import the same module, never a copy.
- **Real payloads** live in `payloads/<message>/`, as a tray wrote or sent them:
  - `heartbeat/`: beats as sent to `POST /api/upload/heartbeat`, taken from a tray's `status.jsonl`.
  - `recorder-status/`: the recorder's `status.json`.
  - `capture-meta/`: a capture's `meta.json`. Only the game version is used.
- **`payloads.mjs`** loads them (`loadPayloads`, `payload`), makes a negative case (`mutate`: one field of a copy of a real payload), and compares shapes (`shapeOf`, `newShape`: keys and JSON types, values ignored).
- **`check.mjs`** is the contract for a sender in another language: the Rust tray's `cargo test` pipes the JSON it builds to it (`desktop/src-tauri/src/contract.rs`).

## The rules for tests

- A test of the tray/API line sends a payload from `payloads/`, or `mutate()` of one. It never writes a body field by hand. `payloads.test.mjs` fails on hand-written recorder or disk fields in `functions/test`, `tools/uploader`, `tools/dev` and `contract`.
- Each sender's own code builds its body in its test, and that body goes through the server's rules:
  - the watcher: `tools/uploader/heartbeat.contract.test.mjs`
  - the tray: `failure_report.rs` and `capture/recorder.rs`, through `check.mjs`
- A body is never accepted by the rules alone: it must also have no key or type that no real payload has. A tray build that writes something new fails until a real payload of it is saved here. The set is refreshed by the change that needs it, not from memory.

## Adding a payload

1. Take it from a real tray, for example `%LOCALAPPDATA%\BotRacing\status.jsonl` (one beat a line, drop `lastSeenAt`) or `%LOCALAPPDATA%\lap-capture\status.json`.
2. Scrub it:
   - `hostId` becomes `deadbeef`
   - `label` becomes `Test PC`
   - `playerName` becomes `seat-test`
   - nothing else changes.
   The loader refuses a file with a user folder, an email, a Firebase uid or a token in it, or with any of those three fields not scrubbed.
3. Name it `<tray version>-<what it shows>.json`.

**Never delete a version's payloads while any PC still sends from it** (`GET /api/uploaders`, last 30 days). The server deploys on every merge; trays update when they update.
