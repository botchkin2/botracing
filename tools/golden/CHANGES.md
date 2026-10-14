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
