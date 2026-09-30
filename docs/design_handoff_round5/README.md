# Claude Design, rounds 4 and 5: Plan, fuel, pit stops, Race, Corner, the "?" pattern, and the nav

Two review rounds of the screens we built after round 3. Round 4 corrected them from the brief; round 5 applied our feedback (`pit-wall/ideas/2026-09-30-claude-design-round4-feedback-1.md`) and added desktop frames. **Round 5 wins where the two differ.** Open the `.dc.html` files in a browser (they need `support.js` beside them). `round5-text.txt` is the round 5 text, for grep.

The sample figures are synthetic (Portimão, 2 h). Build from our real data, never from the numbers in these frames.

## What's in round 5
1. **Plan v2:** "Your last race here" under the chips, with the inputs prefilled from it; the Stops table leads with the full-tank row (stint laps "27 + 28 + 17") and shows equal stints second; Per tank bars with a p90 notch and a boxed "RUNS OUT FIRST".
2. **Fuel-only state** (no VE, e.g. LMP2): VE parts are removed, never shown as 0 or "—". The state is chosen per session from whether VE is stored, never by car class.
3. **Pit stops card v2:** one column per stop (0 / 1 / 2 / 3+ rules; 0 stops becomes a "Fuel" card); bars for VE out and for the pit lane (refuel inside the lane time, litres ÷ 3.4 L/s); the end row "End of L72 · the last whole lap"; "Plan vs what happened" as the lower half, with Plan and Actual in rows.
4. **Track page:** a Plan block per car. **Practice:** stint lines end "in Plan →"; a "Use and lap time" scatter pools all sessions for the track and car, with a Fuel/VE switch and one reference line, the plan's "to drop a stop" threshold.
5. **Race desktop v2:** the class leaderboard in a 320 pt right column (below the lanes at 900–1279), "+1 lap", PIT count and IN, no Satellite, the radar's 10 m lines, Follow −/+ from 120 m.
6. **Compare on the phone:** the plot and the Follow map touch; the live values stay in the chart header; the radar overlay has a 72 % background and disappears without a fade; Follow steps 60 / 120 / 250 / 500 m.
7. **Corner:** "Full throttle by the slowest point: 27 of 38 laps" plus the explainer; "Steering, % of full lock"; MEASURED lines with each channel's rate.
8. **Desktop:** Plan in 3 columns (inputs · answer · use-and-lap-time); Session with the Pit stops card in a 400 pt right column beside the lap table.

Round 4 adds the per-chart "?" spec (WHAT / MEASURED / DIRECTION / LINES) and the nav: a phone bottom bar of Sessions / Plan / Settings, with Laps / Compare / Corner / Race as a segmented row under the session title.
