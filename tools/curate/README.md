# Curating the track catalog

Track data (the corner map, its boundaries, the surface and outline) is curated by one person, not made by users' syncs (pit wall thread 2 #155, #204 to #210). This folder is the curator's side: plans for changing a track, applied atomically, with history. The pure core, the loader, the Admin backend and the command are here.

- `diff.mjs`: describes a map and compares two maps / two boundary states in plain words (corners moved, added, removed, **renumbered**; window starts moved beyond or within their margin).
- `plan.mjs`: `planAdd`, `planReplace`, `planRefold`, `planUndo`. A plan writes nothing. It carries what would be written, the diff, warnings, **refusals** (too few laps, no GPS, no map, a lap length more than 1% from the median of the user sessions on that track, renumbering without `allowRenumber`, a track that already has / has no map) and the **blast radius** (how many sessions across all users are on the track).
- `apply.mjs`: `applyPlan(backend, plan, {reason, by})`. Needs `--reason`, refuses a refused plan, and does everything in the backend's one atomic `commit`: checks the track's `catalogRev` equals the one the plan saw (else "the track changed since this plan"), creates the history document (append-only), patches **only the curated fields** of the track doc, sets or deletes the boundaries doc. A versioned-catalog-file hook runs after the commit.
- `fixture.mjs`: an in-memory catalog with the same `commit` semantics, for the tests.

`catalogRev` is on the track doc (0 or absent for what exists before curation). The trays' stamp (`tools/sessions/catalogStamp.mjs`) appends `:r<analysisRev>` (the `catalogRev` of the last change an analysis can see; absent means `catalogRev`) only when it is above 0, so every stamp recorded earlier stays valid, and a curated change that moves no boundary still changes it.

**Display-only plans** (`elevation`, `bank`: `DISPLAY_ONLY_KINDS` in `plan.mjs`) write a field only the app draws. They bump `catalogRev` (the history and the stale-plan check) but keep `analysisRev`, so the stamp does not move and no session on the track is re-analysed; the dry run says so. Every other plan, and every undo, sets `analysisRev` to its own rev. The claim that analysis never reads `.elevation` or `.bank` is a test (`displayOnly.test.mjs` scans the analysis sources).

History: `trackHistory/{trackId}__{rev}` holds the state that was replaced (the curated fields and the boundaries doc), the reason, who, when, and a one-line summary. Undo restores a snapshot **as a new rev**; history is never rewritten.

## Using it (curator PC, Admin credentials: `gcloud auth application-default login`)

```
node tools/curate/curate.mjs sessions --track lmu-road_atlanta     # your local sessions and their ids
node tools/curate/curate.mjs show lmu-road_atlanta                  # live rev, map, sessions across all users
node tools/curate/curate.mjs plan-add lmu-road_atlanta --session 3fa9c1          # dry run
node tools/curate/curate.mjs plan-add lmu-road_atlanta --session 3fa9c1 --apply --reason "first map from my 14-lap run"
node tools/curate/curate.mjs sessions --sim iracing --track iracing-127-full_course   # iRacing's .ibt folder (IRACING_TELEMETRY)
node tools/curate/curate.mjs plan-replace <track> --session <id> [--allow-renumber]
node tools/curate/curate.mjs plan-refold <track> --sessions <id,id>
node tools/curate/curate.mjs plan-undo <track> [--to-rev N]
node tools/curate/curate.mjs plan-elevation <track> --session <id> --capture <dir>   # height along the lap, from the capture's mPos_y
node tools/curate/curate.mjs plan-bank <track> --session <id> --capture <dir>        # road bank along the lap, from the capture's mOri roll (the 3D road and cars)
node tools/curate/curate.mjs history <track>
```

`--sim iracing` reads iRacing's .ibt folder with the uploader's own adapter (`tools/sessions/sims.mjs`), so track ids match the sync's (`iracing-<TrackID>-<config>`). iRacing's Lat/Lon is real GPS, so the same fit makes its map (Road Atlanta: 4056 m, 5 sections, 11 turns from one 22-lap race). It needs no OSM fit to draw true to scale: its georef is the identity, `fakeOrigin` equal to `originLat`/`originLon` (`tools/track-fit/georef.json`).

`plan-add` and `plan-replace` take `--pool` in place of `--session`: every session of that track id in the folder is analysed and their comparable laps make one map (a median per grid point, boundaries folded oldest session first), so a layout driven in many short sessions clears the 8-lap floor that none clears alone. The dry run lists the laps each session gave and, for iRacing, the `TrackVersion` of each; a version whose median lap is more than 0.1% off the main version's is named in a warning before any apply (`poolReport.mjs`, pit wall thread 125 #8388).

A session id is the uploader's (a prefix of 6+ characters). A dry run exits 1 when the plan is refused. `loader.mjs` makes the map and boundaries from the chosen session's local recordings (as a first session on that track would), or folds the chosen sessions onto the live map for a refold. `buildFromLaps` makes that same `built` object from laps that already have a 5 m grid (`mapFromLaps` and `onGrid` in `analyze.mjs`), folding one session at a time. `adminBackend.mjs` is the Firestore transaction behind `commit`.

Not here yet: the versioned catalog file the trays read stamps from (the hook `regenerateCatalogFile` is wired, nothing is plugged into it), and the curator endpoint that replaces admin credentials with his own sign-in.
