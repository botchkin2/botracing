# Copying an owner's data to another owner key

How Botkin's data moves from the owner key `botkin` to his Firebase uid. Decided in pit wall thread 2 (#140 to #152). The tool is `tools/sessions/migrateOwner.mjs`; the rules are in `ownerCopy.mjs` (ids, references) and `ownerCopyRun.mjs` (plan, apply, verify).

This is a **copy**. Nothing is deleted or changed in the originals, and the tool has no way to delete (its backend has no such call, and a test fails if the code ever asks for one). Switching the mapping and deleting the originals are separate steps that need Botkin's sign-off, and are not done by this tool.

## What is copied, and what is not

Copied, with new ids and paths:

| What                                                      | Where it goes                                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `recordings`, `sessions`, `laps` with `ownerId == botkin` | the same collections, `ownerId` = the uid, ids recomputed                                                                                     |
| traces, bands, fields (`traces/`, `bands/`, `field/`)     | the same folders under the uid and the new ids, **byte copies** (server-side copy, content type, `Content-Encoding` and `Cache-Control` kept) |
| corner slices (`slices/`)                                 | **rewritten**: each file lists its laps by id, so the ids are remapped, and the folder is named by a hash of the new content                  |
| archive (`archive/lmu/<session>/<recording>/*.parquet`)   | `archive/<uid>/lmu/<new session>/<new recording>/`, byte copies                                                                               |

**Not copied: track data.** Tracks, their corner boundaries, and the surface and outline files are shared app data, not an owner's (Botkin, thread 2 #149). Sessions only name a track id. The tool reads them, to report one thing: the boundaries and surface files list the sessions already folded into them by the **old** session id. A later server-side fold must treat the copies as already folded; the id map (`--map-out`) says which is which. The tool leaves those files as they are.

**Also not covered here:** the uploader status (`/uploaders`, being made per-owner), and moving the gaming PC onto the signed-in tray (`--remote`).

## Why the ids are recomputed, not mapped at random

Every id comes from a hash that includes the owner key (`sync.mjs`): a recording's id from `owner|sim|source|recordedAt`, a session's from `owner|sim|layout|car|sessionType` and its first recording's time, a lap's from its recording's id. The copy computes the ids the uploader will compute for the new owner, so the first sync from his signed-in tray overwrites the copies instead of creating a second set next to them.

Before copying, every **old** id is recomputed from the stored inputs and must equal the stored id. If the derivation has changed since a document was written, the run stops and lists that document. After rewriting, a **residual scan** looks at every new document and file for an old id (anywhere, in a key or a string), an `ownerId` still `botkin`, or a path in `botkin`'s folder; any hit stops the run. The word "botkin" in a driver name, car or event title is not a hit.

## Runbook

Prerequisites: a backup of Firestore and the bucket that has been **restored once to prove it works** (thread 2 #140, #141); `gcloud auth application-default login` and `npm ci --prefix functions` on the machine that runs this; the uid (the tray menu shows it, or Firebase console, Authentication, Users).

1. **Snapshot what the app shows now**, before anything changes:
   `node tools/sessions/migrateOwner.mjs api-snapshot --out before.json`
   (no token: the anonymous read, which is `botkin`'s). Keep the file.
2. **Dry run.** `node tools/sessions/migrateOwner.mjs plan --to <uid> --map-out idmap.json`
   Reads everything, writes nothing. Read the output: the counts, the warnings (laps with no trace file, the folded-sessions note), and above all any `PROBLEM` line. A problem means nothing was written and nothing will be until it is understood. Keep `idmap.json`.
3. **Freeze uploads.** The tray and the PC are uploading under `botkin` while you work. Pause the tray (menu, Pause uploads) and stop the PC uploader. Anything synced after the last apply is missing from the uid side.
4. **Apply.** `node tools/sessions/migrateOwner.mjs apply --to <uid> --backup-confirmed "<which backup, taken when>"`
   Files first, then laps and recordings, then session documents last. Safe to run again after a crash or an interruption: files already there with the same bytes and metadata, and documents already equal, are skipped. It ends with the same checks as `verify`.
5. **Run it once more** (the final apply after the freeze picks up only what changed), then `node tools/sessions/migrateOwner.mjs verify --to <uid>`. Read-only. It compares: document counts per collection; every new document, with the new ids and paths mapped back to the old ones, against the original (only `ownerId` and the ids differ); every byte-copied file's bytes **and** content type, content encoding and cache control; every slice set mapped back against the original and its hash. Counts are compared at that moment, so run it after the freeze.
6. **Switch the mapping** (a separate step, Botkin's sign-off): not done by this tool. `users/<uid>.ownerKey` is `botkin` today; the switch makes his key the uid. `functions/scripts/setOwnerKey.mjs` refuses to overwrite a different key (and refuses when the uid already owns data, which it now does after the copy), so the switch needs a reviewed command that removes or replaces the mapping. **That command does not exist yet** (open item, `setOwnerKey` change). Do not edit `users/<uid>` by hand.
7. **Check what the user sees.** With his token (a file holding a current ID token):
   `node tools/sessions/migrateOwner.mjs verify-api --to <uid> --token-file token.txt --baseline before.json`
   The API's session list with his token must equal the baseline apart from ids (same count, same content), and a sample of the copies is read through the API (laps, a lap's telemetry, the track's surface). If a track's surface or outline is not readable, the readers have not yet been changed to serve shared track data to a signed-in user: stop before step 8.
8. **Un-pause the tray**, and move the PC onto it. The next sync overwrites the copies with identical ids.

## Rollback

The originals were never touched. Rolling back is setting `users/<uid>.ownerKey` back to `botkin`; `setOwnerKey.mjs` refuses to overwrite a different key, so this too needs the explicit admin change from step 6, run the other way. Uploads made under the uid after the switch stay under the uid (they are not in the `botkin` data).

## Limits, honestly

- Nothing in `tools/sessions/ownerCopy*.mjs` has run against production. The tests run against an in-memory backend that has the same shape as the Admin one, and the Admin adapter is tested against a shim of the SDK, not the SDK. The first dry run is the first time the id derivation is checked against real stored ids; if it is wrong, the dry run reports a problem for every document and writes nothing.
- It needs Admin credentials, which the machine that wrote it did not have.
- Laps that exist only in the old seed (no trace file in the bucket) are counted and copied without a file; the dry run says how many.
- Content hashes of slice sets are recomputed with the same rule as `cornerSlices.mjs`; if that rule changes, the check "the slice files hash to the stored hash" stops the run.
