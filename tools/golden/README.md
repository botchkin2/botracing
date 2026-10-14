# The golden set

Four real sessions, cut to a few laps, run through the real analysis in CI. The
key numbers must equal `expected/<name>.json`, or the PR says why they moved.

- `manifest.json`: the four sessions (sim, start time, laps cut) and the
  sha256 of every slice file. The slices are real laps, so they live in the
  private bucket (`gs://botracing-61-lmu/golden/<name>/`), never in the repo.
- `make.mjs <name> [--upload]`: on the PC that has the session, cuts the slice
  (the neutral archive, only the channels the analysis reads, no driver name,
  ids or paths), writes `expected/`, pins the sha256s in the manifest. `--upload`
  copies it to the bucket with the curator's own gcloud login.
- `golden.test.mjs`: every session through `analyzeSession`, compared number for
  number (laps, stints, fuel, pit stops, consistency, corner window times, and per
  corner the brake point and peak, turn-in, throttle pickup, full throttle,
  minimum). A mismatch prints which numbers moved.
- `update.mjs [name]`: after a deliberate analysis change, rewrites `expected/`
  from the pinned slices and appends a stub to `CHANGES.md`.
- `gate.mjs`: CI fails if `expected/` changed and `CHANGES.md` has no entry
  added in the same PR with a real reason (`Why:`, at least five words, not TODO).
- `fetch.mjs`: fetches a slice into `.golden/cache` and refuses one whose sha256
  does not match the manifest.

Not in the set: the class pace (it comes from the field of the live capture, which a slice
does not carry), and anything the app computes from stored docs (the Plan, Compare's
median): those have their own jest fixtures.

CI reads the bucket with the service account in the repo secret
`GOLDEN_READER_SERVICE_ACCOUNT` (read only on `golden/`; made by `node ops/iam/goldenReader.mjs --apply`, see ops/iam/README.md); without it (a fork) the
sessions are skipped, with it `GOLDEN_REQUIRED=1` makes a missing slice a failure.
Locally, `gcloud auth login` is enough, or run `make.mjs` on a PC with the session.

Slices are never regenerated for a small reason: every new one is another 1 to 4 MB in
the bucket, and the manifest's sha256s change with it.

## The parity pairs

Each pair is one drive recorded twice, by the tray's capture and by the game,
with the curated track docs both paths read (`catalog.json`):

- `road-atlanta-2026-10-03-race`: the golden live capture
  (`golden/live-capture/road-atlanta-2026-10-03/`, the first five laps of the race)
  and the game's file of the same race cut to that window
  (`golden/parity/road-atlanta-2026-10-03/`).
- `road-atlanta-2026-10-02-practice` (`golden/parity/road-atlanta-2026-10-02-practice.tar.gz`):
  a practice with a reset to the garage, out-laps and a lap the game
  invalidated; the capture cut to the session before the restart.

Driver names are blanked (the game file's DriverName is `seat-test`; the
capture's field `mDriverName` is empty and its `playerName` is `seat-test`).

- `parity.mjs <pair folder>`: builds the drive through today's capture path
  (`syncLive` → `analyzeStored`) and game-file path (`buildSession`, sync.mjs's
  build → `store.upload`) into memory (`memoryStore.mjs`), compares every
  session and lap field, and checks both against the feature manifest
  (`tools/sessions/manifest.mjs`). Prints each unexplained difference and miss.
- `parityAllow.json`: what may differ, each entry with its reason. `tol` bounds
  numbers, `tolS` bounds two times in seconds; no bound allows any value.
  `when: "untimed"` applies to laps the game did not time, `pair` to one pair
  only, and `laps.first` / `laps.last` name a pair's first and last lap. An entry
  marked `gap` is a known missing feature or an open finding
  (`docs/SESSION_PIPELINE.md`) and is deleted when it is fixed or ruled on.
- `parity.test.mjs`: the rules everywhere; the pairs where `PARITY_PAIRS` names
  their folder. CI's `contract-replay` job fetches them (sha256-pinned in
  `.github/workflows/test.yml`) on any change to the tray, sessions, golden or
  API code.
- `cutGameFile.mjs <in.duckdb> <out.duckdb> <untilT>` and
  `cutCapture.mjs <capture> <out> <lastChunk> <endUtc>`: how the pairs were cut.
