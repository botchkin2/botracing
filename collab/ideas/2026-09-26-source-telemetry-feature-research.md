# Telemetry Tool — Feature Add Research Notes
**Owner context:** Staff SWE. Existing product already ingests Garage61 and has a working LMU-direct path (demoed). These notes are capability research for the next slice, not a greenfield design.

**Date:** 2026-09-26  
**Scope:** LMU-first feature adds + iRacing ingest unification + lap-analysis ideas that actually change a driver’s next stint.

---

## 0. Current product position (as stated)

- Built against Garage61 first. G61 does not support LMU.
- Direct LMU ingest already works and has been demoed.
- Next work is feature adds, not “can we read a lap.”
- Dual-sim goal: LMU + iRacing under one analysis model.
- Endurance is a first-class use case, not a bolt-on fuel widget.

Implication: treat G61 as an *iRacing community-lap source*, not as the canonical schema. Own the session/lap/channel model. Map G61 and LMU and IBT into that model.

---

## 1. Data plane — what you can actually read

### 1.1 LMU has three complementary sources. Use all three.

| Source | Rate / nature | Strengths | Weaknesses |
|---|---|---|---|
| Official `LMU_Data` Shared Memory Interface (`Support\SharedMemoryInterface`, post-1.2) | ~100 Hz telem, scoring slower | No third-party DLL; EAC-safe; LMU-native fields (VE, SoC, regen, L&C, track limits, electronics) | Struct packing is `#pragma pack(4)`; version-fragile; scoring vs telem split |
| Iron Wolf `rF2SharedMemoryMapPlugin` (`$rFactor2SMMP_*`) | Classic rF2 maps | CrewChief / Second Monitor / many tools still use it; weather, rules, pitinfo, extended | Plugin install + `CustomPluginVariables.json` quirk (`" Enabled"` leading space); EAC / version risk |
| Local REST `:6397` | Low frequency | Virtual Energy history (`GET /rest/strategy/usage`), garage wearables (`GET /rest/garage/UIScreen/RepairAndRefuel`), pit menu state, forecast-ish data | Unofficial, UI-coupled, version-fragile |
| Native `.duckdb` in `UserData\Telemetry\` | Session recording | Plugin-free post-session; MyLMU / LMU→MoTeC converters already parse this | Not live; large files (~20 MB / 15 min rule of thumb); schema owned by S397 |
| Session XML | Post-race | Classification, sectors, pitstops | After the fact |

**Practical ingest architecture**
- Live: official SMI + REST overlay. Fall back to Iron Wolf map if SMI field is missing on a given build.
- Offline: `.duckdb` as the high-fidelity session archive (same role IBT plays for iRacing).
- Do not let live and offline schemas diverge. Same channel catalog, different adapters.

**Python reference implementations worth reading, not copying as product:**
- `TinyPedal/pyLMUSharedMemory` — official SMI mapping
- `stephenhoran/goLMUSharedMemory` — packing/alignment notes
- `Swizzjack/lmu-pitwall` — clean split: SMI @ 100 Hz + REST for VE/repairs
- `alelosbrigia/LMU-telemetry` — duckdb → MoTeC `.ld`

### 1.2 LMU fields that directly unlock the ideas you listed

**Already in official / rF2-derived structs (player + field):**

| Idea | Fields | Notes |
|---|---|---|
| Blue / race-control flags | Scoring flags, `mUnderYellow`, vehicle `mFlag`, session yellow/red/SC state | Blue specifically is weaker than iRacing’s `SessionFlags` bit. Confirm on current SMI header; may need REST or scoring phase. |
| Other cars on track | `VehicleScoringInfoV01[104]`: `mPos`, `mLapDist`, `mPathLateral`, `mPlace`, `mTimeBehindLeader`, class, pits, estimated lap time; telem array for nearby cars | This is a full field model, not just “car ahead/behind.” |
| Time gaps | `mTimeGapCarAhead/Behind`, `mTimeGapPlaceAhead/Behind` | Cheap HUD channels. Not a substitute for reconstructing the field from scoring. |
| Contact | `mLastImpactET`, `mLastImpactMagnitude`, `mLastImpactPos`, `mDentSeverity[8]`, `mDetached` | Event stream, not a physics contact log. No official fault attribution. You can *infer* direction from impact pos + relative velocity of nearest cars if you record the field at impact tick. |
| Fuel | `mFuel` + consumption derived from Δfuel / lapDist | Classic. |
| Virtual energy / hybrid | `mVirtualEnergy`, `mSoC`, `mRegen` (kW), `mMotorMap`, `mMigration`, `mLiftAndCoastProgress` | This is the LMU differentiator. G61 has nothing like it. |
| Tires | Wheel struct: temps I/M/O + carcass, pressure, wear %, compound index/type, `mOptimalTemp` | Wear + thermal is good enough for stint models. |
| Electronics | TC/ABS levels + active flags, ARB, motor map, regen, brake migration | Online-safe on SMI (pitwall claims this). |
| Track limits | `mTrackLimitsSteps`, steps-per-point, steps-per-penalty, `mLapInvalidated` | First-class invalidation reason, not just a bool. |
| Elevation | World `mPos.y` (or Z depending on coord convention) sampled vs `mLapDist` | Not a named “elevation” channel. Derive a track altitude profile from one clean lap, persist it, reuse. |
| Session clock | `mSessionTimeRemaining`, `mTimeOfDay`, weather / grip / cloud coverage | Endurance + night + weather strategy. |
| Damage / wearables | Dent array + REST RepairAndRefuel (aero, brakes, suspension) | Merge: impact events → damage state → repair time cost. |

**Wheels extras useful for analysis math channels**
- `mLongitudinalPatchVel`, `mLongitudinalGroundVel`, `mGripFract` — community use for ABS onset / slip proxy when a true slip channel is missing.

### 1.3 iRacing ingest (the “bring IBT / IRSDK in” item)

Two adapters, one session model:

| Adapter | Use |
|---|---|
| IRSDK live shared memory | Overlay, live strategy, live field |
| `.ibt` on disk | Offline analysis, identical var set to live |

Canonical references: `kutu/pyirsdk`, `sajax.github.io/irsdkdocs`, IBT = header + disk subheader + varheaders + frames.

**iRacing-specific channels you will want in the unified model**

- Flags: `SessionFlags` bitfield includes `irsdk_blue = 0x20`, yellow, caution, black, repair, start lights. Also `CarIdxSessionFlags[64]`.
- Field: `CarIdxLapDistPct`, `CarIdxPosition`, `CarIdxClassPosition`, `CarIdxF2Time`, `CarIdxEstTime`, `CarIdxOnPitRoad`, `CarIdxTrackSurface`, `CarLeftRight`.
- Fuel: `FuelLevel`, `FuelUsePerHour`, `LapDeltaTo*` family.
- Tires: per-corner temp/wear/pressure + session tire inventory (`LFTiresUsed/Available`, compounds).
- Pits: `PitSv*`, `dp*` requested service, `PitRepairLeft` / `PitOptRepairLeft`, fast repair counts.
- Weather / track: air/track temp, wetness, wind — first-class in YAML session info + live vars.
- Incidents: not as clean as LMU impact magnitude. Combine `PlayerCarTowPoint`, surface off-track, sudden Δspeed + nearby `CarIdx` proximity.

G61 remains useful as:
- community reference-lap store for iRacing
- ghost sync source
- condition-matched “laps like this one” search (Pro feature they already sell)

Do not block LMU analysis on G61 feature parity. Invert it: your tool should be the place G61-quality comparison exists for LMU.

---

## 2. Your unvetted idea list — researched and sharpened

### 2.1 Blue flags
**Why it matters:** Time loss that looks like “I was slow in S3” is often a yield. If you don’t tag it, every endurance pace model is poisoned.

**Build**
- Event: `BLUE_SHOWN`, `BLUE_CLEARED`, optional `YIELD_COMMIT` (throttle cut or move-off-line while blue + faster class closing).
- Attribution: seconds lost vs expected time-over-distance in that interval, using your own clean-lap spline — not vs a ghost that wasn’t yielding.
- UI: lap ribbon with blue segments; stint table column “blue cost”; filter “clean air only” for reference-lap picking.

**LMU caveat:** confirm blue as an explicit flag vs inferring from class + gap-behind + relative speed. iRacing is the easy win (`SessionFlags & 0x20`). Ship inference on LMU if the bit isn’t there; don’t wait.

### 2.2 Other cars on track
**This is not a map widget. It’s a context channel for every other analysis.**

Record at scoring rate (5–10 Hz is enough) for every vehicle:
`id, class, lapDist, pathLateral, speed, inPits, place, estimatedLapTime`

Derived products:
- **Traffic density** at player `lapDist` ± window (e.g. 150 m ahead, 80 m behind).
- **Class-relative delta**: time to nearest faster-class car approaching from behind; time to slower-class car ahead.
- **Clean-air classifier** for each lap: % of lap within X meters of another car. Use this as a join key when picking reference laps.
- **Overtake / being-overtaken events** with location, closing rate, whether it was same-class or multi-class.
- **Encounter forecast** (endurance): given current class pace table, predict when the next Hypercar / LMP2 / GT pack arrives at the player. StrategyMaster 3000 already sells a version of this; yours can be live + post-session.

Track map is the visualization, not the feature.

### 2.3 Contact
**Data is good enough for a timeline. It is not good enough for stewarding.** Don’t pretend it is.

Pipeline:
1. On `mLastImpactET` change, snapshot: magnitude, local impact pos, player speed/yaw, nearest N cars (dist, relative vel, heading), dent array before/after.
2. Store as `ContactEvent` with `inferredRole = incoming_rear | side | headon | wall | unknown` from impact pos + nearest-car geometry.
3. Join to subsequent damage / pace step-change / pit for repair.

Analysis value:
- Stint “pace after contact” vs baseline (often 0.2–0.5 s from aero/suspension damage you didn’t notice).
- Corner heat map of contact for a team or a season of public lobbies.
- “This lap is invalid for reference use” automatic reason code: `CONTACT`, distinct from track limits.

### 2.4 Fuel usage
Table stakes. Don’t ship a tank gauge and call it planning.

Minimum viable model:
- Per-lap consumption (exclude out-lap, in-lap, SC/FCY laps).
- Rolling median + IQR, not mean.
- Laps-to-splash, fuel-to-finish, reserve = 1.0–1.2 laps (community convention in LMU dashes).
- Fuel load vs lap time curve from your own sessions (weight effect). Use this in the planner, not a generic constant.

### 2.5 Virtual energy + endurance planning (LMU-native)
This is the feature G61 cannot copy without LMU. Prioritize it.

**Physics/regs reminder (for the model, not a tutorial):**
- VE is the regulated energy budget for the stint (fuel + electrical), not “the battery.”
- Pit time is driven by VE added, not by playing with fuel ratio. Fuel ratio changes how much chemical fuel is carried for a given VE target.
- Regen max is generally “set and forget” (LMH 200 kW / LMDh 170 kW community default). Motor map and L&C are the driver-controlled levers.
- LMDh: do not arrive at the box at 0% SoC.
- Full SoC is also bad: regen stops, you burn more chemical energy.

**Planner inputs**
- Race length (time or laps), track, class, car
- Pit-loss constant (track-specific; measure from your own pit-in/out telemetry)
- Push / lift-and-coast consumption table (you already have `mLiftAndCoastProgress`)
- Weather / SC probability (v1: manual slider; v2: from session history)
- Tire-change threshold (wear % or thermal cycles)
- Driver stint limits (endurance)

**Planner outputs**
- Stop count, windows, VE% / fuel to add per stop
- “Save X% VE per lap to drop a stop” with predicted lap-time cost (Pareto)
- L&C vs push comparison per stint
- Finish-on-time vs finish-on-laps (multiclass: overall leader ends the session)
- Live drift: planned vs actual VE/lap; recompute remaining stops every lap

REST ` /rest/strategy/usage` already gives VE history. Mirror it locally so you are not UI-coupled at race time.

### 2.6 Tire wear planning
Don’t stop at “wear %.”

- Wear rate per corner of the track (Δwear / pass), not just per stint. Shows which sequence is killing the rears.
- Thermal cycle count: time spent above optimal band (`mOptimalTemp`) per corner.
- Grip proxy vs wear: lap time vs wear% scatter, split by fuel load so you don’t confuse weight with rubber.
- Change decision: predicted time loss over next N laps on current tires vs pit-loss + fresh-tire gain. That’s the actual call.
- Compound tracking (`mCompoundIndex/Type`) so wet/dry and soft/medium/hard don’t get averaged together.

### 2.7 Elevation
Cheap, high leverage for lap analysis and brake-point coaching.

- Build `alt(s)` from world position vs lap distance on one survey lap. Cache per track (and per layout).
- Overlay grade on the brake/throttle traces: downhill entries need earlier/harder brakes; uphill exits tolerate earlier throttle.
- Grade-adjusted “expected min-speed” so a slow apex uphill isn’t flagged as a mistake.
- Endurance: power/VE cost is not uniform; mark the elevation-heavy sectors as the first place to lift-and-coast.

---

## 3. Lap analysis that is worth building (creative, high value)

Garage61 / Delta / Hotlap / Track Impulse have already commoditized “two traces and a delta.” Differentiation is *attribution* and *context*.

### 3.1 Analysis order as a product rule
Enforce this in the UI, not just in a blog post:

1. Distance-aligned **delta** (where)
2. **Line + min-speed** (what shape)
3. **Inputs** (how)
4. **Context channels** (why it wasn’t free: traffic, blue, fuel load, tire age, damage, weather, elevation)

If you start people on throttle traces you will ship a pretty tool that teaches the wrong fix.

### 3.2 Corner cost budget that sums to the lap
Segment the lap into corners + straights (detect from curvature of the racing line or from a track definition file).

For each segment output:
- time vs reference
- cause tags with $s$ estimates that **add back to the segment delta**
  - brake point (±m)
  - peak brake / trail shape
  - min speed
  - throttle pickup delay
  - steering overlap / oscillation
  - gear / shift
  - line (lateral RMSE vs ref)
  - traffic / blue / L&C / damage (context, not technique)

Rank segments by recoverable time, not by turn number. Collapse “same mistake in three similar hairpins” into one habit.

This is what Track Impulse / Hotlap.ai are selling as coaching. You can do it locally, deterministic, no LLM required for v1. LLM copy on top is optional and should cite the numbers.

### 3.3 Reference lap matching (the unglamorous killer feature)
A 0.4 s “you’re slow” vs a qualifying ghost on 20 kg less fuel and new tires is noise.

Match on:
- car + track + layout
- session type (practice vs race)
- fuel / VE remaining ± band
- tire compound + wear band
- weather / grip / wetness
- clean-air ratio
- damage state
- time of day / temp

G61 Pro already does “laps driven in similar conditions.” Reimplement as a first-class query, not a filter chip.

### 3.4 Traffic-adjusted pace
Every endurance “I found two tenths” claim is a lie until you split:
- clean-air push lap
- traffic-affected lap
- yield lap
- SC/FCY lap
- in/out lap

Show stint pace as a distribution with those labels. The number on the HUD is the clean-air median.

### 3.5 Lift-and-coast overlay (LMU exclusive)
You have `mLiftAndCoastProgress`. Almost nobody graphs it against delta.

- Mark lift point vs reference lift point.
- Show VE saved vs time lost per event.
- Build a per-corner L&C menu: “this corner returns 0.08% VE for 0.04 s” vs “this one returns 0.02% for 0.07 s.” Drivers should L&C where the exchange rate is good (usually elevation + long braking zones), not everywhere.

### 3.6 Hybrid deployment map
Motor map + SoC + regen vs lap distance.
- Where SoC hits floor or ceiling
- Where regen is clipping because SoC is full (wasted energy, extra fuel)
- Suggested map schedule: higher deploy off slow corners, harvest on the long zones

This is setup/strategy analysis, not driving-style traces. G61 explicitly said they were weak at setup-oriented channels; you can occupy that.

### 3.7 Consistency and “time left on the table”
- Theoretical best lap = best sector combo, but **also** best *corner combo with physically possible transitions* (don’t stitch a late-apex T1 onto an early-apex T2 if the car state can’t connect).
- Stint consistency: σ of clean laps, trend line (tires + fuel).
- Session “time found” ledger: the driver worked T8 this week; show the actual distribution shift. Motivation feature that also tells you the coach loop is working.

### 3.8 Math channels worth shipping early
Keep these as named, documented derived channels so the UI and the planner share them.

- Slip proxy from patch/ground vel + `mGripFract`
- Brake onset / ABS duty cycle (`mABSActive` time in zone)
- TC duty cycle
- Combined G and friction circle utilization
- Heading vs track tangent (under/oversteer proxy)
- Curvature of driven line vs reference
- Δwear and Δtemp per corner
- Grade `d(alt)/ds`

### 3.9 Video is optional; visual markers are not
Coach Dave Delta is adding synced video. That’s expensive. A cheaper 80% :
- brake/throttle points drawn on the track map *and* expressed as distance-to-next-corner and as a known track marker if you maintain a marker file
- “15 m later than ref, after the end of the wall” beats “brake 0.12 s later”

### 3.10 Multi-sim channel catalog
Define a small canonical set and map both sims into it:

`t, s, s_pct, v, throttle, brake, steer, gear, rpm, fuel, energy, soc, tire[4].{tI,tM,tO,p,wear}, flag_set, field_snapshot_id, impact, alt, weather`

Sim-specific extras hang off a sidecar, never block the core plots.

---

## 4. Competitive map (so you don’t rebuild a worse Second Monitor)

| Tool | Lane | Steal / ignore |
|---|---|---|
| Garage61 | iRacing community comparison, ghosts, condition search | Steal matching + collaboration notes. Ignore as LMU platform. |
| MoTeC i2 | Pro math channels, workspaces | Steal channel grouping + distance alignment. Don’t try to be i2. |
| lmu-pitwall | Live widgets, VE from REST, field map, engineer callouts | Steal source split (SMI + REST). Your differentiator is post-session analysis + planner quality. |
| TK LMU Dash / SimHub packs | Live endurance HUD | Leave live HUD to them unless you already have an overlay. |
| SimEndurance / StrategyMaster 3000 | Pre-race VE/fuel plan, stints, shareable plan | Steal planner UX. Beat them by closing the loop with *your recorded consumption*, live drift, and L&C exchange rates. |
| Coach Dave Delta / Hotlap / Track Impulse | Coaching copy + corner grades | Steal the cost-budget idea. Keep v1 deterministic. |
| MyLMU / LMU Trace / LMU Telemetry Lab | LMU-native record + compare | Crowded. Don’t be “another lap overlay site.” |
| Second Monitor / Z1 / CrewChief | Live race engineer | Integrate or coexist; don’t clone. |

Your wedge: **one local-first analysis + strategy brain that understands LMU energy regs and iRacing field/flags, with context-aware lap comparison.** Not another dashboard.

---

## 5. Suggested build slices (when the desktop is back on)

Ordered by “unlocks the next thing,” not by flash.

1. **Canonical session schema + adapters**
   - LMU duckdb + SMI live + REST sidecar
   - iRacing IBT + IRSDK
   - G61 import remains an iRacing reference source
2. **Track model cache**
   - `s`, centerline, width, `alt(s)`, corner segments, pit-loss constant
3. **Context event layer**
   - flags, traffic windows, contact, track limits, pit in/out, SC
4. **Reference matcher + clean-air filter**
5. **Corner cost budget on two laps**
6. **VE/fuel/tire planner fed by actual channels, with live drift**
7. **L&C exchange-rate map + hybrid deploy plot**
8. **Team artifacts**
   - shared plan, stint notes, “this lap is the reference because …”

Slice 3 is what makes slices 5–6 honest. Do not skip it.

---

## 6. Open questions to answer from your existing codebase (not from the internet)

- What does the current LMU adapter already store at sample rate vs scoring rate?
- Are you on official SMI, Iron Wolf plugin, duckdb, or a mix?
- Is the analysis domain already distance-based (`s`) or time-based? If time-based, fix that before any comparison feature.
- Do you persist the field, or only the player car? Field persistence is the contact/blue/traffic prerequisite.
- How do you define a lap boundary and invalidation today? Needs to absorb `mLapInvalidated`, track-limit steps, contact, and in-lap.
- G61 channel subset vs full IBT — what’s missing if you go direct IBT (tires, shocks, weather, CarIdx)?
- Target UX: local app (you) vs web review vs engineer on a second machine. Pitwall’s “browser on :9000” is the right engineer pattern if endurance teams are in scope.

---

## 7. Vetting checklist for any new feature

Before it hits the board:

- [ ] Named source fields exist on current LMU build **or** can be derived without guessing
- [ ] Same feature has an iRacing mapping or is explicitly LMU-only
- [ ] It changes a decision: next corner, next pit, or next reference lap
- [ ] It does not poison pace stats (events tagged, not averaged away)
- [ ] It works on a 24h file without loading the whole thing into RAM (duckdb / parquet, query by `s` and lap)
- [ ] Offline path works with the game closed

---

## 8. Raw idea parking lot (worth a spike, not a promise)

- Per-driver L&C signature for team endurance (who actually saves VE).
- Multiclass “dirty air + extra VE cost” estimate.
- Automatic pit-loss measurement per track from telemetry, replacing a constant.
- Setup delta: ride height / ARB / map changes correlated with min-speed, not just lap time.
- Public-lobby contact climatology by corner (personal risk map).
- Replay-marker export for LMU 1.4 protest workflow — out of scope unless you want to be adjacent to stewarding.
- Local speech callouts — CrewChief already owns this; only if you have an engineer mode.

---

## 9. References (for when you implement, not for reading now)

- LMU SMI header: game `Support\SharedMemoryInterface`
- Community field dump: LMU forum thread “Shared memory data structure”
- `TinyPedal/pyLMUSharedMemory`, `Swizzjack/lmu-pitwall` (SMI + REST split, VE endpoint)
- `alelosbrigia/LMU-telemetry` (duckdb → MoTeC)
- iRacing: `sajax.github.io/irsdkdocs` (`SessionFlags`, `CarIdx*`)
- VE regs / driver levers: Traxion “How to manage Virtual Energy in LMU”
- Planner prior art: StrategyMaster 3000, SimEndurance, TK LMU Dash
- Analysis prior art: Coach Dave Delta, Hotlap.ai, Track Impulse coaching model
