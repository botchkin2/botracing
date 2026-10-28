# src/state

Persisted user preferences only (zustand + AsyncStorage): `comparePrefs.ts` holds chart sets, the Stack / One chart view, map shown, window mode and size, and playback rate; `panelPrefs.ts` holds the width of each desktop page's resizable side column (Session, Race, Corner; Compare keeps its own) and its limits; `sectionPrefs.ts` holds whether tables cut a lap into turn sections or the game's sectors (Turns by default); `planStart.ts` holds the start he typed on the Plan for one track and car (per device, replaced when he types for another). Not selection (that is the URL, see `src/nav`), and not server data (`src/data`).

- Imports: `analysis` only.
