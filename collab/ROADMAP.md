# Roadmap

Draft 2026-09-27 by opus, revised after `claude`'s review in [005](threads/005-roadmap.md). Not a decision until Botkin accepts it.

Two parts. **Restart** is the work already in flight: get LMU into the app, get it to the phone, settle the data model, clean up, and make it great. **Extensions** are the feature phases after that, built from Botkin's 2026-09-26 phone notes ([full text](ideas/2026-09-26-source-telemetry-feature-research.md)).

The goal that orders everything: **consistency analysis**, finding under a tenth in a corner, on the phone, with overlaid traces.

Each extension says what the LMU recording already holds. Checked against `Michelin Raceway Road Atlanta_R_2026-09-26T00_38_49Z.duckdb` (57 channels, 45 event types). "In the file" means we can build it from the `.duckdb` we already extract. "Needs a recorder" means a live shared-memory reader that does not exist yet.

---

## Restart

| Phase | What | State |
| --- | --- | --- |
| R1 | LMU laps on the existing compare chart, full rate | done (`8cb988f`…`23d6105`) |
| R2 | Upload program, plus close-out bugs | done 2026-09-27: phone fix, BEST-lap fix, Garage 61 dropped (`a04e5fd`). Botkin tested on the phone. Storage still testing-only. |
| R3 | Data model, track model, storage | next. Gated: Botkin approves the storage. |
| R4 | Cleanup | after R3 |
| R5 | Design: the wow pass | after R4 |

**R2 close-out.** Two bugs, shipped together at one checkpoint:

- Phone: analyze bounced to driver profile when signed out of Garage 61. Fixed in `app/_layout.tsx`, verified locally at phone width. Not deployed.
- Session cards pick a partial or untimed lap as BEST (Daytona race at 0:02.870).

**R3 — data model, track model, storage.** One lap/session/channel model that Garage 61, LMU `.duckdb`, and later iRacing `.ibt` all map into. The storage Botkin did not approve is replaced here. This phase has a gate: he approves the storage before R4 starts, so cleanup and design are not built twice.

- One channel catalog for both sims, sim-only channels on the side ([idea](ideas/2026-09-26-channel-catalog.md)). The nine CSV columns become a subset.
- Named derived channels in the catalog, so the chart and later phases share them: combined G, friction-circle use, ABS and TC duty in a zone, heading against the track, line curvature, Δwear and Δtemp per corner (notes 3.8).
- Track model, cached per track and layout: centerline, width, corner and straight segments, pit-loss measured from pit in/out (notes slice 2). E1, E4 and E5 all need the corner segments.
- Distance (`s`) is the axis. It already is; keep it.
- Lap tags we already compute (pit, off-asphalt, untimed) become first-class fields, so E2 extends the model instead of rewriting it.
- A lap is fetched by itself, so "my best lap from last week on this week's stint" stays one small download.
- Answer the notes' section 6 from the code before building on it: how a lap boundary and invalidation are defined today, which channels are kept at sample rate and which at event rate, and what the Garage 61 CSV leaves out compared with a full `.ibt`.

**R4 — cleanup.** Architecture pass on the year-old app, against the R3 model.

**R5 — design.** Consistency first: stint spread of clean laps, trend with fuel and tires, and a theoretical best built from corners that can actually connect, not only sectors. A "time found" ledger per week shows whether practice on a corner moved the distribution. Mobile playback with overlaid traces is the showpiece. Two rules from the notes:

- Analysis order in the UI: delta (where), then line and minimum speed (what shape), then inputs (how), then context (why).
- Brake and throttle points on the map, said as meters from a landmark, beat "0.12 s later."

---

## Extensions

| Phase | What | In the file | Needs a recorder |
| --- | --- | --- | --- |
| E1 | Corner cost on laps Botkin picks | all driving channels, `Path Lateral`, G forces, R3 corner segments | — |
| E2 | Context tags on every lap | pit, surface (off-asphalt), impact magnitude, yellow and sector flags, fuel, VE, compound, tire wear, weather, `Time Behind Next` | other cars, blue flag, official track-limit points |
| E3 | Reference matching and clean-lap pace | fuel/VE band, compound, wear, track temp, damage from E2 | clean-air ratio |
| E4 | Energy and endurance planner | `Fuel Level`, `Virtual Energy`, `SoC`, `Regen Rate`, `FuelMixtureMap`, `Brake Migration`, pit events | lift-and-coast progress, motor map |
| E5 | Tires | temps (inner/centre/outer, carcass, rim), pressure, wear, compound | — |
| E6 | Live recorder and the field | — | all of it |
| E7 | iRacing direct (`.ibt`) | — | an `.ibt` reader |

**E1 — corner cost.** Serves the consistency goal most directly. For each corner and straight, time against a reference lap Botkin chooses, with cause estimates that add back to the segment delta: brake point, peak brake, minimum speed, throttle pickup, line. Rank by recoverable time, and fold the same mistake in three hairpins into one habit. Deterministic, no LLM. The reference stays manual until E2 lands; the existing pit, off-asphalt and untimed tags already keep junk laps out. [Idea](ideas/2026-09-26-corner-cost.md).

**E2 — context tags.** Tag why a lap was slow before calling it a driving mistake. Split stint pace into clean, traffic, yellow, contact, in/out. The headline number is the clean-lap median. The notes' "context makes the planner honest" is why this comes before E3 and E4. [Idea](ideas/2026-09-26-context-events.md).

**E3 — reference matching.** The app picks the reference: same car, track, session type, fuel or VE band, compound and wear band, conditions. A qualifying ghost on low fuel is noise against a race lap. Notes section 3.3.

**E4 — energy.** Per-lap fuel and VE use (median, excluding in/out and yellow laps), laps to go, stops to finish, and "save X% VE per lap to drop a stop" with its lap-time cost. Hybrid deploy map from SoC and regen against distance. Lift-and-coast exchange rate per corner starts from throttle-off-before-brake in the file; the game's own L&C progress channel needs E6. [Fuel and VE](ideas/2026-09-26-fuel-virtual-energy.md), [L&C and hybrid](ideas/2026-09-26-lift-coast-hybrid.md).

**E5 — tires.** Wear per corner, time above the optimal band, lap time against wear split by fuel load. [Idea](ideas/2026-09-26-tires-and-elevation.md).

**E6 — live recorder.** A PC-side reader of LMU's official shared memory, running next to the game. Only this unlocks other cars (traffic, overtakes, clean-air percent), blue flags, the official track-limit counter, lift-and-coast progress, and elevation (world position). It is a new program on the PC, so it is its own phase.

**E7 — iRacing direct.** Read `.ibt` into the same model, so iRacing gets tires, weather, and flags that the Garage 61 CSV does not carry. Garage 61 stays as the community reference source.

**Parked.** Spikes, no promise: [parking lot](ideas/2026-09-26-parking-lot.md). Team artifacts (shared plan, stint notes, "this lap is the reference because…", notes slice 8) are parked there too. Elevation waits on E6, because the recording has GPS latitude and longitude but no altitude.

---

## Vetting rule for anything new

From the notes, section 7. Before a feature gets a phase: the source field exists or can be derived without guessing; it has an iRacing mapping or is marked LMU-only; it changes a decision (next corner, next pit, next reference lap); it tags events instead of averaging them away; the analysis works with the game closed (a recorder may run beside the game, but only to capture); it handles a 24-hour file without loading it all into memory.
