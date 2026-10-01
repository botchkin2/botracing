# src/data

Everything that talks to the lap API (`docs/API.md`), one folder per resource: `client.ts` (fetch), `keys.ts` (React Query keys), `queries.ts` (hooks), `adapters.ts` (raw doc → typed shape, seconds as numbers).

- Screens get server data only through these hooks.
- Imports: `analysis`.
- `traces/` also holds the Corner screen's per-corner slices (`slices.ts` fetch and hook, `sliceTrace.ts` slice to `GridTrace`); the format is in `docs/STORAGE.md`.
- `sessions/windowOptimum.ts` turns a session's laps and the layout's corner windows into the input of `analysis/sectionOptimum.ts` (which window times count), lap selection shared across features (the Session and Corner screens).
