# src/features

One folder per screen: `<Screen>Screen.tsx`, `components/`, `model.ts` (`use<Screen>Model` plus a pure `build<Screen>Model`), `model.test.ts`.

- Selection (laps, reference, highlight, corner, window) comes from route params, never from a store.
- Imports: anything under `src/` except another feature. Only `app/` routes import features.
