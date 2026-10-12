# src/features

One folder per screen: `<Screen>Screen.tsx`, `components/`, `model.ts` (`use<Screen>Model` plus a pure `build<Screen>Model`), `model.test.ts`.

- Selection (laps, reference, highlight, corner, window) comes from route params, never from a store.
- Imports: anything under `src/` except another feature. Only `app/` routes import features.

- `session/`: on the phone the grid and the lap table scroll sideways as one through `components/linkedScroll.tsx` (one driver at a time; rows share an offset); the section order is in `docs/ARCHITECTURE.md`, "Session on the phone".
