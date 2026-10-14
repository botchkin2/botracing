# Session pipeline

How a drive becomes a stored session, and what every session must have. This
is the one place that says it: STORAGE.md, LMU_SYNC_NOTES.md and the code
comments point here. A claim in this file that something "adds nothing" or
"is covered" names the test that proves it, or it is not made.

## Flows

There are three, and no others.

| Flow | When | Input | Who runs it |
|---|---|---|---|
| A. Recorded drive | the tray's recorder ran during the drive | the capture (live during, final at the end of the drive) | the tray |
| B. Unrecorded drive | before install, tray off, recorder off, older sessions | the game's file (.duckdb, .ibt) | the tray |
| C. Repair | a stored session is stale (rules or catalog changed) | the stored archive and stored inputs | the cloud |

<!-- torsion: flows A/B/C on the tray side, the end-of-drive event -->

## Feature set

Every session has each of these, or names why not (`{absent: reason}`), never
a silent null.

<!-- sidepod: feature table (feature, built by, source per flow, test that proves it / "none today") -->

## Analysis

<!-- sidepod: one engine, its callers and the inputs each passes -->

## Store

<!-- sidepod: uploadSession / uploadLive / what a write keeps from the stored doc -->

## App

<!-- sidepod: how the app learns a session changed and what it reads -->

## Repair paths

<!-- torsion + sidepod: analyze-on-open, archiveRepair, capture-extract backlog, ownerCopy: keep, merge or delete -->

## Script-era cruft

<!-- both: what goes -->

## Gaps

<!-- both: every 'none today' above, as a roadmap row -->
