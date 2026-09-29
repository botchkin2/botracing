# src/analysis

Pure TypeScript analysis shared with the uploader (`tools/sessions/analyze.mjs` runs it in Node as is).

- Belongs here: consistency, corners, lap classification, window math, time-diff rebase, resampling, the field (`field.ts`) and the race clock (`raceClock.ts`: race time and the player's lap and distance).
- Not here: React, formatting, fetching.
- Imports: **nothing**. Erasable TS syntax only, no path aliases.
