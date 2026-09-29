# Handoff: Round 3 — the field (race playback, cars around you, field tags)

Builds on the v2 handoff (`design_handoff_lap_analysis/README.md`, v2 section) and the Lap Analysis Design System. **Dark theme only** from this round: drop the light theme and the theme setting.

## Overview
The uploader now records every car at 5 Hz (world position, lap distance, lateral position, speed, class, place, gaps, pit and flag state) and the player at 100 Hz (incl. heading). This round adds the views that show the other cars:

1. **Race playback** — every car as a dot on the track outline, on the Compare clock, with a synced leaderboard and a "Your race" tag timeline.
2. **Cars around you** — a heading-up radar centred on the player, in Race, Compare and as a map inset.
3. **Field tags** — TOW, TRAF, BLUE, PASS, BTL, RESET, in the lap table, lap chart and timeline.
4. **Smaller items** — combined pedals + steering chart, settings review points, loading/error/no-data states.
5. **App mark + favicon, and a navigation rule** for tabs with no session selected.

The app is an instrument, not a coach: it shows what happened, never advice, verdicts or scores. Copy follows the system's content rules (plain, factual, units on every number, true minus "−", sentence case, mono caps labels).

## About the design files
`Round 3 Field.dc.html` is a **design reference built in HTML**: a live prototype showing intended look and behaviour, not production code. Recreate it in the app's existing environment (React Native target, web prototypes use the same tokens) with its established patterns and the Lap Analysis Design System components. Open the file in a browser next to `support.js` and the `_ds/` design-system folder (copy `_ds/` from the design-system project if it is missing). Everything on the page runs on one clock: press play in any transport and all maps, radars, lanes and charts move together.

**Sample data is synthetic** (track shape, 58-car field, lap times, tag values). The simulation exists only to exercise the layouts; every *rule* stated here is real and is what should be built.

## Fidelity
**High fidelity.** Final colours, type, spacing and interactions, all on the existing tokens. Recreate pixel-accurately using the system components (SegmentedControl, Transport, Button, LapRow, StatusBanner, EmptyState, Skeleton) and the existing chart/map primitives.

---

## Screens / views

Frame IDs match the labels on the page (N1, R1a…R4c).

### N1 · App mark and favicon
- Replaces the 18 pt placeholder square in the desktop chrome (top-left of the 48 pt top bar) and on the phone Sessions header. Also the favicon / app icon source.
- **Applied: N1a "Trace"** (`assets/app-mark-trace.svg`, `assets/favicon.svg`). Alternatives N1b "Circuit" and N1c "Lap bars" are in `assets/`.
- Geometry (viewBox 18×18): square `x .5 y .5 w 17 h 17 rx 4`, fill `--surface-raised #15181c`, 1 px stroke `--control-border #3a4148`; zero line y 10.5 in `#3a4148`; trace path in `--lap-ref #f2f4f6` 1.6 pt round caps; cursor line x 11 in `--accent` (oklch(0.80 0.16 70); the SVG files use the sRGB approximation #f5a524) 1.3 pt.
- Holds at 16 pt. The product name, where needed, is plain type beside it.
- Tapping/clicking the mark always goes to **Sessions**.

### N2 · Navigation without a session (rule)
Session, Compare, Race and Corner need a selected session. If one is tapped/clicked while **no session is selected** (first launch, cleared selection, deleted session) the app **goes to the Sessions screen instead**. The tab is not shown as selected; no empty workspace or empty state is drawn for it. Same for deep links naming a tab but no session.

### R1a · Phone · Race tab (390 × 844 frame, 358 pt content)
Race is a new segment next to Laps inside a session (`SegmentedControl` Laps | Race, md).
Top to bottom:
- Header 44 pt: ‹ back, title "Road Atlanta · Race" (`--type-title`), sub "58 cars · 3 classes · you #NN GT3" (mono 11, `--text-muted`), R badge.
- **Map 358 × 260** (was 220), `--surface`, 1 px `--line-strong`, radius 6. Overlays: top-left label control (`SegmentedControl` sm, mono: Off / Pos / No.); top-right radar inset 72 × 108; bottom-left focus chip when a car is focused (amber 1 px border, "#34 · GT3 P5 · +3.412 ×"); bottom-right "© OpenStreetMap contributors" (9 pt, `--text-faint`).
- Legend row (mono 10.5, `--text-secondary`, wraps): Hypercar, LMP2, GT3, You, Pit lane, Stopped, Off track — each with its dot glyph.
- Leaderboard: class filter `SegmentedControl` sm (All / HY / P2 / GT3, default = your class); column heads GAP, PIT (`--type-column`). Rows 32 pt, grid `22 | 3 | 30 | 1fr | 70 | 24`, gap 6, padding 0 16: position (`--text-secondary`), 3×14 class bar, car number (mono 500), model (sans 12.5, ellipsis), gap (right), pit count. "All" adds class headers (mono 600 9.5, tracking .06em). On open, scroll so your row is third from top.
- **YOUR RACE** lanes (`--surface-raised`, top border `--line-strong`): label + race clock + zoom `SegmentedControl` sm (Race / 10 laps / 3 laps, default 10 laps). Lane labels column 44 pt (PIT, TOW, BATTLE, BLUE, PASS; mono 9), lanes 310 × 45 (5 × 9 pt) on `--chart-plot`, lap gridlines and lap labels, playhead 2 pt `--chart-cursor`. Window start/end times under it (mono 9.5, `--text-faint`). Drag to scrub.
- `Transport` pinned at the bottom (play 40 pt, rates 0.25× 0.5× 1× 2×).
- No speed chart here (removed on review: its space went to the lanes).

### R1c · Phone landscape · full screen (844 × 390)
Turning the phone on the Race tab opens full screen. Left: map 512 × 306 with "‹ Exit" + label control top-left, radar inset 84 × 126 top-right; under the map a row with play button (40 pt), race clock, a 300 × 16 strip (TOW + PIT) and rate `SegmentedControl`. Right panel 284 (`--surface`, left border `--line-strong`): header "GT3 · P9–P17 · AROUND YOU", then the **nine cars around you in your class** (4 ahead, you, 4 behind; clamped at the ends), 32 pt rows, grid `20 | 3 | 26 | 1fr | 62`. Exit/turning back returns to R1a at the same playhead.

### R1b · Desktop · D4 Race workspace (1440 × 900)
New workspace tab between Compare and Corner. Top bar 48 pt as D1–D3 (mark, tabs Session / Compare / **Race** / Corner, session picker "LMU · Road Atlanta · Race · 58 cars ▾", "You #NN · model · GT3", right: `Button` tertiary sm "Full screen").
Grid `1060 | 380`:
- Left: toolbar 40 pt (TRACK label, legend, LABELS + `SegmentedControl` Off / Class position / Car number). **Map 1020 × 520** with S1–S3 labels, PIT label, radar inset **150 × 226** top-right (caption "±30 m · heading up"), focus chip bottom-left (long form: "#34 · Ferrari 296 GT3 · GT3 P5 · L14 · 212 km/h · 1 pit").
- Under the map: **YOUR RACE** with zoom control; lanes 56 pt label column + 940 × 74 SVG (lanes 12 pt).
- Then **THROTTLE · BRAKE** for your current lap (1020 × 64, R4a style, white lap colour), with explainer "Your pedals on the current lap. Line = throttle, fill = brake. The amber line is the playhead, shared with Compare."
- Right: leaderboard on `#0b0d10`, head grid `26 | 3 | 30 | 1fr | 64 | 58 | 22` (POS, NO., CAR, GAP, INT, PIT), rows 24 pt, grouped by class with headers "HYPERCAR · 14 CARS". Hover row `#15181c`. Footnote explains Gap/Int/PIT/STOP/OFF/GAR.
- Bottom: `Transport` (330 wide) + race clock + "Your Ln · race clock, shared with Compare" + right "Paused on a 5 Hz sample · m:ss.s" / "Moving between 5 Hz samples".
- **Full screen:** hides the chrome and the YOUR RACE/pedals area; the map fills the window, the leaderboard becomes a 10-row panel over the map's right edge, transport stays.
- **Responsive:** 1280+ = D4; 900–1279 = leaderboard moves under the map; < 900 = phone layout.

### R1d · Dot states
| State | Drawing | Leaderboard |
|---|---|---|
| Running | class colour fill, 1.1 pt `#0d0f12` edge, radius by class (HY 4.2 / P2 3.7 / GT3 3.2 at desktop scale ×1.15; phone ×0.8) | gap |
| You | `#f2f4f6` fill r 4.6×scale + white ring r+3.2, 1.3 pt; drawn last | row gets white 3 pt inset bar + `#15181c` |
| Focused | amber ring r+5, 1.8 pt | amber 3 pt inset bar + `--accent-tint` |
| Pit lane | hollow: `#0d0f12` fill, 1.5 pt class-colour ring, drawn on the pit lane | "PIT" in amber |
| Stopped | solid grey ring `#aeb4ba` 1.3 pt around the dot, after 2 s under 5 km/h outside the pit lane | "STOP" |
| Off track | dashed ring `#aeb4ba` 1 pt `2 2`, at its true position, when more than 7.5 m from the centreline | "OFF" |
| Garage (reset) | removed from the map | row 50% opacity, "GAR", sorted last |

### R1e · Labels at 58 cars
Modes: Off / class position / car number. One label per car, placed just outside the track edge along the track normal (outside first, inside if taken). Greedy by priority: **focused car > you > cars within 3 places of you in your class > class leaders > overall order**. Losers are dropped, never shrunk or stacked. Labels also avoid the overlay controls, radar inset and attribution. Style: `--map-badge` fill, 1 px `--map-badge-stroke` (yours `#aeb4ba`, focused amber), mono 600 9.5/12, text in class colour (yours white). Expect ~12 labels on phone, ~30 on desktop.

### R1f · Class colours (design-system addition)
New tokens, used **only for other cars** (dots, radar blocks, 3 pt leaderboard class bar) — never for a line or a number:
- `--class-hy` **red** oklch(0.62 0.20 25)
- `--class-p2` **blue** oklch(0.66 0.14 250)
- `--class-gt3` **orange** oklch(0.73 0.16 48) — redder and darker than amber so it doesn't read as selection
- Fallback palette "Distinct" (Tweak): HY oklch(0.62 0.17 20), P2 oklch(0.70 0.12 240), GT3 oklch(0.84 0.13 160).
Classes also differ by dot size.

### R2 · Cars around you (radar)
- Your car fixed in the centre pointing up (white 2 × 4.6 m block with a small dark nose chevron).
- Every car within **±R m** (default 30, range 20–50) drawn to scale at its **true 2D position and heading relative to yours**: take world positions, subtract yours, rotate into your heading (forward = along your heading, side = perpendicular). Block sizes: HY 2 × 5.0 m, P2 2 × 4.7, GT3 2 × 4.6, rx 1–2.
- **Range ticks** at 10, 20, 30 m ahead and behind: short `--chart-zero` ticks on both edges, faint `--chart-gridline` across, mono 9 labels "10 20 30". Dashed centre line = your heading.
- **Fade:** opacity = clamp((R + 4 − |forward|) / 6, 0, 1), so cars fade over the last 6 m instead of popping. Cars in the pit lane ×0.4.
- **Side bars:** left/right edge bar (3–5 pt, `#e4e7ea`, 30% of the radar height, centred) lit when a car's length overlaps yours (|forward| < (len + 4.6)/2) and |side| < 6 m.
- **5 Hz:** the radar renders the 5 Hz sample at floor(t × 5)/5 even while the map interpolates. The sample time is printed bottom-right ("21:23.4", on the large sizes "21:23.4 · 5 Hz").
- Sizes: 72 × 108 phone map inset; 84 × 126 landscape; 150 × 226 desktop; 98 × 148 docked in phone Compare; 200 × 300 anatomy (R2a). Background `--surface` (insets: rgba(13,15,18,.9)), 1 px `--line-strong`, radius 3.

### R2b · Phone Compare with the field (390 × 844)
The existing Compare screen, field on:
- Lap chips (ref + playing lap) with time and tags.
- Map 358 × 170 with the whole field at the cursor (badge "Track · 58 cars at Ln").
- Charts: TIME DIFF (50 pt), **SPEED with the radar docked right** (chart 250 × 150 + radar 100 × 150; the radar stays put while charts scroll), **CAR AHEAD** (new, 56 pt): gap in seconds to the nearest car ahead at your speed, 0–3 s, dashed line at 1.0 s; under it one tow lane per lap in its lap colour.
- Distance scrubber + `Transport`.
- The field follows the lap under the cursor; the reference lap has its own field (its CAR AHEAD line and lane).

### R2c · Desktop D2 Compare with the field (1440 × 900)
D2 keeps its three columns (`260 | 820 | 360`). Header adds "Field data · 58 cars" (right). Centre gains **CAR AHEAD** (780 × 80) + tow lanes, and "field sample m:ss.s" next to the transport. Right column: TRACK map 320 × 220 with the field; **CARS AROUND YOU**: radar 150 × 226 + list (rows 24 pt, grid `3 | 26 | 36 | 1fr`): class bar, #number, forward distance "+12 m / −8 m", side ("in line", "left 2.4 m", or **ALONGSIDE L/R** in `--text` when the side bar is lit). Empty: "No cars within 30 m at this sample." Sessions without field data keep today's D2 exactly.

### R3 · Field tags
Same style as OUT/IN/OFF/SLOW/HIT (`LapTag`: mono 500 10, `--text-secondary`; BEST `--best`).
| Code | Rule |
|---|---|
| **TOW 6.1** | Seconds in a tow on this lap: under 1.0 s behind a car, lateral offset under 1.5 m, above 180 km/h. Shown from 1.0 s. Detail panel splits it per straight ("Tow, T11–T1 straight · 4.5 s"). |
| **TRAF** | Held up: 4 s or more under 1.0 s behind a car with a slower lap pace, below 160 km/h. |
| **BLUE 2** | Cars of a faster class that passed you on this lap. |
| **PASS +1 −2** | Places made and lost to cars of your class. |
| **BTL 34** | Seconds within 1.0 s of a car of your class, ahead or behind. Shown from 5 s. |
| IN · OUT | Unchanged (pit laps); stop time in the detail panel. |
| **RESET** | Lap ends in the garage after a reset. Excluded, like IN. (Needs the reset detection fix.) |
| BEST | Unchanged. |

**Priority (extends LAP_TAG_PRIORITY):** PART · OUT · IN · RESET · SLOW · **TOW** · BEST · OFF · HIT · TRAF · BLUE · PASS · BTL. TOW sits above BEST so a towed best lap always shows TOW at 375 pt (one tag + "+n").
- **Session summary** adds "Best without TOW or TRAF: Ln m:ss.sss · +0.290 s".
- **Lap chart (R3c):** bars towed ≥ 5 s are drawn hollow (1 pt outline in the bar's colour). Rails under the chart, labelled TOW / TRAF / PIT (mono 9): white 4 pt block per towed lap, grey tick for TRAF or BLUE, amber for IN/OUT.
- **Detail panel for a towed lap:** "In a tow for 10.0 s on this lap, mostly behind #27. The best lap without TOW or TRAF is L9 (1:48.459, +0.913 s)." + per-straight rows + the rule line.
- **Timeline lanes (Your race):** PIT span (amber), TOW span (`#e4e7ea`), BATTLE span (`#8a929b`), BLUE tick (`#aeb4ba`, 1.5 pt), PASS ▲ made (`#e4e7ea`) / ▼ lost (`#8a929b`). Zoom Race / 10 laps (1,080 s) / 3 laps (325 s); zoomed windows are centred on the playhead and clamped to the race. Lap labels every 5 / 2 / 1 laps.
- Sessions without field data get none of TOW, TRAF, BLUE, PASS, BTL; the key says so once.

### R4a · Throttle, brake and steering in one chart (decided)
Height 140: pedals area 96 pt (0–100%) + 8 pt gap + steering band 36 pt with its own zero line (`--chart-zero`), ±90°, left up.
- Throttle: lap-coloured line, standard lap widths (2.3 key, 1.5 others).
- Brake: filled area in the lap colour at **16%**, 1 pt edge at 80%.
- Steering: 1.2 pt lap-coloured line in its band.
- Dashes remain only as the colour-blind fallback.
- Explainer: "Line = throttle, filled area = brake, both 0–100%. Bottom band = steering, ±90°, left up."

### R4b · Settings and uploader (review points; v2 frames stand)
1. Dot green only when the host was seen in the last 10 min, grey otherwise; never red or amber.
2. Card rows in v2 order: label, version, LMU found, last upload, queue, last error, capture disk; mono values with units ("3.1 GB of 20 GB").
3. Last error keeps its time and says what still works; neutral text.
4. Recorder block: state, game version, "Layout OK" — or a neutral banner that recording is paused until the uploader can read this game version.
5. Hit areas 44 pt, rows 32 pt, no layout shift on refresh.

### R4c · States
- **Field data loading:** the map draws the outline and your car immediately; `StatusBanner` dot="waiting" over the map bottom: "Loading field data · 1.8 of 4.2 MB. Your car and traces already play." Leaderboard rows as `Skeleton` at 32 pt.
- **No field data (older sessions):** Race tab stays, map with your car only (white + ring); `EmptyState` "No field data for this session" / "Other cars are recorded for sessions from 28 Sep 2026 on. Your laps, traces and your own car on the map work as before." Leaderboard, radar and field lanes are hidden (not empty).
- **Field data failed:** one neutral `StatusBanner` (dot idle, never amber/red): "Field data didn't load (timed out after 30 s). Your laps, traces and your car on the map still work." + Retry (refetches field data only).
- **Traces loading:** `Skeleton` at real chart heights (Speed 104, Pedals 140) under their headers.
- Field data (~4 MB per race-hour) loads after your own traces and never blocks them.

---

## Interactions & behaviour
- **One clock.** Race playback's playhead *is* Compare's cursor (race time ↔ lap + distance). Play/pause, rate (0.25×–2×), scrub/drag on any lane or strip, and clicking a lap all set the same time.
- **5 Hz honesty.** While playing, dots interpolate between samples. When paused, the clock snaps to the nearest 0.2 s so every dot is a real sample. The radar always shows the 5 Hz sample and prints its time.
- **Focus.** Tap a dot or a leaderboard row to focus a car (amber ring + highlighted row + focus chip); tap again or × to clear. Focus is shared across map sizes.
- **Labels mode** and **class filter** are per-view preferences (persist).
- **Timeline zoom**: Race / 10 laps / 3 laps; zoomed windows follow the playhead.
- **Landscape** on the phone Race tab = full screen; exit keeps the playhead.
- **Navigation rule N2** (no session → Sessions).
- Motion: none beyond playback. No transitions.

## State
- `t` (race time, s), `playing`, `rate`, `focusCarId`, `labelMode` ('off' | 'pos' | 'num'), `classFilter`, `timelineZoom` ('race' | 'l10' | 'l3').
- Derived per render: per-car position (lap, distance, lateral, world x/y, heading), state (run/pit/stop/off/gar), class position, gap to class leader / interval (time for the car ahead to reach this car's progress), pit count.
- Data: `GET` field positions per session (5 Hz, per car: t, lap distance, lateral, world x/y, heading or derivable, speed, class, place, pit/flag), per-lap tags from the uploader, plus the existing map endpoint (`/api/lmu/sessions/{id}/map`).

## Design tokens
All existing tokens from `tokens/colors.css`, `typography.css`, `spacing.css` (dark `:root` only). Key values used: `--bg #0d0f12`, `--surface #101317`, `--surface-raised #15181c`, `--surface-overlay #1b1f23`, `--line-strong #2e343a`, `--control-border #3a4148`, `--text #e4e7ea`, `--text-secondary #aeb4ba`, `--text-muted #8a929b`, `--text-faint #5b636b`, `--accent oklch(0.80 0.16 70)`, `--accent-tint`, `--best oklch(0.70 0.20 300)`, `--lap-ref #f2f4f6`, `--lap-1 oklch(0.70 0.15 255)`, `--chart-track-edge #343a42`, `--chart-track-fill #1a1d22`, `--chart-gridline #1d2125`, `--chart-zero #3a4148`, `--chart-plot #101317`, `--map-badge #15181c`, `--map-badge-stroke #3a4148`.
**New:** `--class-hy`, `--class-p2`, `--class-gt3` (values above).
Type: IBM Plex Sans Condensed (headings/body), IBM Plex Mono (numbers, labels, axes; tabular figures). Radii 2/3/6/10. Only shadow: `--shadow-float`.

## Assets
- `assets/app-mark-trace.svg` (applied), `assets/app-mark-circuit.svg`, `assets/app-mark-lapbars.svg`, `assets/favicon.svg`. For iOS/Android app icons, scale the Trace mark on a full-bleed `#15181c` square (drop the border).
- No icon library; glyphs are Unicode (‹ × ▲ ▼ ▾ ↑).
- Map geometry from OSM (attribution always shown).

## Files
- `Round 3 Field.dc.html` — the live reference for every frame above (open in a browser with `support.js` beside it and `_ds/` from the design-system project).
- `support.js` — the prototype runtime (reference only).
- `assets/` — app mark and favicon SVGs.
