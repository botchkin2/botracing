# Corner cost and a fair reference lap

Status: spark
Date: 2026-09-26
From: botkin (phone notes), filed by grok

Source: [2026-09-26-source-telemetry-feature-research.md](2026-09-26-source-telemetry-feature-research.md) sections 3.1–3.3 and 3.7–3.9.

## The idea

Show comparison in this order: where the time is (distance delta), what the line and minimum speed did, how the inputs differed, then why it was not free (traffic, blue flag, fuel, tire age, damage, weather, elevation).

Split the lap into corners and straights. For each piece, the time loss and the causes have to add back to that piece. Rank pieces by time the driver can get back. The same mistake in three hairpins is one habit.

Pick the reference lap on car, track, session type, fuel or energy, tire compound and wear, weather, clean air, and damage. A qualifying lap on low fuel is the wrong ruler for a race lap.

A theoretical best is the best corners that can actually connect, not a stitch of two lines the car cannot drive. Show whether a week of work on one corner moved the times.

On the map, say brake points as meters and a track marker ("after the wall"), not only as a time offset. Synced video can wait.

## Why it might matter

Two traces and a delta are already common. The useful part is telling the driver which corner, which cause, and whether the reference was a fair lap.

## Open questions

The chart is already distance-aligned for the nine driving columns. Corner bounds and a marker file do not exist. This waits on context tags so traffic is not scored as a late brake.
