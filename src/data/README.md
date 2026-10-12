# src/data

Everything that talks to the lap API (`docs/API.md`), one folder per resource: `client.ts` (fetch), `keys.ts` (React Query keys), `queries.ts` (hooks), `adapters.ts` (raw doc → typed shape, seconds as numbers).

- Screens get server data only through these hooks.
- `http.ts` sends every API call as the signed-in person: `tokenSource.ts` holds the current ID-token provider (set by `src/auth`) and reports a 401 back. This folder never imports `auth`.
- Imports: `analysis`.
- `queryPersist.ts` keeps three kinds of answer across app reopens (a layout's map and surface, and the Plan's `/plan`), per signed-in person and versioned (`PERSIST_VERSION`; bump it when a kept shape changes). Firebase Hosting strips our `max-age` and `If-None-Match`, so HTTP caching cannot do this. `src/auth/followFirebase.ts` restores the snapshot before the auth gate lets requests out, and drops it on sign-out or when another person signs in.
- `tray/` is the Windows tray's release (`/api/tray/latest`, anonymous, no auth header): the Settings Download card reads it.
- `android/` is the Android APK's release (`/api/android/latest`, anonymous): `{version, versionCode}` for the Settings Android card (`features/settings/androidCard.ts`), which in the installed app shows only for a higher versionCode than `expo-application`'s `nativeBuildVersion`.
- `traces/` also holds the Corner screen's per-corner slices (`slices.ts` fetch and hook, `sliceTrace.ts` slice to `GridTrace`); the format is in `docs/STORAGE.md`.
- `sessions/windowOptimum.ts` turns a session's laps and the layout's corner windows into the input of `analysis/sectionOptimum.ts` (which window times count), lap selection shared across features (the Session and Corner screens).
