# src/analysis

Pure TypeScript analysis shared with the uploader (`tools/sessions/analyze.mjs` runs it in Node as is).

- Belongs here: consistency, corners, lap classification, window math, time-diff rebase, resampling, the field (`field.ts`) the race clock (`raceClock.ts`: race time and the player's lap and distance) and the YOUR RACE lanes (`raceLanes.ts`: pit, tow and battle spans, blue flags and passes over race time; `tools/sessions/raceLanes.parity.test.mjs` keeps its rules equal to the uploader's).
- Also here: the pre-race fuel and VE planner (`fuelPlan.ts`): numbers from the driver's own green laps for one set of event rules, no advice.
- Not here: React, formatting, fetching.
- Imports: **nothing**. Erasable TS syntax only, no path aliases.
