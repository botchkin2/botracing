# src/analysis

Pure TypeScript analysis shared with the uploader (`tools/sessions/analyze.mjs` runs it in Node as is).

- Belongs here: consistency, corners, lap classification, window math, time-diff rebase, resampling, the field (`field.ts`), its classes (`fieldClasses.ts`: one table per session, fastest first, the colours and labels every screen uses), the race clock (`raceClock.ts`: race time and the player's lap and distance) and the YOUR RACE lanes (`raceLanes.ts`: pit, tow and battle spans, blue flags and passes over race time; `tools/sessions/raceLanes.parity.test.mjs` keeps its rules equal to the uploader's).
- Also here: the measured track surface (`trackSurface.ts`: centre path and edges from PathLateral and TrackEdge, summed per 10 m bin so sessions add up, and the rule that drops OSM roads inside it).
- Also here: the pre-race fuel and VE planner (`fuelPlan.ts`): numbers from the driver's own green laps for one set of event rules, no advice.
- Also here: the reference-lap ranking (`referenceLap.ts`): which lap is a fair ruler for another (same car and session kind, a similar fuel load, tyres kept, clean air), as matches and numbers.
- Also here: the corner windows (`cornerBoundaries.ts`): an ordered list of boundaries from the line to the line, each section's window a margin before the earliest brake or lift onset seen at the layout, so the windows tile the lap and add up to its time; the corner and exit split and the brake applications of a window. Pure; the uploader will cut section times and slices with it.
- `segments.ts`: the one shape per-section tables read: a `SegmentTimes` (a lap cut into labelled segments, a time per lap) made by two producers in `data/sessions/segments.ts`, our turn sections or the game's S1–S3, picked by the Settings toggle (`state/sectionPrefs.ts`). The bests, medians, spread and optimum all take it and never branch on which producer made it.
- Also here: the optimal lap (`sectionOptimum.ts`): per stint and corner window, the best and median of the times a caller passes, and their two sums, hidden under 5 laps. The caller (`data/sessions/windowOptimum.ts`) decides which window times count: only pit, off-track and local-yellow windows are left out, never tow or traffic. `windowMedians` gives each window's median over a set of laps the caller picked (Compare's checked laps).
- Not here: React, formatting, fetching.
- Imports: **nothing**. Erasable TS syntax only, no path aliases.
