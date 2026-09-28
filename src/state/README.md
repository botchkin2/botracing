# src/state

Persisted user preferences only (zustand + AsyncStorage): `comparePrefs.ts` holds chart sets, the Stack / One chart view, map shown, window mode and size, and playback rate. Not selection (that is the URL, see `src/nav`), and not server data (`src/data`).

- Imports: `analysis` only.
