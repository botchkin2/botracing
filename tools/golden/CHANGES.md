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
