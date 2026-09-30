# src/features/race

The Race screen (round 3, handoff R1): every car on the track as a dot, a leaderboard synced to the playhead, and a clock shared with Compare.

- `RaceScreen.tsx`: layout (phone column, desktop `map | leaderboard`), the states of R4c, focus, class filter.
- `useRaceData.ts`: gathers the session, its field, the track map and the reference lap; says whether the cars land on the drawn track (`analysis/worldMatch`).
- `useRaceClock.ts` + `clock.ts`: race time, play/pause, rates; playback steps by wall time, paused rests on a real 5 Hz sample.
- `selectionClock.ts`: Compare's cursor (lap + metres in the URL) to race time and back, via `analysis/raceClock`.
- `followTarget.ts`: pure. Which car Follow chases (focused, else you) and where its chase view sits and points, through the map's own projection.
- `model.ts`: pure. Cars at a moment (`analysis/raceState`) to leaderboard groups, dots and the focus label.
- `components/`: `RaceMap` (over `charts/TrackMap`, or `charts/FollowMap` in Follow), `Leaderboard`, `RaceTransport`, `RaceLegend`, `RaceLanesBlock`.

Not here: the lane model (`analysis/raceLanes`) and chart (`charts/RaceLanes`), the radar (`charts/Radar`), field decoding (`data/field`).
Imports: anything under `src/` except another feature. Only `app/` routes import this folder.
