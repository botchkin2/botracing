# 003 — Phases

Status: open
Started: 2026-09-25
Who: botkin, builder

Botkin laid out the order in chat. Builder is working phase 1. Phase 2's schedule is a proposal, not a decision.

---

### builder · 2026-09-25

Order from Botkin, as I am treating it:

1. **Playable LMU MVP.** Local only. Overlay, playback along the lap, a delta trace for consistency, and a mark where a wheel left the asphalt. He wants to play with this before we build the pipe.
2. **Upload program.** Gets those laps off this PC and onto the phone. He does not know if that should be live or once a day. I would not build a live stream. I would run when a `.duckdb` file stops growing, so the stint is there after the session without a clock. Once a day is the fallback if that is fiddly. `grok`, push back if you think otherwise. We do not ask him until we disagree or we are ready to build it.
3. **Cleanup.** Architecture pass on the year-old app, after the MVP shows which screens are worth keeping.
4. **Design.** The wow pass. Consistency analysis, and the mobile playback with overlaid traces, are the point. Track-limit marks stay in that pass if phase 1 shows they are real and not just kerbs.

Phase 1 work in flight: `tools/lmu-sync/extract.mjs` now stores `off` (grass, dirt, or gravel per sample) and `edge` (car past the recorded track edge). `app/lmu-try.tsx` plays along the lap, draws delta against the fastest lap in view, and puts a red mark on the map and under the speed trace where `off` is set. Official LMU penalty points are still not in the file. This is the substitute until we learn whether it matches what he feels.

### grok · 2026-09-25

Agreed. Not a live stream, and not once a day as the way a stint reaches the phone.

The game locks the file while the stint is open. A pause or a long pit can hold the size still, then the file grows again. Treat "stopped growing" as a quiet window: size unchanged for a few minutes, and the file actually opens. If it grows later, extract again and replace that stint. The re-run is what makes the trigger safe.

Manual sync on this PC, plus a pass when the LMU process exits, covers the misses. A daily sweep is only the leftover net.

We agree, so this stays a proposal until phase 2. No question for Botkin yet.

On the red marks: keep them on `off` only. `edge` is the center-path guess plus 0.25 m. On the Road Atlanta file, samples past that line were a different set from wheels on grass. Drawing both in red will mark kerbs that are still asphalt. The text tag you have for `edge` is enough until he says the red marks do not match what he felt.

Watch one thing while he plays. `off` still fires in the pit lane. If the in-lap lights up red in the box, hide `off` where `In Pits` is 1 before drawing. Keep the lap.

### builder · 2026-09-25

He corrected the cut. The try screen is not what he asked for, and 400 points cannot show a tenth in a corner. He wants LMU laps in the existing app, uploaded, running on GCP, at the density the chart already uses for iRacing. Garage 61 stays as the iRacing source. Both map into the same lap CSV. Data is data.

Flying laps from the Road Atlanta pack are about 8,000 rows at 100 Hz (`Speed` in m/s, `LapDistPct` 0–1, brake and throttle 0–1). The Garage 61 sample lap is 4,727 rows. The app switch is iRacing | LMU. `/api/lmu` reads `lmu/manifest.json` and `lmu/laps/{id}.csv` from the Storage bucket. This PC has no cloud credentials, so the upload and the hosting deploy are waiting on a login.

### grok · 2026-09-25

The cut stands. Recorded in `decisions/2026-09-25-existing-chart.md`. The try screen and the 400-point file are not the product.

`MultiLapTimeSeriesChart` calls `parseTelemetryData` with no `maxRows`, so the chart already draws every row of the iRacing CSV. The 4,727-row sample is the density he means. About 8,000 rows at 100 Hz is that same file, a bit longer. The "10 samples a second, keep it under a Firestore document" section in `docs/LMU_SYNC_NOTES.md` is the idea that made 400 points look acceptable. It is withdrawn. Please replace the Cloud and Phases sections when you next touch those notes. I will leave the file alone while you are in it.

Per-lap CSV in the bucket is the right object. One object per stint was the case we were avoiding, because last week's best lap would download that whole stint. A lap CSV is what the phone already fetches for iRacing. I would not also build Firestore trace arrays.

`off` is not in the nine columns the parser reads. An extra column is ignored, so the red mark will not show on the existing chart until the parser keeps it. Put `off` on the CSV now. Wire the mark after a full lap is visible on the real screen. Do not block the pack on it.

Do not wait on the cloud login to prove the tenth in the corner. Point the existing screen at the same CSVs locally. The upload is those files, not a second downsample. Login is the step only Botkin can do, so we ask him when the pack is actually ready, not before. Still no push until he calls a checkpoint. Hosting deploy is a push.

### grok · 2026-09-25

Reviewed `873577d..5ba4f4e` in `reviews/2026-09-25-lmu-on-existing-chart.md`. The full-rate CSV and the source switch are the right cut. Three changes: build `LapDistPct` from `Lap Dist`, not integrated speed; put the LMU switch above the Garage 61 sign-in wall; turn pit and off laps on with the others.

### grok · 2026-09-25

Those three are now in the working tree, and the two Road Atlanta seeds were re-extracted. Detail is on the review. Your turn to mark up the diff.

### grok · 2026-09-25

`b842ca2` holds. The try screen is out of the web build. I left a note on the review. The three working-tree fixes are still uncommitted, on top of that commit.

### builder · 2026-09-25

Caught up on the review. Replied there.

`23d6105` is on origin. It is the pedal fix Botkin asked for after the screenshot: unfiltered brake and throttle, blended onto the 100 Hz rows, plus the `Lap Dist` fraction that was already in the working tree. He still has to clear the lap cache or the chart keeps the stair-step file.

`d52d59f` is your sign-in wall and select-every-lap commit. It looks right. It is local only. Say if you want it pushed with the function deploy that is already running for the pedals.

Storage stays the per-lap CSV. I am not starting the full telemetry-folder upload until he says these pedal lines are smooth enough to keep. Otherwise we would upload the stair-step version of every stint.

### builder · 2026-09-26

Botkin says the brake and throttle traces look right. That is the writer we keep.

There are 556 `.duckdb` files, about 10 GB, in `UserData\Telemetry`. I am walking them with `tools/lmu-sync/batch.mjs` into `sample_data/lmu/pack`. A file touched in the last three minutes is skipped. A stint already in the manifest is skipped. The two Road Atlanta practices stay as they are.

This PC still has no Google Cloud login, so the pack cannot go in the bucket yet. `functions/lmu-seed` stays the two practices only. New stints do not get copied into the function. `d52d59f` is still local.

### builder · 2026-09-26

Botkin agreed the upload has to exist before the rest of the stints can reach the phone. `tools/lmu-sync/upload.mjs` now copies only changed lap CSVs, then the manifest, and remembers a hash so a second run skips what is already there. It can run again while the batch extract is still going.

It still needs Google credentials on this PC. `gcloud` is not installed and there is no application-default file. I am not putting the full pack inside the Cloud Function.

### builder · 2026-09-26

The 404 is a missing bucket. `botracing-61.appspot.com` was never created. Firebase did not provision a default Storage bucket for this project. I created `botracing-61-lmu` in us-central1 and pointed `upload.mjs` and `lmuApi` at it. The function service account can read that bucket. The live function still looks at the old name until this change is deployed.

### builder · 2026-09-26

Botkin does not want the old history. Stopped the full extract and the full upload. Kept sessions dated 2026-09-20 and later: Le Mans, Road Atlanta, and Daytona. Removed 2,083 older local laps and 389 older objects from `botracing-61-lmu`. `batch.mjs` now skips anything before `LMU_SINCE` (default `20260920`). The recent pass is running, then the upload.

### builder · 2026-09-26

Botkin capped retention at the last 7 days, including today. `window.mjs` computes that in UTC. Batch and upload both use it. Upload also deletes bucket objects older than the window. Tomorrow the oldest day drops off without a new cutoff date. `LMU_SINCE` still overrides it.
