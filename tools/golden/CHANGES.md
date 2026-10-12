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
Why: #570 is reverted: Botkin says the 110 s window in this race is a real stop (fuel and repair), so the pre-start rule hid a real stop; the numbers return to the 2026-10-10 baseline (the stop with its 4 L and front-right tyre, 2 comparable laps).
Changed:
- fuel.litresPerVePctStop: null -> 1.303
- consistency.overview: "3 laps. Best lap 108.922; best sections add up to 105.843." -> "2 laps. Best lap 108.922; best sections add up to 106.272."
- laps.0.pitStop: null -> back to the stored service stop
