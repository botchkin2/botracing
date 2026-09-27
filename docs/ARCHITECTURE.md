# App architecture

Agreed in pit-wall thread 24 (`decisions/lap/2026-09-27-app-architecture.md`). This file is the reference; change it with the code.

## Folders

```
app/                              routes only: parse params, render features/<x>/<X>Screen
  index.tsx                       Sessions
  session/[id]/index.tsx          Session
  session/[id]/compare.tsx        Compare   (?laps=ref,a,b&hl=&c=&t=&w=)
  session/[id]/corner/[n].tsx     Corner
  settings.tsx                    cache management, uploader status
src/
  analysis/   pure TS, no imports at all (Node runs it for the uploader). consistency, corners,
              lap classification, window math, time-diff rebase, 5 m resample.
  nav/        pure URL builders (routes.ts): every in-app link; the URL owns the selection. No imports.
  design/     tokens (dark, light), ThemeProvider, useTheme, lapPalette(mode), fonts
  ui/         primitives with no data: Text, Button, Chip, Checkbox, Segment, Sheet, Tray, Explainer, Badge
  charts/     react-native-svg chart layer, pure props: Axis, Trace, Band, Cursor, Bars, DotStrip, CornerGrid
  data/<resource>/   client.ts, keys.ts, queries.ts, adapters.ts   (sessions, laps, traces, map)
  state/      zustand, persisted prefs only (chart sets, map shown, stack/one view)
  features/<screen>/  <Screen>Screen.tsx, components/, model.ts (use<Screen>Model), model.test.ts
```

## Layers

`analysis` ← `design` ← `ui`, `charts` ← `data`, `state` ← `features` ← `app`.

- `src/analysis/**` and `src/nav/**` import nothing. Anything may import them.
- `ui` and `charts` may import `design` and `analysis`, never `data`, `state` or `features`.
- Only `app` imports `features`. A feature never imports another feature.
- A component moves from `features/x/components` to `ui` only when a second feature needs it.
- Enforced by `import/no-restricted-paths` in ESLint, at error level.

## Breakpoints

- <900: phone. 900–1279: two-column layouts (`isDesktop`). ≥1280: three-column desktop workspaces (`isWide`). All from `useLayout()`.

## State

- **The URL is the only source of truth for selection:** build links with `src/nav/routes.ts`, never by hand: session, laps, reference (first in `laps`), highlight, corner, cursor and window.
- **Server data** comes only through React Query hooks in `data/`.
- **Zustand** holds persisted preferences only.

## Screens

Worked example: `src/features/sessions/model.ts` and `model.test.ts`.

Every screen follows the same shape: `use<Screen>Model(params)` combines the queries with `analysis` into one view model, and the screen renders it. Models are pure given their inputs and are unit-tested.

## Data hooks (API v2, `/api/lmu`)

`useSessions(filter)`, `useSession(id)`, `useSessionLaps(id)`, `useSessionBand(id)`, `useSessionMap(id)`, `useLapTraces(lapIds)`. Key factories: `sessionKeys.*`, `lapKeys.*`. Uploaded sessions are immutable: staleTime is ∞, and cache busting uses the session `version`.

## Naming

- Components are PascalCase files with one component each. Other modules are camelCase. Hooks are `useX`.
- Units go in names where the unit is ambiguous: `timeS`, `deltaS`, `distanceM`, `speedKph`, `impactG`, `offTrackS`.
- `lapId` is a string and `lapNumber` is an int. Never use a bare `lap` for either.
- One import alias: `@/` (tsconfig). No babel module-resolver aliases.

## Product rule

The app is an instrument, not a coach: no advice text, and every summary number can be drilled into.
