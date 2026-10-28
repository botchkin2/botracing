# Golden set: why a number moved

Every change to `tools/golden/expected/*.json` needs an entry here, added in the same PR, with a real
reason after `Why:` (CI: `node tools/golden/gate.mjs`). `node tools/golden/update.mjs` appends the stub; replace
`TODO` with what changed in the analysis and where (PR or thread). Newest last.

## 2026-10-10 lmu-race-road-atlanta
Why: first golden numbers for this session (LMU race with VE, a fuel start under the fill limit and a race left early); the baseline later changes are measured against.
Changed: new session (launch/golden, canard)

## 2026-10-10 iracing-race-road-atlanta
Why: first golden numbers for this session (iRacing race with one real refuel stop and no VE); the baseline later changes are measured against.
Changed: new session

## 2026-10-10 lmu-race-daytona-tyres
Why: first golden numbers for this session (LMU race with a pit stop that changed tyres); the baseline later changes are measured against.
Changed: new session

## 2026-10-10 lmu-practice-road-atlanta
Why: first golden numbers for this session (LMU practice over two files with off-track, pit and partial laps); the baseline later changes are measured against.
Changed: new session

## 2026-10-12 lmu-race-daytona-tyres
Why: the 110 s window before the green flag (263 s in, the lap counter first moves at 277 s) is the race start held in the pit lane, not a stop (pitVisit 4, tyres 4: a race window that begins before the first lap-counter change is the session start). Its 4 L top-up and front-right tyre set no longer count as a stop; the lap after it is no longer cold tyres, so 3 laps are comparable, not 2.
Changed:
- fuel.litresPerVePctStop: 1.303 -> null
- consistency.overview: "2 laps. Best lap 108.922; best sections add up to 106.272." -> "3 laps. Best lap 108.922; best sections add up to 105.843."
- laps.0.pitStop: {"added":{"fuelL":4.04,"vePct":3.1},"atEntry":{"fuelL":96.03,"vePct":96.9},"inPitS":110.4,"tyresChanged":true,"tyreWheels":["FR"],"visit":"service"} -> null

## 2026-10-12 lmu-race-daytona-tyres
Why: #570 is reverted because Botkin says the 110 s window in this race is a real stop (fuel and repair); the numbers return to the 2026-10-10 baseline, with the stop, its 4 L and front-right tyre, and 2 comparable laps.
Changed:
- fuel.litresPerVePctStop: null -> 1.303
- consistency.overview: "3 laps. Best lap 108.922; best sections add up to 105.843." -> "2 laps. Best lap 108.922; best sections add up to 106.272."
- laps.0.pitStop: null -> the stored service stop

## 2026-10-13 lmu-race-road-atlanta
Why: slow laps are now decided by the one rule in src/analysis/paceEvents.ts (a lap far above its stint's pace curve, from the sections), replacing the median cut; a lap the old cut called slow can now stay comparable, and the comparable count, median and spread move with it (decisions/lap/2026-10-12-default-selection-outliers.md).
Changed:
- summary.comparableCount: 10 -> 11
- summary.medianLapTime: 80.823 -> 80.869
- summary.stdevLapTime: 0.624 -> 1.186

## 2026-10-13 lmu-practice-road-atlanta
Why: slow laps are now decided by the one rule in src/analysis/paceEvents.ts (a lap far above its stint's pace curve, from the sections), replacing the median cut; a lap the old cut called slow can now stay comparable, and the comparable count, median and spread move with it (decisions/lap/2026-10-12-default-selection-outliers.md).
Changed:
- summary.comparableCount: 10 -> 12
- summary.medianLapTime: 80.775 -> 80.904
- summary.stdevLapTime: 0.547 -> 1.179
- stints.0.comparable: 10 -> 11
- stints.0.medianLapTime: 80.775 -> 80.853
- stints.0.stdevLapTime: 0.547 -> 1.009
- stints.1.comparable: 0 -> 1
- stints.1.bestLapTime: null -> 83.445
- stints.1.medianLapTime: null -> 83.445
- cornerMedians.0: 6.782 -> 6.797000000000001
- cornerMedians.1: 13.96 -> 13.979
- cornerMedians.2: 10.569500000000001 -> 10.603
- cornerMedians.3: 28.9425 -> 28.945
- cornerMedians.4: 16.4435 -> 16.454
- laps.1.reasons.0: "slow" -> undefined
- laps.1.comparable: false -> true
- laps.15.reasons.0: "slow" -> undefined
- laps.15.comparable: false -> true

## 2026-10-14 iracing-race-road-atlanta
Why: a lap with an iRacing local yellow was excluded as a full-course yellow; a yellow never selects a lap (decision 2026-10-11 #4), so it now counts (6 -> 7 laps).
Changed:
- consistency.overview: "6 laps. Scatter 0.81 s around the pace trend (raw spread 0.94 s). Best lap 79.345; best sections add up to 75.240. No lap off pace. Most time lost against repeatable pace: section 2 (2.3 s), section 6 (1.1 s)." -> "7 laps. Scatter 0.72 s around the pace trend (raw spread 0.86 s). Best lap 79.345; best sections add up to 75.240. No lap off pace. Most time lost against repeatable pace: section 2 (2.2 s), section 6 (1.6 s)."

## 2026-10-18 lmu-practice-road-atlanta
Why: lap 15 (83.445 s, alone in stint 1) was judged against its own one-lap curve, a residual of 0, so it could not be slow; a stint under MIN_CURVE_LAPS = 3 laps is now judged against the session pace (pit-wall thread 75 #5876, slowLaps 2), so it is slow (3 % over the 80.9 s median) and leaves the comparable set. The session limit is unchanged.
Changed:
- summary.comparableCount: 12 -> 11
- summary.medianLapTime: 80.904 -> 80.853
- summary.stdevLapTime: 1.179 -> 1.009
- stints.1.comparable: 1 -> 0
- stints.1.bestLapTime: 83.445 -> null
- stints.1.medianLapTime: 83.445 -> null
- cornerMedians.0: 6.797000000000001 -> 6.782
- cornerMedians.1: 13.979 -> 13.963
- cornerMedians.2: 10.603 -> 10.602
- cornerMedians.3: 28.945 -> 28.944
- cornerMedians.4: 16.454 -> 16.444
- laps.15.reasons.0: undefined -> "slow"
- laps.15.comparable: true -> false

## 2026-10-18 lmu-race-road-atlanta
Why: a brake application now brakes for the first part whose apex is after its peak (pit-wall thread 92, CORNER_INPUTS_VERSION 3), not the first part turning in after its onset. Lap 7's 11 % touch at 1148.6 m peaks before the first part's apex, so it is that part's, not the second's.
Changed:
- laps.7.corners.2.parts.0.brakeAtM: null -> 1148.6
- laps.7.corners.2.parts.0.peakBrakePct: null -> 11.1
- laps.7.corners.2.parts.1.brakeAtM: 1148.6 -> null
- laps.7.corners.2.parts.1.peakBrakePct: 11.1 -> null

## 2026-10-18 iracing-race-road-atlanta
Why: the same rule (thread 92). Lap 4's later application in this window (peak 55.8 %) peaks past the last part's apex: it brakes for the next section, so it is no part's. The last part keeps its own stop at 1293.2 m (peak 41.4 %), and with the throttle closed from it to the next section's braking, the window holds no throttle pickup.
Changed:
- laps.4.corners.2.parts.2.peakBrakePct: 55.8 -> 41.4
- laps.4.corners.2.parts.2.throttlePickupAtM: 1473.6 -> null

## 2026-10-18 lmu-race-road-atlanta
Why: CORNER_INPUTS_VERSION 4 adds two facts per corner part, the line (`apexLateralM`, path_lateral_m at the slowest sample) and the steering size there (`apexSteerPct`), for the Corner card "what moves with the time" (pit-wall thread 88, S4); null where the slowest sample is on the window's edge. Nothing else moved.
Changed:
- laps.#.corners.#.parts.#.apexLateralM: undefined -> value or null (every part of every lap)
- laps.#.corners.#.parts.#.apexSteerPct: undefined -> value or null (every part of every lap)

## 2026-10-18 iracing-race-road-atlanta
Why: CORNER_INPUTS_VERSION 4 adds two facts per corner part, the line (`apexLateralM`, path_lateral_m at the slowest sample) and the steering size there (`apexSteerPct`), for the Corner card "what moves with the time" (pit-wall thread 88, S4); null where the slowest sample is on the window's edge or has no line channel (iRacing records no path_lateral_m: apexLateralM is null on every part, apexSteerPct is set). Nothing else moved.
Changed:
- laps.#.corners.#.parts.#.apexLateralM: undefined -> value or null (every part of every lap)
- laps.#.corners.#.parts.#.apexSteerPct: undefined -> value or null (every part of every lap)

## 2026-10-18 lmu-race-daytona-tyres
Why: CORNER_INPUTS_VERSION 4 adds two facts per corner part, the line (`apexLateralM`, path_lateral_m at the slowest sample) and the steering size there (`apexSteerPct`), for the Corner card "what moves with the time" (pit-wall thread 88, S4); null where the slowest sample is on the window's edge. Nothing else moved.
Changed:
- laps.#.corners.#.parts.#.apexLateralM: undefined -> value or null (every part of every lap)
- laps.#.corners.#.parts.#.apexSteerPct: undefined -> value or null (every part of every lap)

## 2026-10-18 lmu-practice-road-atlanta
Why: CORNER_INPUTS_VERSION 4 adds two facts per corner part, the line (`apexLateralM`, path_lateral_m at the slowest sample) and the steering size there (`apexSteerPct`), for the Corner card "what moves with the time" (pit-wall thread 88, S4); null where the slowest sample is on the window's edge. Nothing else moved.
Changed:
- laps.#.corners.#.parts.#.apexLateralM: undefined -> value or null (every part of every lap)
- laps.#.corners.#.parts.#.apexSteerPct: undefined -> value or null (every part of every lap)

## 2026-10-24 lmu-race-daytona-tyres
Why: GRID_LAP_VERSION 2: a grid start's lap 0 is read over its racing lap (line to line), no longer over the stretch to the formation line, so the lap's off-track seconds are the racing lap's (0.26 s, none before) (pit-wall thread 100, ticket #49). Only lap 0 moved; every other lap and number is unchanged.
Changed:
- laps.0.offTrackSec: 0 -> 0.26

## 2026-10-25 lmu-race-road-atlanta
Why: the session doc's fuel block gains setupVePct and setupVePerLapPct, LMU's own VE expectation read from the car setup's VM_VIRTUAL_ENERGY string (pit-wall thread 104 #7391, ticket #47). The golden slices carry no such string (iRacing has none), so both are null here and no other number moved.
Changed:
- fuel.setupVePct: undefined -> null
- fuel.setupVePerLapPct: undefined -> null

## 2026-10-25 iracing-race-road-atlanta
Why: the session doc's fuel block gains setupVePct and setupVePerLapPct, LMU's own VE expectation read from the car setup's VM_VIRTUAL_ENERGY string (pit-wall thread 104 #7391, ticket #47). The golden slices carry no such string (iRacing has none), so both are null here and no other number moved.
Changed:
- fuel.setupVePct: undefined -> null
- fuel.setupVePerLapPct: undefined -> null

## 2026-10-25 lmu-race-daytona-tyres
Why: the session doc's fuel block gains setupVePct and setupVePerLapPct, LMU's own VE expectation read from the car setup's VM_VIRTUAL_ENERGY string (pit-wall thread 104 #7391, ticket #47). The golden slices carry no such string (iRacing has none), so both are null here and no other number moved.
Changed:
- fuel.setupVePct: undefined -> null
- fuel.setupVePerLapPct: undefined -> null

## 2026-10-25 lmu-practice-road-atlanta
Why: the session doc's fuel block gains setupVePct and setupVePerLapPct, LMU's own VE expectation read from the car setup's VM_VIRTUAL_ENERGY string (pit-wall thread 104 #7391, ticket #47). The golden slices carry no such string (iRacing has none), so both are null here and no other number moved.
Changed:
- fuel.setupVePct: undefined -> null
- fuel.setupVePerLapPct: undefined -> null

## 2026-10-27 lmu-race-road-atlanta
Why: the lap next to a stint's edge is now judged with Tukey's end rule from the first two full 5-lap windows (ticket 31, pit-wall thread 120, slowLaps 4), so a run of 2 slow laps at a stint's start is an event as it is mid-stint. Lap 1 (84.553 s, the first candidate lap, 4.6 % over the 80.8 s median) was ticked because it and lap 2 (81.53 s) were read as the stint's pace; it is now slow and leaves the comparable set, so the count, median and spread move. The session's limit is unchanged.
Changed:
- summary.comparableCount: 11 -> 10
- summary.medianLapTime: 80.869 -> 80.823
- summary.stdevLapTime: 1.186 -> 0.624

## 2026-10-27 lmu-practice-road-atlanta
Why: the lap next to a stint's edge is now judged with Tukey's end rule from the first two full 5-lap windows (ticket 31, pit-wall thread 120, slowLaps 4), so a run of 2 slow laps at a stint's start is an event as it is mid-stint. Lap 1 (83.695 s, the first candidate lap, 3.5 % over the 80.9 s median) is now slow and leaves the comparable set (stint 1: 11 -> 10, and the laps' reasons). The session summary's count, median and spread read the first pass, which judges by lap times alone and flags laps 1 and 2 (9 laps), so they move by one more lap than the final flags do; that gap is older than this change. The session's limit is unchanged.
Changed:
- summary.comparableCount: 11 -> 9
- summary.medianLapTime: 80.853 -> 80.697
- summary.stdevLapTime: 1.009 -> 0.356
- stints.0.comparable: 11 -> 10
- stints.0.medianLapTime: 80.853 -> 80.775
- stints.0.stdevLapTime: 1.009 -> 0.547
- cornerMedians.1: 13.963 -> 13.96
- cornerMedians.2: 10.602 -> 10.569500000000001
- cornerMedians.3: 28.944 -> 28.9425
- cornerMedians.4: 16.444 -> 16.4435
- laps.1.reasons.0: undefined -> "slow"
- laps.1.comparable: true -> false
