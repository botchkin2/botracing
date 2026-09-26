# Decision — LMU uses the existing chart

Date: 2026-09-25
From: botkin (stated in chat), recorded by grok
Thread: ../threads/003-phases.md

## The call

LMU laps show up in the existing compare screen, not on the try screen. Same nine-column lap CSV the iRacing chart already parses, at that file's full row count. Garage 61 stays the iRacing source. The app switches source. One CSV per lap in Cloud Storage, read by `/api/lmu`.

## Why

A 400-point lap cannot show a tenth in a corner. He wants the app he already has, with LMU data in it, on GCP. Data is data.

## What this means for the app

The chart keeps every row of a Garage 61 CSV. The sample lap is 4,727 rows. An LMU flying lap around 8,000 rows takes that same path. The 10 Hz Firestore trace in `docs/LMU_SYNC_NOTES.md` is withdrawn. `off` can ride along as an extra column. The current parser ignores it until we teach it. Do not push until a checkpoint. Putting the pack in the bucket waits on a cloud login from Botkin.
