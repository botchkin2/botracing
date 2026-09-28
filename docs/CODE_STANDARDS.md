# Code standards

This codebase is written and maintained by AI sessions, with Botkin reviewing results rather than code. These rules exist so that a fresh session with no memory of past work can find the right place, make a change in the house style, and prove it works. When a rule and existing code disagree, the rule wins for new code; fix old code only when you are already touching it.

The structure itself (folders, layers, state ownership, data hooks) is decided in `pit-wall/decisions/lap/2026-09-27-app-architecture.md`. This file covers how to write code inside that structure. The visual source of truth is `docs/design_handoff_lap_analysis/README.md`.

## 0. The phone is the primary product

Botkin uses this app mostly on his phone, straight out of the car after a session. **Mobile is the primary experience; desktop is second and must still be good.** When the two conflict, the phone wins.

- Every screen is designed, built and verified at 375–390 pt wide first. A feature is not done until it works one-handed on a phone: readable without zooming, every control reachable and at least 44 pt, no horizontal page scroll.
- Desktop (≥900 pt) then gets a real multi-pane layout that uses the space. It is never a stretched phone screen, and never the only place a feature works.
- Phone constraints come first: flaky mobile data (summaries before heavy traces, visible progress), touch instead of hover (nothing depends on hover), and small-screen reading (one chart at a time is a first-class view, not a fallback).
- Every UI PR shows screenshots at 375 pt **first**, then at ≥900 pt.

## 1. Write for the next reader, who has no context

- **The file tree is the map.** A session should be able to guess where something lives from its name. If you have to explain where a thing is, it is in the wrong place.
- **One concept per file, and name the file after it.** `lapStroke.ts`, not `helpers.ts`. No `utils/`, `common/` or `misc/` folders. Each layer folder and each `data/<resource>/` may have one `index.ts` that is its public API; import through it from outside, and import files directly from inside. No nested or wildcard barrels below that.
- **Keep files small enough to read in one pass.** Aim for under 250 lines; over 400 is a signal to split along a real seam (a subcomponent, a pure function), not arbitrarily.
- **Every folder under `src/` has a short `README.md`** saying what belongs there, what does not, and what it may import. Update it when you change the folder's purpose.
- **Comments explain why, never what.** Say where a constant comes from ("median + 3 robust σ, from the handoff"), why a workaround exists, or which doc a rule comes from. No commented-out code, no changelog comments, no `// TODO` without a pit-wall thread number.
- **No clever code.** Prefer a plain loop over a chain of five array methods when the loop is clearer. No metaprogramming, no dynamic imports for style, no string-built keys where a typed union works.

## 2. Types are the contract

- `strict` TypeScript. No `any`; use `unknown` at boundaries and narrow it. No non-null `!` except right after a check the compiler cannot follow, with a comment.
- **Units in names** where the unit is ambiguous: `timeS`, `deltaS`, `distanceM`, `speedKph`, `impactG`, `offTrackS`, `throttlePct`. Times are seconds as numbers everywhere below the UI. Only the display layer formats.
- **Ids vs numbers:** `lapId: string`, `lapNumber: number`, `sessionId: string`. Never a bare `lap`.
- **Model the states, not flags.** Use discriminated unions (`{kind: 'excluded'; reason: ExclusionReason}`) instead of several booleans that can contradict each other.
- **API shapes stop at `data/<resource>/adapters.ts`.** Raw server documents are typed there and converted to app types. Nothing else sees a raw response.
- Export types next to the code that owns them. No global `types/` dumping ground for new code.

## 3. Pure logic first, React last

- **Anything computable without React goes in `src/analysis/`** (pure TS, no imports; Node runs it for the uploader) or in a screen's `model.ts`. Components receive finished values.
- **Screen models are pure functions of their inputs**, wrapped by a `use<Screen>Model` hook that only gathers inputs (params, queries, prefs). The pure part is exported separately so tests call it without React.
- **Components render; they do not compute.** No sorting, filtering, statistics or formatting math inside JSX. A `useMemo` over a model call is fine.
- **No side effects in render or in models.** Fetching lives in `data/`, persistence in `state/`, navigation in event handlers.

## 4. Styling: tokens only

- **Every color, font, size, space, radius, stroke and chart height comes from `src/design/tokens.ts`** via `useTheme()`. A raw hex, rgba, font name or magic number in a component is a bug. If the token is missing, add it to `tokens.ts` with the handoff reference, then use it.
- **Color has one meaning each** (see the handoff): accent is UI only, `best` is best lap/sector only, lap colors are laps only, `faster`/`slower` always come with a sign. Never pick a color because it looks nice.
- **Numbers are always Mono with tabular figures** (`type.data`, `type.axis`), always with a unit, and formatted by the shared formatters (`m:ss.sss`, signed 3-decimal gaps). Do not hand-format numbers in a component.
- **Both themes, always.** Dark is the default; every component must render correctly in light too. Read colors from the theme, never from a module-level constant.
- `StyleSheet.create` at the bottom of the file for static styles; inline only the values that depend on props or theme.

## 5. Layout: mobile first, desktop real

- See section 0. Design at 390 pt wide with 16 pt gutters first, then add the ≥900 pt layout. Desktop is a proper multi-pane layout, not a stretched phone.
- Breakpoints come from `size.desktopBreakpoint` through one `useLayout()` hook. No ad-hoc `Dimensions.get` checks in components.
- **Hit areas are at least 44 pt**; use `hitSlop` to extend small drawn controls (checkboxes, chips).
- No horizontal page scroll at 375 pt. Horizontal scroll is allowed only inside a component designed for it (lap chips).
- Test on web and on a phone-sized viewport before calling a UI change done.

## 6. Charts and performance

- Charts live in `src/charts/`, take plain arrays and scales as props, and know nothing about sessions, queries or routes.
- **Draw recorded samples inside the window; grids only for cross-lap maths.** Charts draw each channel's real samples (`GridTrace.samples`) sliced to the window by index (`analysis/nativeSamples.ts`), joined by a monotone curve that never overshoots them; at whole-lap zoom, keep the min and max per point, never an in-between value. Readouts at the cursor are the nearest recorded sample. The 5 m grid is only for maths that must line laps up point by point: time diff, the p10–p90 band, section and corner stats (Botkin, pit-wall thread 26 #392/#397).
- Memoize path strings by their inputs; the cursor moves, the traces should not rebuild on every frame. Gesture and playback updates go through Reanimated shared values, not React state, when they fire per frame.
- Stable query keys and memoized selectors per `docs/REACT_QUERY.md`. Heavy per-lap arrays load only when Compare opens, with visible progress.

## 7. The product rule: an instrument, not a coach

- No advice, verdicts, scores, grades or "work on X" text anywhere. Show numbers, their units, the reference they are measured against, and how they were computed.
- Every chart and table carries its one-line explainer, copied verbatim from the handoff. If you change what a chart computes, update the explainer in the same PR.
- Every summary number can be traced to the laps it came from.

## 8. Tests

- **Every `analysis/` function and every `model.ts` has a colocated test** (`x.ts` → `x.test.ts`). Test behavior at the boundaries the handoff names: 6, 7, 19 and 20 selected laps; empty sessions; no comparable laps; partial and pit laps; the ±0.10 s and ±0.30 s grid cut-offs.
- Use small handwritten fixtures in the test file. Real session files go in `__fixtures__/` next to the test and stay under 50 KB.
- Components get tests only when they hold logic that cannot move to a model. Prefer moving the logic.
- A bug fix starts with a failing test that reproduces it.
- `npm test`, `npm run lint` and `npx tsc --noEmit` pass before every PR. Never skip or weaken a test to make it pass; if a test is wrong, say why in the PR.

## 9. Errors and loading

- Every screen handles loading, empty, error and partial data explicitly, with the states the handoff draws (for example "No sessions yet", "3 laps, none comparable"). No spinner-forever, no blank screen.
- Throw at boundaries for impossible states; do not silently return defaults that hide bad data. Adapters validate what they read and report which field was wrong.
- No `console.log` in committed code. Use `console.warn` or `console.error` only for things a developer must act on.

## 10. Dependencies

- Add a dependency only when it removes real code or risk, and say why in the PR. Prefer what is already installed (`react-native-svg`, Reanimated, React Query, zustand).
- Install with `npx expo install` so versions match the Expo SDK.
- No UI kits or CSS-in-JS libraries; the design system is ours.

## 11. Changing things

- **Small PRs, one purpose each.** A refactor and a behavior change go in separate PRs.
- Follow the PR process in `pit-wall/decisions/lap/2026-09-27-pr-process.md`: own worktree, branch, PR, another seat reviews. Never push to `main`.
- **The PR description says what you ran and what it printed**, plus screenshots at 375 and ≥900 pt for any UI change, in both themes when colors changed.
- Leave the code you touched cleaner than you found it, but do not wander: an unrelated fix gets its own PR or a pit-wall note.
- Deleting code is a feature. When a new screen replaces an old one, remove the old components, routes and styles in the same migration step, and grep for leftover imports.
- Keep docs true. If you change a rule, a folder's purpose or a data shape, update this file, the folder README or `docs/` in the same PR.
