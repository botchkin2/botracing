# The numbers audit

Walks every session through the app's own API client and model functions and
checks each headline number against an independent recompute from the stored
laps (pit-wall thread 1 #4835). Read only: GET requests as `seat-test`.

- `allSessions.ts`: `walkSessions(visit)` lists every session, loads detail,
  laps and the track map the way the app does, and calls `visit` for each. Use it
  for any all-sessions check. `signInFromFile(tokenFile)` signs the data layer in.
- `dumpSessions.test.ts`: writes every session as one JSON line (`sessions.ndjson`)
  so a check can run offline over the same data.
- `numbersAudit.ts`: `auditSession(session, laps, map)` returns findings of four
  types: `mismatch` (a shown number differs from the recompute), `set` (a number
  computed on another set of laps than its label says: head median over all
  comparable laps while the selection is smaller; "of N" that is not the basis
  count), `zero` (a 0 where a value is missing: a spread of one lap), `selection`
  (the opening selection is not every comparable lap, decision 2026-10-11).
  The recompute shares no code with `src/analysis/setStats.ts`.
- `numbersAudit.test.ts`: runs it over every session and prints counts per type,
  per check, and the ten worst sessions.

Jest tests, so they use the project's alias and the app's model code. All are
skipped unless an env var is set; they hold lap data, so keep dumps out of the repo.

```powershell
node functions/scripts/mintTestToken.mjs --id-token-file $env:TEMP\seat-test.token
$env:AUDIT_TOKEN_FILE = "$env:TEMP\seat-test.token"
npx jest tools/audit/numbersAudit                       # live, as seat-test
$env:AUDIT_OUT = "$env:TEMP\audit"; npx jest tools/audit/dumpSessions
$env:AUDIT_NDJSON = "$env:TEMP\audit\sessions.ndjson"; npx jest tools/audit/numbersAudit   # offline
```

`AUDIT_REPORT=<file>` also writes the full report (every finding per session) as JSON.
Rerun after a numbers PR: the counts go to 0.

Not yet covered: Compare's reference and "median of N", Corner per section, the Plan's
pooled values (they need the same walk plus their own model functions).
