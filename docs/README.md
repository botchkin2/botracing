# Docs

The reference for how this app is built and how it behaves. Talk, plans, and half-formed ideas live in the pit wall, `C:/Users/Botkin/Projects/pit-wall` (its own local repo). New people start at `pit-wall/JOIN.md`. A note here is reference. A note there is a conversation.

## Start here

- [Code standards](./CODE_STANDARDS.md): how code is written here; read before coding.
- [Architecture](./ARCHITECTURE.md): layers, screens, and the rules every number follows (facts vs comparisons, one median, IQR).
- [Testing](./TESTING.md): seat-test sign-in, live slots, test data, the tray end to end and update rehearsal, golden set.

## Data

- [Data model](./DATA_MODEL.md): sessions, laps, tracks and what each field means.
- [Storage](./STORAGE.md): Firestore and Storage layout, block versions, what the uploader writes.
- [API](./API.md): the endpoints and what each returns.
- [React Query](./REACT_QUERY.md): query keys, caching, empty answers (a 404 map is `null`).
- [LMU recordings](./LMU_SYNC_NOTES.md): where Le Mans Ultimate recordings live, what one holds, and the rules taken from them (laps to keep, track limits, units).
- [Owner copy](./OWNER_COPY.md): copying an owner's data to a uid: rules, runbook, rollback.

## UI

- [Layout rules](./LAYOUT.md): per-screen rule at 375, 1024, 1440 and 1920, and the probes that measure it.
- [React Native Web](./REACT_NATIVE_WEB.md): what differs on web and how the app handles it.
- Design handoffs (`design_handoff_*/`): the original designs, kept as history; where they disagree with the app, the app and these docs win.

## Build and upgrade

- [Android build](./ANDROID_BUILD.md): EAS and local Android builds.
- [Major upgrades](./MAJOR_UPGRADES.md): major-version bumps held back from Dependabot, with their blockers.
- The tray: `desktop/README.md`.
