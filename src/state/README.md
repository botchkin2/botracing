# src/state

Persisted user preferences only (zustand + AsyncStorage): `comparePrefs.ts` holds chart sets, the Stack / One chart view, map shown, window mode and size, and playback rate; `panelPrefs.ts` holds the width of each desktop page's resizable side column (Session, Race, Corner; Compare keeps its own) and its limits. Not selection (that is the URL, see `src/nav`), and not server data (`src/data`).

- Imports: `analysis` only.
