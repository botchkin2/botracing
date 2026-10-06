# Curating the track catalog

Track data (the corner map, its boundaries, the surface and outline) is curated by one person, not made by users' syncs (pit wall thread 2 #155, #204 to #210). This folder is the curator's side: plans for changing a track, applied atomically, with history. The pure core, the loader, the Admin backend and the command are here.

- `diff.mjs`: describes a map and compares two maps / two boundary states in plain words (corners moved, added, removed, **renumbered**; window starts moved beyond or within their margin).
- `plan.mjs`: `planAdd`, `planReplace`, `planRefold`, `planUndo`. A plan writes nothing. It carries what would be written, the diff, warnings, **refusals** (too few laps, no GPS, no map, a lap length more than 1% from the median of the user sessions on that track, renumbering without `allowRenumber`, a track that already has / has no map) and the **blast radius** (how many sessions across all users are on the track).
- `apply.mjs`: `applyPlan(backend, plan, {reason, by})`. Needs `--reason`, refuses a refused plan, and does everything in the backend's one atomic `commit`: checks the track's `catalogRev` equals the one the plan saw (else "the track changed since this plan"), creates the history document (append-only), patches **only the curated fields** of the track doc, sets or deletes the boundaries doc. A versioned-catalog-file hook runs after the commit.
- `fixture.mjs`: an in-memory catalog with the same `commit` semantics, for the tests.

`catalogRev` is on the track doc (0 or absent for what exists before curation). The trays' stamp (`tools/sessions/catalogStamp.mjs`) appends `:r<catalogRev>` only when it is above 0, so every stamp recorded earlier stays valid, and a curated change that moves no boundary still changes it.

History: `trackHistory/{trackId}__{rev}` holds the state that was replaced (the curated fields and the boundaries doc), the reason, who, when, and a one-line summary. Undo restores a snapshot **as a new rev**; history is never rewritten.

## Using it (curator PC, Admin credentials: `gcloud auth application-default login`)

```
node tools/curate/curate.mjs sessions --track lmu-road_atlanta     # your local sessions and their ids
node tools/curate/curate.mjs show lmu-road_atlanta                  # live rev, map, sessions across all users
node tools/curate/curate.mjs plan-add lmu-road_atlanta --session 3fa9c1          # dry run
node tools/curate/curate.mjs plan-add lmu-road_atlanta --session 3fa9c1 --apply --reason "first map from my 14-lap run"
node tools/curate/curate.mjs plan-replace <track> --session <id> [--allow-renumber]
node tools/curate/curate.mjs plan-refold <track> --sessions <id,id>
node tools/curate/curate.mjs plan-undo <track> [--to-rev N]
node tools/curate/curate.mjs history <track>
```

A session id is the uploader's (a prefix of 6+ characters). A dry run exits 1 when the plan is refused. `loader.mjs` makes the map and boundaries from the chosen session's local recordings (as a first session on that track would), or folds the chosen sessions onto the live map for a refold. `adminBackend.mjs` is the Firestore transaction behind `commit`.

Not here yet: the versioned catalog file the trays read stamps from (the hook `regenerateCatalogFile` is wired, nothing is plugged into it), and the curator endpoint that replaces admin credentials with his own sign-in.
