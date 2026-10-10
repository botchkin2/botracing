# Handoff: Lap analysis app (React Native), v1


## v2: answers to the feedback log
This section is the source of truth where it conflicts with anything below. Frames: `Handoff v2.dc.html`. Build decisions B1–B10 are adopted as the design.

**Missing**
- **M1 Real track map.**
  - **Map panel modes:** Follow / Track / Satellite. Satellite is disabled until it ships.
  - **OSM outline** (`quality` good or fair):
    - Band is `chart.track` edge stroke 10 pt with a `chart.trackFill` stroke of 7.5 pt on top.
    - Pit lane is the same styling at 4.5 / 2.5 pt, with a "PIT" label.
  - **Laps:** georeferenced traces in lap colors on top (ref 2 pt, others 1.4 pt), with cursor dots synced to the charts.
  - **Labels:**
    - Section boundaries are 14 pt ticks across the band (`#8a929b`, light `#737a82`).
    - S1–S5 labels go on the inside of the loop, corner numbers on the outside in 8.5 pt `textFaint`.
  - **Quality chip, top right:** "OSM outline · good" or "Driven line".
  - **Attribution:** "© OpenStreetMap contributors", 9 pt, bottom right, whenever OSM geometry is drawn.
  - **Poor quality:**
    - The driven line is drawn at 6 pt `chart.track`, with no edges, pit lane, attribution or Satellite.
    - The note reads: "No reliable track outline for this layout, so this shows your driven line instead. Laps line up by distance, not by position on the track." It shows once per session and dismisses on tap.
  - **Follow** draws the OSM edges (1.3 pt `#4d555d`) and the position label "Section 4 · C8 apex".
- **M2 Desktop.** Three tiers: 1280 and up = D1/D2/D3; 900–1279 = the build's two-column layouts; below 900 = phone.
- **M3 Loading and errors.**
  - **Sessions, first load:** skeleton rows at the real 54 pt height and a 2 pt accent progress line. With a cache, show the cached rows plus the progress line only.
  - **Offline:** a neutral banner, "Offline. Showing sessions saved on this phone, last synced 21:58.", with Retry. Uncached rows are at 50% with "Not saved offline" and can't be opened.
  - **Server error, no cache:**
    - Full screen with the title "Couldn't load sessions" and the body "The server didn't respond. Your uploads are safe on the server and will appear once it's reachable."
    - A mono request line (long-press to copy), Retry as primary, and "Show saved (n)".
    - With a cache, it becomes the banner "Server unavailable".
  - **Compare loading:**
    - The reference loads first, then the laps one at a time; each lap appears as soon as it's ready.
    - The chip shows % and a 2 pt progress bar; queued chips are dashed.
    - A status row reads "Loading telemetry · 1 of 3 laps · 2.1 of 3.4 MB".
    - Dependent cells stay neutral placeholders. Scrubbing is never blocked.
  - **One lap failed:**
    - The chip gets "!" and "Retry", and keeps its color slot.
    - The banner reads "L31 telemetry didn't load (timed out after 20 s). Showing 2 of 3 laps."
    - If the reference fails, the next loaded lap becomes a temporary reference and the line reads "L12 (L16 failed to load)".
  - Status banners are neutral (`surfaceOverlay`, `lineStrong` border), never amber or red.
- **M4 Series and event.**
  - Optional `series` (short chip, e.g. "ELMS", 9.5 pt mono, 1 pt border) and `event` ("Super 60 · Round 4").
  - **Sessions, Day view:**
    - Within a day, sessions sharing an event sit under an event header indented to the text column (44 pt), with the series chip, event name (truncates) and "n sessions".
    - Sessions with no event list directly.
  - **Sessions, Event view (later):** one card per event, containing:
    - a header with chip and name, "track · dates · car · laps" and "Event best" in purple;
    - rows whose line 1 is the session type and line 2 the day and time;
    - a "No event" list after the cards.
  - **Session header order:**
    - series chip and event (omitted if none);
    - "Race · Portimão";
    - "Porsche 911 GT3 R · Manthey #91", team muted, the team part wraps;
    - time · sim · duration.
- **M5 Settings.** Opens from a gear on the Sessions header (phone) and from Settings in the desktop chrome.
  - **Uploader card:**
    - Status dot: green = connected and seen within 10 min, grey = not seen or not connected, amber = waiting during setup. There is never a red dot.
    - Host · version · "LMU found", last upload, queue.
    - "Set up on another PC".
  - **Appearance:** Theme = System / Dark / Light.
  - **Units:** speed km/h|mph, distance m|ft, temperature °C|°F. Display only; stored data stays metric.
  - **Offline data:** "Keep recent sessions" stepper (default 20) with count and size; "Download on Wi-Fi only" toggle (on); "Clear offline data…" (confirm).
  - **Account:** email and Sign out, then the app version.
  - **Set up uploader:**
    1. Install on the sim PC, with "Send link to my email".
    2. Enter the pairing code (26 pt mono, expiry countdown).
    3. Drive a session: "Waiting for the uploader to connect…".
    - Error example: "Not seen for 3 days", the last error, the path, and "How to fix ›".

**Wrong or unclear**
- **W1 Light chart tokens:**
  - chart.track `#d5d9dd` · chart.trackFill `#eef0f2` · chart.trackEdge `#b9bec3`
  - chart.gridline `#e3e5e8` · chart.zero (median and zero lines) `#aeb4ba` · chart.band `#111316` at 7%
  - chart.cursor = accentInk `oklch(0.62 0.15 65)` · chart.hover `#111316` at 60%
  - grid.neutral `#e6e8eb` with text `#4a5057`; grid.slower `oklch(0.48 0.19 25)` at 55–100% with white text; grid.faster `oklch(0.72 0.15 150)` at 45–100% with text `#111316`
  - map.badge `#fff` with stroke `#c9cdd1`; map.label `#4a5057`, corner numbers `#9aa0a6`
  - Dark equivalents are in the same table in `Handoff v2.dc.html`.
- **W2 Sessions row at 375:**
  - The budget is 16 + 22 + flex ≈ 143 + 28 + 62 + 62 + 16, with 8 pt gaps.
  - Line 1 is the layout's short name and never truncates.
  - Line 2 is "car model · time": the model truncates with "…" and the time never does.
  - The type lives in the R, Q or P badge.
- **W3 Lap table at 375:**
  - Columns 16 | 28 | 60 | 42 | 34 | 34 | 34 | tag ≥ 58, with 4 pt gaps. Sectors show 1 decimal at 375 and 2 on desktop.
  - Each row shows one tag plus a muted "+n". Priority: exclusion reason (OUT, IN, PART, SLOW) > BEST > OFF > HIT. The detail panel lists every tag.
  - Stint header on two lines: "Stint 1 · L1–L17" / "median … · spread …", with Select stint on the right.
- **W4 Theme:** System is the default; it follows the OS, and dark is used when the OS reports no preference. Settings can override.

**Build decisions adopted:** B1–B10 as logged.
- The prototypes now match them: tag order and OFF/HIT rules, detail copy, the no-brake dash, Sessions row lines, and the Session header full car name.
- Desktop: no Top km/h, Stint column 34, fall-off without an interval, no rail search or chrome uploader status, no Export CSV, and D3 with a Selected / All comparable laps toggle.
- B9 (a reference-time x axis in Time mode) and B7 (sections in the phone and desktop prototypes' own grids) are specified here and in the v2 frames. The older prototype engines still draw metres and 11 corners.

## Overview
A personal lap and race analysis app for a sim racer. It is used mostly on the phone, straight after a session. v1 has four views:

1. **Sessions**: sessions by day.
2. **Session**: one chart of every lap's time across the race, plus a dense lap table. Laps are selected here for comparison.
3. **Compare**: traces against a chosen reference lap, a map with moving markers, scrub, zoom, playback, and a per-corner time grid.
4. **Corner**: every selected pass through one corner, with brake point, minimum speed and throttle pickup, and traces zoomed to that corner.

The app offers tools, not conclusions. It generates no verdicts, scores or recommendations. Every chart carries a one-line explanation, every number has a unit, and the reference lap is always named.

## About the design files
The files in this bundle are **design references created in HTML**. They are prototypes that show the intended look and behavior; they are not production code to copy. The task is to **recreate these designs in React Native** using the codebase's established patterns (navigation, state, charting). If there is no codebase yet, choose appropriate libraries; `react-native-svg` plus a small custom chart layer, or Skia, fits the charts shown here.

Open `App Screens.dc.html` in a browser (keep `support.js` next to it). Every frame is interactive. The four screen components are separate files, each taking one `v` screen model, which maps directly to a screen component and its props or selectors.

## Fidelity
**High fidelity.** Colors, type, spacing, line weights and interactions are final. Recreate them pixel-accurately at 1 pt = 1 CSS px, with a 390 pt wide screen, 16 pt side margins and 358 pt content width.

---

## Global rules
- **Color has one meaning each.**
  - `accent` amber is UI only: selection, highlight, primary button, chart cursor, pit markers. It is never a lap color.
  - `best` purple marks the session best lap and best sectors only.
  - Lap colors are only for laps.
  - `faster` and `slower` always go with a sign (− faster, + slower), and they are also separated by lightness (faster is bright, slower is dark) so the pair reads without color vision.
- **Lap palette, fixed order:** ref `#f2f4f6` (white), then lap.1 to lap.5 (below). A maximum of 6 laps get individual colors.
  - **7–19 laps selected, tinted mode:** each non-key lap uses its hue at low chroma, `oklch(0.72 0.07 H)` with H cycling 255, 350, 185, 105, 225. Stroke 1.2 pt at 55% opacity.
  - **20+ laps, grey mode:** `#5d646d`, 1 pt at 45% opacity.
  - In both modes, the **reference** and the **highlighted (tapped) lap** use full colors (ref white, highlighted lap.1) at 2.3 pt, drawn on top. Only those two show values in chart headers and dots on the map.
- **Line weights:**
  - reference and highlighted lap: 2.3 pt
  - selected lap (normal mode): 1.5 pt
  - cursor: 1 pt accent
  - pit marker: 1 pt accent, dashed 2/2
  - brake and throttle point marks: 1 pt in the lap color, dashed 3/2
  - median and zero line: 1 pt `#3a4148`
- **Units and formats:**
  - lap time `m:ss.sss`
  - gaps are signed with 3 decimals (the corner grid uses 2 and drops the leading zero, e.g. `+.21`)
  - distances in whole metres, speed in km/h, pedals in %, steering in °, impact in g
  - corner names follow "Corner 6 · 2,150 m"
- **Explainer line:** every chart and table has one line of explanatory text under its label (`type.explainer`). The exact copy is in the prototypes; keep it verbatim.

## Design tokens
Dark is the default. Light values are listed where they differ.

### Color
| token | dark | light | use |
|---|---|---|---|
| bg | `#0d0f12` | `#f4f5f6` | app background |
| surface | `#101317` | `#ffffff` | table headers, map panel |
| surfaceRaised | `#15181c` | `#eceef0` | chips, cards, detail panel (`#171a1f` for the detail panel) |
| surfaceOverlay | `#1b1f23` | `#ffffff` | compare tray, menus |
| line | `#15181c` | `#e3e5e8` | row dividers |
| lineStrong | `#2e343a` | `#c9cdd1` | control borders, section rules (`#21252b` for header rules) |
| grid | `#1d2125` | `#eceef0` | chart corner lines |
| text | `#e4e7ea` | `#111316` | primary |
| textSecondary | `#aeb4ba` / `#c3c8cd` | `#4a5057` | values in tables |
| textMuted | `#8a929b` | `#4a5057` | explainers, labels |
| textFaint | `#5b636b` | `#737a82` | axis, units |
| accent | `oklch(0.80 0.16 70)` ≈ `#f2a93b` | same fill | UI accent |
| accentInk | = accent | `oklch(0.62 0.15 65)` | amber lines and text on light |
| accentTint | accent @ 13% | accent @ 18% | highlighted row and bar |
| best | `oklch(0.70 0.20 300)` | `oklch(0.52 0.20 300)` | best lap and sectors |
| faster | `oklch(0.82 0.17 150)` | `oklch(0.60 0.15 150)` | always with − |
| slower | `oklch(0.64 0.20 25)` | `oklch(0.48 0.19 25)` | always with + |
| lap.ref | `#f2f4f6` | `#111316` | reference |
| lap.1 | `oklch(0.70 0.15 255)` | `oklch(0.52 0.17 255)` | also the highlighted lap in tinted and grey modes |
| lap.2 | `oklch(0.73 0.17 350)` | `oklch(0.56 0.20 350)` | |
| lap.3 | `oklch(0.78 0.11 185)` | `oklch(0.55 0.10 185)` | |
| lap.4 | `oklch(0.90 0.14 105)` | `oklch(0.68 0.14 100)` | |
| lap.5 | `oklch(0.84 0.09 225)` | `oklch(0.62 0.10 225)` | |
| lap.tint | `oklch(0.72 0.07 H)` @55% | `oklch(0.62 0.06 H)` | 7–19 laps |
| lap.muted | `#5d646d` @45% | `#b9bec3` | 20+ laps |
| band | `rgba(230,232,234,0.07)` | `rgba(17,19,22,0.07)` | consistency band (p10–p90) |

For RN, convert the oklch values to hex or rgb with any oklch→sRGB converter (e.g. culori) when building the theme.

**Corner time grid scale** (difference vs reference, in seconds; opaque colors, never alpha):
- |d| < 0.10: `#1b1f24` background, `#9aa1a9` text.
- Slower (d > 0): `oklch(0.40+0.12t  0.10+0.10t  25)`, text `#f2f4f6`.
- Faster (d < 0): `oklch(0.62+0.20t  0.10+0.07t  150)`, text `#0d0f12`.
- t = min(1, (|d| − 0.10) / 0.20), so full strength is reached at ±0.30 s.

### Type
Two fonts: **IBM Plex Sans Condensed** (400, 500, 600) and **IBM Plex Mono** (400, 500, 600). All numbers use Mono with tabular figures.
| token | spec |
|---|---|
| display | Sans Cond 600, 24/26 (screen titles; 22 on Session title) |
| title | Sans Cond 600, 16/20 |
| body | Sans Cond 400/600, 14–14.5/20 |
| explainer | Sans Cond 400, 11–12/15, textMuted |
| label | Mono 600, 10.5, uppercase, letter-spacing 0.08em |
| data | Mono 400/500, 11.5–12.5, tabular |
| tableHeader | Mono 500, 9–9.5, uppercase, +0.05em, textMuted |
| axis | Mono 500, 9–9.5 (minimum), textFaint |

### Space, radius, sizes
- Space (4 pt base): 2, 4, 6, 8, 12, 16, 24, 32.
- Radius: xs 2 (grid cells, marks), sm 3 (controls, chips, checkboxes), md 6 (cards, tray, detail panel).
- Sizes:
  - lap table row 32
  - session row about 54
  - chip about 28
  - transport buttons 40
  - minimum hit area 44 (extend checkbox and chip hit areas beyond their drawn size)
- Chart heights (Compare): Time diff 62, Speed 104, Throttle 50, Brake 50, Steering 56, Gear 44.
- Chart heights (Corner): Speed 96, Brake 52, Throttle 52.
- Shadow: only the compare tray, `0 8 24 rgba(0,0,0,.5)`.

---

## Screens

### 1. Sessions (`SessionsScreen.dc.html`)
- **Header:** title "Sessions" (display); the context picker "LMU · all tracks ▾" on the right (Mono 500 11.5, 1 pt lineStrong border, sm radius). The picker sets a global sim/track/car filter that every screen respects.
- **Column header:** a pinned row with columns `24 | 1fr | 30 | 64 | 64`, 8 pt gaps: badge, Track · car, Laps, Best, Median. Background surface, with top and bottom borders.
- **Day groups:** each group has a header ("Today" Sans 600 14, plus the date in Mono 11 textFaint) and one row per session.
  - Session type badge R / Q / P: 22×22 pt, 1 pt border.
  - Track in Sans 600 14.5, followed by "· Race" in textMuted.
  - Second line: "21:40 · 911 GT3 R" in Mono 11.
  - Laps, best and median right-aligned in Mono 12.
- **Row states:** the open or last-viewed row has a surfaceRaised background plus a 3 pt inset accent bar on the left.
- **Tap:** opens Session.
- **Empty or first run (01b):** a card reading "No sessions yet", a short explanation, uploader status "Uploader: not seen yet", and a primary "Set up uploader" button.

### 2. Session (`SessionScreen.dc.html`)
- **Header:**
  - back link "‹ Sessions"
  - title "Race · Portimão"
  - subline "Today 21:40 · 911 GT3 R · LMU"
  - a facts row: Laps, Comparable, Best (in `best` purple), Median, each as a label over a Mono 14 value
- **Lap times chart** (358×166):
  - Explainer: "Each bar is one lap. Up = faster than the median (1:41.xxx), down = slower; bars stop at ±1.5 s. Outlined stubs at the bottom are excluded laps. Tap a bar to find it in the table."
  - Bars: width = 358 / lapCount − 1.6.
  - Colors: comparable bars `#5d646d`; the best lap uses `best`; selected laps use their lap color.
  - Excluded laps: a 9 pt tall stub on the baseline (y = H − 14), outlined `#8a929b` on bg.
  - Stints are divided by `#21252b` rules labeled "STINT n". Pit stops are dashed accent lines labeled "PIT".
  - Median line with a "median" label; x-axis labels every 10 laps.
  - The highlighted lap gets a frame 2 pt outside its bar, accentTint fill with a 1.5 pt accent stroke.
- **Lap detail panel:** shown when a lap is highlighted. surfaceRaised background, 1 pt border in accent at 50%, md radius.
  - Title "L22 · 2:06.213" in Mono 600 14.
  - Status: "Comparable · +0.312 s vs median" (textSecondary) or "Excluded · Pit in" (accent).
  - One-sentence reason (rules below).
  - A button: "Add to compare" (primary), "Remove from compare" (outline), or "Reference".
- **Lap table:**
  - Pinned header, columns `16 | 30 | 62 | 44 | 38 | 38 | 38 | 1fr`, 4 pt gaps: checkbox, Lap, Time, vs med, S1, S2, S3, Tags. Rows are 32 pt.
  - Stint header rows: "Stint 1 · L1–L22 · median 1:41.123 · spread 0.38 s" (Mono 600 10), with a "Select stint" tertiary button that selects every comparable lap in the stint while keeping the reference first.
  - Best sector values are in `best` purple.
  - "vs med" is signed; faster values use `faster`.
  - Excluded rows are drawn at 50% opacity with no gap value.
  - Tags are short codes in Mono 10: `BEST` (purple), `OUT`, `IN`, `PART`, `SLOW`, `OFF 3.1`, `HIT 2.1g`, and never wrap. A key is printed under the table.
  - Checkbox: 16 pt, 1.5 pt border; when checked it fills with the lap's Compare color and shows a ✓.
  - Row highlight: accentTint background plus a 3 pt inset accent bar.
- **Interactions:**
  - Tap a bar: highlights that lap, scrolls the table so the row sits about 55% down the viewport, and shows the detail panel.
  - Tap a row: highlights it, and its bar is framed.
  - Tap the checkbox: toggles selection. There is no cap on the number of laps; above 6 the tinted or grey rules apply. The reference (the first selected lap) cannot be removed from here.
- **Compare tray:** floating, 12 pt from the sides and 18 pt from the bottom. It shows a color square per selected lap, a label ("L16 · L12 · L31", or "L16 ref + 21 laps"), "Clear", and a primary "Compare n →".
- **No comparable laps (02c):** the chart is replaced by a card saying "3 laps, none comparable" with the reasons listed. The table still shows.

**Exclusion reason copy:**
- Pit out: "Starts in the pit lane, so it includes pit exit time."
- Pit in: "Ends in the pit lane, so it includes pit entry time."
- Partial: "Timing started partway round, so the lap is incomplete."
- Slow outlier: "+X.XX s vs the stint median. Laps more than Y.YY s slower are excluded (median + 3 robust σ, max 7%)."
- Add these when they apply:
  - "Off track for N.N s." If the lap is still comparable, add ", under the 1.0 s tolerance, so the lap still counts".
  - "Impact of N.N g, possible damage."

### 3. Compare (`CompareScreen.dc.html`)
- **Header:** "‹ Session", "Compare", and on the right a "Hide map" / "Show map" toggle.
- **Reference line:** "REFERENCE" label, a white line swatch, then "L16 · 1:39.733 · Race best". It truncates with an ellipsis and is always visible.
- **Lap chips:** horizontally scrolling. Each chip has a 10×3 color swatch, the lap label, and its delta to the reference (signed, colored faster/slower) or "REF". Non-reference chips have ×. Tapping a chip makes that lap the reference. In tinted or grey mode only the ref and highlighted chips show, plus a dashed chip "+N laps, tinted" (7–19 laps) or "+N laps, shown grey" (20+).
- **Map (shown), 358×170 on surface:**
  - Track stroke 6 pt `#262b31`.
  - Corner badges are 8 pt radius circles with the number; the open corner is inverted (text-colored fill, dark number).
  - Each lap has a position dot (r 4.5, 1.5 pt bg stroke). Tapping a badge opens Corner.
- **Map panel modes (segment at the top left): Follow (default) / Track.**
  - **Follow** is a zoomed chase view for watching the racing line through the corner.
    - It is heading-up and centred on the reference car at 64% of the panel height.
    - Zoom tracks the chart window: visible length ≈ 0.95 × the window's distance span, clamped to 50–360 m. Charts and follow view always show the same stretch of track.
    - It draws the track band (12 m wide) with 1 pt edges, one line per lap (its own map x/y path, in lap color; ref white on top), and a car dot per lap at the same elapsed time. Brake points are 2.2 pt ticks across each lap's line, and corner badges sit on the inside of each apex.
    - It also has a 20 m scale bar and a 96×64 whole-track inset (top right) with an accent dot for where you are.
    - In tinted and grey modes, lines follow the same rules; at 20+ laps only the ref and highlighted lap are drawn.
  - **Track** is the whole-lap map described above.
  - On desktop the same two modes fill the 320×220 map slot in D2.
- **Map (hidden) → strip (28 pt):**
  - A 4 pt track bar with corner numbers under it.
  - A frame showing the current zoom window.
  - A 3×16 marker per lap.
  - Dragging along the strip scrubs.
- **Position row:** "Corner 6" or "After Corner 6", the distance, and each shown lap's speed at the cursor in its color, followed by "km/h".
- **Time per corner grid:**
  - Explainer: "Time in each corner vs L16, in seconds. Grey = within ±0.10 s. Red + = slower, green − = faster. Tap a corner to open it."
  - Columns `36 | 11 × 1fr`, 2 pt gaps, 24 pt cells. The open corner's cell has a 1 pt text-colored outline.
  - Rows: one per non-reference lap. In tinted or grey mode, a "MED" row (the median difference of the selection) plus the highlighted lap's row.
- **Charts are user-composed.** Each chart holds 1–3 channels from Time diff, Speed, Throttle, Brake, Steering and Gear, overlaid on the same distance axis.
  - Default set: [Time diff] [Speed] [Throttle + Brake] [Steering] [Gear].
  - Overlay line style shows the channel: 1st solid, 2nd dashed `5 3`, 3rd dotted `1.5 2.5`. Lap color always shows the lap. Channels of the same kind (throttle + brake) share a 0–100% scale; mixed units keep their own scales, and the explainer says so ("Speed solid, Brake dashed. Each channel keeps its own scale.").
  - Single-channel header: label, unit, then each lap's value at the cursor (tap a value to hide that lap in this chart only), and × to remove the chart.
  - Multi-channel header: the combined label ("THROTTLE + BRAKE") with ×, then one 17 pt row per channel containing an 18 pt line-style swatch, the channel name and unit, and the per-lap values.
  - Consistency band only on single-channel Speed, Throttle or Brake charts. Zero line whenever Time diff is present. Height = max of its channels' heights + 14 pt when overlaid.
- **Charts bar** (above the charts, surface background): "CHARTS" label, a view segment **Stack / One chart**, and an "Edit charts" button.
  - **Stack:** every chart stacked with the time-per-corner grid above.
  - **One chart:** built for the phone. The grid is hidden, there is a tab row of the user's charts (tap to switch), and the chart is drawn 330 pt tall. Under the tabs, "Overlay on this chart (up to 3):" is followed by a pill for every channel (✓ on, + off, with accent border and 16% tint when on) that toggles the channel in the focused chart instantly. At least 1 channel must remain.
- **Edit charts sheet:** a bottom sheet over a 55% scrim, starting 120 pt from the top, surfaceOverlay background, 10 pt top radius.
  - Header "Edit charts" and a primary "Done", with one line of explanation.
  - Presets: Default; Pedals = [Time diff] [Throttle + Brake]; Braking = [Speed + Brake] [Time diff]; Separate = one channel each.
  - One row per chart: its number, channel chips (line-style swatch, name, ×; removing the last channel removes the chart), "+ overlay" (dashed, shown while the chart has fewer than 3 channels; opens an inline row of channel pills), and ↑ ↓ × for order and delete.
  - "+ Add chart" at the bottom.
- The chart setup persists per user (not per session), so the layout is the same every time Compare opens.
- **Window (primary way to read traces):** the charts never show the whole lap by default. They show a short window around the cursor so corner detail is readable.
  - **Time mode (default, speed-dependent):** the window is ±win/2 seconds of the reference lap around the cursor. Its distance span is dist(t + win/2) − dist(t − win/2), so it widens on straights and tightens in slow corners. Steps: 0.5 s, 1 s, **2 s**, 4 s, 15 s, Lap. A Lap button beside the stepper goes to the whole lap in one tap (D29).
  - **Distance mode (fixed):** a window of win metres centred on the cursor. Steps: 50, 100, **200**, 400 m, Lap.
  - **Lap:** the whole lap, for orientation only.
  - Inside a window, traces are drawn from every 5 m sample, smoothed with Catmull-Rom (except gear, which stays stepped). Gridlines use a nice step (5, 10, 20, 25, 50, 100 or 200 m) labelled with the lap distance, and corner apex lines are labelled "C6 apex".
  - Time diff is **rebased to the window**: plotted value = (lap.t[i] − ref.t[i]) − (lap.t[i0] − ref.t[i0]), where i0 is the window's left edge. Every lap starts at 0 on the left, so the slope shows where time is gained or lost inside the corner. The y-range is symmetric around 0 with a floor of ±0.02 s. Header values stay absolute (the total gap at the cursor). Windowed explainer: "Time gained or lost within this window, starting from 0 at its left edge. Line rising = losing time. Values are the total gap at the cursor."
  - Speed auto-fits the window; pedals are fixed at −4 to 104. Grid labels closer than 34 pt to the right edge are dropped.
- **Moving through the lap:** dragging any chart pans the window. The cursor stays fixed (centred in time in time mode, and in distance in distance mode), and the traces move under it. Time mode: Δt = −(dx / width) × win. Distance mode: Δd = −(dx / width) × win. Dragging pauses playback. Tapping the map strip, a map corner badge or a corner grid cell jumps the cursor there.
- **Transport bar**, pinned at the bottom in two rows:
  - Row 1: "WINDOW" label, a Time / Distance segment, the approximate span in metres ("≈ 87 m"), and a − 2 s + stepper.
  - Row 2: play/pause (40×40, accent fill) and the rate segment 0.25× / 0.5× / 1× / 2×.
  - During playback the traces scroll under the fixed cursor, and the map dots move as ghost cars. Playback loops at the end of the reference lap.
- **Behavior:** every chart, the map and the strip share one cursor, stored as time on the reference lap. Every lap's values are read at the reference's distance at that time (charts are aligned by distance). The map dots show each lap's own position at the same elapsed time.

### 4. Corner (`CornerScreen.dc.html`)
- **Header:**
  - "‹ Compare", with ‹ › buttons that step to the previous or next corner.
  - Title "Corner 6".
  - Subline "2,150 m · 3 laps · compared with L16".
  - A corner chip row C1–C11; the active chip is inverted.
- **Definition:** a corner runs from the lap's brake point for this corner to its brake point for the next corner. If there is no braking, use 100 m before the apex. The explainer under the table states this verbatim.
- **Up to 19 laps: table.**
  - Columns `44 | 4 × 1fr`: Lap (with color bar, and "REF" under the reference), Time in corner, Brake point (m before the apex), Min speed (km/h), Full throttle (m after the apex).
  - Each cell shows the value with the gap to the reference beneath it; the time gap is colored faster/slower.
  - The highlighted row gets accentTint. Tapping a row highlights that lap.
- **20+ laps: dot strips.**
  - One strip per measure: time in corner, brake point, min speed, full throttle.
  - Header shows the label, unit, "med X · p10–90 A–B", and the min and max at the ends of the axis.
  - Dots: others r 2.8 in `#6b737c`; the reference r 4.2 in white; the highlighted lap r 4.2 in lap.1. Dots at the same value stack alternately up and down in 5 pt steps.
  - The brake point axis is flipped so left means earlier.
  - Tapping a dot highlights that lap; a line under the strips gives that lap's four values.
- **Zoomed traces:** Speed, Brake and Throttle, from 250 m before the apex to 150 m after.
  - An apex rule, plus dashed marks at each shown lap's brake point (Brake chart) and full-throttle point (Throttle chart).
  - Axis ticks at −200 m, −100 m, apex and +100 m.

---

---

## Desktop (1440 × 900 and up): `Desktop Screens.dc.html`
The desktop is **not** a stretched phone. The phone shows one question per view with drill-down and back. The desktop puts related views side by side, shows exact values on hover, and adds analysis that needs the space. It uses the same tokens, color rules, data and state model as the phone. Everything below is interactive in the prototype.

**App chrome (48 pt):**
- Logo mark.
- Workspace tabs **Session · Compare · Corner** (the active tab has a `#1b1f24` fill). These are the same three views as the phone, reachable directly because the selection persists.
- The global context picker, then uploader status and Settings on the right.

### D1 Session workspace
Columns: 280 | 820 | 340.
- **Rail (280, bg `#0b0d10`):**
  - "Sessions" title and a search field.
  - Sessions grouped by day, each row 20 | 1fr | best: type badge, "Portimão · Race", "21:40 · 44 laps", best lap.
  - The open session has a 3 pt inset accent bar. Clicking a row switches the session in place, with no navigation.
- **Centre:**
  - Header: title, subline, and the facts row (Laps, Comparable, Best in purple, Median) aligned right.
  - Lap-time bars at 780×166, the same rules as the phone.
  - A wider lap table (rows 26 pt), columns `18 | 40 | 30 | 78 | 62 | 60 | 60 | 60 | 52 | 1fr`: checkbox, Lap, Stint, Time, vs med, S1, S2, S3, **Top km/h**, Tags. Stint header rows have "Select stint". Row and bar highlighting is synced, as on the phone.
- **Right (340), scrolling:**
  - **Stints table:** name, n (comparable/total), median, best, spread, then a second line with the lap range and "fall-off ±x s/lap" (linear trend of time vs lap-in-stint, with a 95% interval).
  - **Lap-time distribution:** one row per stint (30 pt) in a 236 pt strip with a dot per comparable lap, the stint median as a white tick, and axis labels at min, mid and max. Selected laps use their lap color, the best lap is purple, the highlighted lap gets an accent ring. Clicking a dot highlights the lap.
  - **Stint 2 vs Stint 1 by corner:** median segment time per corner, stint 2 minus stint 1, as diverging bars (84 pt each side), faster green to the left of centre and slower red to the right, with a signed value and a Σ total.
  - The **lap detail panel** (the same as on the phone).
- **Bottom of the right column:** the compare tray.

### D2 Compare workspace
Columns: 260 | 820 | 360. The chrome also shows **Reference** with its name, plus Copy link and Export CSV.
- **Left, laps:**
  - "Comparing" is a vertical list of the selected laps: color swatch, label, time, delta to ref, ×. Clicking a lap sets it as the reference.
  - Below, **All laps** for the session: a compact checkbox list with time, gap and tags, grouped by stint. Clicking a row toggles it in the comparison.
- **Centre:**
  - **Toolbar (surface):** play/pause (30 pt), rate segment, the Window block (Time / Distance, − 4 s +, "≈ 180 m"), and **Layout** preset chips (Default, Pedals, Braking, Separate).
  - **Whole-lap overview (780×58):** the running time diff over the full lap for the shown laps, corner ticks numbered underneath, and an **accent frame showing the detail window**. Click or drag on it to move the window, which also sets the cursor. The desktop shows the overview and the detail together; the phone has to choose one.
  - **Detail charts (780 wide):** the default window is 4 s, in time mode. Heights: Time diff 96, Speed 150, Throttle + Brake 106, Steering 84, Gear 60.
    - Each chart header is its own editor: channel chips (dash swatch, name, ×), "+ overlay" opening inline channel pills, and the value at the pointer for every channel and lap on the right.
    - **Hover** moves a dashed white hover line, and every value in every header and in the Values panel reads at the hover position.
    - **Drag** pans the window, as on the phone, and the amber line stays the cursor. Pointer-leave clears the hover.
  - "+ Add chart" at the bottom.
- **Right (360), scrolling:**
  - **Track map (320×220):** numbered corner badges (clicking one opens it in Corner) and a dot per lap at the cursor time.
  - **Values table:** "Hover · 2,093 m" or "Cursor · …", with rows Time diff, Speed, Throttle, Brake, Steering, Gear × a column per shown lap in its color, in Mono 12 tabular. This is the exact-values readout the phone can't fit.
  - **Time per corner, transposed:** a row per corner (C1–C11 with distance) and a column per compared lap, using the same cells and color scale as the phone grid. The open corner row is tinted. Clicking a cell opens that corner.

### D3 Corner deep dive
Columns: 600 | 840. The chrome also shows the corner chips C1–C11 and ‹ prev / next ›. The default is the whole race (38 laps), because the desktop is where distributions pay off.
- **Left, scrolling:**
  - Title "Corner 6", with the subline "2,150 m · 38 laps · compared with L16".
  - **Where each lap braked (560×210):** a zoomed map of the track from 350 m before the apex to 200 m after, a 16 pt track band with a dashed centreline, and distance marks at −300, −200, −100 and +100 m plus APEX.
    - Brake points are circles: the reference r 4.8 white, the highlighted lap r 4.8 lap.1, others r 2.8 grey at 55%.
    - Full-throttle points are squares, 6 pt for key laps and 4 pt for others.
    - The spread of braking locations becomes spatial and visible at a glance.
  - **Distribution:** four dot strips (time in corner, brake point, min speed, full throttle), 440 wide, with a label, "med · p10–p90" and the axis min and max. Clicking a dot highlights the lap in every panel.
  - **Sortable table** of every selected lap: Lap, Time in corner (s, 3 decimals, plus the signed gap to the reference), Brake point, Min speed, Full throttle.
    - Click a header to sort; the active header is text-colored with ↑ (↓ for min speed, where higher is better). The default sort is time in corner, ascending.
    - The highlighted row gets accentTint. The sticky header uses the surface color.
    - The corner-definition explainer sits under the table.
- **Right (840):**
  - The highlighted lap's line: "L31: 9.75 s · brake 155 m · min 114 km/h · full throttle 50 m".
  - Zoomed Speed (≈226 pt), Brake (≈122) and Throttle (≈122) traces, 800 wide, from −250 m to +150 m around the apex, with dashed brake and full-throttle marks for the key laps and distance ticks. With 20 or more laps, the lines follow the tinted/grey rules.

### Desktop behaviour notes
- Hover is a desktop-only affordance. Anything shown on hover must also be reachable without a pointer: the Values panel falls back to the cursor.
- **Keyboard:**
  - ← → step the cursor 5 m (with Shift, 50 m)
  - Space: play/pause
  - [ ]: window size
  - 1–9: open that corner
  - Esc: clear highlight
- All three workspaces share the phone's state (selection, highlight, corner, window, charts), so switching tabs, or moving between phone and desktop, keeps context.
- Minimum width is 1280. Between 1280 and 1440, the centre column flexes and the side columns keep their widths. Below 1280, fall back to the phone layouts inside a centred 430 pt column, or build a tablet variant later.

## State
- `selection`:
  - `laps: LapId[]`: the first entry is the reference. It persists across sessions and days and is shared by Session, Compare and Corner.
  - `highlight: LapId | null`: shared by the chart, table, dot strips and grid.
- `session`: the open session ID.
- `compare`:
  - `cursorT`: seconds on the reference lap
  - `playing`
  - `rate` (0.25, 0.5, 1 or 2)
  - `windowMode` ('time' or 'distance')
  - `window` (seconds or metres, or 'lap')
  - `mapHidden`
  - `charts`: `{ channels: ChannelKind[1..3], hiddenLaps[] }[]`, persisted per user
  - `chartView` ('stack' or 'one') and `focusedChart` index
  - `editorOpen`
- `corner`: the open corner index.
- **Mode, derived from `laps.length`:**
  - ≤6: individual colors
  - 7–19: tinted
  - ≥20: grey, and Corner uses dot strips

**Deep links:** encode session, laps (ref first), highlight, corner, zoom and cursor, so every Session, Compare and Corner view reopens exactly.

## Data needed per screen
- **Sessions:** a summary per session (track, car, sim, type, start time, laps, best, median).
- **Session:** per lap:
  - time, three sectors, stint, comparable flag, exclusion reason
  - off-track seconds, impact g
  - per-stint median and spread, and the outlier cut
- **Compare and Corner:** per lap, sampled every 5 m:
  - distance, elapsed time, speed, throttle, brake, steering, gear, map x/y
  - per lap × corner: brake point, min speed, full-throttle point, segment time (brake point to brake point)
  - p10 and p90 bands for speed, throttle and brake across comparable laps
- Load heavy per-lap arrays only when Compare opens, and show progress while they load. Summaries load first.

## Files
- `App Screens.dc.html`: every screen and state, interactive. It includes the sample-data generator and all derived logic (in the `<script data-dc-script>` block: `buildData`, `dir()` for Compare charts, `t4()` for Session and Corner models).
- `SessionsScreen.dc.html`, `SessionScreen.dc.html`, `CompareScreen.dc.html`, `CornerScreen.dc.html`: the four screen templates. CompareScreen frames: 03a map, 03b collapsed strip, 03c one chart with overlay pills, 03d edit charts sheet, 03e 12 laps tinted, 03f whole race grey.
- `Handoff v2.dc.html`: answers to the feedback log (real map, sections, loading and errors, series and event, 375 budgets, settings and uploader, light chart tokens).
- `Desktop Screens.dc.html`: the D1 Session, D2 Compare and D3 Corner desktop workspaces, interactive, with the same engine plus `dx()` for desktop-only panels.
- `Design System.dc.html`: tokens and components reference, including the light theme.
- `support.js`: runtime needed to open the .dc.html files locally.

Sample data is synthetic (LMU, Portimão, Porsche 911 GT3 R, 44-lap race). Only its shape is meaningful.

## Assets
There are no images or icons. The play and pause glyphs are simple SVG shapes. The track map is drawn from the per-lap x/y positions.
