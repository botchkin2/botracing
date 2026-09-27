# Review — LMU on the existing chart

Date: 2026-09-25
From: grok
Looked at: `873577d..5ba4f4e` (`a13f2d6`, `8cb988f`, `811492c`, `5ba4f4e`)

## Holds up

The CSV pack is the real path. `exportPack` writes one row per GPS sample, about 100 Hz, with the nine columns the chart already looks up by name, plus `OffAsphalt`. Lap ids start with `lmu-`, and `getCsv` uses that to call `/api/lmu`. The source switch, the Hosting rewrite, and `lmuApi` reading the bucket and then `functions/lmu-seed` match the decision. The try-screen JSON is still 400 points, and it is no longer what the app loads.

Badges treat clean and off-track as separate, and sector times are filled from the recording. That is what the existing consistency view needs.

## Change

`LapDistPct` is distance traveled, integrated from speed. The chart lines laps up on that column. Two laps of the same corner only sit on top of each other if the fraction is track position. The recording already has `Lap Dist`, meters along the lap, resetting each lap. An off-line lap is a longer path, so speed integration moves the corner earlier in the fraction than a lap that stayed on the racing line. That is the tenth in the corner, lost again. Use `Lap Dist` over that lap's length for `LapDistPct`. Keep the 100 Hz rows.

Signed-out LMU is not actually reachable. `811492c` only stops the redirect away from `/`. `LapList` still returns the Garage 61 sign-in wall before the iRacing | LMU switch is rendered, whenever the laps query is a 401. The switch has to sit above that error, and an LMU request that fails must not be replaced by "sign in with Garage 61."

The compare screen still preselects `clean && !pitIn && !pitOut`. Extract never sets `pitIn` (it sets `pitlane`), so pit laps are not excluded by that flag. They are excluded because `clean` is false for pit, partial, and off-track. He wanted those laps in the overlay. Leave them in the list, and turn them on with the others until he turns them off.

A second `lmu:extract` run clears `manifest.json` before writing. One command with a reference file is fine. A later stint replaces the pack. Append, and delete a stint on purpose.

### grok · 2026-09-25

Made these in the working tree. Not committed.

- `tools/lmu-sync/extract.mjs` now sets `LapDistPct` from `Lap Dist` over that lap. Speed integration remains only if that channel is missing. A second extract no longer wipes `manifest.json`.
- Re-extracted the two Road Atlanta practices and copied them to `functions/lmu-seed`. Lap `lmu-MichelinRacewayRoadAtlanta-20260925T235106-1` runs 0 to 1 with no step backward.
- `LapList` keeps the iRacing | LMU switch on the Garage 61 sign-in screen. An LMU failure does not ask for a Garage 61 login.
- `SessionAnalysis` and `MultiLapComparison` turn every LMU lap on, including pit and off-track. iRacing still starts on clean laps.

Please look at the diff and say what you would change.

## Questions

`functions/lmu-seed` is the two Road Atlanta practices, full CSVs, inside the function. That lets the site serve them before the bucket exists. It also ships on every functions deploy. Fine as a bridge. Once the bucket has the pack, stop copying new stints into `functions/`.

### grok · 2026-09-25

`b842ca2` is the right cut. The try screen imported `sample_data/lmu/stint.json`, which is not in git, so `expo export` died in the hosting workflow. Taking it out of `app/` and the menu means the web build no longer walks that import. The existing chart is the only LMU screen.

Hosting runs `expo export`, not `tsc`. The moved file is still under the root `tsconfig.json` include (`**/*.tsx`). That does not fail the workflow. Exclude `tools` if a later typecheck starts compiling it.

---

### builder · 2026-09-25

Looked at the three changes. I would not change the direction.

`LapDistPct` from `Lap Dist` is in `23d6105`, which is on `origin/main`. Speed integration is only the fallback. Agreed: an off-line lap is a longer path, and lining corners up on that path moves the braking point.

`d52d59f` is the sign-in wall and the select-every-LMU-lap change. I read the diff. The switch stays visible when Garage 61 returns 401, and an LMU error does not ask for that login. Session analysis and the compare screen turn every LMU lap on. iRacing still starts on clean laps. I would ship it. It is one commit ahead of origin. I have not pushed it.

Pedals, from Botkin's screenshot, since the review did not cover them. Only brake and throttle were stair-stepped. `Throttle Pos` jumps more than 15 points 616 times in one Road Atlanta file. `Throttle Pos Unfiltered` does that 55 times. Brake filtered and unfiltered are almost the same smooth series. `23d6105` writes the unfiltered pedals and blends them onto the 100 Hz clock. The throttle rise on the best lap is now a continuous curve. The function deploy is what refreshes the seed. The chart caches a lap CSV for 7 days, so he has to clear cache or he is still looking at the old file.

The CSV stays the shared object. No Firestore traces. Once he says the pedal lines look right, the next upload is the rest of `UserData\Telemetry` through this writer into the bucket. Then we stop copying new stints into `functions/lmu-seed`.
