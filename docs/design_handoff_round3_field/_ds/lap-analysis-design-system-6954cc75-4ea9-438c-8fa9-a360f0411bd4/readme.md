# Lap Analysis Design System
A design system for a sim-racing telemetry app, built for **Le Mans Ultimate**: per-lap telemetry, whole-race consistency and multi-lap comparison. Phone first, with a desktop workspace alongside. The target build is React Native; web prototypes use the same tokens.

**What the product is:** Sessions → Session (the whole race: lap-time bars and a dense lap table) → Compare (traces, map, time per section, playback) → Corner or section (every pass side by side). It gives the driver tools, not conclusions: it shows the data plainly, states every rule it applied, and never picks "the one thing to fix".

**Sources:**
- Designed in this project, with no external codebase or Figma.
- The prototypes that define the system:
  - `App Screens.dc.html`: the phone screens.
  - `Desktop Screens.dc.html`: the D1 Session, D2 Compare and D3 Corner workspaces at 1280 pt and up.
  - `Handoff v2.dc.html`: the real track map, loading and error states, series and event, settings, and light chart tokens.
  - `Design System.dc.html`: the original specimen page.
- The developer handoff is `design_handoff_lap_analysis/README.md`. Its v2 section is the source of truth for behaviour.
- The live app's API is referenced in the handoff, e.g. `GET /api/lmu/sessions/{id}/map` with its OSM outline and georef.

## Content fundamentals
- **Plain, factual, second person when needed.** Examples:
  - "Each bar is one lap. Up = faster than the median."
  - "The server didn't respond. Your uploads are safe on the server and will appear once it's reachable."
  - No "we", no exclamation marks, no emoji.
- **Every chart has a one-line explainer** saying what it shows, e.g. "Running gap to the reference. Line rising = losing time there."
- **The reference lap is always named:** "Seconds vs L16", "compared with L16", "Reference L16 · 1:39.733 · Race best".
- **Units follow every number:** s, m, km/h, %, °.
- **Number formats:**
  - Lap times are `m:ss.sss`.
  - Gaps are signed with three decimals: `+0.312` / `−0.058`, using the true minus sign "−". The section grid uses two decimals without the leading 0: `+.24`.
  - Distances are whole metres: `2,150 m`.
- **Names:**
  - Laps are `L1…Ln` in driving order.
  - Sessions are R, Q or P in badges, and Race, Qualifying or Practice in titles.
  - Car model first, team second: "Porsche 911 GT3 R · Manthey #91".
  - Short track names in lists ("Spa", "Le Mans").
- **Tags are short caps codes** (OUT, IN, PART, SLOW, OFF 1.6, HIT, BEST), with a key under each table and the full reason in the detail panel.
- **Rules are stated, not implied:** "Laps more than 1.12 s slower are excluded (median + 3 robust σ, max 7%)."
- **Sentence case** for buttons and headings. Section labels are mono caps ("TIME PER SECTION"). An arrow → marks a navigation action ("Compare 3 →").
- **Errors say what happened and what still works.** They never blame the user and never say "Oops".

## Visual foundations
- **Mood:** instrument panel. It is dark-first, dense and quiet, and the data is the brightest thing on screen. Light theme uses the same roles with darker inks, and the theme defaults to the system setting (dark when there's no preference).
- **Color: one meaning per color.**
  - Amber (`--accent`) is UI only: selection, the highlighted row, the primary button, the playback cursor and pit markers.
  - Purple (`--best`) means best lap or best sector only.
  - Green (`--faster`) and red (`--slower`) always appear with a − or + sign, and they differ in lightness (faster bright, slower dark) so they read without color vision.
  - Lap colors (`--lap-ref` white, then `--lap-1…5`) are only ever used for laps.
  - 7–19 laps use desaturated tints (`--lap-tint-n`, 1.2 pt, 55%). 20 or more use `--lap-muted` (1 pt, 45%). The reference and highlighted lap stay at full color and 2.3 pt.
- **Time-difference scale:** neutral grey within ±0.10 s, saturating to full strength at ±0.30 s.
- **Type:**
  - IBM Plex Sans Condensed for headings, body and explainers.
  - IBM Plex Mono for every number, label, column header and axis, with tabular figures.
  - Label caps get +0.08em tracking. Nothing is set below 9 pt.
- **Backgrounds:** flat surfaces with no gradients, images, textures or blur. Depth comes from three surface steps (`--surface`, `--surface-raised`, `--surface-overlay`) and 1 px lines.
- **Borders and shadows:** 1 px `--line` row dividers and `--line-strong` rules and control borders. The only shadow is `--shadow-float`, used on floating elements (the compare tray, menus).
- **Radii are small:** 2 pt cells and marks, 3 pt controls and chips, 6 pt cards and panels, 10 pt at the top of bottom sheets. There are no large rounded cards and no colored left-border cards.
- **Selection and highlight:** the selected row gets a 3 pt amber inset bar on the left plus `--accent-tint`. The selected segment is an inverted pill (`--text` on `--bg`).
- **States:**
  - Hover (desktop) is a `--surface-raised` background on rows. The chart hover line is dashed, in `--chart-hover`.
  - Press has no scale effect.
  - Disabled is 40% opacity for buttons and faint text for segments.
  - Excluded laps are shown at 50% opacity.
- **Motion:** almost none. Playback moves the cursor and markers at the chosen rate, and the map follow view pans with the car. There are no bounces or decorative transitions.
- **Charts:**
  - Plots sit on `--chart-plot` or the bare background.
  - Corner and section gridlines are `--chart-gridline`, the median and zero lines `--chart-zero`, and the consistency band `--chart-band` (p10–p90).
  - Overlaid channels in one chart use line dash (solid, `5 3`, `1.5 2.5`) while color keeps meaning lap.
- **Map:**
  - The OSM outline is drawn as an edge stroke with a fill band, with the pit lane thinner, section ticks across the track and S1–S5 labels on the inside.
  - OSM attribution is always shown with OSM geometry. When quality is poor, it falls back to the driven line with a note.
- **Layout:**
  - Phone content is 358 pt wide (16 pt margins). Lap rows are 32 pt, session rows 54 pt, chips 28 pt, transport controls 40 pt, and hit areas at least 44 pt.
  - Desktop has three tiers: 1280 pt and up is the D1–D3 workspaces, 900–1279 is two-column, below 900 is the phone layout.
  - The compare tray floats at the bottom and the transport bar is pinned to the bottom of Compare.

## Iconography
- There is **no icon font or icon library.** The interface is text-first.
- The few glyphs are Unicode, set in the mono or sans face: ‹ back, › next or disclosure, × remove, ✓ checked, ! failed, ▾ picker, ↑ ↓ sort and reorder, → navigation action, − and + steppers.
- Play and pause are two tiny inline SVG shapes (a triangle, and two bars) in `Transport`.
- Status uses 7–8 pt dots (StatusDot), never icons.
- Session type is a boxed letter badge (R, Q, P) and the series is a boxed mono chip ("ELMS").
- **No emoji anywhere.**
- If a future feature needs real icons, use one outline set at a 1.5 pt stroke (Lucide is the closest match) and flag it as an addition.
- **No logo was provided.** The app chrome shows a plain 18 pt square placeholder, so render the product name in plain type wherever a mark would go.

## Index
- `styles.css`: the entry point, which only @imports `tokens/fonts.css`, `tokens/colors.css` (dark `:root` plus `[data-theme="light"]`), `tokens/typography.css` and `tokens/spacing.css`.
- `guidelines/`: foundation specimen cards for Colors, Type and Spacing.
- `components/`: one folder per component (`<group>/<Name>/` with `.jsx`, `.d.ts`, `.prompt.md` and a preview card).
  - `controls/`: Button, SegmentedControl, Stepper, Switch, Checkbox.
  - `laps/`: LapChip, LapTag (with LAP_TAG_PRIORITY), SessionRow, LapRow, StintHeader, LapDetail, CompareTray.
  - `charts/`: ChartHeader, TraceChart, LapTimeBars, TimeGrid, DotStrip, TrackMap, Transport.
  - `feedback/`: StatusBanner, StatusDot, Skeleton, EmptyState.
- `ui_kits/lap-analysis/`: the phone click-through, Sessions → Session → Compare.
- The prototypes and handoff are listed under Sources.
- `SKILL.md`: the Agent Skill entry point.

## Intentional additions
- **Skeleton, StatusBanner, StatusDot and EmptyState** formalize the v2 loading, error and settings states. The original screens had no primitives for them.
- **Follow view:** `TrackMap` covers Track mode only. The Follow view (a heading-up chase view whose zoom tracks the chart window) has no component yet; its geometry lives in the prototypes (`follow()` in `App Screens.dc.html`).

## Caveats
- **Fonts** load from Google Fonts through `tokens/fonts.css`. There are no self-hosted font files yet.
- **Sample data** in all prototypes is synthetic: the track shape, the lap numbers, and the fuel and tyre figures.
