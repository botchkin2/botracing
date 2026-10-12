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
