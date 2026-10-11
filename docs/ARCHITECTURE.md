# App architecture

Agreed in pit-wall thread 24 (`decisions/lap/2026-09-27-app-architecture.md`). This file is the reference; change it with the code.

## Folders

```
app/                              routes only: parse params, render features/<x>/<X>Screen
  index.tsx                       Sessions
  session/[id]/index.tsx          Session
  session/[id]/compare.tsx        Compare   (?laps=ref,a,b&hl=&c=&t=&w=; no laps: every comparable lap
                                  of the stint with the most of them, vs their median: stintSetLapIds)
  session/[id]/corner/[n].tsx     Corner
  settings.tsx                    cache management, uploader status
src/
  analysis/   pure TS, no imports at all (Node runs it for the uploader). consistency, corners,
              lap classification, window math, time-diff rebase, 5 m resample.
  nav/        pure URL builders (routes.ts): every in-app link; the URL owns the selection. No imports.
  design/     tokens (dark, light), ThemeProvider, useTheme, lapPalette(mode), fonts
  ui/         primitives with no data: Text, Button, Chip, Checkbox, Segment, Sheet, Tray, Badge
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

- **The URL is the only source of truth for selection:** build links with `src/nav/routes.ts`, never by hand: session, laps, reference (`ref`, only when the user picks one; `laps` order carries no meaning), highlight, corner, cursor and window.
- **Server data** comes only through React Query hooks in `data/`.
- **Zustand** holds persisted preferences only.

## Screens

Worked example: `src/features/sessions/model.ts` and `model.test.ts`.

Every screen follows the same shape: `use<Screen>Model(params)` combines the queries with `analysis` into one view model, and the screen renders it. Models are pure given their inputs and are unit-tested.

### Session on the phone

Under 900 pt the Session page reads, top to bottom: the head (Best and Median large, "21 laps · 14 comparable" under them; session facts), Lap times (the chart, then one Optimal · Median · gap · "of N" line per stint, `optimumLines.ts` over `StintNumbers`), Laps (the section grid and the lap table), then Pit stops (a fold, open when there were stops, the energy line inside), Tires (open) and Fuel use (folded). Desktop, and 900 to 1279, keep their own layout.

The grid and the lap table scroll sideways as one (`session/components/linkedScroll.tsx`): every row and the head of a table share one offset, the lap column (grid) or checkbox, lap, time and vs med (table) stay pinned. One scroller drives at a time, from the first touch of a drag until its momentum ends, or until it has been quiet for 150 ms where there are no such events (a wheel on web); the offsets the others report back while it drives are ignored, or a fling would be pulled back. A scroller that mounts late (the table is virtualised) starts at the current offset.

### Numbers: one basis, named

The rule (decision `pit-wall/decisions/lap/2026-10-11-selection-and-numbers.md`): **facts are the session's, comparisons are the selection's.** A fact says what happened and never moves with a tick: Laps, Comparable, Best, the session Median, energy, fuel, tires, pit stops. Anything that compares laps or measures spread is over the **basis laps**, the ticked ones (or the comparable ones when none is ticked), and says how many it is "of". Every number below is from `src/features/session/selectionStats.ts`, so one question has one answer on a screen.

- **Session, per segment:** the grid heads, the desktop table under the lap list (Median / Best / IQR) and the best-cell marks are one computation (`segmentBasisStats`).
- **Session, per lap:** the lap table's "vs med", the lap-time bars, the lap strip and the detail ("vs median of N") use the basis median.
- **Session, per stint:** the stint line in the lap table ("med · IQR · of N"), the desktop Stints panel and the Optimal / Median / Inconsistency facts. Optimal is the best basis segments summed (each segment needs 5 times, `MIN_OPTIMUM_LAPS`); Median is the median lap time of the same laps, a time that was driven; Inconsistency = Median − Optimal. No "Typical lap".
- **Corner:** the per-stint best and median rows of the window are over the ticked laps.
- **Spread is the IQR (p75 − p25) everywhere, and is called IQR.** No standard deviation is shown.
- **A section has one name on every screen and the map: its turns** ("T7", "T2–5", "T10a–T12"; `sectionNameOf` in `analysis/turnNames.ts`, decision `2026-10-04-sections-and-compare.md`). "S1–S3" means the game's own sectors only (the sector mode), never one of our sections.
- **A ticked lap counts even when it is not comparable:** the user chose it. Pit, off-track and full-course yellow windows still drop out of a segment by themselves (`windowOptimum.ts`).
- **Gap basis (Compare):** the chips, the "vs" line and the All laps list measure against the same basis: the Ref lap if one is picked, else the median of the checked laps. The session median only stands in when nothing is checked.
- **Fuel and VE per lap (Session, Plan):** the median over the stint's green laps (timed, whole, no pit, no yellow; `greenLaps` in `session/fuelUse.ts`), the set the stored stint medians and the Plan use. A slow or off-track lap still burns fuel. Printed with `oneDecimal` (`design/format.ts`, half up on the stored value) so Session and Plan show the same figure for the same median.
- **Full pedal (Corner):** the driver's pedal, not the car's throttle (see the Corner table below).

### Corner: windows and the Parts row

Corner shows one corner's window: a section's window (boundary to boundary, `tracks/{trackId}.boundaries`) when the section is one corner, or one part's window when it is compound. The charts frame the window from the section's start to the shown corner's end, and shade the window. A compound section's Parts row starts with **All** (`/session/[id]/corner/[n]?all=1`, `n` = first part): the whole window as one corner, same charts, table, Spread and braking map. Stepping through the parts is unchanged. Charts read the last part's slice file, which already runs from the section's start to its end. Which fact comes from where over the whole window (`src/features/corner/wholeCorner.ts`):

| Fact | Source |
| --- | --- |
| Time, slowest speed, apex speed | the section's own facts (full window) |
| Brake point, peak brake, turn-in | one part for the whole set: the part most laps' first brake application brakes for (`brakeApps[0].part`; else the slowest point's part; ties to the earlier), measured to its apex; judged by that part's `minSpeedAtEdge` |
| Pickup, lowest throttle | the last part, measured from its apex; judged by the section's `minSpeedAtEdge` |
| Full pedal | the last part, from its apex, for every lap (a lap already flat there reads "at min"); judged by the section's `minSpeedAtEdge`. The point is the driver's unfiltered pedal at 95 % or more (`tools/sessions/pedalPoints.mjs`), not the car's throttle that the chart plots: that one dips under 95 % where traction control cuts while the pedal is floored |

The card's Run-in / Corner / Exit split every lap at the same two distances: the lap's own onset and the map's exit for that corner, never the lap's full-throttle point (that is the table's Full pedal column), so the Corner and Exit gaps do not trade seconds when a lap gets to the throttle early or late. The run-in/corner boundary stays each lap's own onset on purpose: braking earlier is driving the corner differently, getting to the throttle earlier is the Full throttle column's fact. Where the map's exit is at or past the window's end, Exit is "—" (it happens in the next window), not 0.00.

A fact the source cannot supply is "—" (never a boundary value). The braking map spans first entry to last exit and places each lap's points from the same apexes.

## Data hooks (API v2, `/api/lmu`)

`useSessions(filter)`, `useSession(id)`, `useSessionLaps(id)`, `useSessionBand(id)`, `useSessionMap(id)`, `useLapTraces(lapIds)`. Key factories: `sessionKeys.*`, `lapKeys.*`. Uploaded sessions are immutable: staleTime is ∞, and cache busting uses the session `version`.

## Naming

- Components are PascalCase files with one component each. Other modules are camelCase. Hooks are `useX`.
- Units go in names where the unit is ambiguous: `timeS`, `deltaS`, `distanceM`, `speedKph`, `impactG`, `offTrackS`.
- `lapId` is a string and `lapNumber` is an int. Never use a bare `lap` for either.
- One import alias: `@/` (tsconfig). No babel module-resolver aliases.

## Product rule

The app is an instrument, not a coach: no advice text, and every summary number can be drilled into.
